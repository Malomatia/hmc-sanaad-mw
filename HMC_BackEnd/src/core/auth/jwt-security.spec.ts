import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard, PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthStateService } from './auth-state.service';
import { JwtStrategy } from './jwt.strategy';
import { TokenRevocationService } from './token-revocation.service';
import { assertSessionClaims } from './jwt-claims';

@Controller('protected')
@UseGuards(AuthGuard('jwt'))
class ProtectedController {
  @Get()
  get() {
    return { ok: true };
  }
}

const secret = 'local-test-secret-never-used-outside-tests';
const jwt = new JwtService({
  secret,
  signOptions: { expiresIn: '1h', algorithm: 'HS256', issuer: 'sanaad', audience: 'sanaad-b2e' },
});
const claims = {
  sub: '037400',
  username: 'TESTUSER',
  deviceImei: 'device',
  sid: 'session',
  jti: 'access',
  typ: 'access',
};

describe('Backend bearer security', () => {
  let app: INestApplication;
  const state = { sessionActive: jest.fn().mockResolvedValue(true) };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [ProtectedController],
      providers: [
        JwtStrategy,
        TokenRevocationService,
        { provide: AuthStateService, useValue: state },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            app: { nodeEnv: 'test' },
            auth: {
              jwtSecret: secret,
              jwtIssuer: 'sanaad',
              jwtAudience: 'sanaad-b2e',
              disabled: false,
              staticLogin: false,
            },
          }),
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    state.sessionActive.mockResolvedValue(true);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('accepts a correctly signed active session', async () => {
    await request(app.getHttpServer())
      .get('/protected')
      .auth(jwt.sign(claims), { type: 'bearer' })
      .expect(200);
    expect(state.sessionActive).toHaveBeenCalledWith('session', 'TESTUSER', 'device', 'access');
  });

  it.each([
    { issuer: 'other' },
    { audience: 'other' },
    { secret: 'different-local-test-signing-secret' },
    { expiresIn: -1 },
    { algorithm: 'HS384' as const },
    { noTimestamp: true },
  ])('rejects incompatible token options %j before session lookup', async (options) => {
    await request(app.getHttpServer())
      .get('/protected')
      .auth(jwt.sign(claims, options), { type: 'bearer' })
      .expect(401);
    expect(state.sessionActive).not.toHaveBeenCalled();
  });

  it.each(['exp', 'sub', 'username', 'jti', 'sid', 'deviceImei', 'typ'])(
    'rejects missing %s',
    async (key) => {
      const payload = jwt.decode<Record<string, unknown>>(jwt.sign(claims));
      delete payload[key];
      expect(() => assertSessionClaims(payload, 'access')).toThrow();
    },
  );

  it('rejects a refresh token as a bearer token', async () => {
    await request(app.getHttpServer())
      .get('/protected')
      .auth(jwt.sign({ ...claims, typ: 'refresh' }), { type: 'bearer' })
      .expect(401);
    expect(state.sessionActive).not.toHaveBeenCalled();
  });

  it('rejects expired/revoked/inactive sessions even with an otherwise valid JWT', async () => {
    state.sessionActive.mockResolvedValue(false);
    await request(app.getHttpServer())
      .get('/protected')
      .auth(jwt.sign(claims), { type: 'bearer' })
      .expect(401);
  });
});
