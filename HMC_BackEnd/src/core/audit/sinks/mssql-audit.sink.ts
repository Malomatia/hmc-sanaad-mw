import { Injectable } from '@nestjs/common';
import { UsersDbDialect, UsersDbService } from '../../database/users-db/users-db.service';
import { AuditLevel, AuditRecord } from '../audit-event';
import { AuditSink } from '../ports/audit-sink.port';
import { LoggerAuditSink } from './logger-audit.sink';

/** A UTC bind shifted to Qatar time (+03:00) for the legacy datetime columns. */
const QATAR_TIME: Record<UsersDbDialect, (bind: string) => string> = {
  mssql: (bind) => `SWITCHOFFSET(TODATETIMEOFFSET(${bind}, '+00:00'), '+03:00')`,
  mysql: (bind) => `CONVERT_TZ(${bind}, '+00:00', '+03:00')`,
};

@Injectable()
export class MssqlAuditSink implements AuditSink {
  constructor(
    private readonly db: UsersDbService,
    private readonly logs: LoggerAuditSink,
  ) {}

  async write(record: AuditRecord): Promise<void> {
    this.logs.write(record);
    if (record.level !== AuditLevel.API_CALL || !this.db.isConfigured()) return;

    const loginId = record.username ?? null;
    const imeiNumber = record.deviceImei ?? null;
    const timestamp = new Date(record.timestamp);
    const status = record.status === 'success' ? 'success' : 'error';
    const qatarTime = QATAR_TIME[this.db.dialect];
    const writes = [
      this.db.execute(
        `INSERT INTO HMC_Sanad_FunctionAccessLogs_tbl
           (LoginID, IMEINumber, AppName, AppVersion, FunctionID, ActionTaken, ActionResult, AccessDatetime)
         VALUES (@loginId, @imeiNumber, @appName, @appVersion, @functionId, @actionTaken, @actionResult,
                 ${qatarTime('@accessDatetime')})`,
        {
          loginId,
          imeiNumber,
          appName: record.appName ?? null,
          appVersion: record.appVersion ?? null,
          functionId: record.functionId ?? record.apiName ?? null,
          actionTaken: record.actionTaken ?? null,
          actionResult: status,
          accessDatetime: timestamp,
        },
      ),
    ];
    if (record.functionId === 'auth_login') {
      writes.push(
        this.db.execute(
          `INSERT INTO HMC_Sanad_UserLogs_tbl (LoginID, IMEINumber, LoginTime, Status)
           VALUES (@loginId, @imeiNumber, ${qatarTime('@loginTime')}, @status)`,
          { loginId, imeiNumber, loginTime: timestamp, status },
        ),
      );
    }
    await Promise.all(writes);
  }
}
