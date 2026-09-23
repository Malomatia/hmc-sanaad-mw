import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';
import { JwtStrategy } from '@core/auth/jwt.strategy';
import { TokenRevocationService } from '@core/auth/token-revocation.service';
import { ResponseInterceptor } from '@core/http/response.interceptor';
import { AppIntegrityService } from '../application/app-integrity.service';
import { AppIntegrityController } from './app-integrity.controller';
import { AppIntegrityGuard } from './app-integrity.guard';

const PATH = '/api/v1/app-integrity/challenge';

describe('POST /app-integrity/challenge', () => {
  let app: INestApplication;
  const service = {
    issueChallenge: jest.fn().mockResolvedValue('server-issued-challenge'),
    verifyIosAssertion: jest.fn(),
    verifyAndroidToken: jest.fn(),
    registerIosKey: jest.fn(),
  };

  beforeAll(async () => {
    const config = new ConfigService({
      auth: { disabled: false, jwtSecret: 'challenge-test-secret-not-for-production' },
      appIntegrity: { mode: 'enforce', ios: { enabled: false }, android: { enabled: false } },
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [AppIntegrityController],
      providers: [
        JwtAuthGuard,
        JwtStrategy,
        AppIntegrityGuard,
        { provide: ConfigService, useValue: config },
        {
          provide: TokenRevocationService,
          useValue: { isRevoked: jest.fn().mockReturnValue(false) },
        },
        { provide: AppIntegrityService, useValue: service },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalGuards(moduleRef.get(JwtAuthGuard), moduleRef.get(AppIntegrityGuard));
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app?.close());

  it('issues a challenge for the device without JWT or attestation headers in enforce mode', async () => {
    const response = await request(app.getHttpServer())
      .post(PATH)
      .send({ deviceId: 'Mobile-Installation-123' })
      .expect(200);

    expect(response.body).toMatchObject({
      result: { challenge: 'server-issued-challenge' },
      status: 'success',
      httpStatusCode: 200,
    });
    expect(service.issueChallenge).toHaveBeenCalledWith('Mobile-Installation-123');
    expect(service.verifyIosAssertion).not.toHaveBeenCalled();
    expect(service.verifyAndroidToken).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { deviceId: null },
    { deviceId: 123 },
    { deviceId: '' },
    { deviceId: ' \t\n ' },
    { deviceId: [] },
    { deviceId: {} },
    { deviceId: 'x'.repeat(101) },
    { deviceId: 'device-1', username: 'someone' },
    { deviceId: 'device-1', ip: '203.0.113.10' },
    { deviceId: 'device-1', unexpected: true },
  ])('rejects an invalid challenge body %j before issuing a nonce', async (body) => {
    await request(app.getHttpServer()).post(PATH).send(body).expect(400);
    expect(service.issueChallenge).not.toHaveBeenCalled();
  });

  it('requires deviceId in the body rather than the query', async () => {
    await request(app.getHttpServer()).post(`${PATH}?deviceId=device-1`).send({}).expect(400);
    expect(service.issueChallenge).not.toHaveBeenCalled();
  });

  it('accepts a device identifier at the storage length limit', async () => {
    const deviceId = 'd'.repeat(100);
    await request(app.getHttpServer()).post(PATH).send({ deviceId }).expect(200);
    expect(service.issueChallenge).toHaveBeenCalledWith(deviceId);
  });

  it('does not retain the old GET challenge endpoint', async () => {
    await request(app.getHttpServer()).get(PATH).expect(404);
    expect(service.issueChallenge).not.toHaveBeenCalled();
  });

  it.each(['ios/register', 'android/verify'])('keeps %s authenticated', async (route) => {
    await request(app.getHttpServer()).post(`/api/v1/app-integrity/${route}`).send({}).expect(401);
    expect(service.registerIosKey).not.toHaveBeenCalled();
    expect(service.verifyAndroidToken).not.toHaveBeenCalled();
  });

  it('documents only challenge issuance as public and requires its JSON body', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    const challenge = document.paths[PATH];
    expect(challenge.get).toBeUndefined();
    expect(challenge.post?.security ?? []).toEqual([]);
    expect(challenge.post?.requestBody).toMatchObject({ required: true });
    expect(document.components?.schemas?.IssueChallengeDto).toMatchObject({
      required: ['deviceId'],
      properties: { deviceId: { type: 'string', maxLength: 100 } },
    });
    for (const route of ['ios/register', 'android/verify']) {
      expect(document.paths[`/api/v1/app-integrity/${route}`].post?.security).toEqual([
        { bearer: [] },
      ]);
    }
  });
});
