import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MssqlService } from '@core/database/mssql.service';
import { MssqlQueryError } from '@core/database/mssql.error';
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

/**
 * The state this actually ships in: server deployed, `FIREBASE_SERVICE_ACCOUNT`
 * not set yet, and `HMC_Sanad_DeviceToken_tbl` not created yet — while the
 * Users DB itself is up and answering.
 *
 * That last part is why this exists rather than relying on the unit tests: the
 * local smoke test runs with `USERS_DB_DISABLED=true`, which fails at the pool
 * and never reaches a statement. On the real server the pool connects fine and
 * SQL Server answers error 208 to every query — a different path, and the one
 * that will really happen.
 *
 * The requirement is absolute: every endpoint keeps working. Not "degrades
 * politely" — works.
 */
describe('notifications on an incomplete deployment', () => {
  let app: INestApplication;
  /** Every statement fails the way a missing table does. */
  const query = jest.fn();
  const execute = jest.fn();
  const lookup: RequestLookupPort = {
    findLatestSubmission: jest.fn(),
    findByNotificationId: jest.fn(),
  };

  beforeAll(async () => {
    const missingTable = () =>
      MssqlQueryError.from(
        Object.assign(new Error("Invalid object name 'HMC_Sanad_DeviceToken_tbl'."), {
          number: 208,
        }),
      );
    query.mockRejectedValue(missingTable());
    execute.mockRejectedValue(missingTable());

    const moduleRef = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        NotificationsService,
        RequestNotifier,
        MssqlDeviceTokenRepository,
        { provide: MssqlService, useValue: { query, execute } },
        { provide: DEVICE_TOKEN_STORE_PORT, useExisting: MssqlDeviceTokenRepository },
        { provide: REQUEST_LOOKUP_PORT, useValue: lookup },
        // No credential configured → the module binds the no-op sender.
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
    // The same pipe CoreModule installs — validation is part of "requests
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

  it('validation still works — this is not a blanket catch', async () => {
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
