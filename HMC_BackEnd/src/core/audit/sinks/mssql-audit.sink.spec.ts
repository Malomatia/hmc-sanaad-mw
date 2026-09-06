import { MssqlService } from '../../database/mssql.service';
import { AuditLevel, AuditRecord, AuthLifecycleEvent } from '../audit-event';
import { LoggerAuditSink } from './logger-audit.sink';
import { MssqlAuditSink } from './mssql-audit.sink';

const RECORD: AuditRecord = {
  auditId: 'audit-1',
  timestamp: '2026-09-06T10:00:00.000Z',
  level: AuditLevel.API_CALL,
  apiName: 'GET /api/v1/employee/profile',
  functionId: 'employee_profile',
  username: 'hmc1',
  deviceImei: 'imei-1',
  appName: 'Sanaad',
  appVersion: '1.0.0',
  status: 'success',
};

function makeSink() {
  const db = {
    isConfigured: jest.fn().mockReturnValue(true),
    execute: jest.fn().mockResolvedValue({ rowsAffected: 1, rows: [] }),
  } as unknown as jest.Mocked<MssqlService>;
  const logs = { write: jest.fn() } as unknown as jest.Mocked<LoggerAuditSink>;
  return { sink: new MssqlAuditSink(db, logs), db, logs };
}

describe('MssqlAuditSink', () => {
  it('binds the requested function-access columns and retains the structured audit log', async () => {
    const { sink, db, logs } = makeSink();

    await sink.write(RECORD);

    expect(logs.write).toHaveBeenCalledWith(RECORD);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO HMC_Sanad_FunctionAccessLogs_tbl/),
      {
        loginId: 'hmc1',
        imeiNumber: 'imei-1',
        appName: 'Sanaad',
        appVersion: '1.0.0',
        functionId: 'employee_profile',
        actionTaken: 'GET /api/v1/employee/profile',
        actionResult: 'success',
        accessDatetime: new Date(RECORD.timestamp),
      },
    );
  });

  it.each(['success', 'error'])(
    'writes one user log for a login with status=%s',
    async (status) => {
      const { sink, db } = makeSink();

      await sink.write({
        ...RECORD,
        functionId: 'auth_login',
        apiName: 'POST /api/v1/auth/login',
        status,
      });

      expect(db.execute).toHaveBeenCalledTimes(2);
      expect(db.execute).toHaveBeenCalledWith(
        expect.stringMatching(/INSERT INTO HMC_Sanad_UserLogs_tbl/),
        {
          loginId: 'hmc1',
          imeiNumber: 'imei-1',
          loginTime: new Date(RECORD.timestamp),
          status,
        },
      );
    },
  );

  it('does not insert duplicate user logs for the existing login lifecycle event', async () => {
    const { sink, db, logs } = makeSink();
    const record = {
      ...RECORD,
      level: AuditLevel.LIFECYCLE,
      event: AuthLifecycleEvent.LOGIN_SUCCESS,
    };

    await sink.write(record);

    expect(logs.write).toHaveBeenCalledWith(record);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('uses bound values rather than interpolating user-controlled text into SQL', async () => {
    const { sink, db } = makeSink();
    const username = "test'user";

    await sink.write({ ...RECORD, username, meta: { mpin: 'not-for-sql', otp: 'not-for-sql' } });

    const [statement, params] = db.execute.mock.calls[0];
    expect(statement).not.toContain(username);
    expect(statement).toContain('@loginId');
    expect(params).toMatchObject({ loginId: username });
    expect(params).not.toHaveProperty('meta');
    expect(JSON.stringify(params)).not.toContain('not-for-sql');
  });

  it('does not invent device or app details when an older token has none', async () => {
    const { sink, db } = makeSink();

    await sink.write({
      ...RECORD,
      deviceImei: undefined,
      appName: undefined,
      appVersion: undefined,
    });

    expect(db.execute).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ imeiNumber: null, appName: null, appVersion: null }),
    );
  });

  it('retains console audits when the Users DB is unconfigured', async () => {
    const { sink, db, logs } = makeSink();
    db.isConfigured.mockReturnValue(false);

    await sink.write(RECORD);

    expect(logs.write).toHaveBeenCalledWith(RECORD);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('still attempts the user log when the function-access insert fails', async () => {
    const { sink, db, logs } = makeSink();
    db.execute.mockRejectedValueOnce(new Error('function log table unavailable'));

    await expect(sink.write({ ...RECORD, functionId: 'auth_login' })).rejects.toThrow(
      'function log table unavailable',
    );

    expect(logs.write).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO HMC_Sanad_UserLogs_tbl'),
      expect.objectContaining({ status: 'success' }),
    );
  });
});
