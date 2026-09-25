import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { UsersDbService } from '@core/database/users-db/users-db.service';
import { SqlQueryError } from '@core/database/sql.error';
import { FIREBASE_APP } from '@core/firebase/firebase-app';
import { NotificationsService } from './application/notifications.service';
import { RequestNotifier } from './application/request-notifier.service';
import { DEVICE_TOKEN_STORE_PORT } from './domain/ports/device-token-store.port';
import { PUSH_SENDER_PORT } from './domain/ports/push-sender.port';
import { REQUEST_LOOKUP_PORT, RequestLookupPort } from './domain/ports/request-lookup.port';
import { MssqlDeviceTokenRepository } from './infrastructure/adapters/mssql-device-token.repository';
import { NoopPushSender } from './infrastructure/adapters/firebase-push-sender.adapter';
import { NotificationsController } from './interface/notifications.controller';
import { NotificationTriggerInterceptor } from './interface/notification-trigger.interceptor';
import { ResponseInterceptor } from '@core/http/response.interceptor';
import { EmployeeController } from '@modules/employee/interface/employee.controller';
import { EmployeeService, SupervisorService } from '@modules/employee/application/employee.service';

/**
 * The state this actually ships in: server deployed, `FIREBASE_SERVICE_ACCOUNT`
 * not set yet, and `HMC_Sanad_DeviceToken_tbl` not created yet - while the
 * Users DB itself is up and answering.
 *
 * That last part is why this exists rather than relying on the unit tests: the
 * local smoke test runs with `USERS_DB_DISABLED=true`, which fails at the pool
 * and never reaches a statement. On the real server the pool connects fine and
 * SQL Server answers error 208 to every query - a different path, and the one
 * that will really happen.
 *
 * The requirement is absolute: every endpoint keeps working. Not "degrades
 * politely" - works.
 */
describe('notifications on an incomplete deployment', () => {
  let app: INestApplication;
  /** Every statement fails the way a missing table does. */
  const query = jest.fn();
  const execute = jest.fn();
  const lookup: RequestLookupPort = {
    findWorklistNotifications: jest.fn().mockResolvedValue([]),
    findLatestSubmission: jest.fn(),
    findByNotificationId: jest.fn(),
  };

  beforeAll(async () => {
    const missingTable = () =>
      SqlQueryError.from(
        Object.assign(new Error("Invalid object name 'HMC_Sanad_DeviceToken_tbl'."), {
          number: 208,
        }),
      );
    query.mockRejectedValue(missingTable());
    execute.mockRejectedValue(missingTable());

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        // The diagnostic test-send route is behind DiagnosticsEnabledGuard,
        // which reads config. Global in the app, absent in a bare harness.
        { provide: ConfigService, useValue: { get: () => ({ enabled: true }) } },
        NotificationsService,
        RequestNotifier,
        MssqlDeviceTokenRepository,
        { provide: UsersDbService, useValue: { query, execute } },
        { provide: DEVICE_TOKEN_STORE_PORT, useExisting: MssqlDeviceTokenRepository },
        { provide: REQUEST_LOOKUP_PORT, useValue: lookup },
        // No credential configured -> the module binds the no-op sender.
        { provide: FIREBASE_APP, useValue: undefined },
        { provide: PUSH_SENDER_PORT, useClass: NoopPushSender },
        { provide: APP_INTERCEPTOR, useClass: NotificationTriggerInterceptor },
      ],
    })
      // The real guards need Oracle/JWT; the caller identity is all this needs.
      .overrideGuard(Symbol('unused'))
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    // The same pipe CoreModule installs - validation is part of "requests
    // still work correctly", so it has to be exercised here too.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { username: 'AIBRAHIM39', employeeNumber: '037400', roles: ['EMPLOYEE'] };
      next();
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registering a device still answers 200', async () => {
    await request(app.getHttpServer())
      .post('/notifications/device-token')
      .send({ token: 'fcm-token', imei: 'imei-1', platform: 'android' })
      .expect(200)
      .expect((res: { body: { message?: string } }) => {
        expect(res.body.message).toContain('registered');
      });
  });

  it('unregistering still answers 200', async () => {
    await request(app.getHttpServer())
      .delete('/notifications/device-token')
      .send({ imei: 'imei-1' })
      .expect(200);
  });

  it('validation still works - this is not a blanket catch', async () => {
    await request(app.getHttpServer())
      .post('/notifications/device-token')
      .send({ imei: 'imei-1' })
      .expect(400);
  });

  it('a notification attempt reaches nobody and raises nothing', async () => {
    const notifications = app.get(NotificationsService);

    await expect(
      notifications.notifyUser('AIBRAHIM39', { title: 'x', body: 'y' }),
    ).resolves.toBeUndefined();
  });

  it('the whole trigger path is inert rather than broken', async () => {
    (lookup.findLatestSubmission as jest.Mock).mockResolvedValue({
      approver: 'RABOOBACKER',
      requestType: 'Leave Request',
    });

    // Approver resolved, tokens unreadable, no sender: still silent success.
    await expect(app.get(RequestNotifier).onSubmitted('AIBRAHIM39')).resolves.toBeUndefined();
  });

  it('never lets the database error escape to a caller', async () => {
    // Every code path above went through a failing statement.
    expect(execute).toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
  });
});

describe('worklist submission HTTP and device delivery', () => {
  let app: INestApplication;
  let query: jest.Mock;
  let send: jest.Mock;
  let lookup: jest.Mock;
  let update: jest.Mock;
  let sender: { enabled: boolean; send: jest.Mock };
  const body = { p_new_supervisor: '112', p_reason: 'Team restructure' };

  beforeEach(async () => {
    query = jest.fn().mockResolvedValue([
      { LoginID: 'APPROVER', IMEINumber: 'phone', DeviceTokenValue: 'test-phone' },
      { LoginID: 'APPROVER', IMEINumber: 'tablet', DeviceTokenValue: 'test-tablet' },
    ]);
    send = jest.fn().mockResolvedValue({ sent: 2, failed: 0, invalidTokens: [] });
    sender = { enabled: true, send };
    lookup = jest.fn().mockResolvedValue([
      {
        notificationId: '123',
        recipient: 'APPROVER',
        subject: 'Supervisor change request',
        itemKey: '456',
        itemType: 'HRSSA',
      },
    ]);
    update = jest
      .fn()
      .mockResolvedValue({ successflag: 'S', status: 'success', errormessage: 'Submitted' });
    const moduleRef = await Test.createTestingModule({
      controllers: [EmployeeController],
      providers: [
        { provide: EmployeeService, useValue: {} },
        { provide: SupervisorService, useValue: { update } },
        NotificationsService,
        RequestNotifier,
        MssqlDeviceTokenRepository,
        { provide: UsersDbService, useValue: { query, execute: jest.fn() } },
        { provide: DEVICE_TOKEN_STORE_PORT, useExisting: MssqlDeviceTokenRepository },
        { provide: PUSH_SENDER_PORT, useValue: sender },
        {
          provide: REQUEST_LOOKUP_PORT,
          useValue: {
            findWorklistNotifications: lookup,
            findByNotificationId: jest.fn().mockResolvedValue({
              requestType: 'Supervisor Change',
              requestor: 'SUBMITTER',
              requestorName: 'Old Requester Name',
            }),
          },
        },
        { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
        { provide: APP_INTERCEPTOR, useClass: NotificationTriggerInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.use((req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = { username: 'SUBMITTER', employeeName: 'Alice Requester', roles: ['EMPLOYEE'] };
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  async function submit() {
    const response = await request(app.getHttpServer())
      .post('/api/v1/employee/supervisor')
      .send(body)
      .timeout(2000)
      .expect(200);
    expect(response.body).toEqual({
      status: 'success',
      successflag: 'S',
      message: 'Success',
      httpStatusCode: 200,
    });
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('queries every device by the worklist recipient login and sends the personalized message to all tokens', async () => {
    await submit();
    expect(lookup).toHaveBeenCalledWith('SUBMITTER');
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM HMC_Sanad_DeviceToken_tbl\s+WHERE LoginID = @username/),
      { username: 'APPROVER' },
    );
    expect(send).toHaveBeenCalledWith(['test-phone', 'test-tablet'], {
      title: 'New request awaiting your approval',
      body: 'Alice Requester sent you Supervisor Change for Approval',
      data: {
        event: 'APPROVAL_REQUIRED',
        notificationId: '123',
        itemKey: '456',
        itemType: 'HRSSA',
      },
    });
  });

  it('keeps successful submits working with push disabled', async () => {
    sender.enabled = false;
    await submit();
    expect(lookup).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps successful submits working with no registered devices', async () => {
    query.mockResolvedValue([]);
    await submit();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps successful submits working with a missing token table', async () => {
    query.mockRejectedValue(
      SqlQueryError.from(Object.assign(new Error('Invalid object name'), { number: 208 })),
    );
    await submit();
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps successful submits working when SQL Server or FCM fails', async () => {
    query.mockRejectedValueOnce(new Error('SQL Server unavailable'));
    await submit();
    expect(send).not.toHaveBeenCalled();
    lookup.mockResolvedValue([{ notificationId: '124', recipient: 'APPROVER' }]);
    send.mockRejectedValue(new Error('FCM unavailable'));
    await submit();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not hold the HTTP response open for an unresolved lookup', async () => {
    lookup.mockImplementation(() => new Promise(() => undefined));
    await submit();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not fail the HTTP response when the worklist lookup rejects', async () => {
    lookup.mockRejectedValue(new Error('Oracle unavailable'));
    await submit();
    expect(query).not.toHaveBeenCalled();
  });

  it('preserves business failure and validation without creating a notification job', async () => {
    update.mockResolvedValue({ successflag: 'N', status: 'error', errormessage: 'Rejected' });
    const response = await request(app.getHttpServer())
      .post('/api/v1/employee/supervisor')
      .send(body)
      .expect(200);
    expect(response.body.successflag).toBe('N');
    expect(response.body.status).toBe('error');
    await request(app.getHttpServer())
      .post('/api/v1/employee/supervisor')
      .send({ ...body, username: 'SPOOF' })
      .expect(400);
    expect(lookup).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
