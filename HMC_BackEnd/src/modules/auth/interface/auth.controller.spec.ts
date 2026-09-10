import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../application/auth.service';
import { OnboardingService } from '../application/onboarding.service';
import { MpinService } from '../application/mpin.service';
import { AuthController } from './auth.controller';
import { configureApiVersioning } from '@core/http/api-versioning';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';
import { JwtStrategy } from '@core/auth/jwt.strategy';
import { TokenRevocationService } from '@core/auth/token-revocation.service';

describe.each(['1', '2'])('AuthController v%s', (version) => {
  let app: INestApplication;
  const onboarding = {
    validateUser: jest.fn().mockResolvedValue({ status: 'success' }),
    sendOtp: jest.fn().mockResolvedValue({ status: 'success' }),
  };
  const mpin = {
    forgotInitiate: jest.fn().mockResolvedValue({ status: 'initiated successfully' }),
    setMpin: jest
      .fn()
      .mockResolvedValue({ status: 'success', message: 'MPIN updated successfully' }),
  };
  const body = { username: 'hmc1', imeinumber: 'imei-1', platform: 'android' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        JwtAuthGuard, JwtStrategy, TokenRevocationService,
        { provide: ConfigService, useValue: new ConfigService({ auth: { disabled: false, jwtSecret: 'auth-controller-test-secret-not-for-production' } }) },
        { provide: AuthService, useValue: {} },
        { provide: OnboardingService, useValue: onboarding },
        { provide: MpinService, useValue: mpin },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApiVersioning(app, 'api/v1');
    app.useGlobalGuards(app.get(JwtAuthGuard));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  describe('POST /auth/mpin/update', () => {
    it('accepts an opaque client hash with the required user/device context', async () => {
      const requestBody = {
        username: body.username,
        imeinumber: body.imeinumber,
        mpin: 'client-hashed-test-value+/=',
      };

      await request(app.getHttpServer())
        .post(`/api/v${version}/auth/mpin/update`)
        .send(requestBody)
        .expect(200)
        .expect({ status: 'success', message: 'MPIN updated successfully' });

      expect(mpin.setMpin).toHaveBeenCalledWith(expect.objectContaining(requestBody));
    });

    it.each([
      { label: 'missing', value: undefined },
      { label: 'null', value: null },
      { label: 'empty', value: '' },
      { label: 'number', value: 1234 },
      { label: 'object', value: {} },
      { label: 'array', value: ['1234'] },
    ])('rejects a $label MPIN before calling the service', async ({ value }) => {
      await request(app.getHttpServer())
        .post(`/api/v${version}/auth/mpin/update`)
        .send({ ...body, mpin: value })
        .expect(400);

      expect(mpin.setMpin).not.toHaveBeenCalled();
    });
  });

  describe.each([
    ['initiate', onboarding.validateUser],
    ['send-otp', onboarding.sendOtp],
    ['mpin/forgot', mpin.forgotInitiate],
  ] as const)('POST /auth/%s', (route, handler) => {
    it.each([
      ['en', 'en'],
      ['ar', 'ar'],
      [undefined, 'en'],
      ['unsupported', 'en'],
    ] as const)('resolves lang header %s to %s', async (header, expected) => {
      const req = request(app.getHttpServer()).post(`/api/v${version}/auth/${route}`);
      if (header !== undefined) req.set('lang', header);

      await req.send(body).expect(200);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining(body), expected);
    });

    it('preserves the existing query-language precedence', async () => {
      await request(app.getHttpServer())
        .post(`/api/v${version}/auth/${route}?lang=en`)
        .set('lang', 'ar')
        .send(body)
        .expect(200);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining(body), 'en');
    });
  });
});
