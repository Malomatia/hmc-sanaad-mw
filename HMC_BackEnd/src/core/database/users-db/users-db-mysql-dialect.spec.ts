import { ConfigService } from '@nestjs/config';
import { OtpConfig } from '@core/config/configuration';
import { MssqlAuditSink } from '@core/audit/sinks/mssql-audit.sink';
import { LoggerAuditSink } from '@core/audit/sinks/logger-audit.sink';
import { AuditLevel, AuditRecord } from '@core/audit/audit-event';
import { MssqlDeviceRegistryRepository } from '@modules/auth/infrastructure/adapters/mssql-device-registry.repository';
import { MssqlMpinStoreRepository } from '@modules/auth/infrastructure/adapters/mssql-mpin-store.repository';
import { MssqlOtpRepository } from '@modules/auth/infrastructure/adapters/mssql-otp.repository';
import { MssqlDeviceTokenRepository } from '@modules/notifications/infrastructure/adapters/mssql-device-token.repository';
import {
  MssqlAttestKeyStore,
  MssqlChallengeStore,
} from '@modules/app-integrity/infrastructure/adapters/mssql-integrity-store.repository';
import { SqlQueryError } from '../sql.error';
import { UsersDbService } from './users-db.service';

/**
 * USERS_DB_DRIVER=mysql: every repository on the Users DB must send MySQL
 * syntax — no T-SQL-only construct may leak through.
 */
const T_SQL_ONLY =
  /\bGETDATE\(|\bTOP\s+\d|\bOUTPUT\s+INSERTED|\bMERGE\b|\bIF\s+NOT\s+EXISTS|WITH\s*\(NOLOCK\)|\bISNULL\(|\bDATEADD\(|\bDATEDIFF\(|SWITCHOFFSET|TODATETIMEOFFSET/i;

function mysqlDb() {
  return {
    dialect: 'mysql',
    isConfigured: jest.fn().mockReturnValue(true),
    query: jest.fn().mockResolvedValue([]),
    execute: jest.fn().mockResolvedValue({ rowsAffected: 1, rows: [] }),
  } as unknown as jest.Mocked<UsersDbService>;
}

function statements(db: jest.Mocked<UsersDbService>): string[] {
  return [...db.query.mock.calls, ...db.execute.mock.calls].map(([sql]) => String(sql));
}

function expectMysqlOnly(db: jest.Mocked<UsersDbService>) {
  const sent = statements(db);
  expect(sent.length).toBeGreaterThan(0);
  for (const sql of sent) expect(sql).not.toMatch(T_SQL_ONLY);
}

describe('Users DB repositories on MySQL', () => {
  describe('device registry', () => {
    it('bind() inserts only when the pair is missing, via INSERT … SELECT … WHERE NOT EXISTS', async () => {
      const db = mysqlDb();
      await new MssqlDeviceRegistryRepository(db).bind({ username: 'hmc1', imei: 'imei-1' });

      expect(db.execute.mock.calls[0][0]).toMatch(
        /INSERT INTO HMC_Sanad_DeviceRegn_tbl[\s\S]*SELECT @username, @imei[\s\S]*NOW\(\), NOW\(\), 'NODEJS', 'Inactive'[\s\S]*FROM DUAL[\s\S]*WHERE NOT EXISTS/,
      );
      expectMysqlOnly(db);
    });

    it('find() uses LIMIT 1 and touch() uses NOW()', async () => {
      const db = mysqlDb();
      const repo = new MssqlDeviceRegistryRepository(db);
      await repo.find('hmc1', 'imei-1');
      await repo.touch('hmc1', 'imei-1');

      expect(db.query.mock.calls[0][0]).toMatch(/LIMIT 1\s*$/);
      expect(db.execute.mock.calls[0][0]).toMatch(/SET LastActive = NOW\(\)/);
      expectMysqlOnly(db);
    });
  });

  it('MPIN set() stamps NOW() and keeps the insert fallback', async () => {
    const db = mysqlDb();
    db.execute.mockResolvedValueOnce({ rowsAffected: 0, rows: [] });
    await new MssqlMpinStoreRepository(db).set({ username: 'hmc1', imei: 'imei-1', mpin: 'h' });

    expect(db.execute.mock.calls[0][0]).toMatch(/DateFirstRegistered = NOW\(\), MPIN = @mpin/);
    expect(db.execute.mock.calls[1][0]).toMatch(/INSERT INTO HMC_Sanad_DeviceRegn_tbl/);
    expectMysqlOnly(db);
  });

  describe('OTP', () => {
    const CFG: OtpConfig = {
      length: 6,
      ttlSeconds: 300,
      maxAttempts: 3,
      resendWindowSeconds: 60,
      staticValue: '',
      inResponse: false,
      charset: 'numeric',
      delivery: 'motc',
      store: 'legacy',
    };
    const SEND = {
      username: 'hmc1',
      phoneNumber: '77861234',
      imei: 'imei-1',
      purpose: 'ONBOARDING' as const,
    };

    function makeRepo() {
      const db = mysqlDb();
      const repo = new MssqlOtpRepository(
        db,
        { sendOtpSms: jest.fn().mockResolvedValue(undefined) },
        { sendOtpEmail: jest.fn().mockResolvedValue(undefined) },
        { getOrThrow: () => CFG } as unknown as ConfigService,
      );
      return { db, repo };
    }

    it('overwrites the newest row in ONE statement and reads the SeqNo from insertId', async () => {
      const { db, repo } = makeRepo();
      db.execute.mockResolvedValueOnce({ rowsAffected: 1, rows: [], insertId: 77 });

      await expect(repo.send(SEND)).resolves.toMatchObject({ requestId: '77', status: 'NEW' });
      expect(db.execute).toHaveBeenCalledTimes(1);
      expect(db.execute.mock.calls[0][0]).toMatch(
        /UPDATE HMC_RHAP_OTP_tbl[\s\S]*OTPSentDateTime = NOW\(\)[\s\S]*SeqNo = LAST_INSERT_ID\(SeqNo\)[\s\S]*ORDER BY SeqNo DESC\s+LIMIT 1/,
      );
      expectMysqlOnly(db);
    });

    it('inserts the first row and takes its AUTO_INCREMENT SeqNo', async () => {
      const { db, repo } = makeRepo();
      db.execute
        .mockResolvedValueOnce({ rowsAffected: 0, rows: [] })
        .mockResolvedValueOnce({ rowsAffected: 1, rows: [], insertId: 78 });

      await expect(repo.send(SEND)).resolves.toMatchObject({ requestId: '78' });
      expect(db.execute.mock.calls[1][0]).toMatch(/INSERT INTO HMC_RHAP_OTP_tbl/);
      expectMysqlOnly(db);
    });

    it('reads the latest row with TIMESTAMPDIFF and records attempts with IFNULL', async () => {
      const { db, repo } = makeRepo();
      db.query.mockResolvedValue([
        { SeqNo: 9, DiffInSeconds: 10, OTPValue: '123456', OTPStatus: '1', OTPSendMode: 'SMS' },
      ]);

      await expect(
        repo.verify({ username: 'hmc1', imei: 'imei-1', requestId: '9', otp: '000000' }),
      ).resolves.toBe(false);
      expect(db.query.mock.calls[0][0]).toMatch(
        /TIMESTAMPDIFF\(SECOND, OTPSentDateTime, NOW\(\)\)[\s\S]*LIMIT 1\s*$/,
      );
      expect(db.execute.mock.calls[0][0]).toMatch(/IFNULL\(OTPValidationAttemptCount, 0\) \+ 1/);
      expectMysqlOnly(db);
    });
  });

  it('device token save() upserts with ON DUPLICATE KEY UPDATE', async () => {
    const db = mysqlDb();
    await new MssqlDeviceTokenRepository(db).save({
      username: 'hmc1',
      imei: 'imei-1',
      token: 'fcm',
      platform: 'android',
    });

    expect(db.execute.mock.calls[0][0]).toMatch(
      /INSERT INTO HMC_Sanad_DeviceToken_tbl[\s\S]*ON DUPLICATE KEY UPDATE DeviceTokenValue = @token/,
    );
    expectMysqlOnly(db);
  });

  it('device token store degrades on a missing MySQL table (errno 1146)', async () => {
    const db = mysqlDb();
    db.query.mockRejectedValue(
      SqlQueryError.from(
        Object.assign(new Error("Table 'Sanad.x' doesn't exist"), { errno: 1146 }),
      ),
    );
    await expect(new MssqlDeviceTokenRepository(db).findByUsername('hmc1')).resolves.toEqual([]);
  });

  describe('attestation', () => {
    it('issues a challenge expiring @ttl ms from NOW(3)', async () => {
      const db = mysqlDb();
      await new MssqlChallengeStore(db, 300000).issue('device-1');

      expect(db.execute.mock.calls[0][0]).toMatch(
        /VALUES \(@value, @deviceId, NOW\(\), DATE_ADD\(NOW\(3\), INTERVAL @ttl \* 1000 MICROSECOND\)\)/,
      );
      expect(db.execute.mock.calls[0][1]).toMatchObject({ ttl: 300000 });
      expectMysqlOnly(db);
    });

    it('consumes with NOW() and upserts keys with ON DUPLICATE KEY UPDATE', async () => {
      const db = mysqlDb();
      await new MssqlChallengeStore(db, 300000).consume('c', 'device-1');
      const keys = new MssqlAttestKeyStore(db);
      await keys.save({ keyId: 'k', username: 'device:1', publicKey: 'pk', signCount: 0 });
      await keys.updateSignCount('k', 1);
      await keys.bind('k', 'hmc1');

      expect(db.execute.mock.calls[0][0]).toMatch(/ExpiresAt > NOW\(\) AND LoginID = @deviceId/);
      expect(db.execute.mock.calls[1][0]).toMatch(
        /INSERT INTO HMC_Sanad_AttestKey_tbl[\s\S]*ON DUPLICATE KEY UPDATE/,
      );
      expectMysqlOnly(db);
    });
  });

  it('audit sink converts the UTC timestamp to Qatar time with CONVERT_TZ', async () => {
    const db = mysqlDb();
    const record = {
      level: AuditLevel.API_CALL,
      timestamp: '2026-09-25T10:00:00.000Z',
      status: 'success',
      functionId: 'auth_login',
      username: 'hmc1',
    } as unknown as AuditRecord;

    await new MssqlAuditSink(db, { write: jest.fn() } as unknown as LoggerAuditSink).write(record);

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.execute.mock.calls[0][0]).toMatch(
      /CONVERT_TZ\(@accessDatetime, '\+00:00', '\+03:00'\)/,
    );
    expect(db.execute.mock.calls[1][0]).toMatch(/CONVERT_TZ\(@loginTime, '\+00:00', '\+03:00'\)/);
    expectMysqlOnly(db);
  });
});
