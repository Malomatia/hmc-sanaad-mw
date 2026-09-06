import { BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { Request, Response } from 'express';
import { ProxyService } from './proxy.service';

describe('ProxyService', () => {
  const config = {
    getOrThrow: (key: string) =>
      key === 'backend'
        ? { baseUrl: 'http://backend.local', apiPrefix: 'api/v1', timeoutMs: 30000 }
        : { apiPrefix: 'api/v1' },
  } as unknown as ConfigService;

  const makeRes = (): Response => {
    const res: Partial<Response> = {
      status: jest.fn().mockReturnThis(),
      setHeader: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    return res as Response;
  };

  const makeReq = (overrides: Partial<Request> = {}): Request =>
    ({
      originalUrl: '/api/v1/auth/login?lang=ar',
      method: 'POST',
      headers: { authorization: 'Bearer abc', 'content-type': 'application/json' },
      body: { username: 'x' },
      correlationId: 'cid-123',
      ...overrides,
    }) as unknown as Request;

  it('forwards the request to the backend and relays status/body/headers untouched', async () => {
    const backendBody = Buffer.from(JSON.stringify({ result: { token: 'jwt' } }));
    const request = jest.fn().mockReturnValue(
      of({
        status: 200,
        data: backendBody,
        headers: { 'content-type': 'application/json', 'x-correlation-id': 'cid-123' },
      }),
    );
    const http = { request } as unknown as HttpService;
    const service = new ProxyService(http, config);
    const req = makeReq();
    const res = makeRes();

    await service.forward(req, res);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/v1/auth/login?lang=ar',
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer abc',
          'content-type': 'application/json',
          'x-correlation-id': 'cid-123',
        }),
        data: { username: 'x' },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'application/json');
    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'cid-123');
    expect(res.send).toHaveBeenCalledWith(backendBody);
  });

  it.each(['en', 'ar'])('forwards lang=%s while preserving the header allowlist', async (lang) => {
    const request = jest
      .fn()
      .mockReturnValue(of({ status: 200, data: Buffer.alloc(0), headers: {} }));
    const service = new ProxyService({ request } as unknown as HttpService, config);
    const allowedHeaders = {
      authorization: 'Bearer abc',
      'content-type': 'application/json',
      accept: 'application/json',
      'accept-language': lang === 'en' ? 'ar' : 'en',
      lang,
      'x-integrity-token': 'integrity-token',
      'x-integrity-request-hash': 'request-hash',
      'x-integrity-challenge': 'challenge',
      'x-ios-assertion': 'assertion',
      'x-ios-key-id': 'key-id',
    };

    await service.forward(
      makeReq({
        headers: {
          ...allowedHeaders,
          cookie: 'session=private',
          'x-user-role': 'admin',
          'x-forwarded-for': '203.0.113.1',
          'x-correlation-id': 'untrusted-cid',
        },
      }),
      makeRes(),
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { ...allowedHeaders, 'x-correlation-id': 'cid-123' },
      }),
    );
  });

  it('does not infer a lang header from accept-language or the query string', async () => {
    const request = jest
      .fn()
      .mockReturnValue(of({ status: 200, data: Buffer.alloc(0), headers: {} }));
    const service = new ProxyService({ request } as unknown as HttpService, config);

    await service.forward(makeReq({ headers: { 'accept-language': 'ar' } }), makeRes());

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { 'accept-language': 'ar', 'x-correlation-id': 'cid-123' },
      }),
    );
  });

  it('rewrites the gateway API prefix to the backend API prefix', async () => {
    const request = jest
      .fn()
      .mockReturnValue(of({ status: 200, data: Buffer.alloc(0), headers: {} }));
    const http = { request } as unknown as HttpService;
    const backendPrefixConfig = {
      getOrThrow: (key: string) =>
        key === 'backend'
          ? { baseUrl: 'http://backend.local', apiPrefix: 'internal/v2', timeoutMs: 30000 }
          : { apiPrefix: 'api/v1' },
    } as unknown as ConfigService;
    const service = new ProxyService(http, backendPrefixConfig);

    await service.forward(makeReq({ originalUrl: '/api/v1/leave/balance' }), makeRes());

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: '/internal/v2/leave/balance' }),
    );
  });

  it('maps a connection failure to BadGatewayException', async () => {
    const request = jest
      .fn()
      .mockReturnValue(
        throwError(() =>
          Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
        ),
      );
    const http = { request } as unknown as HttpService;
    const service = new ProxyService(http, config);

    await expect(service.forward(makeReq(), makeRes())).rejects.toThrow(BadGatewayException);
  });

  it('maps a timeout to GatewayTimeoutException', async () => {
    const request = jest
      .fn()
      .mockReturnValue(
        throwError(() =>
          Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }),
        ),
      );
    const http = { request } as unknown as HttpService;
    const service = new ProxyService(http, config);

    await expect(service.forward(makeReq(), makeRes())).rejects.toThrow(GatewayTimeoutException);
  });
});
