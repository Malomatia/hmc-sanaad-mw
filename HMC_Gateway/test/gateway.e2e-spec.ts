import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MockBackend, startMockBackend } from './mock-backend';

const JWT_SECRET = 'e2e-test-secret-value-not-for-production';

async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();
  return app;
}

describe('Gateway (e2e) — backend reachable', () => {
  let backend: MockBackend;
  let app: INestApplication;

  beforeAll(async () => {
    backend = await startMockBackend(JWT_SECRET);
    process.env.BACKEND_BASE_URL = backend.url;
    process.env.BACKEND_API_PREFIX = 'api/v1';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.AUTH_DISABLED = 'false';
    process.env.THROTTLE_LOGIN_LIMIT = '2';
    process.env.THROTTLE_LOGIN_TTL_MS = '60000';
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    await backend.close();
  });

  it('forwards POST /auth/login to the backend and relays its body/status untouched', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'AIBRAHIM39', mpin: '1234' })
      .expect(200);

    expect(res.body.status).toBe('success');
    expect(typeof res.body.token).toBe('string');

    const forwarded = backend.requests.find((r) => r.url?.startsWith('/api/v1/auth/login'));
    expect(forwarded?.body).toEqual({ username: 'AIBRAHIM39', mpin: '1234' });
  });

  describe.each(['initiate', 'send-otp', 'mpin/forgot'])('POST /auth/%s', (route) => {
    it.each(['en', 'ar'])('forwards lang=%s without a bearer token', async (lang) => {
      const body = { username: 'test-user', deviceid: 'test-device' };
      const acceptLanguage = lang === 'en' ? 'ar' : 'en';
      const requestCount = backend.requests.length;
      const res = await request(app.getHttpServer())
        .post(`/api/v1/auth/${route}`)
        .set('lang', lang)
        .set('Accept-Language', acceptLanguage)
        .set('Cookie', 'session=private')
        .send(body)
        .expect(404);

      expect(res.body).toEqual({ status: 'error', message: 'not found' });
      expect(backend.requests).toHaveLength(requestCount + 1);
      const forwarded = backend.requests[requestCount];
      expect(forwarded.method).toBe('POST');
      expect(forwarded.url).toBe(`/api/v1/auth/${route}`);
      expect(forwarded.body).toEqual(body);
      expect(forwarded.headers.lang).toBe(lang);
      expect(forwarded.headers['accept-language']).toBe(acceptLanguage);
      expect(forwarded.headers.cookie).toBeUndefined();
      expect(forwarded.headers.authorization).toBeUndefined();
    });
  });

  it('rejects an unauthenticated request to a proxied (wildcard) route with 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/employee/profile').expect(401);
  });

  it('proxies an authenticated request through the wildcard controller with the bearer token forwarded', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'AIBRAHIM39', mpin: '1234' });
    const token = login.body.token as string;

    const res = await request(app.getHttpServer())
      .get('/api/v1/employee/profile')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.result).toEqual({ name: 'Ahmed Ibrahim' });
    expect(res.body.receivedAuthorization).toBe(`Bearer ${token}`);
  });
});

describe('Gateway (e2e) — throttling', () => {
  let backend: MockBackend;
  let app: INestApplication;

  beforeAll(async () => {
    backend = await startMockBackend(JWT_SECRET);
    process.env.BACKEND_BASE_URL = backend.url;
    process.env.BACKEND_API_PREFIX = 'api/v1';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.AUTH_DISABLED = 'false';
    process.env.THROTTLE_LOGIN_LIMIT = '2';
    process.env.THROTTLE_LOGIN_TTL_MS = '60000';
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    await backend.close();
  });

  it('rate-limits repeated login attempts beyond THROTTLE_LOGIN_LIMIT', async () => {
    const attempt = () =>
      request(app.getHttpServer()).post('/api/v1/auth/login').send({ username: 'x', mpin: '0000' });

    await attempt().expect(200);
    await attempt().expect(200);
    await attempt().expect(429);
  });
});

describe('Gateway (e2e) — backend unreachable', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Nothing listens here — exercises ProxyService's connection-failure path.
    process.env.BACKEND_BASE_URL = 'http://127.0.0.1:1';
    process.env.BACKEND_API_PREFIX = 'api/v1';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.AUTH_DISABLED = 'true';
    process.env.THROTTLE_LOGIN_LIMIT = '100';
    process.env.THROTTLE_LOGIN_TTL_MS = '60000';
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a minimal 502 when the backend connection is refused', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({}).expect(502);

    expect(res.body).toEqual(expect.objectContaining({ status: 'error', httpStatusCode: 502 }));
  });
});
