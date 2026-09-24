import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ResponseInterceptor } from '@core/http/response.interceptor';

import request from 'supertest';
import { AuthService } from '../application/auth.service';
import { OnboardingService } from '../application/onboarding.service';
import { MpinService } from '../application/mpin.service';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  let app: INestApplication;

  const auth = { login: jest.fn() };
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
        { provide: AuthService, useValue: auth },
        { provide: OnboardingService, useValue: onboarding },
        { provide: MpinService, useValue: mpin },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  it('preserves the original initiate response without log interceptors', async () => {
    const response = {
      status: 'success',
      vflag: 'Exist',
      email: 'VP********@hamad.qa',
      employeephonenumber: 'XXXXXXXXXX654',
      emailunmasked: 'VP12345678@hamad.qa',
      employeephonenumberunmasked: '0097454321654',
    };
    onboarding.validateUser.mockResolvedValueOnce(response);

    await request(app.getHttpServer())
      .post('/api/v1/auth/initiate')
      .send(body)
      .expect(200)
      .expect(response);
  });

  describe('POST /auth/login', () => {
    it.each([
      ['en', true],
      ['ar', true],
      ['en', false],
      ['ar', false],
    ] as const)(
      'preserves both languages and the Oracle flag with lang=%s and isOrcaleUser=%s',
      async (lang, isOrcaleUser) => {
        const response = {
          status: 'success',
          employeeusername: 'HMC1',
          employeenumber: '037400',
          employeename: 'Test Employee',
          employeenamear: 'موظف تجريبي',
          job_title: 'Oracle job',
          job_title_ar: 'المسمى الوظيفي',
          organization_name: 'Oracle organization',
          organization_name_ar: 'المؤسسة',
          isOrcaleUser,
        };
        auth.login.mockResolvedValueOnce(response);
        const loginBody = { ...body, mpin: 'client-hashed-test-value' };

        await request(app.getHttpServer())
          .post(`/api/v1/auth/login?lang=${lang}`)
          .set('lang', lang)
          .send(loginBody)
          .expect(200)
          .expect(response);

        expect(auth.login).toHaveBeenCalledWith(expect.objectContaining(loginBody), lang);
      },
    );
  });

  describe('POST /auth/mpin/update', () => {
    it('accepts an opaque client hash with the required user/device context', async () => {
      const requestBody = {
        username: body.username,
        imeinumber: body.imeinumber,
        mpin: 'client-hashed-test-value+/=',
      };

      await request(app.getHttpServer())
        .post('/api/v1/auth/mpin/update')
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
        .post('/api/v1/auth/mpin/update')
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
