import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { IntegrityPreCheckGuard } from './integrity-precheck.guard';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';

/**
 * The gateway's half of device attestation: everything that can be decided
 * without a database or a platform credential, because it holds neither by
 * design.
 *
 * The cryptography stays in the backend, so these cases are about the split
 * being honest — the gateway must drop junk cheaply and must never refuse a
 * request it has no way to judge.
 */
describe('IntegrityPreCheckGuard', () => {
  const TOKEN = 'a'.repeat(64);

  function make(mode: 'off' | 'observe' | 'enforce') {
    const config = { getOrThrow: () => ({ mode }) } as unknown as ConfigService;
    return new IntegrityPreCheckGuard(new Reflector(), config);
  }

  function context(
    headers: Record<string, string> = {},
    opts: { rawBody?: Buffer; body?: unknown; isPublic?: boolean } = {},
  ): ExecutionContext {
    const handler = () => undefined;
    class Controller {}
    if (opts.isPublic) Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
    return {
      getHandler: () => handler,
      getClass: () => Controller,
      switchToHttp: () => ({
        getRequest: () => ({
          headers,
          rawBody: opts.rawBody,
          body: opts.body,
          originalUrl: '/api/v1/leave/apply',
        }),
      }),
    } as unknown as ExecutionContext;
  }

  describe('off — the default', () => {
    it('lets everything through', () => {
      expect(make('off').canActivate(context())).toBe(true);
    });
  });

  describe('observe', () => {
    it('allows a request with nothing attached, so nobody is locked out while measuring', () => {
      expect(make('observe').canActivate(context())).toBe(true);
    });

    it('allows a mismatched hash too', () => {
      const ctx = context(
        { 'x-integrity-token': TOKEN, 'x-integrity-request-hash': 'f'.repeat(64) },
        { rawBody: Buffer.from('{"a":1}') },
      );

      expect(make('observe').canActivate(ctx)).toBe(true);
    });
  });

  describe('enforce — Android', () => {
    it('accepts a plausible token', () => {
      expect(make('enforce').canActivate(context({ 'x-integrity-token': TOKEN }))).toBe(true);
    });

    it('accepts a hash computed over the body we actually received', () => {
      const raw = Buffer.from('{"leave":"casual"}');
      const ctx = context(
        {
          'x-integrity-token': TOKEN,
          'x-integrity-request-hash': createHash('sha256').update(raw).digest('hex'),
        },
        { rawBody: raw },
      );

      expect(make('enforce').canActivate(ctx)).toBe(true);
    });

    it('rejects a hash belonging to a different body — a token lifted onto another request', () => {
      const ctx = context(
        {
          'x-integrity-token': TOKEN,
          'x-integrity-request-hash': createHash('sha256').update('{"amount":1}').digest('hex'),
        },
        { rawBody: Buffer.from('{"amount":1000000}') },
      );

      expect(() => make('enforce').canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('rejects a hash that is not even a digest', () => {
      const ctx = context(
        { 'x-integrity-token': TOKEN, 'x-integrity-request-hash': 'nonsense' },
        { rawBody: Buffer.from('{}') },
      );

      expect(() => make('enforce').canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('allows a token sent without a hash — the backend still verifies it', () => {
      // The hash is optional in the protocol; refusing here would invent a rule.
      expect(make('enforce').canActivate(context({ 'x-integrity-token': TOKEN }))).toBe(true);
    });

    it('rejects a token too short to be real', () => {
      expect(() => make('enforce').canActivate(context({ 'x-integrity-token': 'abc' }))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a token containing characters no encoder produces', () => {
      const ctx = context({ 'x-integrity-token': 'a'.repeat(40) + ' <script>' });

      expect(() => make('enforce').canActivate(ctx)).toThrow(UnauthorizedException);
    });
  });

  describe('enforce — iOS', () => {
    const IOS = {
      'x-ios-assertion': TOKEN,
      'x-ios-key-id': 'key-1',
      'x-integrity-challenge': 'nonce',
    };

    it('accepts a complete set of headers', () => {
      expect(make('enforce').canActivate(context(IOS))).toBe(true);
    });

    it('rejects an assertion with no key id — the backend could not look it up', () => {
      const { 'x-ios-key-id': _omitted, ...withoutKeyId } = IOS;

      expect(() => make('enforce').canActivate(context(withoutKeyId))).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an assertion with no challenge', () => {
      const { 'x-integrity-challenge': _omitted, ...withoutChallenge } = IOS;

      expect(() => make('enforce').canActivate(context(withoutChallenge))).toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('enforce — general', () => {
    it('rejects a request carrying no attestation at all', () => {
      expect(() => make('enforce').canActivate(context())).toThrow(UnauthorizedException);
    });

    it('exempts the pre-login journey, where a device has no session yet', () => {
      expect(make('enforce').canActivate(context({}, { isPublic: true }))).toBe(true);
    });

    it('falls back to the parsed body when the raw bytes are unavailable', () => {
      const body = { leave: 'casual' };
      const ctx = context(
        {
          'x-integrity-token': TOKEN,
          'x-integrity-request-hash': createHash('sha256')
            .update(JSON.stringify(body))
            .digest('hex'),
        },
        { body },
      );

      expect(make('enforce').canActivate(ctx)).toBe(true);
    });
  });
});
