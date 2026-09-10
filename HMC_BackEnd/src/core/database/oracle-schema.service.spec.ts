import { OracleSchemaService } from './oracle-schema.service';
import { OracleMetadataService } from './oracle-metadata.service';

/**
 * User-scoped LOV reads (leave/lov/amend, letters/lov, ...) call hasColumn to
 * find the key column. Routing that through the full describe() fired the
 * expensive ALL_ARGUMENTS query and held three pool connections per check,
 * which timed the requests out. These cases pin the split: column checks read
 * only columns, signature reads only arguments — describe() is never used here.
 */
describe('OracleSchemaService', () => {
  const object = 'XXHMC_SND_LEAVE_AMEND_V';

  function make(overrides: Partial<jest.Mocked<OracleMetadataService>> = {}) {
    const describe = jest.fn();
    const describeColumns = jest.fn().mockResolvedValue([
      { name: 'USER_NAME', dataType: 'VARCHAR2', nullable: false, position: 1 },
    ]);
    const describeArguments = jest.fn().mockResolvedValue([
      {
        owner: 'APPS', ownerRank: 1, packageName: null,
        objectName: 'XXHMC_SND_GET_PAYSLIP_PERIODS', overload: null, subprogramId: 1,
        name: 'P_USER_NAME', position: 1, sequence: 1, dataLevel: 0,
        dataType: 'VARCHAR2', typeOwner: null, typeName: null, typeSubname: null,
        direction: 'IN', defaulted: false,
      },
      {
        owner: 'APPS', ownerRank: 1, packageName: null,
        objectName: 'XXHMC_SND_GET_PAYSLIP_PERIODS', overload: null, subprogramId: 1,
        name: 'P_GET_PERIODS', position: 2, sequence: 2, dataLevel: 0,
        dataType: 'REF CURSOR', typeOwner: null, typeName: null, typeSubname: null,
        direction: 'OUT', defaulted: false,
      },
    ]);
    const metadata = { describe, describeColumns, describeArguments, ...overrides } as unknown as OracleMetadataService;
    return { service: new OracleSchemaService(metadata), describe, describeColumns, describeArguments };
  }

  it('coalesces strict metadata reads and caches successful discoveries', async () => {
    const { service, describeColumns, describe } = make();
    const results = await Promise.all([
      service.columnsOfStrict(object),
      service.columnsOfStrict(object.toLowerCase()),
    ]);
    expect(results).toEqual([new Set(['USER_NAME']), new Set(['USER_NAME'])]);
    await service.columnsOfStrict(object);
    expect(describeColumns).toHaveBeenCalledTimes(1);
    expect(describe).not.toHaveBeenCalled();
  });

  it('retries strict metadata after failure instead of confirming a global LOV', async () => {
    const { service, describeColumns } = make();
    describeColumns.mockRejectedValueOnce(new Error('offline'));
    await expect(service.columnsOfStrict(object)).rejects.toMatchObject({ status: 503 });
    await expect(service.columnsOfStrict(object)).resolves.toEqual(new Set(['USER_NAME']));
    expect(describeColumns).toHaveBeenCalledTimes(2);
  });

  it('rejects empty strict metadata and retries on the next request', async () => {
    const { service, describeColumns } = make();
    describeColumns.mockResolvedValueOnce([]);
    await expect(service.columnsOfStrict(object)).rejects.toMatchObject({ status: 503 });
    await expect(service.columnsOfStrict(object)).resolves.toEqual(new Set(['USER_NAME']));
    expect(describeColumns).toHaveBeenCalledTimes(2);
  });

  it('does not trust cached empty legacy metadata after an outage', async () => {
    const { service, describeColumns } = make();
    describeColumns.mockRejectedValueOnce(new Error('offline'));
    await expect(service.hasColumn(object, 'USER_NAME')).resolves.toBe(false);
    await expect(service.columnsOfStrict(object)).resolves.toEqual(new Set(['USER_NAME']));
    expect(describeColumns).toHaveBeenCalledTimes(2);
    await expect(service.hasColumn(object, 'USER_NAME')).resolves.toBe(false);
  });

  it('confirms global columns only after a nonempty successful discovery', async () => {
    const { service, describeColumns } = make();
    describeColumns.mockResolvedValue([{ name: 'NAME', dataType: 'VARCHAR2' }]);
    await expect(service.columnsOfStrict(object)).resolves.toEqual(new Set(['NAME']));
  });

  it('resolves a key column from the column-only read, never the full describe', async () => {
    const { service, describe, describeColumns } = make();
    await expect(service.resolveKeyColumn(object, ['user_name', 'username'])).resolves.toBe('user_name');
    expect(describeColumns).toHaveBeenCalledWith(object);
    expect(describe).not.toHaveBeenCalled();
  });

  it('answers hasColumn from the column-only read', async () => {
    const { service, describe, describeColumns } = make();
    await expect(service.hasColumn(object, 'USER_NAME')).resolves.toBe(true);
    await expect(service.hasColumn(object, 'EMPLOYEE_NUMBER')).resolves.toBe(false);
    expect(describeColumns).toHaveBeenCalledTimes(1); // cached after the first read
    expect(describe).not.toHaveBeenCalled();
  });

  it('reads a procedure signature from the argument-only read, never the full describe', async () => {
    const { service, describe, describeArguments } = make();
    const params = await service.resolveParams('XXHMC_SND_GET_PAYSLIP_PERIODS');
    expect(params?.map((p) => p.name)).toEqual(['p_user_name', 'p_get_periods']);
    expect(describeArguments).toHaveBeenCalledWith('XXHMC_SND_GET_PAYSLIP_PERIODS');
    expect(describe).not.toHaveBeenCalled();
  });

  it('ignores nested collection attributes and selects the matching overload', async () => {
    const base = {
      owner: 'APPS',
      ownerRank: 1,
      packageName: 'XXHMC_SND_PHONE_PKG',
      objectName: 'ADD_OR_UPDATE_PHONE',
      typeOwner: null,
      typeName: null,
      typeSubname: null,
      defaulted: false,
    };
    const describeArguments = jest.fn().mockResolvedValue([
      { ...base, overload: '1', subprogramId: 1, name: 'P_USER_NAME', position: 1, sequence: 1, dataLevel: 0, dataType: 'VARCHAR2', direction: 'IN' },
      { ...base, overload: '1', subprogramId: 1, name: 'P_PHONE', position: 2, sequence: 2, dataLevel: 0, dataType: 'TABLE', direction: 'IN', typeOwner: 'APPS', typeName: 'XXHMC_SND_PHONE_PKG', typeSubname: 'PHONE_TAB' },
      { ...base, overload: '1', subprogramId: 1, name: 'P_PHONE_ID', position: 1, sequence: 3, dataLevel: 1, dataType: 'NUMBER', direction: 'IN' },
      { ...base, overload: '2', subprogramId: 2, name: 'P_USER_NAME', position: 1, sequence: 1, dataLevel: 0, dataType: 'VARCHAR2', direction: 'IN' },
      { ...base, overload: '2', subprogramId: 2, name: 'P_PHONE_ID', position: 2, sequence: 2, dataLevel: 0, dataType: 'NUMBER', direction: 'IN' },
      { ...base, overload: '2', subprogramId: 2, name: 'P_PHONE_TYPE', position: 3, sequence: 3, dataLevel: 0, dataType: 'VARCHAR2', direction: 'IN' },
      { ...base, overload: '2', subprogramId: 2, name: 'P_PHONE_NUMBER', position: 4, sequence: 4, dataLevel: 0, dataType: 'VARCHAR2', direction: 'IN' },
    ]);
    const { service } = make({ describeArguments } as Partial<jest.Mocked<OracleMetadataService>>);
    const params = await service.resolveParams('XXHMC_SND_PHONE_PKG.ADD_OR_UPDATE_PHONE', [
      'p_user_name',
      'p_phone_id',
      'p_phone_type',
      'p_phone_number',
    ]);
    expect(params?.map((p) => p.name)).toEqual([
      'p_user_name',
      'p_phone_id',
      'p_phone_type',
      'p_phone_number',
    ]);
  });

  it('binds composite parameters by their declared type but keeps cursors native', () => {
    const composite = {
      name: 'p_phone', direction: 'IN', dataType: 'PL/SQL TABLE', defaulted: false,
      typeOwner: 'APPS', typeName: 'XXHMC_SND_PHONE_PKG', typeSubname: 'PHONE_TAB',
    };
    expect(OracleSchemaService.outBindType(composite)).toBe('APPS.XXHMC_SND_PHONE_PKG.PHONE_TAB');

    const typedCursor = {
      name: 'p_cursor', direction: 'OUT', dataType: 'REF CURSOR', defaulted: false,
      typeOwner: 'APPS', typeName: 'XXHMC_SND_PHONE_PKG', typeSubname: 'PHONE_CUR',
    };
    expect(OracleSchemaService.outBindType(typedCursor)).not.toBe(
      'APPS.XXHMC_SND_PHONE_PKG.PHONE_CUR',
    );
  });

  it('returns null when an object has no formal parameters', async () => {
    const describeArguments = jest.fn().mockResolvedValue([]);
    const { service } = make({ describeArguments } as Partial<jest.Mocked<OracleMetadataService>>);
    await expect(service.resolveParams('XXHMC_SND_CHILD_DETS_VIEW')).resolves.toBeNull();
  });

  it('reports a returnType for a table function, distinguishing it from a procedure', async () => {
    // FUNCTION XXHMC_SND_CHILD_DETS_VIEW(p_acad_yr_strt_dt, p_user_name)
    //   RETURN xxhmc_snd_child_detl_nt — ALL_ARGUMENTS reports the RETURN
    // clause as a row with position 0 and no argument_name.
    const base = {
      owner: 'APPS', ownerRank: 1, packageName: null,
      objectName: 'XXHMC_SND_CHILD_DETS_VIEW', overload: null, subprogramId: 1,
      defaulted: false,
    };
    const describeArguments = jest.fn().mockResolvedValue([
      { ...base, name: null, position: 0, sequence: 0, dataLevel: 0, dataType: 'TABLE', typeOwner: 'APPS', typeName: 'XXHMC_SND_CHILD_DETL_NT', typeSubname: null, direction: null },
      { ...base, name: 'P_ACAD_YR_STRT_DT', position: 1, sequence: 1, dataLevel: 0, dataType: 'VARCHAR2', typeOwner: null, typeName: null, typeSubname: null, direction: 'IN' },
      { ...base, name: 'P_USER_NAME', position: 2, sequence: 2, dataLevel: 0, dataType: 'VARCHAR2', typeOwner: null, typeName: null, typeSubname: null, direction: 'IN' },
    ]);
    const { service } = make({ describeArguments } as Partial<jest.Mocked<OracleMetadataService>>);
    const signature = await service.resolveSignature('XXHMC_SND_CHILD_DETS_VIEW', [
      'p_acad_yr_strt_dt',
      'p_user_name',
    ]);
    expect(signature?.params.map((p) => p.name)).toEqual(['p_acad_yr_strt_dt', 'p_user_name']);
    expect(signature?.returnType).toBeDefined();
    expect(OracleSchemaService.returnTypeName(signature?.returnType)).toBe(
      'APPS.XXHMC_SND_CHILD_DETL_NT',
    );
  });

  it('reports no returnType for an ordinary procedure', async () => {
    const { service } = make();
    const signature = await service.resolveSignature('XXHMC_SND_GET_PAYSLIP_PERIODS');
    expect(signature?.returnType).toBeUndefined();
  });
});
