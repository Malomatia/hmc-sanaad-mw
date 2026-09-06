import { MssqlService } from '@core/database/mssql.service';
import { MssqlQueryError, MssqlUnavailableException } from '@core/database/mssql.error';
import { MssqlDeviceTokenRepository } from './mssql-device-token.repository';

/**
 * This ships BEFORE `HMC_Sanad_DeviceToken_tbl` exists, so the deployed state
 * on day one is: endpoints live, table missing. Registering for push is an
 * accessory to using the app — that state has to be a warning, never a 500,
 * and never something that reaches the caller.
 *
 * The same applies to the Users DB being down, which is a routine condition
 * here (`USERS_DB_DISABLED`, maintenance windows).
 */
describe('device-token store when the deployment is incomplete', () => {
  /** SQL Server's "Invalid object name 'X'" */
  const missingTable = () => {
    const driverError = Object.assign(new Error("Invalid object name 'HMC_Sanad_DeviceToken_tbl'."), {
      number: 208,
    });
    return MssqlQueryError.from(driverError);
  };

  function make(err: unknown) {
    const db = {
      query: jest.fn().mockRejectedValue(err),
      execute: jest.fn().mockRejectedValue(err),
    } as unknown as MssqlService;
    return new MssqlDeviceTokenRepository(db);
  }

  const TOKEN = { username: 'AIBRAHIM39', imei: 'imei-1', token: 'tok' };

  describe('table not created yet', () => {
    it('accepts a registration instead of failing the request', async () => {
      await expect(make(missingTable()).save(TOKEN)).resolves.toBeUndefined();
    });

    it('reads back an empty list, not an exception', async () => {
      await expect(make(missingTable()).findByUsername('AIBRAHIM39')).resolves.toEqual([]);
    });

    it('tolerates unregistering', async () => {
      await expect(make(missingTable()).remove('AIBRAHIM39', 'imei-1')).resolves.toBeUndefined();
    });

    it('tolerates pruning', async () => {
      await expect(
        make(missingTable()).removeDevices([{ username: 'AIBRAHIM39', imei: 'imei-1' }]),
      ).resolves.toBeUndefined();
    });
  });

  describe('Users DB unavailable', () => {
    it('is also a warning, not a failure', async () => {
      const repo = make(new MssqlUnavailableException('Users DB is disabled.'));

      await expect(repo.save(TOKEN)).resolves.toBeUndefined();
      await expect(repo.findByUsername('AIBRAHIM39')).resolves.toEqual([]);
    });
  });

  it('does not touch the database when there is nothing to prune', async () => {
    const db = { execute: jest.fn(), query: jest.fn() } as unknown as MssqlService;

    await new MssqlDeviceTokenRepository(db).removeDevices([]);

    expect(db.execute).not.toHaveBeenCalled();
  });

  it('prunes by device, never by token value', async () => {
    // Deleting by token would need an index over NVARCHAR(4000) — 8000 bytes
    // against SQL Server's 1700-byte key limit, which it warns can make an
    // insert fail. (LoginID, IMEINumber) is already uniquely indexed.
    const execute = jest.fn().mockResolvedValue(undefined);
    const db = { execute, query: jest.fn() } as unknown as MssqlService;

    await new MssqlDeviceTokenRepository(db).removeDevices([
      { username: 'AIBRAHIM39', imei: 'phone' },
    ]);

    const [sql] = execute.mock.calls[0] as [string];
    expect(sql).toContain('LoginID');
    expect(sql).toContain('IMEINumber');
    expect(sql).not.toContain('DeviceTokenValue');
  });

  it('binds every identifier by name when pruning — never string-built SQL', async () => {
    const execute = jest.fn().mockResolvedValue(undefined);
    const db = { execute, query: jest.fn() } as unknown as MssqlService;

    await new MssqlDeviceTokenRepository(db).removeDevices([
      { username: "a'; DROP TABLE x --", imei: 'i1' },
      { username: 'b', imei: 'i2' },
    ]);

    const [sql, binds] = execute.mock.calls[0] as [string, Record<string, unknown>];
    expect(sql).toContain('@u0');
    expect(sql).not.toContain('DROP TABLE');
    expect(binds).toEqual({
      u0: "a'; DROP TABLE x --",
      i0: 'i1',
      u1: 'b',
      i1: 'i2',
    });
  });
});
