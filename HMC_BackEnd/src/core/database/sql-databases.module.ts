import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersDbConfig } from '../config/configuration';
import { MotcSmsDbService } from './motc-sms-db.service';
import { MssqlUsersDbService } from './users-db/mssql-users-db.service';
import { MysqlUsersDbService } from './users-db/mysql-users-db.service';
import { UsersDbService } from './users-db/users-db.service';

/** The Users DB driver named by USERS_DB_DRIVER (an unsupported value is reported by the service). */
export function createUsersDb(config: ConfigService): UsersDbService {
  return config.getOrThrow<UsersDbConfig>('usersDb').driver === 'mysql'
    ? new MysqlUsersDbService(config)
    : new MssqlUsersDbService(config);
}

/**
 * Global module exposing the SQL pools: the Users/Sanaad DB (UsersDbService —
 * SQL Server or MySQL per USERS_DB_DRIVER; auth-cycle device/MPIN/OTP tables,
 * API-1 healthcheck tables, device tokens, attestation, audit) and the MOTC SMS
 * gateway DB (MotcSmsDbService, always SQL Server — the MOTC_SMS_PushTable
 * outbox that stores/delivers/validates login OTPs).
 */
@Global()
@Module({
  providers: [
    { provide: UsersDbService, inject: [ConfigService], useFactory: createUsersDb },
    MotcSmsDbService,
  ],
  exports: [UsersDbService, MotcSmsDbService],
})
export class SqlDatabasesModule {}
