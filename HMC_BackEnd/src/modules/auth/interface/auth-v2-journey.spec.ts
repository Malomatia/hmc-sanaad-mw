import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditInterceptor } from '@core/audit/audit.interceptor';
import { AuthLifecycleEvent } from '@core/audit/audit-event';
import { AuditService } from '@core/audit/audit.service';
import { Role } from '@core/auth/auth-user.interface';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';
import { JwtStrategy } from '@core/auth/jwt.strategy';
import { TokenRevocationService } from '@core/auth/token-revocation.service';
import { AllExceptionsFilter } from '@core/http/all-exceptions.filter';
import { configureApiVersioning } from '@core/http/api-versioning';
import { ResponseInterceptor } from '@core/http/response.interceptor';
import { AuthService } from '../application/auth.service';
import { HealthCheckService } from '../application/healthcheck.service';
import { MpinService } from '../application/mpin.service';
import { OnboardingService } from '../application/onboarding.service';
import { EmployeeIdentity, FunctionAccess, FunctionStatus } from '../domain/auth-identity';
import {
  DEVICE_REGISTRY_PORT,
  DeviceBindingCommand,
  DeviceRegistration,
  DeviceRegistryPort,
} from '../domain/ports/device-registry.port';
import { FUNCTION_ACCESS_PORT, FunctionAccessPort } from '../domain/ports/function-access.port';
import { LDAP_USER_PORT, LdapUserPort } from '../domain/ports/ldap-user.port';
import {
  MPIN_STORE_PORT,
  MpinStorePort,
  SetMpinCommand,
  VerifyMpinQuery,
} from '../domain/ports/mpin-store.port';
import {
  OTP_PORT,
  OtpPort,
  SendOtpCommand,
  SendOtpResult,
  VerifyOtpCommand,
} from '../domain/ports/otp.port';
import { PERSON_IDENTITY_PORT, PersonIdentityPort } from '../domain/ports/person-identity.port';
import { AuthController } from './auth.controller';
import { HealthCheckController } from './healthcheck.controller';

const JWT_SECRET = 'auth-v2-journey-test-secret-not-for-production';
const CLIENT_MPIN = 'client-opaque-hash+/=KeepCase';
const OTP = '012345';
const PERSON_ID = '26023';
const client = {
  username: 'journey.user',
  deviceid: 'journey-device-1',
  platform: 'android',
  appname: 'Sanaad',
  version: '2.0.0',
  devicemodel: 'test-handset',
  osversion: '14',
  sysdate: '2026-09-10T10:00:00',
};
const employee: EmployeeIdentity = {
  username: client.username,
  employeeNumber: '000742',
  employeeName: 'Journey Employee',
  department: 'Technology',
  facility: 'Test Facility',
  company: 'Test Company',
  jobName: 'Engineer',
  phoneNumber: '55123456',
  email: 'journey.user@example.test',
  isEmployee: true,
  isNewUser: true,
  roles: [Role.EMPLOYEE],
};
const functionList: FunctionAccess[] = [
  { functionname: 'Profile', functioncode: 'PROFILE', status: FunctionStatus.ENABLED },
  { functionname: 'Disabled', functioncode: 'DISABLED', status: FunctionStatus.DISABLED },
  { functionname: 'Future', functioncode: 'FUTURE', status: FunctionStatus.COMING_SOON },
];
const healthResponse = {
  appDowntime: 'No',
  downtimeStart: '',
  downtimeEnd: '',
  updatetype: '',
};
const healthBody = {
  deviceid: client.deviceid,
  platform: client.platform,
  appname: client.appname,
  version: client.version,
};
const sessionClaims = {
  sub: employee.employeeNumber,
  username: employee.username,
  employeeNumber: employee.employeeNumber,
  person_id: PERSON_ID,
  roles: [Role.EMPLOYEE],
  functions: ['PROFILE'],
  deviceImei: client.deviceid,
  appName: client.appname,
  appVersion: client.version,
  platform: client.platform,
};
const meResponse = {
  result: {
    username: client.username,
    employeeNumber: employee.employeeNumber,
    roles: [Role.EMPLOYEE],
    functions: ['PROFILE'],
  },
  opstatus: 0,
  status: 'success',
  httpStatusCode: 200,
};
const deviceKey = (username: string, imei: string) => JSON.stringify([username, imei]);

async function createFixture(authDisabled = false) {
  const registrations = new Map<string, DeviceRegistration>();
  const pins = new Map<string, string>();
  const codes = new Map<string, VerifyOtpCommand>();
  let nextRequestId = 0;
  const devices: jest.Mocked<DeviceRegistryPort> = {
    bind: jest.fn(async (cmd: DeviceBindingCommand) => {
      const key = deviceKey(cmd.username, cmd.imei);
      if (!registrations.has(key)) registrations.set(key, { mpinSet: false, status: 'Inactive' });
    }),
    find: jest.fn(async (username: string, imei: string) =>
      registrations.get(deviceKey(username, imei)),
    ),
    isBound: jest.fn(async (username: string, imei: string) =>
      registrations.has(deviceKey(username, imei)),
    ),
    touch: jest.fn().mockResolvedValue(undefined),
  };
  const mpinStore: jest.Mocked<MpinStorePort> = {
    set: jest.fn(async (cmd: SetMpinCommand) => {
      const key = deviceKey(cmd.username, cmd.imei);
      if (!registrations.has(key))
        throw new Error('The fixture device must be bound before MPIN storage.');
      pins.set(key, cmd.mpin);
      registrations.set(key, { mpinSet: true, status: 'Active' });
    }),
    verify: jest.fn(
      async (cmd: VerifyMpinQuery) => pins.get(deviceKey(cmd.username, cmd.imei)) === cmd.mpin,
    ),
    exists: jest.fn(async (username: string, imei: string) => pins.has(deviceKey(username, imei))),
  };
  const otp: jest.Mocked<OtpPort> = {
    send: jest.fn(async (cmd: SendOtpCommand): Promise<SendOtpResult> => {
      const requestId = String(++nextRequestId);
      codes.set(requestId, { username: cmd.username, imei: cmd.imei, requestId, otp: OTP });
      return { requestId, status: 'NEW', mode: 'SMS', validForSeconds: 300, otp: OTP };
    }),
    verify: jest.fn(async (cmd: VerifyOtpCommand) => {
      const stored = codes.get(cmd.requestId);
      const valid =
        stored?.username === cmd.username && stored?.imei === cmd.imei && stored?.otp === cmd.otp;
      if (valid) codes.delete(cmd.requestId);
      return valid;
    }),
  };
  const directory: jest.Mocked<LdapUserPort> = {
    validate: jest.fn().mockResolvedValue(employee),
    authenticate: jest
      .fn()
      .mockRejectedValue(new Error('Password authentication is not part of this journey.')),
  };
  const functionAccess: jest.Mocked<FunctionAccessPort> = {
    list: jest.fn().mockResolvedValue(functionList),
  };
  const personIdentity: jest.Mocked<PersonIdentityPort> = {
    findPersonId: jest.fn().mockResolvedValue(PERSON_ID),
  };
  const audit: jest.Mocked<Pick<AuditService, 'lifecycle' | 'apiCall'>> = {
    lifecycle: jest.fn(),
    apiCall: jest.fn(),
  };
  const health: jest.Mocked<Pick<HealthCheckService, 'check'>> = {
    check: jest.fn().mockResolvedValue(healthResponse),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [JwtModule.register({ secret: JWT_SECRET, signOptions: { expiresIn: '1h' } })],
    controllers: [AuthController, HealthCheckController],
    providers: [
      AuthService,
      OnboardingService,
      MpinService,
      JwtStrategy,
      JwtAuthGuard,
      TokenRevocationService,
      AuditInterceptor,
      ResponseInterceptor,
      {
        provide: ConfigService,
        useValue: new ConfigService({
          auth: {
            disabled: authDisabled,
            staticLogin: false,
            jwtSecret: JWT_SECRET,
            jwtExpiresIn: '1h',
            jwtRefreshExpiresIn: '7d',
          },
          mpin: { minLength: 4, maxLength: 6, maxAttempts: 5, lockoutMinutes: 15 },
          app: { nodeEnv: 'development' },
          otp: {
            inResponse: false,
            ttlSeconds: 300,
            length: 6,
            maxAttempts: 5,
            resendWindowSeconds: 60,
            staticValue: OTP,
            charset: 'numeric',
          },
        }),
      },
      { provide: LDAP_USER_PORT, useValue: directory },
      { provide: DEVICE_REGISTRY_PORT, useValue: devices },
      { provide: MPIN_STORE_PORT, useValue: mpinStore },
      { provide: OTP_PORT, useValue: otp },
      { provide: FUNCTION_ACCESS_PORT, useValue: functionAccess },
      { provide: PERSON_IDENTITY_PORT, useValue: personIdentity },
      { provide: AuditService, useValue: audit },
      { provide: HealthCheckService, useValue: health },
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  configureApiVersioning(app, 'api/v1');
  app.useGlobalGuards(app.get(JwtAuthGuard));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(app.get(AuditInterceptor), app.get(ResponseInterceptor));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return {
    app,
    jwt: app.get(JwtService),
    revocation: app.get(TokenRevocationService),
    registrations,
    pins,
    devices,
    mpinStore,
    otp,
    directory,
    functionAccess,
    personIdentity,
    audit,
    health,
  };
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function onboardAndSetMpin(fixture: Fixture, version = '2') {
  const http = fixture.app.getHttpServer();
  const base = `/api/v${version}/auth`;
  const initiated = await request(http).post(`${base}/initiate`).send(client).expect(200);
  expect(initiated.body).toMatchObject({
    status: 'success',
    message: 'OTP sent successfully',
    employeeusername: client.username,
    employeenumber: employee.employeeNumber,
    newuser: 'Yes',
    vflag: 'New',
    otpmode: 'SMS',
    elapsedtimeinmins: 5,
    requestid: expect.any(String),
    employeephonenumber: 'XXXXX456',
  });
  expect(initiated.body).not.toHaveProperty('result');
  expect(initiated.body).not.toHaveProperty('otp');
  expect(fixture.registrations.get(deviceKey(client.username, client.deviceid))).toEqual({
    mpinSet: false,
    status: 'Inactive',
  });
  await request(http)
    .post(`${base}/otp/validate`)
    .send({ ...client, requestid: initiated.body.requestid, otp: OTP })
    .expect(200)
    .expect({ status: 'success', message: 'OTP Validated successfully' });
  await request(http)
    .post(`${base}/mpin/update`)
    .send({ ...client, mpin: CLIENT_MPIN })
    .expect(200)
    .expect({ status: 'success', message: 'MPIN updated successfully' });
  expect(fixture.mpinStore.set).toHaveBeenCalledTimes(1);
  expect(fixture.mpinStore.set).toHaveBeenCalledWith({
    username: client.username,
    imei: client.deviceid,
    mpin: CLIENT_MPIN,
  });
  expect(fixture.otp.verify).toHaveBeenCalledTimes(1);
  expect(fixture.otp.verify).toHaveBeenCalledWith({
    username: client.username,
    imei: client.deviceid,
    requestId: initiated.body.requestid,
    otp: OTP,
  });
  expect(fixture.registrations.get(deviceKey(client.username, client.deviceid))).toEqual({
    mpinSet: true,
    status: 'Active',
  });
}

function expectHttpError(body: unknown, status: number) {
  expect(body).toMatchObject({
    success: false,
    status: 'error',
    httpStatusCode: status,
    message: expect.any(String),
  });
  expect(body).not.toHaveProperty('result');
}

describe('Auth v2 real-service HTTP mobile journey', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await fixture?.app.close();
  });

  it('onboards, logs in once, refreshes with an expired bearer, rotates once and revokes logout tokens', async () => {
    const { app, jwt, audit, devices, mpinStore, otp, directory, functionAccess, personIdentity } =
      fixture;
    const http = app.getHttpServer();
    await request(http)
      .post('/api/v2/healthcheck')
      .send(healthBody)
      .expect(200)
      .expect(healthResponse);
    expect(fixture.health.check).toHaveBeenCalledTimes(1);
    expect(fixture.health.check).toHaveBeenCalledWith(
      expect.objectContaining({ ...healthBody, deviceimei: client.deviceid }),
    );
    await onboardAndSetMpin(fixture);
    expect(devices.bind).toHaveBeenCalledTimes(2);
    expect(devices.bind).toHaveBeenNthCalledWith(1, {
      username: client.username,
      imei: client.deviceid,
      platform: client.platform,
      deviceModel: client.devicemodel,
      osVersion: client.osversion,
      department: employee.facility,
    });
    expect(otp.send).toHaveBeenCalledTimes(1);
    expect(otp.send).toHaveBeenCalledWith({
      username: client.username,
      imei: client.deviceid,
      phoneNumber: employee.phoneNumber,
      email: employee.email,
      purpose: 'ONBOARDING',
      lang: 'en',
      appName: client.appname,
      appVersion: client.version,
      appDatetime: client.sysdate,
    });

    const beforeLogin = audit.apiCall.mock.calls.length;
    const login = await request(http)
      .post('/api/v2/auth/login')
      .send({ ...client, mpin: CLIENT_MPIN })
      .expect(200);
    expect(login.body).toMatchObject({
      status: 'success',
      token: expect.any(String),
      refreshtoken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: '1h',
      employeeusername: client.username.toUpperCase(),
      employeenumber: employee.employeeNumber,
      functionaccesslist: functionList,
    });
    expect(login.body).not.toHaveProperty('result');
    expect(audit.apiCall.mock.calls.slice(beforeLogin)).toEqual([
      [
        'POST /api/v2/auth/login',
        expect.objectContaining({
          functionId: 'auth_login',
          username: client.username.toUpperCase(),
          deviceImei: client.deviceid,
          platform: client.platform,
          appName: client.appname,
          appVersion: client.version,
          actionTaken: 'submit',
          status: 'success',
        }),
      ],
    ]);
    const accessClaims = jwt.verify<Record<string, unknown>>(login.body.token);
    const refreshClaims = jwt.verify<Record<string, unknown>>(login.body.refreshtoken);
    expect(accessClaims).toMatchObject({
      ...sessionClaims,
      jti: expect.any(String),
      exp: expect.any(Number),
    });
    expect(accessClaims).not.toHaveProperty('typ');
    expect(refreshClaims).toMatchObject({
      ...sessionClaims,
      typ: 'refresh',
      jti: expect.any(String),
    });
    expect(refreshClaims.jti).not.toBe(accessClaims.jti);
    await request(http)
      .get('/api/v2/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`)
      .expect(200)
      .expect(meResponse);

    const expiredAccess = await jwt.signAsync(
      { ...sessionClaims, jti: 'expired-access' },
      { expiresIn: -60 },
    );
    const expiredMe = await request(http)
      .get('/api/v2/auth/me')
      .set('Authorization', `Bearer ${expiredAccess}`)
      .expect(401);
    expectHttpError(expiredMe.body, 401);
    const refreshed = await request(http)
      .post('/api/v2/auth/token/refresh')
      .set('Authorization', `Bearer ${expiredAccess}`)
      .send({ refreshtoken: login.body.refreshtoken })
      .expect(200);
    expect(refreshed.body).toEqual({
      status: 'success',
      token: expect.any(String),
      refreshtoken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: '1h',
    });
    const rotatedAccess = jwt.verify<Record<string, unknown>>(refreshed.body.token);
    const rotatedRefresh = jwt.verify<Record<string, unknown>>(refreshed.body.refreshtoken);
    expect(rotatedAccess).toMatchObject(sessionClaims);
    expect(rotatedRefresh).toMatchObject({ ...sessionClaims, typ: 'refresh' });
    expect(
      new Set([accessClaims.jti, refreshClaims.jti, rotatedAccess.jti, rotatedRefresh.jti]).size,
    ).toBe(4);
    await request(http)
      .post('/api/v2/auth/token/refresh')
      .send({ refreshtoken: login.body.refreshtoken })
      .expect(200)
      .expect({ status: 'error', message: 'This refresh token has been revoked.' });
    await request(http)
      .get('/api/v2/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.token}`)
      .expect(200)
      .expect(meResponse);
    await request(http)
      .post('/api/v2/auth/logout')
      .set('Authorization', `Bearer ${refreshed.body.token}`)
      .send({ refreshtoken: refreshed.body.refreshtoken })
      .expect(200)
      .expect({ status: 'success', message: 'Logged out successfully.' });
    const revokedMe = await request(http)
      .get('/api/v2/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.token}`)
      .expect(401);
    expectHttpError(revokedMe.body, 401);
    await request(http)
      .post('/api/v2/auth/token/refresh')
      .send({ refreshtoken: refreshed.body.refreshtoken })
      .expect(200)
      .expect({ status: 'error', message: 'This refresh token has been revoked.' });

    expect(mpinStore.verify).toHaveBeenCalledTimes(1);
    expect(mpinStore.verify).toHaveBeenCalledWith({
      username: client.username,
      imei: client.deviceid,
      mpin: CLIENT_MPIN,
    });
    expect(devices.touch).toHaveBeenCalledTimes(1);
    expect(devices.touch).toHaveBeenCalledWith(client.username, client.deviceid);
    expect(directory.validate).toHaveBeenCalledTimes(2);
    expect(directory.authenticate).not.toHaveBeenCalled();
    expect(functionAccess.list).toHaveBeenCalledTimes(1);
    expect(functionAccess.list).toHaveBeenCalledWith(employee.employeeNumber);
    expect(personIdentity.findPersonId).toHaveBeenCalledTimes(1);
    expect(personIdentity.findPersonId).toHaveBeenCalledWith(employee.username);
    expect(audit.apiCall).toHaveBeenCalledTimes(11);
    expect(
      audit.apiCall.mock.calls.filter(([, ctx]) => ctx?.functionId?.startsWith('auth_login')),
    ).toHaveLength(1);
    expect(audit.lifecycle.mock.calls.map(([event]) => event)).toEqual([
      AuthLifecycleEvent.USER_VALIDATE_SUCCESS,
      AuthLifecycleEvent.OTP_SENT,
      AuthLifecycleEvent.OTP_VALIDATED,
      AuthLifecycleEvent.MPIN_SET,
      AuthLifecycleEvent.LOGIN_SUCCESS,
      AuthLifecycleEvent.LOGOUT,
    ]);
  });

  it('keeps forgot and reset public, verifies the reset OTP and replaces the MPIN', async () => {
    await onboardAndSetMpin(fixture);
    const http = fixture.app.getHttpServer();
    const forgot = await request(http)
      .post('/api/v2/auth/mpin/forgot')
      .set('lang', 'ar')
      .send(client)
      .expect(200);
    expect(forgot.body).toEqual({
      status: 'initiated successfully',
      requestid: expect.any(String),
    });
    expect(fixture.devices.isBound).toHaveBeenCalledTimes(1);
    expect(fixture.devices.isBound).toHaveBeenCalledWith(client.username, client.deviceid);
    expect(fixture.otp.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        username: client.username,
        imei: client.deviceid,
        purpose: 'FORGOT_MPIN',
        lang: 'ar',
        phoneNumber: employee.phoneNumber,
      }),
    );
    await request(http)
      .post('/api/v2/auth/mpin/update/reset')
      .send({ ...client, requestid: forgot.body.requestid, otp: OTP, newmpin: '654321' })
      .expect(200)
      .expect({ status: 'success', message: 'MPIN Changed successfully' });
    expect(fixture.otp.verify).toHaveBeenCalledTimes(2);
    expect(fixture.otp.verify).toHaveBeenLastCalledWith({
      username: client.username,
      imei: client.deviceid,
      requestId: forgot.body.requestid,
      otp: OTP,
    });
    expect(fixture.mpinStore.set).toHaveBeenCalledTimes(2);
    expect(fixture.mpinStore.set).toHaveBeenLastCalledWith({
      username: client.username,
      imei: client.deviceid,
      mpin: '654321',
    });
    await request(http)
      .post('/api/v2/auth/login')
      .send({ ...client, mpin: CLIENT_MPIN })
      .expect(200)
      .expect({ status: 'error', message: 'Invalid credentials.' });
    const login = await request(http)
      .post('/api/v2/auth/login')
      .send({ ...client, mpin: '654321' })
      .expect(200);
    expect(login.body.status).toBe('success');
    expect(fixture.jwt.verify(login.body.token)).toMatchObject(sessionClaims);
    expect(
      fixture.audit.lifecycle.mock.calls.filter(
        ([event]) => event === AuthLifecycleEvent.MPIN_RESET,
      ),
    ).toHaveLength(1);
  });

  it('accepts a public send-otp body username despite a bad bearer and passes language and contacts to the OTP port', async () => {
    const http = fixture.app.getHttpServer();
    const sent = await request(http)
      .post('/api/v2/auth/send-otp')
      .set('Authorization', 'Bearer malformed-token')
      .set('lang', 'ar')
      .send({ ...client, phonenumber: employee.phoneNumber, email: employee.email })
      .expect(200);
    expect(sent.body).toEqual({ status: 'success', requestid: expect.any(String) });
    expect(fixture.otp.send).toHaveBeenCalledTimes(1);
    expect(fixture.otp.send).toHaveBeenCalledWith({
      username: client.username,
      imei: client.deviceid,
      phoneNumber: employee.phoneNumber,
      email: employee.email,
      purpose: 'ONBOARDING',
      lang: 'ar',
      appName: client.appname,
      appVersion: client.version,
      appDatetime: client.sysdate,
    });
    await request(http)
      .post('/api/v2/auth/otp/validate')
      .send({ ...client, requestid: sent.body.requestid, otp: OTP })
      .expect(200)
      .expect({ status: 'success', message: 'OTP Validated successfully' });
    expect(fixture.directory.validate).not.toHaveBeenCalled();
    expect(fixture.audit.lifecycle.mock.calls.map(([event]) => event)).toEqual([
      AuthLifecycleEvent.OTP_SENT,
      AuthLifecycleEvent.OTP_VALIDATED,
    ]);
  });

  it.each([
    ['wrong MPIN', { mpin: 'wrong-hash' }],
    ['wrong device', { deviceid: 'unregistered-device' }],
    ['wrong username', { username: 'another.user' }],
  ] as const)(
    'returns business HTTP 200 for %s without downstream login side effects',
    async (_label, overrides) => {
      await onboardAndSetMpin(fixture);
      fixture.directory.validate.mockClear();
      fixture.audit.lifecycle.mockClear();
      fixture.audit.apiCall.mockClear();
      await request(fixture.app.getHttpServer())
        .post('/api/v2/auth/login')
        .send({ ...client, mpin: CLIENT_MPIN, ...overrides })
        .expect(200)
        .expect({ status: 'error', message: 'Invalid credentials.' });
      expect(fixture.mpinStore.verify).toHaveBeenCalledTimes(1);
      expect(fixture.directory.validate).not.toHaveBeenCalled();
      expect(fixture.devices.touch).not.toHaveBeenCalled();
      expect(fixture.functionAccess.list).not.toHaveBeenCalled();
      expect(fixture.personIdentity.findPersonId).not.toHaveBeenCalled();
      expect(fixture.audit.lifecycle).toHaveBeenCalledTimes(1);
      expect(fixture.audit.lifecycle).toHaveBeenCalledWith(
        AuthLifecycleEvent.LOGIN_FAILURE,
        expect.objectContaining({ status: 'error' }),
      );
      expect(fixture.audit.apiCall).toHaveBeenCalledTimes(1);
      expect(fixture.audit.apiCall).toHaveBeenCalledWith(
        'POST /api/v2/auth/login',
        expect.objectContaining({ functionId: 'auth_login', status: 'error' }),
      );
    },
  );

  it.each([
    ['healthcheck', { ...healthBody, unexpected: true }],
    ['auth/initiate', { ...client, unexpected: true }],
    ['auth/send-otp', { ...client, phonenumber: employee.phoneNumber, unexpected: true }],
    ['auth/otp/validate', { ...client, requestid: '1', otp: OTP, unexpected: true }],
    ['auth/mpin/update', { ...client, mpin: CLIENT_MPIN, unexpected: true }],
    ['auth/login', { ...client, mpin: CLIENT_MPIN, unexpected: true }],
    ['auth/mpin/forgot', { ...client, unexpected: true }],
    [
      'auth/mpin/update/reset',
      { ...client, requestid: '1', otp: OTP, newmpin: '1234', unexpected: true },
    ],
    ['auth/token/refresh', { refreshtoken: 'token', username: client.username }],
    ['auth/initiate', { ...client, username: undefined }],
    ['auth/initiate', { ...client, deviceid: undefined }],
    ['auth/send-otp', { ...client, email: 'not-an-email' }],
    ['auth/otp/validate', { ...client, requestid: '1', otp: 123456 }],
    ['auth/mpin/update', { ...client, mpin: '' }],
    ['auth/mpin/update', { ...client, mpin: 1234 }],
    ['auth/login', { ...client, mpin: null }],
    ['auth/mpin/update/reset', { ...client, otp: OTP, newmpin: '1234' }],
    ['auth/token/refresh', {}],
    ['auth/token/refresh', { refreshtoken: 1234 }],
  ] as const)(
    'strictly rejects invalid POST /api/v2/%s bodies before services have side effects',
    async (route, body) => {
      const response = await request(fixture.app.getHttpServer())
        .post(`/api/v2/${route}`)
        .send(body)
        .expect(400);
      expectHttpError(response.body, 400);
      expect(response.body).toHaveProperty('errors');
      expect(fixture.health.check).not.toHaveBeenCalled();
      expect(fixture.directory.validate).not.toHaveBeenCalled();
      expect(fixture.devices.bind).not.toHaveBeenCalled();
      expect(fixture.devices.isBound).not.toHaveBeenCalled();
      expect(fixture.mpinStore.set).not.toHaveBeenCalled();
      expect(fixture.mpinStore.verify).not.toHaveBeenCalled();
      expect(fixture.otp.send).not.toHaveBeenCalled();
      expect(fixture.otp.verify).not.toHaveBeenCalled();
      expect(fixture.audit.lifecycle).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown logout body fields before revoking an otherwise valid session', async () => {
    const token = await fixture.jwt.signAsync({ ...sessionClaims, jti: 'strict-logout' });
    const http = fixture.app.getHttpServer();
    const response = await request(http)
      .post('/api/v2/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({ username: 'another.user' })
      .expect(400);
    expectHttpError(response.body, 400);
    expect(fixture.audit.lifecycle).not.toHaveBeenCalled();
    await request(http)
      .get('/api/v2/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(meResponse);
  });

  it('retains v1 onboarding and login while sharing JWTs, refresh rotation and revocation across versions', async () => {
    const http = fixture.app.getHttpServer();
    await request(http)
      .post('/api/v1/healthcheck')
      .send(healthBody)
      .expect(200)
      .expect(healthResponse);
    await onboardAndSetMpin(fixture, '1');
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ ...client, mpin: CLIENT_MPIN })
      .expect(200);
    expect(login.body).toMatchObject({
      status: 'success',
      employeeusername: client.username.toUpperCase(),
    });
    for (const version of ['1', '2']) {
      await request(http)
        .get(`/api/v${version}/auth/me`)
        .set('Authorization', `Bearer ${login.body.token}`)
        .expect(200)
        .expect(meResponse);
    }
    const refreshed = await request(http)
      .post('/api/v2/auth/token/refresh')
      .send({ refreshtoken: login.body.refreshtoken })
      .expect(200);
    expect(refreshed.body.status).toBe('success');
    await request(http)
      .post('/api/v1/auth/token/refresh')
      .send({ refreshtoken: login.body.refreshtoken })
      .expect(200)
      .expect({ status: 'error', message: 'This refresh token has been revoked.' });
    await request(http)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.token}`)
      .expect(200)
      .expect(meResponse);
    await request(http)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${refreshed.body.token}`)
      .send({ refreshtoken: refreshed.body.refreshtoken })
      .expect(200)
      .expect({ status: 'success', message: 'Logged out successfully.' });
    const rejected = await request(http)
      .get('/api/v2/auth/me')
      .set('Authorization', `Bearer ${refreshed.body.token}`)
      .expect(401);
    expectHttpError(rejected.body, 401);
    await request(http)
      .post('/api/v2/auth/token/refresh')
      .send({ refreshtoken: refreshed.body.refreshtoken })
      .expect(200)
      .expect({ status: 'error', message: 'This refresh token has been revoked.' });
  });
});

describe.each([false, true])('Protected auth v2 with auth.disabled=%s', (authDisabled) => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await createFixture(authDisabled);
  });

  afterEach(async () => {
    await fixture?.app.close();
  });

  it.each(['missing', 'malformed', 'wrong signature', 'expired', 'refresh', 'revoked'])(
    'rejects %s bearer tokens on me and logout',
    async (kind) => {
      let token: string | undefined;
      if (kind === 'malformed') token = 'not-a-jwt';
      if (kind === 'wrong signature')
        token = await fixture.jwt.signAsync(sessionClaims, {
          secret: 'different-test-signing-key',
        });
      if (kind === 'expired')
        token = await fixture.jwt.signAsync(sessionClaims, { expiresIn: -60 });
      if (kind === 'refresh')
        token = await fixture.jwt.signAsync({ ...sessionClaims, typ: 'refresh' });
      if (kind === 'revoked') {
        token = await fixture.jwt.signAsync({ ...sessionClaims, jti: 'already-revoked' });
        fixture.revocation.revoke('already-revoked');
      }
      const http = fixture.app.getHttpServer();
      const me = request(http).get('/api/v2/auth/me');
      if (token) me.set('Authorization', `Bearer ${token}`);
      expectHttpError((await me.expect(401)).body, 401);
      const logout = request(http).post('/api/v2/auth/logout').send({});
      if (token) logout.set('Authorization', `Bearer ${token}`);
      expectHttpError((await logout.expect(401)).body, 401);
      expect(fixture.audit.lifecycle).not.toHaveBeenCalled();
      expect(fixture.audit.apiCall).not.toHaveBeenCalled();
    },
  );

  it('still accepts signed access tokens and keeps healthcheck and body-token refresh public', async () => {
    const http = fixture.app.getHttpServer();
    const token = await fixture.jwt.signAsync({ ...sessionClaims, jti: 'valid-access' });
    const refreshtoken = await fixture.jwt.signAsync({
      ...sessionClaims,
      typ: 'refresh',
      jti: 'valid-refresh',
    });
    await request(http)
      .post('/api/v2/healthcheck')
      .send(healthBody)
      .expect(200)
      .expect(healthResponse);
    await request(http)
      .get('/api/v2/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect(meResponse);
    const refreshed = await request(http)
      .post('/api/v2/auth/token/refresh')
      .set('Authorization', 'Bearer invalid-access')
      .send({ refreshtoken })
      .expect(200);
    expect(refreshed.body.status).toBe('success');
    expect(fixture.jwt.verify(refreshed.body.token)).toMatchObject(sessionClaims);
    await request(http)
      .post('/api/v2/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200)
      .expect({ status: 'success', message: 'Logged out successfully.' });
    const rejected = await request(http)
      .get('/api/v2/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expectHttpError(rejected.body, 401);
    expect(fixture.audit.lifecycle).toHaveBeenCalledTimes(1);
    expect(fixture.audit.lifecycle).toHaveBeenCalledWith(AuthLifecycleEvent.LOGOUT, {
      username: client.username,
      status: 'success',
    });
  });
});
