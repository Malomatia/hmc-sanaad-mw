import {
  BadRequestException,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  INestApplication,
  Logger,
  Post,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiOperation, DECORATORS } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { lastValueFrom, of, throwError } from 'rxjs';
import request from 'supertest';
import { AuthController } from '@modules/auth/interface/auth.controller';
import { AuthService } from '@modules/auth/application/auth.service';
import { OnboardingService } from '@modules/auth/application/onboarding.service';
import { MpinService } from '@modules/auth/application/mpin.service';
import { MssqlService } from '../database/mssql.service';
import { MotcSmsDbService } from '../database/motc-sms-db.service';
import { ResponseInterceptor } from '../http/response.interceptor';
import { configureApiVersioning } from '../http/api-versioning';
import { AuditInterceptor } from './audit.interceptor';
import { AuditModule } from './audit.module';
import { AuditService } from './audit.service';

let result: unknown;

@Controller('items')
class AuditFixtureController {
  @Get(':id')
  @ApiOperation({ operationId: 'items_read' })
  read() {
    return result;
  }

  @Post('calculate')
  @HttpCode(200)
  @ApiOperation({ operationId: 'leave_calculate' })
  calculate() {
    return result;
  }

  @Post('apply')
  @HttpCode(200)
  @ApiOperation({ operationId: 'letters_apply' })
  apply() {
    return result;
  }
}

describe('Function access audit classification', () => {
  async function recordCall(
    operationId: string | undefined,
    method = 'GET',
    body: unknown = {},
    error?: Error,
  ) {
    const apiCall = jest.fn();
    const handler = function unmapped() {};
    if (operationId) Reflect.defineMetadata(DECORATORS.API_OPERATION, { operationId }, handler);
    const context = {
      getClass: () => AuditFixtureController,
      getHandler: () => handler,
      switchToHttp: () => ({
        getRequest: () => ({ method, body, route: { path: '/api/v1/example' } }),
        getResponse: () => ({ statusCode: 200 }),
      }),
    } as unknown as ExecutionContext;
    const interceptor = new AuditInterceptor({ apiCall } as unknown as AuditService);
    const response = lastValueFrom(
      interceptor.intercept(context, {
        handle: () => (error ? throwError(() => error) : of({ successflag: 'S' })),
      }),
    );
    if (error) await expect(response).rejects.toBe(error);
    else await response;
    expect(apiCall).toHaveBeenCalledTimes(1);
    return apiCall.mock.calls[0][1] as Record<string, unknown>;
  }

  const mappings: [string, string[]][] = [
    ['frmRequestCertificates', ['letters_lov', 'letters_apply']],
    [
      'frmSchoolFees',
      [
        'schoolFees_apply',
        'schoolFees_schoolsLov',
        'schoolFees_termsLov',
        'schoolFees_eduStageLov',
        'schoolFees_academicYearLov',
        'schoolFees_requestTypeLov',
        'schoolFees_children',
      ],
    ],
    ['frmSupervisorChange', ['employee_supervisorViews', 'employee_supervisorUpdate']],
    ['frmMyRequests', ['approvals_myRequests']],
    ['frmPayslip', ['payslip_periods', 'payslip_count', 'payslip_generate']],
    [
      'frmStaffclinic',
      [
        'appointments_upcoming',
        'appointments_masters',
        'appointments_bookingInit',
        'appointments_book',
      ],
    ],
    ['frmPerformance', ['employee_performance']],
    [
      'frmApprovals',
      [
        'approvals_summary',
        'approvals_worklist',
        'approvals_worklistSummary',
        'approvals_history',
        'approvals_details',
        'approvals_attachment',
        'approvals_decision',
        'approvals_requestInfo',
        'approvals_reassign',
        'lookups_rfmiUser',
      ],
    ],
    ['frmLeaveBalances', ['leave_balance']],
    [
      'frmRequestForLeave',
      [
        'leave_apply',
        'leave_calculate',
        'leave_typesLov',
        'leave_reasonsLov',
        'leave_classesLov',
        'leave_defaults',
        'leave_requestLov',
      ],
    ],
    ['frmRequestLeaveAmendment', ['leave_amend', 'leave_amendLov']],
    ['frmRequestLeaveCancellation', ['leave_cancel', 'leave_cancelLov']],
    [
      'frmReturnFromLeave',
      [
        'leave_return',
        'leave_returnLov',
        'leave_returnDetailsLov',
        'leave_relatedLeave1Lov',
        'leave_relatedLeave2Lov',
      ],
    ],
    ['frmProfile', ['profile_get']],
    ['frmResidencePermitRenewal', ['identity_qid', 'identity_qidUpdate']],
    [
      'frmIDCard',
      ['identity_idCardApply', 'identity_workLocLov', 'identity_deliveryLov', 'identity_reasonLov'],
    ],
    [
      'frmPassport',
      ['dependents_passportTypes', 'dependents_passportApply', 'dependents_issuePlaceLov'],
    ],
    ['frmBasicDetails', ['employee_basic', 'profile_updatePersonal', 'profile_maritalLov']],
    ['frmPhoneNumbers', ['contact_phoneTypeLov', 'contact_upsertPhone', 'contact_deletePhone']],
    [
      'frmDependents',
      ['dependents_add', 'dependents_update', 'dependents_delete', 'dependents_lov'],
    ],
  ];

  it.each(mappings.flatMap(([functionId, operations]) => operations.map((id) => [id, functionId])))(
    'maps %s to the screenshot code %s',
    async (operationId, functionId) => {
      expect(await recordCall(operationId)).toMatchObject({ functionId, actionTaken: 'view' });
    },
  );

  it.each([
    ['employee_employment_v2', 'MyEmpDetails'],
    ['payslip_generate_v2', 'frmPayslip'],
    ['leave_amendLov_v2', 'frmRequestLeaveAmendment'],
    ['profile_notifications_v2', 'frmNotificationList'],
    ['approvals_details_v2', 'frmApprovals'],
    ['annualTicket_cancelOptions_v2', 'frmAnnualTicketCancellation'],
    ['unknown_operation_v2', 'unknown_operation_v2'],
  ])('preserves audit classification for %s', async (operationId, functionId) => {
    expect(await recordCall(operationId)).toMatchObject({ functionId, actionTaken: 'view' });
  });

  it('keeps v2 login classified for the legacy login audit sink', async () => {
    expect(await recordCall('auth_login_v2', 'POST')).toMatchObject({
      functionId: 'auth_login', actionTaken: 'submit',
    });
  });

  it.each(['contact_createAddress', 'contact_updateAddress', 'contact_createAddress_v2', 'contact_updateAddress_v2'])(
    'maps %s by country only, regardless of address type',
    async (operationId) => {
      for (const country of ['Qatar', 'QA', ' qAtAr ', 'qa']) {
        expect(
          await recordCall(operationId, 'POST', {
            p_country: country,
            p_address_type: 'Recruiting',
          }),
        ).toMatchObject({ functionId: 'frmAddressinQatar', actionTaken: 'submit' });
      }
      expect(
        await recordCall(operationId, 'POST', {
          p_country: 'India',
          p_address_type: 'Primary Local Address',
        }),
      ).toMatchObject({ functionId: 'frmAddressOutsideQatar', actionTaken: 'submit' });
      for (const country of [undefined, null, '', ' ', 123, ['Qatar']]) {
        expect(await recordCall(operationId, 'POST', { p_country: country })).toMatchObject({
          functionId: operationId,
          actionTaken: 'submit',
        });
      }
    },
  );

  it.each([
    ['employee_employment', 'GET', 'MyEmpDetails', 'view'],
    ['annualTicket_master', 'GET', 'frmAnnualTicket', 'view'],
    ['annualTicket_apply', 'POST', 'frmAnnualTicket', 'submit'],
    ['annualTicket_cancelOptions', 'GET', 'frmAnnualTicketCancellation', 'view'],
    ['annualTicket_cancel', 'POST', 'frmAnnualTicketCancellation', 'submit'],
    ['profile_notifications', 'GET', 'frmNotificationList', 'view'],
    ['profile_notificationSummary', 'GET', 'frmNotificationList', 'view'],
    ['profile_notificationHistory', 'GET', 'frmNotificationList', 'view'],
  ])(
    'maps newly supplied function %s with its action',
    async (id, method, functionId, actionTaken) => {
      expect(await recordCall(id, method)).toMatchObject({ functionId, actionTaken });
    },
  );

  it.each([
    ['notifications_registerDevice', 'POST'],
    ['notifications_unregisterDevice', 'POST'],
    ['notifications_unregisterDeviceLegacy', 'DELETE'],
    ['notifications_testPush', 'POST'],
  ])('keeps push operation %s separate from the notification center', async (id, method) => {
    expect(await recordCall(id, method)).toMatchObject({ functionId: id, actionTaken: 'submit' });
  });

  it.each([
    'leave_list',
    'approvals_pendingCount',
    'contact_countryLov',
    'lookups_yesNo',
    'lookups_lov',
    'lookups_master',
    'auth_login',
    'future_operation',
  ])('preserves %s when no supplied code identifies the function', async (operationId) => {
    expect(await recordCall(operationId, 'GET', { functionId: 'frmProfile' })).toMatchObject({
      functionId: operationId,
    });
  });

  it('preserves the controller and handler fallback', async () => {
    expect(await recordCall(undefined)).toMatchObject({
      functionId: 'AuditFixtureController.unmapped',
      actionTaken: 'view',
    });
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('records %s as view', async (method) =>
    expect(await recordCall('unmapped', method)).toMatchObject({ actionTaken: 'view' }),
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('records %s as submit', async (method) =>
    expect(await recordCall('unmapped', method)).toMatchObject({ actionTaken: 'submit' }),
  );

  it.each([
    'leave_calculate',
    'auth_healthCheck',
    'appIntegrity_verifyAndroid',
    'diag_oracleSql',
    'diag_usersDbSql',
    'diag_motcSmsDbSql',
    'leave_calculate_v2',
    'auth_healthCheck_v2',
    'appIntegrity_verifyAndroid_v2',
    'diag_oracleSql_v2',
    'diag_usersDbSql_v2',
    'diag_motcSmsDbSql_v2',
  ])('records read-only POST %s as view', async (operationId) =>
    expect(await recordCall(operationId, 'POST')).toMatchObject({ actionTaken: 'view' }),
  );

  it.each(['appIntegrity_challenge', 'appIntegrity_challenge_v2'])(
    'records persisted challenge %s as submit even though it uses GET', async (operationId) => {
      expect(await recordCall(operationId)).toMatchObject({ actionTaken: 'submit' });
    },
  );

  it('retains the mapped function and action on an exception', async () => {
    expect(
      await recordCall('letters_apply', 'POST', {}, new BadRequestException('Rejected')),
    ).toMatchObject({
      functionId: 'frmRequestCertificates',
      actionTaken: 'submit',
      status: 'error',
      errorCode: '400',
    });
  });
});

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
    configureApiVersioning(app, 'api/v1');
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
        actionTaken: 'submit',
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
        actionTaken: 'view',
        actionResult: 'success',
      }),
    );
    expect(JSON.stringify(execute.mock.calls)).not.toMatch(/DO_NOT_LOG|spoofed/);
    expect(JSON.stringify((Logger.prototype.log as jest.Mock).mock.calls)).not.toMatch(
      /DO_NOT_LOG|spoofed/,
    );
  });

  it('inserts the screenshot function code and view for a read-only POST', async () => {
    await request(app.getHttpServer()).post('/api/v1/items/calculate').send({}).expect(200);

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('HMC_Sanad_FunctionAccessLogs_tbl'),
      expect.objectContaining({
        functionId: 'frmRequestForLeave',
        actionTaken: 'view',
        actionResult: 'success',
      }),
    );
  });

  it.each(['S', 'N'])(
    'inserts submit independently of the business result %s',
    async (successflag) => {
      result = { successflag, status: successflag === 'S' ? 'success' : 'error' };
      await request(app.getHttpServer()).post('/api/v1/items/apply').send({}).expect(200);

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('HMC_Sanad_FunctionAccessLogs_tbl'),
        expect.objectContaining({
          functionId: 'frmRequestCertificates',
          actionTaken: 'submit',
          actionResult: successflag === 'S' ? 'success' : 'error',
        }),
      );
    },
  );

  it('records a rejected business submission as error', async () => {
    result = { successflag: 'N', status: 'error', errormessage: 'Not permitted' };

    await request(app.getHttpServer()).get('/api/v1/items/123').expect(200);

    expect(execute).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ actionResult: 'error' }),
    );
  });

  it.each(['HMC_Sanad_FunctionAccessLogs_tbl', 'HMC_Sanad_UserLogs_tbl'])(
    'continues login when saving to %s fails',
    async (table) => {
      execute.mockImplementation((sql: string) =>
        sql.includes(table)
          ? Promise.reject(new Error('audit insert denied'))
          : Promise.resolve({ rowsAffected: 1, rows: [] }),
      );

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(loginBody)
        .expect(200)
        .expect({ status: 'success', employeeusername: 'resolved-user' });
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(execute).toHaveBeenCalledTimes(2);
      expect(Logger.prototype.error).toHaveBeenCalledWith('Audit sink failed: audit insert denied');
    },
  );

  it('continues a non-login API when its audit insert fails', async () => {
    execute.mockRejectedValue(new Error('audit table missing'));

    await request(app.getHttpServer())
      .get('/api/v1/items/123')
      .expect(200)
      .expect({
        result: { name: 'Example' },
        opstatus: 0,
        status: 'success',
        httpStatusCode: 200,
      });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(Logger.prototype.error).toHaveBeenCalledWith('Audit sink failed: audit table missing');
  });

  it('preserves a business rejection even when audit saving also fails', async () => {
    const response = { status: 'error', message: 'Invalid credentials.' };
    login.mockResolvedValue(response);
    execute.mockRejectedValue(new Error('audit unavailable'));

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(loginBody)
      .expect(200)
      .expect(response);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(Logger.prototype.error).toHaveBeenCalledWith('Audit sink failed: audit unavailable');
  });

  it('does not replace the original HTTP error with an audit-save error', async () => {
    login.mockRejectedValue(new BadRequestException('Business request rejected'));
    execute.mockRejectedValue(new Error('audit unavailable'));

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(loginBody)
      .expect(400)
      .expect({ statusCode: 400, message: 'Business request rejected', error: 'Bad Request' });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(Logger.prototype.error).toHaveBeenCalledWith('Audit sink failed: audit unavailable');
  });

  it('responds before audit saving finishes and catches a delayed save failure', async () => {
    let rejectWrite!: (reason: Error) => void;
    execute.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectWrite = reject;
      }),
    );

    try {
      await request(app.getHttpServer()).get('/api/v1/items/123').timeout(2000).expect(200);
      expect(execute).toHaveBeenCalledTimes(1);
    } finally {
      rejectWrite(new Error('audit timeout'));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(Logger.prototype.error).toHaveBeenCalledWith('Audit sink failed: audit timeout');
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
