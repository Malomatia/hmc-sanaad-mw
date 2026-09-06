import { Controller, Get, INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiOperation } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from '@modules/auth/interface/auth.controller';
import { AuthService } from '@modules/auth/application/auth.service';
import { OnboardingService } from '@modules/auth/application/onboarding.service';
import { MpinService } from '@modules/auth/application/mpin.service';
import { MssqlService } from '../database/mssql.service';
import { MotcSmsDbService } from '../database/motc-sms-db.service';
import { ResponseInterceptor } from '../http/response.interceptor';
import { AuditInterceptor } from './audit.interceptor';
import { AuditModule } from './audit.module';

let result: unknown;

@Controller('items')
class AuditFixtureController {
  @Get(':id')
  @ApiOperation({ operationId: 'items_read' })
  read() {
    return result;
  }
}

describe('API database auditing', () => {
  let app: INestApplication;
  const execute = jest.fn();
  const login = jest.fn();
  const loginBody = {
    username: 'hmc1',
    imeinumber: 'imei-1',
    platform: 'iOS',
    appname: 'Sanaad',
    version: '1.0.0',
    mpin: '123456',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuditModule],
      controllers: [AuthController, AuditFixtureController],
      providers: [
        AuditInterceptor,
        { provide: AuthService, useValue: { login } },
        { provide: OnboardingService, useValue: {} },
        { provide: MpinService, useValue: {} },
      ],
    })
      .overrideProvider(MssqlService)
      .useValue({ isConfigured: () => true, execute })
      .overrideProvider(MotcSmsDbService)
      .useValue({})
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(app.get(AuditInterceptor), new ResponseInterceptor(new Reflector()));
    app.use((req: { path: string; user?: unknown }, _res: unknown, next: () => void) => {
      if (req.path.startsWith('/api/v1/items/')) {
        req.user = {
          username: 'verified-user',
          claims: { deviceImei: 'verified-device', appName: 'Sanaad', appVersion: '2.0.0' },
        };
      }
      next();
    });
    await app.init();
  });

  beforeEach(() => {
    execute.mockReset().mockResolvedValue({ rowsAffected: 1, rows: [] });
    login.mockReset().mockResolvedValue({ status: 'success', employeeusername: 'resolved-user' });
    result = { name: 'Example' };
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  it('logs successful login once in each table using the resolved employee username', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/login').send(loginBody).expect(200);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('HMC_Sanad_FunctionAccessLogs_tbl'),
      expect.objectContaining({
        loginId: 'resolved-user',
        imeiNumber: 'imei-1',
        appName: 'Sanaad',
        appVersion: '1.0.0',
        functionId: 'auth_login',
        actionTaken: 'POST /api/v1/auth/login',
        actionResult: 'success',
      }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('HMC_Sanad_UserLogs_tbl'),
      expect.objectContaining({ loginId: 'resolved-user', status: 'success' }),
    );
    expect(JSON.stringify(execute.mock.calls)).not.toContain(loginBody.mpin);
  });

  it('uses the mobile deviceid alias in the login audit', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ ...loginBody, imeinumber: undefined, deviceid: 'mobile-device' })
      .expect(200);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('HMC_Sanad_UserLogs_tbl'),
      expect.objectContaining({ imeiNumber: 'mobile-device' }),
    );
  });

  it('records invalid credentials as error even though login returns HTTP 200', async () => {
    login.mockResolvedValue({ status: 'error', message: 'Invalid credentials.' });

    await request(app.getHttpServer()).post('/api/v1/auth/login').send(loginBody).expect(200);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('HMC_Sanad_FunctionAccessLogs_tbl'),
      expect.objectContaining({ actionResult: 'error' }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('HMC_Sanad_UserLogs_tbl'),
      expect.objectContaining({ loginId: 'hmc1', status: 'error' }),
    );
  });

  it('records a thrown login failure without changing the HTTP error', async () => {
    login.mockRejectedValue(new Error('dependency failed'));

    await request(app.getHttpServer()).post('/api/v1/auth/login').send(loginBody).expect(500);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('HMC_Sanad_UserLogs_tbl'),
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('records DTO rejection before the login service is invoked', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ ...loginBody, mpin: undefined })
      .expect(400);

    expect(login).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('HMC_Sanad_UserLogs_tbl'),
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('uses verified session context on GET and never stores request bodies or query secrets', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/items/123?otp=DO_NOT_LOG')
      .send({ username: 'spoofed-user', imeinumber: 'spoofed-device', mpin: 'DO_NOT_LOG' })
      .expect(200);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('HMC_Sanad_FunctionAccessLogs_tbl'),
      expect.objectContaining({
        loginId: 'verified-user',
        imeiNumber: 'verified-device',
        appName: 'Sanaad',
        appVersion: '2.0.0',
        functionId: 'items_read',
        actionTaken: 'GET /api/v1/items/:id',
        actionResult: 'success',
      }),
    );
    expect(JSON.stringify(execute.mock.calls)).not.toMatch(/DO_NOT_LOG|spoofed/);
    expect(JSON.stringify((Logger.prototype.log as jest.Mock).mock.calls)).not.toMatch(
      /DO_NOT_LOG|spoofed/,
    );
  });

  it('records a rejected business submission as error', async () => {
    result = { successflag: 'N', status: 'error', errormessage: 'Not permitted' };

    await request(app.getHttpServer()).get('/api/v1/items/123').expect(200);

    expect(execute).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ actionResult: 'error' }),
    );
  });

  it('does not fail a successful API call when the database log insert fails', async () => {
    execute.mockRejectedValue(new Error('audit table unavailable'));

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(loginBody)
      .expect(200)
      .expect({ status: 'success', employeeusername: 'resolved-user' });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(Logger.prototype.error).toHaveBeenCalledWith(
      'Audit sink failed: audit table unavailable',
    );
  });
});
