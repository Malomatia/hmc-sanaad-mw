import { ConfigService } from '@nestjs/config';
import { createPool } from 'mysql2/promise';
import configuration from '../../config/configuration';
import { envValidationSchema } from '../../config/env.validation';
import { SqlQueryError, SqlUnavailableException } from '../sql.error';
import { createUsersDb } from '../sql-databases.module';
import { MssqlUsersDbService } from './mssql-users-db.service';
import { MysqlUsersDbService } from './mysql-users-db.service';

jest.mock('mysql2/promise', () => ({ createPool: jest.fn() }));
jest.mock('mssql', () => ({ ConnectionPool: jest.fn() }));

const BASE = {
  driver: 'mysql',
  host: 'mysqlhost',
  port: 3306,
  database: 'Sanad',
  user: 'app',
  password: 'secret',
  poolMin: 2,
  poolMax: 10,
  requestTimeoutMs: 25000,
  connectTimeoutMs: 15000,
  encrypt: true,
  trustServerCertificate: false,
  disabled: false,
  sqlConsoleEnabled: false,
};

const config = (cfg: Record<string, unknown> = {}) =>
  ({ getOrThrow: () => ({ ...BASE, ...cfg }) }) as unknown as ConfigService;

function mysqlPool(execute: jest.Mock) {
  const pool = {
    getConnection: jest.fn().mockResolvedValue({ release: jest.fn() }),
    execute,
    end: jest.fn().mockResolvedValue(undefined),
  };
  (createPool as jest.Mock).mockReturnValue(pool);
  return pool;
}

describe('Users DB driver selection', () => {
  it.each([
    ['mysql', MysqlUsersDbService],
    ['mssql', MssqlUsersDbService],
    ['oracle', MssqlUsersDbService],
  ])('USERS_DB_DRIVER=%s binds %p', (driver, type) => {
    expect(createUsersDb(config({ driver }))).toBeInstanceOf(type);
  });

  it('reports an unsupported driver as unconfigured instead of falling back to SQL Server', async () => {
    const db = createUsersDb(config({ driver: 'oracle' }));
    expect(db.isConfigured()).toBe(false);
    await expect(db.query('SELECT 1')).rejects.toThrow(/USERS_DB_DRIVER \(got "oracle"/);
  });

  describe('configuration', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it('defaults to mssql on 1433', () => {
      delete process.env.USERS_DB_DRIVER;
      delete process.env.USERS_DB_PORT;
      expect(configuration().usersDb).toMatchObject({ driver: 'mssql', port: 1433 });
    });

    it('defaults the port to 3306 for mysql, also when compose passes it empty', () => {
      process.env.USERS_DB_DRIVER = 'MySQL';
      process.env.USERS_DB_PORT = '';
      expect(configuration().usersDb).toMatchObject({ driver: 'mysql', port: 3306 });
    });

    it('keeps an explicit port', () => {
      process.env.USERS_DB_DRIVER = 'mysql';
      process.env.USERS_DB_PORT = '3307';
      expect(configuration().usersDb.port).toBe(3307);
    });
  });

  describe('env schema', () => {
    const validate = (env: Record<string, string>) =>
      envValidationSchema.validate(env, { allowUnknown: true });

    // Validated defaults are written back into process.env, so a schema
    // default of 1433 silently overrode MySQL's 3306 (caught by the smoke test).
    it('does not default USERS_DB_PORT, so the driver picks its own', () => {
      const { error, value } = validate({ USERS_DB_DRIVER: 'mysql' });
      expect(error).toBeUndefined();
      expect(value.USERS_DB_PORT).toBeUndefined();
      expect(value.USERS_DB_DRIVER).toBe('mysql');
    });

    it('accepts the empty port compose passes, and defaults the driver to mssql', () => {
      const { error, value } = validate({ USERS_DB_PORT: '' });
      expect(error).toBeUndefined();
      expect(value.USERS_DB_DRIVER).toBe('mssql');
    });

    it('lets an unsupported driver through to be reported as unconfigured, not crash boot', () => {
      expect(validate({ USERS_DB_DRIVER: 'oracle' }).error).toBeUndefined();
    });
  });
});

describe('MysqlUsersDbService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps USERS_DB_* onto the pool, with FOUND_ROWS, UTC and TLS', () => {
    expect(new MysqlUsersDbService(config()).poolOptions()).toMatchObject({
      host: 'mysqlhost',
      port: 3306,
      database: 'Sanad',
      connectionLimit: 10,
      maxIdle: 2,
      connectTimeout: 15000,
      timezone: 'Z',
      flags: ['+FOUND_ROWS'],
      multipleStatements: false,
      ssl: { rejectUnauthorized: true },
    });
    expect(new MysqlUsersDbService(config({ encrypt: false })).poolOptions().ssl).toBeUndefined();
    expect(
      new MysqlUsersDbService(config({ trustServerCertificate: true })).poolOptions().ssl,
    ).toEqual({ rejectUnauthorized: false });
  });

  it('runs @name binds as a positional prepared statement with the request timeout', async () => {
    const execute = jest.fn().mockResolvedValue([[{ SeqNo: 5 }], []]);
    mysqlPool(execute);
    const db = new MysqlUsersDbService(config());

    await expect(
      db.query('SELECT SeqNo FROM t WHERE LoginID = @username AND IMEI = @imei', {
        username: 'U1',
        imei: 'I1',
      }),
    ).resolves.toEqual([{ SeqNo: 5 }]);
    expect(execute).toHaveBeenCalledWith({
      sql: 'SELECT SeqNo FROM t WHERE LoginID = ? AND IMEI = ?',
      values: ['U1', 'I1'],
      timeout: 25000,
    });
  });

  it('returns affectedRows and insertId for writes', async () => {
    const execute = jest.fn().mockResolvedValue([{ affectedRows: 1, insertId: 42 }, undefined]);
    mysqlPool(execute);

    await expect(new MysqlUsersDbService(config()).execute('UPDATE t SET a = 1')).resolves.toEqual({
      rowsAffected: 1,
      rows: [],
      insertId: 42,
    });
  });

  it('omits a zero insertId', async () => {
    mysqlPool(jest.fn().mockResolvedValue([{ affectedRows: 0, insertId: 0 }, undefined]));
    const result = await new MysqlUsersDbService(config()).execute('UPDATE t SET a = 1');
    expect(result).toEqual({ rowsAffected: 0, rows: [] });
  });

  it('flags a missing table (errno 1146) so repositories can degrade', async () => {
    const driverError = Object.assign(new Error("Table 'Sanad.x' doesn't exist"), { errno: 1146 });
    mysqlPool(jest.fn().mockRejectedValue(driverError));

    const failure = await new MysqlUsersDbService(config())
      .query('SELECT * FROM x')
      .catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SqlQueryError);
    expect((failure as SqlQueryError).missingObject).toBe(true);
    expect((failure as SqlQueryError).sqlErrorNumber).toBe(1146);
  });

  it('surfaces bad credentials as a clean 503 and closes the half-built pool', async () => {
    const pool = mysqlPool(jest.fn());
    pool.getConnection.mockRejectedValue(new Error("Access denied for user 'app'"));
    const db = new MysqlUsersDbService(config());

    await expect(db.query('SELECT 1')).rejects.toBeInstanceOf(SqlUnavailableException);
    expect(pool.end).toHaveBeenCalled();
    expect(db.isEnabled()).toBe(false);
  });

  it('never logs mpin or otp values', async () => {
    mysqlPool(jest.fn().mockResolvedValue([[], []]));
    const db = new MysqlUsersDbService(config());
    const log = jest.spyOn(db['logger'], 'log').mockImplementation(() => undefined);

    await db.query('SELECT 1 FROM t WHERE MPIN = @mpin AND OTPValue = @otp', {
      mpin: 'HASHED-MPIN',
      otp: '123456',
    });
    const logged = log.mock.calls.map(([line]) => String(line)).join('\n');
    expect(logged).toContain('mpin=***');
    expect(logged).not.toContain('HASHED-MPIN');
    expect(logged).not.toContain('123456');
  });

  describe('transaction()', () => {
    function withConnection() {
      const pool = mysqlPool(jest.fn().mockResolvedValue([[], []]));
      const connection = {
        release: jest.fn(),
        beginTransaction: jest.fn().mockResolvedValue(undefined),
        commit: jest.fn().mockResolvedValue(undefined),
        rollback: jest.fn().mockResolvedValue(undefined),
        execute: jest.fn().mockResolvedValue([{ affectedRows: 1, insertId: 0 }, undefined]),
      };
      // The first borrow is connect()'s credential check; transactions get the next.
      pool.getConnection
        .mockResolvedValueOnce({ release: jest.fn() })
        .mockResolvedValue(connection);
      return { pool, connection, db: new MysqlUsersDbService(config()) };
    }

    it('runs every statement on one connection, commits, and returns it to the pool once', async () => {
      const { pool, connection, db } = withConnection();
      await db.query('SELECT 1'); // pool comes up (probe runs on the pool)
      pool.execute.mockClear();

      const result = await db.transaction(async (tx) => {
        await tx.execute('UPDATE t SET a = @a WHERE b = @b', { a: 1, b: 'x' });
        await tx.execute('UPDATE t SET c = 2');
        return 'done';
      });

      expect(result).toBe('done');
      expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(connection.execute).toHaveBeenCalledTimes(2);
      expect(connection.execute.mock.calls[0][0]).toMatchObject({
        sql: 'UPDATE t SET a = ? WHERE b = ?',
        values: [1, 'x'],
      });
      expect(pool.execute).not.toHaveBeenCalled();
      expect(connection.commit).toHaveBeenCalledTimes(1);
      expect(connection.rollback).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back and releases when the work throws', async () => {
      const { connection, db } = withConnection();
      const failure = new Error('business rule');

      await expect(
        db.transaction(async (tx) => {
          await tx.execute('UPDATE t SET a = 1');
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.commit).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back on a failed statement and reports it as a SqlQueryError', async () => {
      const { connection, db } = withConnection();
      connection.execute.mockRejectedValue(
        Object.assign(new Error('Deadlock found'), { errno: 1213 }),
      );

      const failure = await db
        .transaction((tx) => tx.execute('UPDATE t SET a = 1'))
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(SqlQueryError);
      expect(connection.rollback).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
    });
  });
});
