import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthService } from '../application/auth.service';
import { OnboardingService } from '../application/onboarding.service';
import { MpinService } from '../application/mpin.service';
import { AuthController } from './auth.controller';

describe('AuthController OTP language', () => {
  let app: INestApplication;
  const onboarding = {
    validateUser: jest.fn().mockResolvedValue({ status: 'success' }),
    sendOtp: jest.fn().mockResolvedValue({ status: 'success' }),
  };
  const mpin = {
    forgotInitiate: jest.fn().mockResolvedValue({ status: 'initiated successfully' }),
  };
  const body = { username: 'hmc1', imeinumber: 'imei-1', platform: 'android' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: OnboardingService, useValue: onboarding },
        { provide: MpinService, useValue: mpin },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app?.close();
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
      const req = request(app.getHttpServer()).post(`/api/v1/auth/${route}`);
      if (header !== undefined) req.set('lang', header);

      await req.send(body).expect(200);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining(body), expected);
    });

    it('preserves the existing query-language precedence', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/auth/${route}?lang=en`)
        .set('lang', 'ar')
        .send(body)
        .expect(200);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining(body), 'en');
    });
  });
});
