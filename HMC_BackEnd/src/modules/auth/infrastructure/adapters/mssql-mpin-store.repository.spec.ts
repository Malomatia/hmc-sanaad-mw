import { MssqlService } from '@core/database/mssql.service';
import { MssqlMpinStoreRepository } from './mssql-mpin-store.repository';
import { MssqlDeviceRegistryRepository } from './mssql-device-registry.repository';

function makeDb() {
  return { query: jest.fn(), execute: jest.fn() } as unknown as jest.Mocked<MssqlService>;
}

describe('MssqlMpinStoreRepository', () => {
  it('set() updates the registration row and activates it (Status = Active)', async () => {
    const db = makeDb();
    db.execute.mockResolvedValue({ rowsAffected: 1, rows: [] });

    await new MssqlMpinStoreRepository(db).set({ username: 'hmc1', imei: 'imei-1', mpin: '9999' });

    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE HMC_Sanad_DeviceRegn_tbl[\s\S]*DateFirstRegistered = GETDATE\(\), MPIN = @mpin, Status = 'Active'/,
      ),
      { username: 'hmc1', imei: 'imei-1', mpin: '9999' },
    );
  });

  it('set() falls back to an INSERT when no registration row exists yet', async () => {
    const db = makeDb();
    db.execute
      .mockResolvedValueOnce({ rowsAffected: 0, rows: [] })
      .mockResolvedValueOnce({ rowsAffected: 1, rows: [] });

    await new MssqlMpinStoreRepository(db).set({ username: 'hmc1', imei: 'imei-1', mpin: '9999' });

    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.execute).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO HMC_Sanad_DeviceRegn_tbl'),
      { username: 'hmc1', imei: 'imei-1', mpin: '9999' },
    );
  });

  it('verify() is the legacy LoginMPIN equality check', async () => {
    const db = makeDb();
    db.query.mockResolvedValue([{ DeviceID: 7 }]);
    const repo = new MssqlMpinStoreRepository(db);

    await expect(repo.verify({ username: 'hmc1', imei: 'imei-1', mpin: '9999' })).resolves.toBe(
      true,
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(/IMEINumber = @imei AND LoginID = @username AND MPIN = @mpin/),
      { username: 'hmc1', imei: 'imei-1', mpin: '9999' },
    );

    db.query.mockResolvedValue([]);
    await expect(repo.verify({ username: 'hmc1', imei: 'imei-1', mpin: '0000' })).resolves.toBe(
      false,
    );
  });

  it('exists() requires a non-null MPIN on the registration row', async () => {
    const db = makeDb();
    db.query.mockResolvedValue([]);

    await expect(new MssqlMpinStoreRepository(db).exists('hmc1', 'imei-1')).resolves.toBe(false);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('MPIN IS NOT NULL'), {
      username: 'hmc1',
      imei: 'imei-1',
    });
  });
});

describe('MssqlDeviceRegistryRepository', () => {
  it('isBound() is the legacy userValidate device check', async () => {
    const db = makeDb();
    db.query.mockResolvedValue([{ DeviceID: 7 }]);

    await expect(new MssqlDeviceRegistryRepository(db).isBound('hmc1', 'imei-1')).resolves.toBe(
      true,
    );
    expect(db.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /SELECT DeviceID[\s\S]*WHERE LoginID = @username AND IMEINumber = @imei/,
      ),
      { username: 'hmc1', imei: 'imei-1' },
    );
  });

  it('bind() registers the pair only when it does not exist yet, as Inactive', async () => {
    const db = makeDb();
    db.execute.mockResolvedValue({ rowsAffected: 1, rows: [] });

    await new MssqlDeviceRegistryRepository(db).bind({ username: 'hmc1', imei: 'imei-1' });

    expect(db.execute).toHaveBeenCalledWith(
      expect.stringMatching(
        /IF NOT EXISTS[\s\S]*INSERT INTO HMC_Sanad_DeviceRegn_tbl[\s\S]*AddedDt[\s\S]*'Inactive'/,
      ),
      { username: 'hmc1', imei: 'imei-1' },
    );
  });

  it('find() maps the registration row (MPIN presence, status, date)', async () => {
    const db = makeDb();
    db.query.mockResolvedValue([
      {
        DeviceID: 7,
        LoginID: 'hmc1',
        IMEINumber: 'imei-1',
        MPIN: 'stored-hash',
        Status: 'Active',
        DateFirstRegistered: new Date('2026-01-01T00:00:00Z'),
      },
    ]);

    const found = await new MssqlDeviceRegistryRepository(db).find('hmc1', 'imei-1');

    expect(found).toMatchObject({ mpinSet: true, status: 'Active' });
    expect(found?.registeredAt).toBeInstanceOf(Date);
  });

  it('find() reports mpinSet=false for a NULL MPIN and undefined for no row', async () => {
    const db = makeDb();
    db.query.mockResolvedValueOnce([
      { LoginID: 'hmc1', IMEINumber: 'imei-1', MPIN: null, Status: 'Inactive' },
    ]);
    const repo = new MssqlDeviceRegistryRepository(db);

    await expect(repo.find('hmc1', 'imei-1')).resolves.toMatchObject({
      mpinSet: false,
      status: 'Inactive',
    });

    db.query.mockResolvedValueOnce([]);
    await expect(repo.find('hmc1', 'other')).resolves.toBeUndefined();
  });
});
