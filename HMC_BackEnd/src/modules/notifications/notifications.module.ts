import { Logger, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { App } from 'firebase-admin/app';
import { FIREBASE_APP } from '@core/firebase/firebase-app';
import { NotificationsService } from './application/notifications.service';
import { RequestNotifier } from './application/request-notifier.service';
import { DEVICE_TOKEN_STORE_PORT } from './domain/ports/device-token-store.port';
import { PUSH_SENDER_PORT, PushSenderPort } from './domain/ports/push-sender.port';
import { REQUEST_LOOKUP_PORT } from './domain/ports/request-lookup.port';
import { MssqlDeviceTokenRepository } from './infrastructure/adapters/mssql-device-token.repository';
import { OracleRequestLookupRepository } from './infrastructure/adapters/oracle-request-lookup.repository';
import { NotificationTriggerInterceptor } from './interface/notification-trigger.interceptor';
import {
  FirebasePushSender,
  NoopPushSender,
} from './infrastructure/adapters/firebase-push-sender.adapter';
import { NotificationsController } from './interface/notifications.controller';

/**
 * Push notifications (FCM).
 *
 * The transport is chosen at boot from configuration: a credential binds the
 * Firebase sender, no credential binds the no-op. Deliberately not a hard
 * failure — an environment without a Firebase key should run the rest of the
 * API normally, and the notifications routes still accept registrations so the
 * tokens are there when the key arrives.
 *
 * Exported so any module can notify a user without depending on FCM, a token
 * table, or how many devices a person has.
 */
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    RequestNotifier,
    MssqlDeviceTokenRepository,
    OracleRequestLookupRepository,
    { provide: DEVICE_TOKEN_STORE_PORT, useExisting: MssqlDeviceTokenRepository },
    { provide: REQUEST_LOOKUP_PORT, useExisting: OracleRequestLookupRepository },
    // Global: submits live in ten modules, and the rule for notifying about
    // one belongs in a single place rather than in each of them.
    { provide: APP_INTERCEPTOR, useClass: NotificationTriggerInterceptor },
    {
      provide: PUSH_SENDER_PORT,
      // FirebaseModule always provides the token; the value is undefined when
      // no credential is configured, so this is a plain injection.
      inject: [FIREBASE_APP],
      useFactory: (app?: App): PushSenderPort => {
        if (!app) {
          new Logger('NotificationsModule').warn(
            'FIREBASE_SERVICE_ACCOUNT is not set — push notifications are disabled. ' +
              'Registrations are still stored.',
          );
          return new NoopPushSender();
        }
        new Logger('NotificationsModule').log('Push notifications enabled.');
        return new FirebasePushSender(app);
      },
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
