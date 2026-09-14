import { Injectable } from '@nestjs/common';
import { MssqlService } from '../../database/mssql.service';
import { AuditLevel, AuditRecord } from '../audit-event';
import { AuditSink } from '../ports/audit-sink.port';
import { LoggerAuditSink } from './logger-audit.sink';

@Injectable()
export class MssqlAuditSink implements AuditSink {
  constructor(
    private readonly db: MssqlService,
    private readonly logs: LoggerAuditSink,
  ) {}

  async write(record: AuditRecord): Promise<void> {
    this.logs.write(record);
    if (record.level !== AuditLevel.API_CALL || !this.db.isConfigured()) return;

    const loginId = record.username ?? null;
    const imeiNumber = record.deviceImei ?? null;
    const timestamp = new Date(record.timestamp);
    const status = record.status === 'success' ? 'success' : 'error';
    const writes = [
      this.db.execute(
        `INSERT INTO HMC_Sanad_FunctionAccessLogs_tbl
           (LoginID, IMEINumber, AppName, AppVersion, FunctionID, ActionTaken, ActionResult, AccessDatetime)
         VALUES (@loginId, @imeiNumber, @appName, @appVersion, @functionId, @actionTaken, @actionResult, @accessDatetime)`,
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
           VALUES (@loginId, @imeiNumber, @loginTime, @status)`,
          { loginId, imeiNumber, loginTime: timestamp, status },
        ),
      );
    }
    await Promise.all(writes);
  }
}
