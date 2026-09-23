import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { MockBackend, startMockBackend } from './mock-backend';

const JWT_SECRET = 'e2e-test-secret-value-not-for-production';
const signToken = (claims: Record<string, unknown>) =>
  jwt.sign(claims, JWT_SECRET, { expiresIn: '1h' });

async function expectUnauthorized(
  attempt: request.Test,
  backend: MockBackend,
  message = 'Unauthorized action',
): Promise<void> {
  const requestCount = backend.requests.length;
  const res = await attempt.expect(401);
  expect(res.body).toEqual({ status: 'error', message, httpStatusCode: 401 });
  expect(backend.requests).toHaveLength(requestCount);
}

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

  describe('query identity authorization', () => {
    const claims = { username: 'AIBRAHIM39', employeeNumber: '037400' };
    const token = signToken(claims);
    const profile = '/api/v1/employee/profile';

    it.each(['get', 'post', 'put', 'patch', 'delete'] as const)(
      '%s wildcard forwards matching URL/body untouched and blocks mismatches',
      async (method) => {
        const url = `${profile}?username=%61ibrahim39&enum=037400&note=a+b&note=a%20b`;
        const body = { username: 'body-only-user', enum: '999999', nested: { keep: [' 01 '] } };
        const requestCount = backend.requests.length;
        const attempt = request(app.getHttpServer())
          [method](url)
          .set('Authorization', `Bearer ${token}`);
        if (method !== 'get') attempt.send(body);
        await attempt.expect(200);
        expect(backend.requests).toHaveLength(requestCount + 1);
        expect(backend.requests[requestCount]).toEqual(
          expect.objectContaining({
            method: method.toUpperCase(),
            url,
            body: method === 'get' ? undefined : body,
            headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
          }),
        );

        const rejected = request(app.getHttpServer())
          [method](`${profile}?username=OTHER&enum=999999`)
          .set('Authorization', `Bearer ${token}`);
        if (method !== 'get') rejected.send(body);
        await expectUnauthorized(rejected, backend);
      },
    );

    it.each([
      ['username=AIBRAHIM39', { username: 'AIBRAHIM39' }],
      ['username=aibrahim39', { username: 'AIBRAHIM39' }],
      ['username=AIBRAHIM39', { username: 'aibrahim39' }],
      ['enum=037400', { employeeNumber: '037400' }],
      ['enum=emp0037', { employeeNumber: 'EMP0037' }],
      ['enum=EMP0037', { employeeNumber: 'emp0037' }],
      ['username=AiBrAhIm39&enum=Emp0037', { username: 'aibrahim39', employeeNumber: 'EMP0037' }],
    ] as const)(
      'allows case-insensitive matching for only the supplied keys: %s',
      async (query, payload) => {
        const url = `${profile}?${query}`;
        const requestCount = backend.requests.length;
        await request(app.getHttpServer())
          .get(url)
          .set('Authorization', `Bearer ${signToken(payload)}`)
          .expect(200);
        expect(backend.requests).toHaveLength(requestCount + 1);
        expect(backend.requests[requestCount].url).toBe(url);
      },
    );

    it('preserves decoded spaces, plus signs and zeroes when forwarding', async () => {
      const payload = { username: ' أحمد+User ', employeeNumber: ' 0037 ' };
      const url = `${profile}?user%6eame=+${encodeURIComponent('أحمد')}%2BUser%20&en%75m=%200037+`;
      const requestCount = backend.requests.length;
      await request(app.getHttpServer())
        .get(url)
        .set('Authorization', `Bearer ${signToken(payload)}`)
        .expect(200);
      expect(backend.requests).toHaveLength(requestCount + 1);
      expect(backend.requests[requestCount].url).toBe(url);
    });

    it.each([
      'username=aibrahim39&enum=999999',
      'username=OTHER&enum=037400',
      'username=%20AIBRAHIM39',
      'username=AIBRAHIM39+',
      'enum=37400',
      'enum=037400%20',
      'username',
      'enum=',
      'username=AIBRAHIM39&username=AIBRAHIM39',
      'enum=037400&enum=999999',
      'enum=037400&en%75m=037400',
      'username[]=AIBRAHIM39',
      'enum[0]=037400',
      'username[name]=AIBRAHIM39',
      'en%75m%5Bvalue%5D=037400',
      'user%6eame%5B%5D=AIBRAHIM39',
      'username=AIBRAHIM39&username%5B%5D=AIBRAHIM39',
    ])('rejects non-exact or ambiguous identity query %s before proxying', async (query) => {
      await expectUnauthorized(
        request(app.getHttpServer())
          .get(`${profile}?${query}`)
          .set('Authorization', `Bearer ${token}`),
        backend,
      );
    });

    it.each([
      ['username=AIBRAHIM39', {}],
      ['enum=037400', {}],
      ['username=AIBRAHIM39', { sub: 'AIBRAHIM39' }],
      ['enum=037400', { enum: '037400' }],
      ['enum=037400', { sub: '037400' }],
      ['username=123', { username: 123 }],
      ['enum=37400', { employeeNumber: 37400 }],
      ['username=', { username: '' }],
      ['enum=', { employeeNumber: '' }],
    ] as const)('requires an exact nonempty string claim for %s (%j)', async (query, payload) => {
      await expectUnauthorized(
        request(app.getHttpServer())
          .get(`${profile}?${query}`)
          .set('Authorization', `Bearer ${signToken(payload)}`),
        backend,
      );
    });

    it.each([
      ['missing', undefined],
      ['malformed', 'not-a-jwt'],
      ['wrong signature', jwt.sign(claims, 'another-signing-secret')],
      ['expired', jwt.sign(claims, JWT_SECRET, { expiresIn: -1 })],
    ])('rejects a %s JWT with the query identity error envelope', async (_name, bearer) => {
      const attempt = request(app.getHttpServer()).get(
        `${profile}?username=AIBRAHIM39&enum=037400`,
      );
      if (bearer) attempt.set('Authorization', `Bearer ${bearer}`);
      await expectUnauthorized(attempt, backend);
    });

    it.each([
      ['', 'ar', 'إجراء غير مصرح به'],
      ['&lang=ar', 'en', 'إجراء غير مصرح به'],
      ['&lang=en', 'ar', 'Unauthorized action'],
    ])('localizes denial with query "%s" before lang header "%s"', async (query, lang, message) => {
      await expectUnauthorized(
        request(app.getHttpServer())
          .get(`${profile}?username=OTHER${query}`)
          .set('Authorization', `Bearer ${token}`)
          .set('lang', lang),
        backend,
        message,
      );
    });

    it.each(['username=OTHER', 'enum=999999'])(
      'checks %s and language beyond the query parser parameter limit',
      async (query) => {
        const padding = Array.from({ length: 1001 }, (_, index) => `p${index}=x`).join('&');
        await expectUnauthorized(
          request(app.getHttpServer())
            .get(`${profile}?${padding}&${query}&lang=ar`)
            .set('Authorization', `Bearer ${token}`)
            .set('lang', 'en'),
          backend,
          'إجراء غير مصرح به',
        );
      },
    );

    it.each(['username=AIBRAHIM39', 'enum=037400'])(
      'requires a matching signed JWT for %s even on a public auth route',
      async (query) => {
        const url = `/api/v1/auth/initiate?${query}`;
        const body = { username: 'body-only-user', deviceid: 'unchanged-device' };
        await expectUnauthorized(request(app.getHttpServer()).post(url).send(body), backend);
        await expectUnauthorized(
          request(app.getHttpServer())
            .post(url)
            .set(
              'Authorization',
              `Bearer ${signToken({ username: 'OTHER', employeeNumber: '999999' })}`,
            )
            .send(body),
          backend,
        );
        const requestCount = backend.requests.length;
        await request(app.getHttpServer())
          .post(url)
          .set('Authorization', `Bearer ${token}`)
          .send(body)
          .expect(404);
        expect(backend.requests).toHaveLength(requestCount + 1);
        expect(backend.requests[requestCount]).toEqual(
          expect.objectContaining({ method: 'POST', url, body }),
        );
      },
    );
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

describe('Gateway (e2e) — query identity with AUTH_DISABLED=true', () => {
  let backend: MockBackend;
  let app: INestApplication;
  const token = signToken({ username: 'SIGNED_USER', employeeNumber: '000123' });
  const otherToken = signToken({ username: 'AIBRAHIM39', employeeNumber: '037400' });

  beforeAll(async () => {
    backend = await startMockBackend(JWT_SECRET);
    process.env.BACKEND_BASE_URL = backend.url;
    process.env.BACKEND_API_PREFIX = 'api/v1';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.AUTH_DISABLED = 'true';
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    await backend.close();
  });

  describe.each([
    ['get', '/api/v1/employee/profile', 200],
    ['post', '/api/v1/auth/initiate', 404],
  ] as const)('%s %s', (method, route, status) => {
    const body = { username: 'body-only-user', enum: 'body-only-employee' };
    const attempt = (url: string) => {
      const pending = request(app.getHttpServer())[method](url);
      return method === 'post' ? pending.send(body) : pending;
    };

    it('preserves unauthenticated forwarding without identity query keys', async () => {
      const url = `${route}?lang=en&note=username%3DOTHER`;
      const requestCount = backend.requests.length;
      await attempt(url).expect(status);
      expect(backend.requests).toHaveLength(requestCount + 1);
      expect(backend.requests[requestCount]).toEqual(
        expect.objectContaining({
          method: method.toUpperCase(),
          url,
          body: method === 'post' ? body : undefined,
        }),
      );
    });

    it.each(['username=SIGNED_USER', 'enum=000123'])(
      'requires a valid matching JWT for %s instead of DEV_USER or public bypass',
      async (query) => {
        const url = `${route}?${query}`;
        await expectUnauthorized(attempt(url), backend);
        await expectUnauthorized(attempt(url).set('Authorization', 'Bearer not-a-jwt'), backend);
        await expectUnauthorized(
          attempt(url).set('Authorization', `Bearer ${otherToken}`),
          backend,
        );
        const requestCount = backend.requests.length;
        await attempt(url).set('Authorization', `Bearer ${token}`).expect(status);
        expect(backend.requests).toHaveLength(requestCount + 1);
        expect(backend.requests[requestCount]).toEqual(
          expect.objectContaining({
            method: method.toUpperCase(),
            url,
            body: method === 'post' ? body : undefined,
            headers: expect.objectContaining({ authorization: `Bearer ${token}` }),
          }),
        );
      },
    );
  });
});

describe('Gateway (e2e) — public device challenge with integrity enforced', () => {
  let backend: MockBackend;
  let app: INestApplication;
  let previousMode: string | undefined;

  beforeAll(async () => {
    previousMode = process.env.GATEWAY_INTEGRITY_MODE;
    backend = await startMockBackend(JWT_SECRET);
    process.env.BACKEND_BASE_URL = backend.url;
    process.env.BACKEND_API_PREFIX = 'api/v1';
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.AUTH_DISABLED = 'false';
    process.env.GATEWAY_INTEGRITY_MODE = 'enforce';
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
    await backend.close();
    if (previousMode === undefined) delete process.env.GATEWAY_INTEGRITY_MODE;
    else process.env.GATEWAY_INTEGRITY_MODE = previousMode;
  });

  it('forwards POST challenge with deviceId and no JWT or attestation headers', async () => {
    const body = { deviceId: 'mobile-installation-1' };
    const count = backend.requests.length;
    const response = await request(app.getHttpServer())
      .post('/api/v1/app-integrity/challenge')
      .send(body)
      .expect(200);

    expect(response.body).toEqual({
      result: { challenge: 'mock-attestation-challenge' },
      opstatus: 0,
      status: 'success',
      httpStatusCode: 200,
    });
    expect(backend.requests).toHaveLength(count + 1);
    expect(backend.requests[count]).toMatchObject({
      method: 'POST',
      url: '/api/v1/app-integrity/challenge',
      body,
    });
    expect(backend.requests[count].headers.authorization).toBeUndefined();
  });

  /**
   * The app attests on launch, before login: these two complete that flow and
   * cannot demand a JWT or attestation headers — in enforce mode included.
   */
  it('forwards POST ios/register with no JWT or attestation headers', async () => {
    const body = {
      deviceId: 'mobile-installation-1',
      keyId: 'key-1',
      attestation: 'YXR0ZXN0YXRpb24=',
      challenge: 'mock-attestation-challenge',
    };
    const count = backend.requests.length;
    const response = await request(app.getHttpServer())
      .post('/api/v1/app-integrity/ios/register')
      .send(body)
      .expect(200);

    expect(response.body).toMatchObject({ result: { message: 'Device attested.' } });
    expect(backend.requests[count]).toMatchObject({
      method: 'POST',
      url: '/api/v1/app-integrity/ios/register',
      body,
    });
    expect(backend.requests[count].headers.authorization).toBeUndefined();
  });

  it('forwards POST android/verify with no JWT or attestation headers', async () => {
    const body = { integrityToken: 'play.integrity.token' };
    const count = backend.requests.length;
    const response = await request(app.getHttpServer())
      .post('/api/v1/app-integrity/android/verify')
      .send(body)
      .expect(200);

    expect(response.body).toMatchObject({ result: { verified: false } });
    expect(backend.requests[count]).toMatchObject({
      method: 'POST',
      url: '/api/v1/app-integrity/android/verify',
      body,
    });
  });

  it.each(['ios/register', 'android/verify'])(
    'rate-limits %s more tightly than challenge issuance',
    async (route) => {
      const limitedApp = await createApp();
      const count = backend.requests.length;
      try {
        for (let index = 0; index < 20; index++) {
          await request(limitedApp.getHttpServer())
            .post(`/api/v1/app-integrity/${route}`)
            .send({ attempt: index })
            .expect(200);
        }
        await request(limitedApp.getHttpServer())
          .post(`/api/v1/app-integrity/${route}`)
          .send({ attempt: 'one-too-many' })
          .expect(429);
        expect(backend.requests).toHaveLength(count + 20);
      } finally {
        await limitedApp.close();
      }
    },
  );

  it('does not open any other app-integrity route', async () => {
    const count = backend.requests.length;
    await request(app.getHttpServer()).post('/api/v1/app-integrity/ios/assert').send({}).expect(401);
    expect(backend.requests).toHaveLength(count);
  });

  it('does not exempt the old GET challenge route', async () => {
    const count = backend.requests.length;
    await request(app.getHttpServer()).get('/api/v1/app-integrity/challenge').expect(401);
    expect(backend.requests).toHaveLength(count);
  });

  it('forwards GET /app-setting with no JWT or attestation headers', async () => {
    const count = backend.requests.length;
    const response = await request(app.getHttpServer()).get('/api/v1/app-setting').expect(200);

    expect(response.body).toEqual({
      terms_and_conditions_status: true,
      terms_and_conditions_url: 'https://example.com/terms',
      privacy_policy_url: 'https://www.hamad.qa/EN/Sanad/Pages/Privacy-Policy.html',
    });
    expect(backend.requests).toHaveLength(count + 1);
    expect(backend.requests[count]).toMatchObject({ method: 'GET', url: '/api/v1/app-setting' });
    expect(backend.requests[count].headers.authorization).toBeUndefined();
  });

  it('still requires an integrity proof for authenticated business requests', async () => {
    const count = backend.requests.length;
    await request(app.getHttpServer())
      .get('/api/v1/employee/profile')
      .set('Authorization', `Bearer ${signToken({ username: 'TEST_USER' })}`)
      .expect(401);
    expect(backend.requests).toHaveLength(count);
  });

  it('rate-limits challenge issuance by caller even when deviceId changes', async () => {
    const limitedApp = await createApp();
    const count = backend.requests.length;
    try {
      for (let index = 0; index < 60; index++) {
        await request(limitedApp.getHttpServer())
          .post('/api/v1/app-integrity/challenge')
          .send({ deviceId: `device-${index}` })
          .expect(200);
      }
      await request(limitedApp.getHttpServer())
        .post('/api/v1/app-integrity/challenge')
        .send({ deviceId: 'another-device' })
        .expect(429);
      expect(backend.requests).toHaveLength(count + 60);
    } finally {
      await limitedApp.close();
    }
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
