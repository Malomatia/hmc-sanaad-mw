import { ConfigService } from '@nestjs/config';
import * as oracledb from 'oracledb';
import * as sql from 'mssql';
import { OracleService } from './oracle.service';
import { MssqlService } from './mssql.service';
import { MotcSmsDbService } from './motc-sms-db.service';
import { OracleLogStore } from './oracle-log.store';
import { OracleUnavailableException } from './oracle.error';
import { MssqlUnavailableException } from './mssql.error';

// Both drivers are mocked with explicit factories. Auto-mock cannot be used:
// jest walks the real module's exports and oracledb's dbObject getters throw
// ("Cannot read properties of undefined (reading 'fqn')"), and createPool is
// non-configurable so it cannot be spied on either.
jest.mock('oracledb', () => ({
  createPool: jest.fn(),
  initOracleClient: jest.fn(),
  thin: true,
  outFormat: 0,
  fetchAsString: [],
  OUT_FORMAT_OBJECT: 4002,
  CLOB: 2017,
  BIND_OUT: 3003,
  BIND_INOUT: 3002,
}));
jest.mock('mssql', () => ({ ConnectionPool: jest.fn() }));

/**
 * A database whose credentials are WRONG must not take the whole API down.
 *
 * Until 2026-08-30 each of the three pool services rethrew from
 * onModuleInit, which aborts the Nest bootstrap: while the Users DB was being
 * configured the Oracle DSN broke, the process died, and the host answered a
 * bare HTML 503 for every route — including the auth journey, which never
 * touches Oracle. Missing credentials already degraded gracefully, so only
 * *wrong* ones were fatal, which made the failure look unrelated to config.
 *
 * These cases pin the contract: boot survives, the pool stays absent, and the
 * failure surfaces per request (clean 503) and on /health (reachable = false).
 */
describe('database boot resilience', () => {
  const FAILURE = new Error('ORA-12541: TNS:no listener');

  function config(namespace: string, cfg: Record<string, unknown>): ConfigService {
    return {
      getOrThrow: (key: string) => {
        if (key !== namespace) throw new Error(`unexpected config key ${key}`);
        return cfg;
      },
    } as unknown as ConfigService;
  }

  const ORACLE_CFG = {
    disabled: false,
    user: 'apps',
    password: 'secret',
    dsn: 'host:1521/svc',
    poolMin: 1,
    poolMax: 4,
    poolTimeout: 60,
    queueTimeout: 25000,
    thickMode: false,
  };

  const MSSQL_CFG = {
    disabled: false,
    host: 'sqlhost',
    port: 1433,
    database: 'Sanad',
    user: 'sa',
    password: 'secret',
    poolMin: 1,
    poolMax: 4,
    encrypt: false,
    trustServerCertificate: true,
    requestTimeoutMs: 15000,
    connectTimeoutMs: 15000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (oracledb.createPool as unknown as jest.Mock).mockRejectedValue(FAILURE);
    (sql.ConnectionPool as unknown as jest.Mock).mockImplementation(() => ({
      connect: jest.fn().mockRejectedValue(FAILURE),
    }));
  });

  it('starts without Oracle when the pool cannot be created', async () => {
    const service = new OracleService(
      config('oracle', ORACLE_CFG),
      new OracleLogStore(),
    );

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    // the failure is visible where it belongs, not as a dead process
    await expect(service.ping()).resolves.toBe(false);
    await expect(service['getPool']()).rejects.toThrow(OracleUnavailableException);
    await service.onModuleDestroy();
  });

  it('starts without the Users DB when the pool cannot be created', async () => {
    const service = new MssqlService(config('usersDb', MSSQL_CFG));

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    await expect(service.ping()).resolves.toBe(false);
    // Since 2026-08-31 the pool is created lazily: a query retries the
    // connection and surfaces the failure as a clean per-request 503.
    await expect(service.query('SELECT 1 AS ok')).rejects.toThrow(MssqlUnavailableException);
  });

  it('Users DB heals without a restart once the database comes back', async () => {
    const service = new MssqlService(config('usersDb', MSSQL_CFG));
    await service.onModuleInit(); // first attempt fails (mock rejects)
    expect(service.isEnabled()).toBe(false);

    // The database comes back: the next lazy attempt succeeds.
    const query = jest.fn().mockResolvedValue({ recordset: [{ ok: 1 }], rowsAffected: [0] });
    (sql.ConnectionPool as unknown as jest.Mock).mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue({ on: jest.fn(), request: () => ({ input: jest.fn(), query }) }),
    }));

    await expect(service.query('SELECT 1 AS ok')).resolves.toEqual([{ ok: 1 }]);
    expect(service.isEnabled()).toBe(true);
  });

  it('names the missing USERS_DB_* vars when unconfigured', async () => {
    const service = new MssqlService(
      config('usersDb', { ...MSSQL_CFG, host: '', user: '' }),
    );
    await service.onModuleInit();

    await expect(service.query('SELECT 1 AS ok')).rejects.toThrow(
      /USERS_DB_HOST, USERS_DB_USER/,
    );
    expect(service.isConfigured()).toBe(false);
  });

  it('starts without the MOTC SMS DB when the pool cannot be created', async () => {
    const service = new MotcSmsDbService(config('motcSms', MSSQL_CFG));

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    await expect(service.ping()).resolves.toBe(false);
    expect(() => service['getPool']()).toThrow(MssqlUnavailableException);
  });

  it('reports the real reason on /health instead of dying silently', async () => {
    const service = new OracleService(config('oracle', ORACLE_CFG), new OracleLogStore());
    await service.onModuleInit();

    const diag = await service.diagnose();
    expect(diag.error?.message).toBeDefined();
    await service.onModuleDestroy();
  });

  /**
   * "switched off on purpose" and "configured but broken" must not look the
   * same on /health — telling them apart is the whole point of isConfigured().
   */
  it('separates a broken database from a disabled one', async () => {
    const broken = new OracleService(config('oracle', ORACLE_CFG), new OracleLogStore());
    await broken.onModuleInit();

    const off = new OracleService(
      config('oracle', { ...ORACLE_CFG, disabled: true }),
      new OracleLogStore(),
    );
    await off.onModuleInit();

    // neither has a pool, so both are equally unusable...
    expect(broken.isEnabled()).toBe(false);
    expect(off.isEnabled()).toBe(false);

    // ...but only one of them was meant to be running
    expect(broken.isConfigured()).toBe(true);
    expect(off.isConfigured()).toBe(false);
    await Promise.all([broken.onModuleDestroy(), off.onModuleDestroy()]);
  });

  describe('Oracle pool recovery', () => {
    const createPool = oracledb.createPool as unknown as jest.Mock;
    const CLOSED = new Error('NJS-065: connection pool was closed');

    function makeOracle(overrides: Record<string, unknown> = {}) {
      const logs = new OracleLogStore();
      const service = new OracleService(
        config('oracle', { ...ORACLE_CFG, callTimeout: 25000, ...overrides }),
        logs,
      );
      return { service, logs };
    }

    function makePool() {
      const conn = {
        execute: jest.fn().mockResolvedValue({ rows: [{ OK: 1 }] }),
        ping: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
        callTimeout: 0,
      };
      const pool = {
        getConnection: jest.fn().mockResolvedValue(conn),
        close: jest.fn().mockResolvedValue(undefined),
        connectionsOpen: 1,
        connectionsInUse: 0,
      };
      return { pool, conn };
    }

    beforeEach(() => {
      jest.useFakeTimers();
      createPool.mockReset().mockRejectedValue(FAILURE);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    it.each([0, 1, 3, 4])(
      'warms and holds max(1, %s) distinct connections before publication',
      async (poolMin) => {
        const { service } = makeOracle({ poolMin });
        const target = Math.max(1, poolMin);
        const connections = Array.from({ length: target }, () => makePool().conn);
        const lastPing = deferred<void>();
        const lastClose = deferred<void>();
        connections[target - 1].ping.mockReturnValue(lastPing.promise);
        connections[target - 1].close.mockReturnValue(lastClose.promise);
        let next = 0;
        const pool = makePool().pool;
        pool.getConnection.mockImplementation(async () => connections[next++ % target]);
        createPool.mockResolvedValue(pool);
        const boot = service.onModuleInit();
        await jest.advanceTimersByTimeAsync(0);

        expect(pool.getConnection).toHaveBeenCalledTimes(target);
        expect(service.isEnabled()).toBe(false);
        for (const conn of connections) {
          expect(conn.callTimeout).toBe(25000);
          expect(conn.ping).toHaveBeenCalledTimes(1);
          expect(conn.close).not.toHaveBeenCalled();
        }
        lastPing.resolve();
        await jest.advanceTimersByTimeAsync(0);
        expect(service.isEnabled()).toBe(false);
        for (const conn of connections) expect(conn.close).toHaveBeenCalledTimes(1);
        lastClose.resolve();
        await boot;
        expect(service.isEnabled()).toBe(true);
        await expect(
          Promise.all(Array.from({ length: target }, () => service.query('SELECT 1'))),
        ).resolves.toEqual(Array(target).fill([{ OK: 1 }]));
        expect(createPool).toHaveBeenCalledTimes(1);
        expect(pool.getConnection).toHaveBeenCalledTimes(target * 2);
        await service.onModuleDestroy();
      },
    );

    it('waits for every partial acquisition and releases all acquired connections on failure', async () => {
      const { service } = makeOracle({ poolMin: 3 });
      const first = makePool();
      const last = makePool().conn;
      const acquisition = deferred<typeof last>();
      first.pool.getConnection
        .mockResolvedValueOnce(first.conn)
        .mockRejectedValueOnce(FAILURE)
        .mockReturnValueOnce(acquisition.promise);
      createPool.mockResolvedValueOnce(first.pool).mockRejectedValue(FAILURE);
      const boot = service.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(first.pool.getConnection).toHaveBeenCalledTimes(3);
      expect(first.pool.close).not.toHaveBeenCalled();
      expect(first.conn.close).not.toHaveBeenCalled();
      acquisition.resolve(last);
      await jest.advanceTimersByTimeAsync(0);
      expect(first.conn.close).toHaveBeenCalledTimes(1);
      expect(last.close).toHaveBeenCalledTimes(1);
      expect(first.pool.close).toHaveBeenCalledTimes(1);
      expect(service.isEnabled()).toBe(false);
      await jest.advanceTimersByTimeAsync(1000);
      await boot;
      await service.onModuleDestroy();
    });

    it('waits for all warmup pings and closes every connection when a ping or close fails', async () => {
      const { service } = makeOracle({ poolMin: 3 });
      const first = makePool();
      const connections = [first.conn, makePool().conn, makePool().conn];
      const pending = deferred<void>();
      connections[0].ping.mockRejectedValue(FAILURE);
      connections[1].close.mockRejectedValue(CLOSED);
      connections[2].ping.mockReturnValue(pending.promise);
      for (const conn of connections) first.pool.getConnection.mockResolvedValueOnce(conn);
      createPool.mockResolvedValueOnce(first.pool).mockRejectedValue(FAILURE);
      const boot = service.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      for (const conn of connections) expect(conn.close).not.toHaveBeenCalled();
      pending.resolve();
      await jest.advanceTimersByTimeAsync(0);
      for (const conn of connections) expect(conn.close).toHaveBeenCalledTimes(1);
      expect(first.pool.close).toHaveBeenCalledTimes(1);
      expect(service.isEnabled()).toBe(false);
      await jest.advanceTimersByTimeAsync(1000);
      await boot;
      await service.onModuleDestroy();
    });

    it('waits for pending warmup acquisitions and closes them without publication during shutdown', async () => {
      const { service } = makeOracle({ poolMin: 3 });
      const first = makePool();
      const connections = [first.conn, makePool().conn, makePool().conn];
      const acquisition = deferred<typeof first.conn>();
      first.pool.getConnection
        .mockResolvedValueOnce(connections[0])
        .mockResolvedValueOnce(connections[1])
        .mockReturnValueOnce(acquisition.promise);
      createPool.mockResolvedValue(first.pool);
      const boot = service.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      let stopped = false;
      const shutdown = service.onModuleDestroy().then(() => {
        stopped = true;
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(stopped).toBe(false);
      acquisition.resolve(connections[2]);
      await Promise.all([boot, shutdown]);
      for (const conn of connections) expect(conn.close).toHaveBeenCalledTimes(1);
      expect(first.pool.close).toHaveBeenCalledTimes(1);
      expect(service.isEnabled()).toBe(false);
      expect(createPool).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('waits for warmup probes and every release when shutdown starts during a ping', async () => {
      const { service } = makeOracle({ poolMin: 2 });
      const first = makePool();
      const other = makePool().conn;
      const ping = deferred<void>();
      const release = deferred<void>();
      first.conn.ping.mockReturnValue(ping.promise);
      other.close.mockReturnValue(release.promise);
      first.pool.getConnection.mockResolvedValueOnce(first.conn).mockResolvedValueOnce(other);
      createPool.mockResolvedValue(first.pool);
      const boot = service.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      let stopped = false;
      const shutdown = service.onModuleDestroy().then(() => {
        stopped = true;
      });
      expect(service.getReadiness()).toEqual({ ready: false, status: 'stopping' });
      ping.resolve();
      await jest.advanceTimersByTimeAsync(0);
      expect(stopped).toBe(false);
      expect(first.conn.close).toHaveBeenCalledTimes(1);
      expect(other.close).toHaveBeenCalledTimes(1);
      expect(first.pool.close).not.toHaveBeenCalled();
      release.resolve();
      await Promise.all([boot, shutdown]);
      expect(first.pool.close).toHaveBeenCalledTimes(1);
      expect(createPool).toHaveBeenCalledTimes(1);
      expect(service.isEnabled()).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('recovers from failed boot in the background with bounded nonoverlapping cycles', async () => {
      const { service } = makeOracle();
      const boot = service.onModuleInit();
      await jest.advanceTimersByTimeAsync(1000);
      await boot;
      expect(createPool).toHaveBeenCalledTimes(2);
      expect(jest.getTimerCount()).toBe(1);
      await jest.advanceTimersByTimeAsync(1999);
      expect(createPool).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      expect(createPool).toHaveBeenCalledTimes(3);
      await jest.advanceTimersByTimeAsync(1000);
      expect(createPool).toHaveBeenCalledTimes(4);
      createPool.mockResolvedValue(makePool().pool);
      await jest.advanceTimersByTimeAsync(2000);
      expect(createPool).toHaveBeenCalledTimes(5);
      expect(service.isEnabled()).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
      await service.onModuleDestroy();
    });

    it('shares an in-flight background warmup with requests and cancels queued recovery on shutdown', async () => {
      const { service } = makeOracle();
      const boot = service.onModuleInit();
      await jest.advanceTimersByTimeAsync(1000);
      await boot;
      const next = makePool();
      const creation = deferred<typeof next.pool>();
      createPool.mockReturnValue(creation.promise);
      await jest.advanceTimersByTimeAsync(2000);
      const request = service.query('SELECT 1');
      await jest.advanceTimersByTimeAsync(10000);
      expect(createPool).toHaveBeenCalledTimes(3);
      creation.resolve(next.pool);
      await expect(request).resolves.toEqual([{ OK: 1 }]);
      expect(jest.getTimerCount()).toBe(0);
      next.conn.execute.mockRejectedValue(FAILURE);
      await expect(service.query('SELECT 1')).rejects.toThrow();
      expect(jest.getTimerCount()).toBe(1);
      await service.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(10000);
      expect(createPool).toHaveBeenCalledTimes(3);
    });

    it('recovers a broken execution pool without waiting for another request or replaying SQL', async () => {
      const { service } = makeOracle();
      const old = makePool();
      createPool.mockResolvedValueOnce(old.pool);
      await service.onModuleInit();
      old.conn.execute.mockRejectedValueOnce(FAILURE);
      await expect(service.query('SELECT original')).rejects.toThrow();
      const replacement = makePool();
      createPool.mockResolvedValue(replacement.pool);
      await jest.advanceTimersByTimeAsync(2000);
      expect(createPool).toHaveBeenCalledTimes(2);
      expect(old.conn.execute).toHaveBeenCalledTimes(1);
      expect(replacement.conn.execute).not.toHaveBeenCalled();
      expect(service.isEnabled()).toBe(true);
      await service.onModuleDestroy();
    });

    it('exposes fast readiness through warmup, broken-pool recovery, and shutdown', async () => {
      const { service } = makeOracle();
      expect(service.isReady()).toBe(false);
      expect(service.getReadiness()).toEqual({ ready: false, status: 'unavailable' });
      const initial = makePool();
      const ping = deferred<void>();
      initial.conn.ping.mockReturnValueOnce(ping.promise);
      createPool.mockResolvedValueOnce(initial.pool);
      const boot = service.onModuleInit();
      await jest.advanceTimersByTimeAsync(0);
      expect(service.isReady()).toBe(false);
      expect(service.getReadiness()).toEqual({ ready: false, status: 'recovering' });
      ping.resolve();
      await boot;
      expect(service.isReady()).toBe(true);
      expect(service.getReadiness()).toEqual({ ready: true, status: 'ready' });
      initial.conn.execute.mockRejectedValueOnce(FAILURE);
      await expect(service.query('SELECT 1')).rejects.toThrow();
      expect(service.isReady()).toBe(false);
      expect(service.getReadiness()).toEqual({ ready: false, status: 'recovering' });
      expect(service['recoveryTimer']?.hasRef()).toBe(false);
      createPool.mockResolvedValue(makePool().pool);
      await jest.advanceTimersByTimeAsync(2000);
      expect(service.isReady()).toBe(true);
      await service.onModuleDestroy();
      expect(service.isReady()).toBe(false);
      expect(service.getReadiness()).toEqual({ ready: false, status: 'stopping' });
    });

    it.each([
      [{ disabled: true }, { ready: true, status: 'disabled' }],
      [{ user: '' }, { ready: false, status: 'unconfigured' }],
      [{ dsn: '' }, { ready: false, status: 'unconfigured' }],
    ])('never retries disabled or unconfigured Oracle: %j', async (overrides, readiness) => {
      const { service } = makeOracle(overrides);
      await service.onModuleInit();
      expect(service.isReady()).toBe(false);
      expect(service.getReadiness()).toEqual(readiness);
      await jest.advanceTimersByTimeAsync(60000);
      expect(createPool).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      await service.onModuleDestroy();
    });

    it('shares two creation attempts and waits before retrying a missing pool', async () => {
      const { service } = makeOracle();
      const { pool, conn } = makePool();
      createPool.mockRejectedValueOnce(FAILURE).mockResolvedValueOnce(pool);
      const results = Promise.all(Array.from({ length: 8 }, () => service.query('SELECT 1')));
      const checked = expect(results).resolves.toEqual(Array(8).fill([{ OK: 1 }]));

      await jest.advanceTimersByTimeAsync(999);
      expect(createPool).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await checked;

      expect(createPool).toHaveBeenCalledTimes(2);
      expect(conn.ping).toHaveBeenCalledTimes(1);
      expect(conn.callTimeout).toBe(25000);
      expect(service.isEnabled()).toBe(true);
    });

    it('stops after two failures, cools down, then recovers on a later request', async () => {
      const { service, logs } = makeOracle();
      const results = Promise.allSettled(
        Array.from({ length: 8 }, () => service.query('SELECT 1')),
      );
      await jest.advanceTimersByTimeAsync(1000);
      for (const result of await results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(OracleUnavailableException);
          expect(result.reason.getStatus()).toBe(503);
        }
      }
      expect(createPool).toHaveBeenCalledTimes(2);
      expect(logs.list().items).toHaveLength(8);
      expect(logs.list().items.every((entry) => entry.status === 'error')).toBe(true);

      await expect(service.query('SELECT 1')).rejects.toBeInstanceOf(OracleUnavailableException);
      await jest.advanceTimersByTimeAsync(1999);
      await expect(service.acquire()).rejects.toBeInstanceOf(OracleUnavailableException);
      expect(createPool).toHaveBeenCalledTimes(2);

      createPool.mockResolvedValue(makePool().pool);
      await jest.advanceTimersByTimeAsync(1);
      await expect(service.query('SELECT 1')).resolves.toEqual([{ OK: 1 }]);
      expect(createPool).toHaveBeenCalledTimes(3);
    });

    it('recovers after the two startup attempts fail without restarting the service', async () => {
      const { service } = makeOracle();
      const boot = service.onModuleInit();
      await jest.advanceTimersByTimeAsync(1000);
      await boot;
      expect(service.isEnabled()).toBe(false);
      expect(createPool).toHaveBeenCalledTimes(2);

      createPool.mockResolvedValue(makePool().pool);
      await jest.advanceTimersByTimeAsync(2000);
      await expect(service.query('SELECT 1')).resolves.toEqual([{ OK: 1 }]);
      expect(service.isEnabled()).toBe(true);
    });

    it('replaces a broken existing pool once for concurrent callers', async () => {
      const { service } = makeOracle();
      const old = makePool();
      old.pool.getConnection.mockRejectedValue(CLOSED);
      service['pool'] = old.pool as unknown as oracledb.Pool;
      const replacement = makePool();
      createPool.mockRejectedValueOnce(FAILURE).mockResolvedValueOnce(replacement.pool);
      const checked = expect(
        Promise.all(Array.from({ length: 8 }, () => service.query('SELECT 1'))),
      ).resolves.toEqual(Array(8).fill([{ OK: 1 }]));

      await jest.advanceTimersByTimeAsync(1000);
      await checked;
      expect(old.pool.close).toHaveBeenCalledTimes(1);
      expect(createPool).toHaveBeenCalledTimes(2);
      expect(replacement.pool.close).not.toHaveBeenCalled();
    });

    it('counts unusable replacement pools toward the two-attempt limit', async () => {
      const { service } = makeOracle();
      const old = makePool();
      old.pool.getConnection.mockRejectedValue(CLOSED);
      service['pool'] = old.pool as unknown as oracledb.Pool;
      const first = makePool();
      const second = makePool();
      first.conn.ping.mockRejectedValue(
        new Error('ORA-03113: end-of-file on communication channel'),
      );
      second.pool.getConnection.mockRejectedValue(FAILURE);
      createPool.mockResolvedValueOnce(first.pool).mockResolvedValueOnce(second.pool);
      const checked = expect(service.acquire()).rejects.toBeInstanceOf(OracleUnavailableException);

      await jest.advanceTimersByTimeAsync(1000);
      await checked;
      expect(createPool).toHaveBeenCalledTimes(2);
      expect(first.conn.close).toHaveBeenCalledTimes(1);
      expect(first.pool.close).toHaveBeenCalledTimes(1);
      expect(second.pool.close).toHaveBeenCalledTimes(1);
      expect(service.isEnabled()).toBe(false);
    });

    it.each(['NJS-040: connection request timeout', 'NJS-076: connection request rejected'])(
      'does not replace a busy pool for %s',
      async (message) => {
        const { service } = makeOracle();
        const { pool } = makePool();
        pool.getConnection.mockRejectedValue(new Error(message));
        service['pool'] = pool as unknown as oracledb.Pool;

        await expect(service.acquire()).rejects.toBeInstanceOf(OracleUnavailableException);
        expect(createPool).not.toHaveBeenCalled();
        expect(pool.close).not.toHaveBeenCalled();
      },
    );

    it('does not replay a submit when the connection fails during execution', async () => {
      const { service } = makeOracle();
      const old = makePool();
      const statement = 'BEGIN submit_request; END;';
      old.conn.execute.mockImplementation(async (sql: string) => {
        if (sql === statement) throw new Error('ORA-03113: end-of-file on communication channel');
        return {};
      });
      service['pool'] = old.pool as unknown as oracledb.Pool;

      await expect(service.call(statement, {})).rejects.toThrow();
      expect(old.conn.execute.mock.calls.filter(([sql]) => sql === statement)).toHaveLength(1);
      expect(createPool).not.toHaveBeenCalled();
      expect(old.conn.close).toHaveBeenCalledTimes(1);

      createPool.mockResolvedValue(makePool().pool);
      await expect(service.query('SELECT 1')).resolves.toEqual([{ OK: 1 }]);
      expect(createPool).toHaveBeenCalledTimes(1);
      expect(old.pool.close).toHaveBeenCalledTimes(1);
    });

    it('does not replace a pool after a business or SQL error', async () => {
      const { service } = makeOracle();
      const { pool, conn } = makePool();
      conn.execute.mockRejectedValueOnce(new Error('ORA-00904: invalid identifier'));
      service['pool'] = pool as unknown as oracledb.Pool;

      await expect(service.query('SELECT invalid_column')).rejects.toThrow('ORA-00904');
      await expect(service.query('SELECT 1')).resolves.toEqual([{ OK: 1 }]);
      expect(createPool).not.toHaveBeenCalled();
      expect(pool.close).not.toHaveBeenCalled();
    });

    it('does not let a late failure from an old pool invalidate its replacement', async () => {
      const { service } = makeOracle();
      const old = makePool();
      let rejectLate!: (error: Error) => void;
      old.pool.getConnection.mockRejectedValueOnce(CLOSED).mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectLate = reject;
          }),
      );
      service['pool'] = old.pool as unknown as oracledb.Pool;
      const replacement = makePool();
      createPool.mockResolvedValue(replacement.pool);

      const first = service.query('SELECT 1');
      const late = service.query('SELECT 1');
      await expect(first).resolves.toEqual([{ OK: 1 }]);
      rejectLate(CLOSED);
      await expect(late).resolves.toEqual([{ OK: 1 }]);
      expect(createPool).toHaveBeenCalledTimes(1);
      expect(replacement.pool.close).not.toHaveBeenCalled();
    });

    it('lets health probes recover a missing pool and applies the call timeout', async () => {
      const { service } = makeOracle();
      const { pool, conn } = makePool();
      createPool.mockResolvedValue(pool);

      await expect(service.ping()).resolves.toBe(true);
      await expect(service.diagnose()).resolves.toMatchObject({
        enabled: true,
        connected: true,
        pool: { connectionsOpen: 1, connectionsInUse: 0 },
      });
      expect(createPool).toHaveBeenCalledTimes(1);
      expect(conn.callTimeout).toBe(25000);
    });

    it('starts the replacement while existing connections drain and waits for cleanup on shutdown', async () => {
      const { service } = makeOracle();
      const old = makePool();
      old.pool.connectionsInUse = 1;
      old.pool.getConnection.mockRejectedValue(CLOSED);
      let finishDrain!: () => void;
      old.pool.close.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finishDrain = resolve;
          }),
      );
      service['pool'] = old.pool as unknown as oracledb.Pool;
      const replacement = makePool();
      createPool.mockResolvedValue(replacement.pool);

      await expect(service.acquire(1234)).resolves.toBe(replacement.conn);
      expect(replacement.conn.callTimeout).toBe(1234);
      expect(old.pool.close).toHaveBeenCalledWith(50);
      let stopped = false;
      const shutdown = service.onModuleDestroy().then(() => {
        stopped = true;
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(stopped).toBe(false);
      finishDrain();
      await shutdown;
      expect(old.pool.close).toHaveBeenCalledTimes(1);
      expect(replacement.pool.close).toHaveBeenCalledTimes(1);
    });

    it('retains failed pool cleanup for another attempt at shutdown', async () => {
      const { service } = makeOracle();
      const old = makePool();
      old.pool.getConnection.mockRejectedValue(CLOSED);
      old.pool.close.mockRejectedValueOnce(new Error('DPI-1010: not connected'));
      service['pool'] = old.pool as unknown as oracledb.Pool;
      createPool.mockResolvedValue(makePool().pool);

      await expect(service.acquire()).resolves.toBeDefined();
      expect(old.pool.close).toHaveBeenCalledTimes(1);
      await service.onModuleDestroy();
      expect(old.pool.close).toHaveBeenCalledTimes(2);
    });

    it('does not start another cycle when a freshly validated pool loses connectivity', async () => {
      const { service } = makeOracle();
      const old = makePool();
      old.pool.getConnection.mockRejectedValue(CLOSED);
      service['pool'] = old.pool as unknown as oracledb.Pool;
      const replacement = makePool();
      replacement.pool.getConnection
        .mockResolvedValueOnce(replacement.conn)
        .mockRejectedValue(CLOSED);
      createPool.mockResolvedValue(replacement.pool);

      await expect(service.acquire()).rejects.toBeInstanceOf(OracleUnavailableException);
      await expect(service.acquire()).rejects.toBeInstanceOf(OracleUnavailableException);
      expect(createPool).toHaveBeenCalledTimes(1);
    });

    it('counts failed probe cleanup toward the creation attempt limit', async () => {
      const { service } = makeOracle();
      const first = makePool();
      first.conn.close.mockRejectedValue(CLOSED);
      const second = makePool();
      createPool.mockResolvedValueOnce(first.pool).mockResolvedValueOnce(second.pool);
      const checked = expect(service.acquire()).resolves.toBe(second.conn);

      await jest.advanceTimersByTimeAsync(1000);
      await checked;
      expect(createPool).toHaveBeenCalledTimes(2);
      expect(first.pool.close).toHaveBeenCalledTimes(1);
    });

    it.each(['query', 'call', 'callCursor', 'callMultiCursor'] as const)(
      'preserves 503 and records the acquisition failure for %s',
      async (method) => {
        const { service, logs } = makeOracle({ disabled: true });
        const operation =
          method === 'callMultiCursor'
            ? service.callMultiCursor('BEGIN submit_request; END;', {}, [])
            : service[method]('SELECT 1', {});

        await expect(operation).rejects.toBeInstanceOf(OracleUnavailableException);
        expect(logs.list().items).toHaveLength(1);
        expect(logs.list().items[0].status).toBe('error');
        expect(createPool).not.toHaveBeenCalled();
      },
    );

    it.each(['NJS-002', 'NJS-500', 'NJS-503', 'ORA-01034', 'ORA-12541', 'ORA-03114', 'DPI-1080'])(
      'recovers from a connection acquisition error with code %s',
      async (code) => {
        const { service } = makeOracle();
        const old = makePool();
        old.pool.getConnection.mockRejectedValue(
          Object.assign(new Error('connection failed'), { code }),
        );
        service['pool'] = old.pool as unknown as oracledb.Pool;
        const replacement = makePool();
        createPool.mockResolvedValue(replacement.pool);

        await expect(service.acquire()).resolves.toBe(replacement.conn);
        expect(createPool).toHaveBeenCalledTimes(1);
      },
    );

    it.each([{ disabled: true }, { user: '' }, { dsn: '' }])(
      'does not create a pool when Oracle is disabled or unconfigured: %j',
      async (overrides) => {
        const { service } = makeOracle(overrides);
        await expect(service.acquire()).rejects.toBeInstanceOf(OracleUnavailableException);
        await expect(service.ping()).resolves.toBe(false);
        expect(createPool).not.toHaveBeenCalled();
      },
    );

    it('stops retrying when shutdown begins during backoff', async () => {
      const { service } = makeOracle();
      const checked = expect(service.acquire()).rejects.toBeInstanceOf(OracleUnavailableException);
      await jest.advanceTimersByTimeAsync(0);
      const shutdown = service.onModuleDestroy();
      await Promise.all([checked, shutdown]);

      expect(jest.getTimerCount()).toBe(0);
      expect(createPool).toHaveBeenCalledTimes(1);
      await expect(service.acquire()).rejects.toBeInstanceOf(OracleUnavailableException);
      expect(createPool).toHaveBeenCalledTimes(1);
    });

    it('closes a pool created during shutdown without publishing it', async () => {
      const { service } = makeOracle();
      const { pool } = makePool();
      let resolvePool!: (value: typeof pool) => void;
      createPool.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePool = resolve;
          }),
      );
      const checked = expect(service.acquire()).rejects.toBeInstanceOf(OracleUnavailableException);
      await jest.advanceTimersByTimeAsync(0);
      const shutdown = service.onModuleDestroy();
      resolvePool(pool);
      await Promise.all([checked, shutdown]);

      expect(pool.close).toHaveBeenCalledTimes(1);
      expect(pool.getConnection).not.toHaveBeenCalled();
      expect(service.isEnabled()).toBe(false);
    });
  });

  it('treats missing credentials as not configured', async () => {
    const service = new OracleService(
      config('oracle', { ...ORACLE_CFG, dsn: '' }),
      new OracleLogStore(),
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(service.isConfigured()).toBe(false);
  });
});
