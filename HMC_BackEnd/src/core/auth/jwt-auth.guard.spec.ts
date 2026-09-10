import { Controller, ExecutionContext, Get, INestApplication, Version } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApiVersioning } from '../http/api-versioning';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { currentIdentity } from './current-identity';
import { JwtStrategy } from './jwt.strategy';
import { TokenRevocationService } from './token-revocation.service';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser } from './auth-user.interface';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard development audit context', () => {
  it('retains token claims so development API calls carry the same audit fields', () => {
    const claims = {
      username: 'hmc1',
      employeeNumber: '037400',
      deviceImei: 'imei-1',
      appName: 'Sanaad',
      appVersion: '1.0.0',
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const req: { headers: Record<string, string>; user?: AuthenticatedUser } = {
      headers: { authorization: `Bearer header.${payload}.signature` },
    };
    const context = {
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    const config = { get: jest.fn().mockReturnValue(true) } as unknown as ConfigService;
    const guard = new JwtAuthGuard(new Reflector(), config);

    expect(guard.canActivate(context)).toBe(true);
    expect(req.user).toMatchObject({ username: 'hmc1', claims });
  });
});

@Controller('identity-test')
class IdentityFixture {
  @Get()
  legacy() { return { legacy: true }; }

  @Get()
  @Version('2')
  current(@CurrentUser() user: AuthenticatedUser) { return currentIdentity(user); }

  @Get('public')
  @Version('2')
  @Public()
  markedPublic() { return { public: true }; }
}

describe('v2 JWT verification and identity query rejection', () => {
  const secret = 'v2-guard-test-secret-not-for-production';
  const jwt = new JwtService({ secret });
  const token = (claims: Record<string, unknown> = {}) => jwt.sign({ username: 'test.User', employeeNumber: '001234', person_id: '26023', ...claims });
  let app: INestApplication;
  let revocation: TokenRevocationService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [IdentityFixture],
      providers: [JwtAuthGuard, JwtStrategy, TokenRevocationService, {
        provide: ConfigService,
        useValue: {
          get: (key: string, fallback: unknown) => key === 'auth.disabled' ? true : fallback,
          getOrThrow: () => ({ jwtSecret: secret }),
        },
      }],
    }).compile();
    app = module.createNestApplication();
    configureApiVersioning(app, 'api/v1');
    app.useGlobalGuards(app.get(JwtAuthGuard));
    revocation = app.get(TokenRevocationService);
    await app.init();
  });

  afterAll(async () => { await app?.close(); });

  it('keeps v1 bypass but requires a JWT on v2', async () => {
    await request(app.getHttpServer()).get('/api/v1/identity-test').expect(200);
    await request(app.getHttpServer()).get('/api/v2/identity-test').expect(401);
    await request(app.getHttpServer()).get('/api/v2/identity-test/public').expect(200);
  });

  it('allows an expired access header on a public v2 route used before or during login', async () => {
    await request(app.getHttpServer()).get('/api/v2/identity-test/public')
      .set('Authorization', `Bearer ${token({ exp: Math.floor(Date.now() / 1000) - 60 })}`)
      .expect(200);
  });

  it('accepts a verified token and retains its exact claims', async () => {
    const response = await request(app.getHttpServer()).get('/api/v2/identity-test?lang=en')
      .set('Authorization', `Bearer ${token()}`).expect(200);
    expect(response.body).toMatchObject({ username: 'test.User', employeeNumber: '001234', personId: '26023' });
  });

  it.each([
    'username=OTHER', 'enum=001234', 'person_id=26023', 'user_name=OTHER',
    'username=', 'username=A&username=A', 'enum[]=001234', 'person_id[value]=26023',
    '%75sername=OTHER', 'USER_NAME=OTHER',
  ])('rejects identity query %s even when it matches', async (query) => {
    await request(app.getHttpServer()).get(`/api/v2/identity-test?${query}`)
      .set('Authorization', `Bearer ${token()}`).expect(400);
  });

  it('checks identity keys beyond the query parser limit', async () => {
    const query = `${Array(1100).fill('a=1').join('&')}&username=OTHER`;
    await request(app.getHttpServer()).get(`/api/v2/identity-test?${query}`)
      .set('Authorization', `Bearer ${token()}`).expect(400);
  });

  it.each([
    () => 'invalid.jwt.token',
    () => `${token().split('.').slice(0, 2).join('.')}.invalid`,
    () => token({ exp: Math.floor(Date.now() / 1000) - 60 }),
    () => token({ typ: 'refresh' }),
    () => token({ sub: 'user', username: undefined }),
  ])('refuses invalid sessions even with AUTH_DISABLED', async (makeToken) => {
    await request(app.getHttpServer()).get('/api/v2/identity-test')
      .set('Authorization', `Bearer ${makeToken()}`).expect(401);
  });

  it('refuses revoked tokens', async () => {
    revocation.revoke('revoked-v2', Math.floor(Date.now() / 1000) + 60);
    await request(app.getHttpServer()).get('/api/v2/identity-test')
      .set('Authorization', `Bearer ${token({ jti: 'revoked-v2' })}`).expect(401);
  });
});
