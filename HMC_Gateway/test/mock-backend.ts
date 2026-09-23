import * as http from 'http';
import * as jwt from 'jsonwebtoken';

export interface CapturedRequest {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

export interface MockBackend {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

/**
 * A minimal stand-in for HMC_BackEnd used by the gateway's e2e tests: it
 * mints a real JWT (signed with the same secret the gateway is configured
 * with) on /auth/login, echoes the bearer token it received on any other
 * route, and records every request so tests can assert what the gateway
 * forwarded.
 */
export function startMockBackend(jwtSecret: string): Promise<MockBackend> {
  const requests: CapturedRequest[] = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });

      if (req.url?.startsWith('/api/v1/auth/login')) {
        const token = jwt.sign({ username: 'AIBRAHIM39', employeeNumber: '037400' }, jwtSecret, {
          expiresIn: '1h',
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', token }));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/v1/app-integrity/challenge') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            result: { challenge: 'mock-attestation-challenge' },
            opstatus: 0,
            status: 'success',
            httpStatusCode: 200,
          }),
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/api/v1/app-integrity/ios/register') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            result: { message: 'Device attested.' },
            opstatus: 0,
            status: 'success',
            httpStatusCode: 200,
          }),
        );
        return;
      }

      if (req.method === 'POST' && req.url === '/api/v1/app-integrity/android/verify') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            result: { verified: false, reason: 'Play Integrity is not configured' },
            opstatus: 0,
            status: 'success',
            httpStatusCode: 200,
          }),
        );
        return;
      }

      if (req.method === 'GET' && req.url === '/api/v1/app-setting') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            terms_and_conditions_status: true,
            terms_and_conditions_url: 'https://example.com/terms',
          }),
        );
        return;
      }

      if (req.url?.startsWith('/api/v1/slow')) {
        // Never responds — used to exercise the gateway's timeout handling.
        return;
      }

      if (req.url?.startsWith('/api/v1/employee/profile')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            result: { name: 'Ahmed Ibrahim' },
            opstatus: 0,
            status: 'success',
            httpStatusCode: 200,
            receivedAuthorization: req.headers.authorization ?? null,
          }),
        );
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: 'not found' }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
