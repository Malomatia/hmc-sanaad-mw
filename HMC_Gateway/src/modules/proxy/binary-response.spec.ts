import { ProxyService } from './proxy.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import type { Request, Response } from 'express';

/**
 * The attachment download serves a real file. A client needs three headers to
 * make sense of it — the type, the length, and the filename — and the proxy
 * relays an allow-list, so anything missing from that list simply disappears.
 *
 * `Content-Disposition` was missing, which is how a verified-working download
 * still arrived without its filename.
 */
describe('proxy relaying a binary response', () => {
  function make(responseHeaders: Record<string, string>) {
    const http = {
      request: jest.fn().mockReturnValue(
        of({
          status: 200,
          headers: responseHeaders,
          data: Buffer.from('%PDF-1.4'),
        }),
      ),
    } as unknown as HttpService;

    const config = {
      getOrThrow: (key: string) =>
        key === 'backend'
          ? { baseUrl: 'http://backend', apiPrefix: 'api/v1', timeoutMs: 1000 }
          : { apiPrefix: 'api/v1' },
    } as unknown as ConfigService;

    const set: Record<string, unknown> = {};
    const res = {
      status: jest.fn().mockReturnThis(),
      setHeader: (k: string, v: unknown) => {
        set[k] = v;
      },
      send: jest.fn(),
    } as unknown as Response;

    const req = {
      method: 'GET',
      originalUrl: '/api/v1/approvals/attachments/86443491',
      headers: {},
      body: undefined,
    } as unknown as Request;

    return { service: new ProxyService(http, config), req, res, set };
  }

  const FILE_HEADERS = {
    'content-type': 'application/pdf',
    'content-disposition': 'inline; filename="marriage-cert.pdf"',
    'content-length': '8',
  };

  it('relays the filename, so the client can name what it downloaded', async () => {
    const { service, req, res, set } = make(FILE_HEADERS);

    await service.forward(req, res);

    expect(set['content-disposition']).toBe('inline; filename="marriage-cert.pdf"');
  });

  it('relays the content type and length', async () => {
    const { service, req, res, set } = make(FILE_HEADERS);

    await service.forward(req, res);

    expect(set['content-type']).toBe('application/pdf');
    expect(set['content-length']).toBe('8');
  });

  it('passes the bytes through untouched', async () => {
    const { service, req, res } = make(FILE_HEADERS);

    await service.forward(req, res);

    expect((res.send as jest.Mock).mock.calls[0][0].toString()).toBe('%PDF-1.4');
  });

  it('does not invent headers the backend did not send', async () => {
    const { service, req, res, set } = make({ 'content-type': 'application/json' });

    await service.forward(req, res);

    expect(set['content-disposition']).toBeUndefined();
  });
});
