import { Global, Module } from '@nestjs/common';
import { MssqlService } from './mssql.service';
import { MotcSmsDbService } from './motc-sms-db.service';

/**
 * Global module exposing the SQL Server pools: the Users/Sanaad DB
 * (MssqlService — auth cycle device/MPIN legacy tables + API-1 healthcheck
 * tables) and the MOTC SMS gateway DB (MotcSmsDbService — the
 * MOTC_SMS_PushTable outbox that stores/delivers/validates login OTPs).
 */
@Global()
@Module({
  providers: [MssqlService, MotcSmsDbService],
  exports: [MssqlService, MotcSmsDbService],
})
export class MssqlModule {}
