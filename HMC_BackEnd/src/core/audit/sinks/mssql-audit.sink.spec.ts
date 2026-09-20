import { MssqlService } from '../../database/mssql.service';
import { AuditLevel, AuditRecord, AuthLifecycleEvent } from '../audit-event';
import { LoggerAuditSink } from './logger-audit.sink';
import { MssqlAuditSink } from './mssql-audit.sink';

const RECORD: AuditRecord = {
  auditId: 'audit-1',
  timestamp: '2026-09-06T10:00:00.000Z',
  level: AuditLevel.API_CALL,
  apiName: 'GET /api/v1/profile',
  functionId: 'frmProfile',
  actionTaken: 'view',
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
  beforeEach(() => {
    jest.replaceProperty(process, 'env', { ...process.env, TZ: 'Asia/Qatar' });
  });

  afterEach(() => jest.restoreAllMocks());

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
        functionId: 'frmProfile',
        actionTaken: 'view',
        actionResult: 'success',
        accessDatetime: new Date(RECORD.timestamp),
      },
    );
    expect(db.execute.mock.calls[0][0]).toContain(
      "SWITCHOFFSET(TODATETIMEOFFSET(@accessDatetime, '+00:00'), '+03:00')",
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
        actionTaken: 'submit',
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
      expect(db.execute.mock.calls[1][0]).toContain(
        "VALUES (@loginId, @imeiNumber, SWITCHOFFSET(TODATETIMEOFFSET(@loginTime, '+00:00'), '+03:00'), @status)",
      );
    },
  );

  it.each([
    ['2026-09-20T21:30:00.000Z', '2026-09-20T21:30:00.000Z'],
    ['2026-12-31T22:30:00.000Z', '2026-12-31T22:30:00.000Z'],
    ['2026-09-21T00:30:00.000+03:00', '2026-09-20T21:30:00.000Z'],
  ])('keeps UTC binds and structured audit timestamps for %s', async (timestamp, expectedUtc) => {
    const { sink, db, logs } = makeSink();
    const record = Object.freeze({ ...RECORD, functionId: 'auth_login', timestamp });

    await sink.write(record);

    expect(db.execute).toHaveBeenCalledTimes(2);
    const [accessSql, accessParams] = db.execute.mock.calls[0];
    const [loginSql, loginParams] = db.execute.mock.calls[1];
    expect(accessSql).toContain("SWITCHOFFSET(TODATETIMEOFFSET(@accessDatetime, '+00:00'), '+03:00')");
    expect(accessParams).toMatchObject({ accessDatetime: new Date(expectedUtc) });
    expect(loginSql).toContain("SWITCHOFFSET(TODATETIMEOFFSET(@loginTime, '+00:00'), '+03:00')");
    expect(loginParams).toMatchObject({ loginTime: new Date(expectedUtc) });
    expect(logs.write).toHaveBeenCalledWith(record);
    expect(record.timestamp).toBe(timestamp);
  });

  it.each([
    ['Asia/Qatar', '2026-01-01T22:30:00.000Z'],
    ['UTC', '2026-09-06T10:00:00.000Z'],
    ['Asia/Kolkata', '2026-09-06T10:00:00.000Z'],
    ['America/New_York', '2026-01-01T10:00:00.000Z'],
    ['America/New_York', '2026-07-01T10:00:00.000Z'],
    ['Pacific/Kiritimati', '2026-12-31T12:30:00.000Z'],
    ['Invalid/Timezone', '2026-09-06T10:00:00.000Z'],
    [undefined, '2026-09-06T10:00:00.000Z'],
    ['', '2026-09-06T10:00:00.000Z'],
  ])('uses fixed UTC+3 regardless of TZ=%s at %s for both SQL audit tables', async (timeZone, timestamp) => {
    if (timeZone === undefined) delete process.env.TZ;
    else process.env.TZ = timeZone;
    const { sink, db, logs } = makeSink();
    const record = Object.freeze({ ...RECORD, functionId: 'auth_login', timestamp });

    await sink.write(record);

    expect(db.execute).toHaveBeenCalledTimes(2);
    const [accessSql, accessParams] = db.execute.mock.calls[0];
    const [loginSql, loginParams] = db.execute.mock.calls[1];
    expect(accessSql).toContain("SWITCHOFFSET(TODATETIMEOFFSET(@accessDatetime, '+00:00'), '+03:00')");
    expect(loginSql).toContain("SWITCHOFFSET(TODATETIMEOFFSET(@loginTime, '+00:00'), '+03:00')");
    expect(accessParams).toMatchObject({ accessDatetime: new Date(timestamp) });
    expect(loginParams).toMatchObject({ loginTime: new Date(timestamp) });
    expect(accessParams).not.toHaveProperty('timeZoneOffset');
    expect(loginParams).not.toHaveProperty('timeZoneOffset');
    expect(logs.write).toHaveBeenCalledWith(record);
  });

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
