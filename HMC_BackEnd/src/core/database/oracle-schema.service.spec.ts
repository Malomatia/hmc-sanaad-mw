import { Test } from '@nestjs/testing';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { classifyException } from '@core/http/exception-classifier';
import { OracleSchemaService } from './oracle-schema.service';
import { OracleMetadataService } from './oracle-metadata.service';
import { OracleModule } from './oracle.module';
import { OracleContractCatalog } from './oracle-contracts';
import { OracleContractUnavailableException } from './oracle.error';
import { OracleService } from './oracle.service';

describe('Business Oracle discovery isolation', () => {
  it('does not inject the live dictionary service into the business resolver', () => {
    const dependencies = Reflect.getMetadata('design:paramtypes', OracleSchemaService) as unknown[];
    expect(dependencies).not.toContain(OracleMetadataService);
  });

  it('does not export the live dictionary service to feature modules', () => {
    const exports = Reflect.getMetadata('exports', OracleModule) as unknown[];
    expect(exports).not.toContain(OracleMetadataService);
  });

  it('uses the static catalog through Nest injection, even when live discovery would fail', async () => {
    const metadata = {
      describe: jest.fn().mockRejectedValue(new Error('Live discovery is forbidden')),
      describeColumns: jest.fn().mockRejectedValue(new Error('Live discovery is forbidden')),
      describeArguments: jest.fn().mockRejectedValue(new Error('Live discovery is forbidden')),
    };
    const module = await Test.createTestingModule({
      providers: [OracleSchemaService, OracleContractCatalog, { provide: OracleMetadataService, useValue: metadata }],
    }).compile();
    try {
      const schema = module.get(OracleSchemaService);
      await expect(schema.resolveKeyColumn(ORACLE_OBJECTS.PERSONAL_DETAILS_V, ['user_name', 'username']))
        .resolves.toBe('user_name');
      const params = await schema.resolveParams(ORACLE_OBJECTS.QID_CHG_PR);
      expect(params).toHaveLength(24);
      await expect(schema.resolveParams(ORACLE_OBJECTS.UPD_PERSONAL_INFO_PR))
        .rejects.toBeInstanceOf(OracleContractUnavailableException);
      for (const method of Object.values(metadata)) expect(method).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('retains live argument inspection as an explicit diagnostic operation', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const diagnostics = new OracleMetadataService({ query } as unknown as OracleService);
    await diagnostics.describeArguments(ORACLE_OBJECTS.QID_CHG_PR);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('FROM all_arguments');
  });
});

describe('Static Oracle contracts', () => {
  const catalog = new OracleContractCatalog();
  const schema = new OracleSchemaService(catalog);

  it.each([
    [ORACLE_OBJECTS.COID_REQ_PR, 29],
    [ORACLE_OBJECTS.QID_CHG_PR, 24],
    [ORACLE_OBJECTS.SCHOOL_FEE_PR, 39],
    [ORACLE_OBJECTS.LEAVE_BALANCE_PR, 6],
    [ORACLE_OBJECTS.GET_PAYSLIP_PERIODS, 4],
    [ORACLE_OBJECTS.CHK_PAYROLL_CNT, 6],
    [ORACLE_OBJECTS.PAYSLIP_PR, 15],
    [ORACLE_OBJECTS.HR_EMPLYMNT_LTR_PR, 31],
  ] as const)('keeps the complete registered signature for %s', async (object, count) => {
    const params = await schema.resolveParams(object);
    expect(params).toHaveLength(count);
    expect(params.map((param) => param.name)).not.toContain('p_language');
    expect(new Set(params.map((param) => param.name)).size).toBe(params.length);
  });

  it('preserves the supplied school-fee date, number, birth-token, and BLOB types', async () => {
    const params = await schema.resolveParams(ORACLE_OBJECTS.SCHOOL_FEE_PR);
    const types = Object.fromEntries(params.map((param) => [param.name, param.dataType]));
    expect(types).toMatchObject({
      p_acd_st_dt: 'DATE', p_acd_end_dt: 'DATE', p_child_date_birth: 'VARCHAR2', p_amount: 'NUMBER',
      p_attachment1: 'BLOB', p_attachment10: 'BLOB', p_error_msg_ar: 'VARCHAR2',
    });
  });

  it.each([
    ORACLE_OBJECTS.PERFORMANCE_V, ORACLE_OBJECTS.SALARY_V,
    ORACLE_OBJECTS.EMPLOYMENT_V, ORACLE_OBJECTS.EMPLOYMENT_DETAILS_V,
  ])(
    'resolves %s by its confirmed USER_NAME key',
    async (object) => {
      await expect(schema.resolveKeyColumn(object, ['user_name', 'username'])).resolves.toBe('user_name');
      await expect(schema.hasColumn(object, 'USERNAME')).resolves.toBe(false);
    },
  );

  it('resolves documented numeric and role-keyed views from static columns', async () => {
    await expect(schema.resolveKeyColumn(ORACLE_OBJECTS.LEAVE_CANCEL_V, ['username', 'person_id']))
      .resolves.toBe('person_id');
    await expect(schema.isNumericColumn(ORACLE_OBJECTS.LEAVE_CANCEL_V, 'PERSON_ID')).resolves.toBe(true);
    await expect(schema.resolveKeyColumn(ORACLE_OBJECTS.APPROVE_SUMRY_V, ['approver_user_name']))
      .resolves.toBe('approver_user_name');
    await expect(schema.isNumericColumn(ORACLE_OBJECTS.APPROVE_SUMRY_V, 'APPROVER_USER_NAME')).resolves.toBe(false);
  });

  it('does not mutate catalog definitions when a returned record is changed', async () => {
    const params = await catalog.describeArguments(ORACLE_OBJECTS.QID_CHG_PR);
    params[0].name = 'CHANGED';
    const columns = await catalog.describeColumns(ORACLE_OBJECTS.LEAVE_CANCEL_V);
    columns[0].name = 'CHANGED';
    expect((await catalog.describeArguments(ORACLE_OBJECTS.QID_CHG_PR))[0].name).toBe('P_USER_NAME');
    expect((await catalog.describeColumns(ORACLE_OBJECTS.LEAVE_CANCEL_V))[0].name).toBe('PERSON_ID');
  });

  it.each([
    ORACLE_OBJECTS.DEPENDENT_PKG_ADD,
    ORACLE_OBJECTS.DEPENDENT_PKG_UPDATE,
    ORACLE_OBJECTS.RET_FRM_LEAV_PR,
    ORACLE_OBJECTS.HR_LEAV_AMEND_PR,
    ORACLE_OBJECTS.UPD_PERSONAL_INFO_PR,
  ])('keeps an uncaptured production signature unavailable: %s', async (object) => {
    await expect(schema.resolveParams(object)).rejects.toBeInstanceOf(OracleContractUnavailableException);
  });

  it('resolves the employee phone view by its confirmed USER_NAME key', async () => {
    await expect(schema.resolveKeyColumn(ORACLE_OBJECTS.EMP_PHONE_V, ['user_name', 'username']))
      .resolves.toBe('user_name');
    await expect(schema.isNumericColumn(ORACLE_OBJECTS.EMP_PHONE_V, 'DEPENDENT_ID')).resolves.toBe(true);
  });

  it.each([ORACLE_OBJECTS.EMP_IN_ADDRESS_V, ORACLE_OBJECTS.EMP_OUT_ADDRESS_V])(
    'resolves %s by its confirmed USER_NAME key with an ADDRESS_TYPE filter column',
    async (object) => {
      await expect(schema.resolveKeyColumn(object, ['user_name', 'username'])).resolves.toBe('user_name');
      await expect(schema.hasColumn(object, 'ADDRESS_TYPE')).resolves.toBe(true);
      await expect(schema.isNumericColumn(object, 'ADDRESS_ID')).resolves.toBe(true);
    },
  );

  it('resolves every profile view by its confirmed USER_NAME key', async () => {
    for (const object of [
      ORACLE_OBJECTS.PERSONAL_DETAILS_V, ORACLE_OBJECTS.EMP_PHONE_V, ORACLE_OBJECTS.EMP_OUT_ADDRESS_V,
      ORACLE_OBJECTS.EMP_IN_ADDRESS_V, ORACLE_OBJECTS.EMP_CONTACT_V,
    ]) {
      await expect(schema.resolveKeyColumn(object, ['user_name', 'username'])).resolves.toBe('user_name');
    }
    await expect(schema.resolveKeyColumn(ORACLE_OBJECTS.DEP_PHONE_V, ['dependent_id'])).resolves.toBe('dependent_id');
    await expect(schema.resolveKeyColumn(ORACLE_OBJECTS.DEP_ADDRESS_V, ['address_id'])).resolves.toBe('address_id');
  });

  it('refuses unavailable view definitions and unsupported keys before any read', async () => {
    await expect(schema.hasColumn(ORACLE_OBJECTS.QID_DET_V, 'USER_NAME'))
      .rejects.toBeInstanceOf(OracleContractUnavailableException);
    await expect(schema.resolveKeyColumn(ORACLE_OBJECTS.LEAVE_CANCEL_V, ['USERNAME']))
      .rejects.toBeInstanceOf(OracleContractUnavailableException);
  });

  it('returns an explicit 503 configuration message without exposing object names', () => {
    const error = new OracleContractUnavailableException(ORACLE_OBJECTS.HR_EMPLYMNT_LTR_PR, 'program parameters');
    const classified = classifyException(error);
    expect(classified).toMatchObject({
      httpStatus: 503, serverSide: true, message: OracleContractUnavailableException.publicMessage,
    });
    expect(classified.message).not.toContain('XXHMC');
    expect(error.message).toContain(ORACLE_OBJECTS.HR_EMPLYMNT_LTR_PR);
  });
});

/**
 * User-scoped LOV reads resolve their keys from the injected static catalog.
 * A live dictionary dependency previously fired expensive ALL_ARGUMENTS reads
 * and held several pool connections per check. These fixtures exercise the
 * contract resolver independently of Oracle; production injection and exports
 * must keep the live dictionary service confined to explicit diagnostics.
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

  it('propagates signature failures and caches only a subsequent successful lookup', async () => {
    const { service, describeArguments } = make();
    const error = new Error('Signature discovery failed');
    describeArguments.mockRejectedValueOnce(error);

    await expect(service.resolveParams('XXHMC_SND_GET_PAYSLIP_PERIODS')).rejects.toBe(error);

    const params = await service.resolveParams('XXHMC_SND_GET_PAYSLIP_PERIODS');
    expect(params?.map((p) => p.name)).toEqual(['p_user_name', 'p_get_periods']);
    await expect(service.resolveParams('xxhmc_snd_get_payslip_periods')).resolves.toEqual(params);
    expect(describeArguments).toHaveBeenCalledTimes(2);
  });

  it('propagates column failures without poisoning column-name or column-type caches', async () => {
    const { service, describeColumns } = make();
    const error = new Error('Column discovery failed');
    describeColumns.mockRejectedValueOnce(error).mockResolvedValue([
      { name: 'PERSON_ID', dataType: 'NUMBER', nullable: false, position: 1 },
    ]);

    await expect(service.hasColumn(object, 'PERSON_ID')).rejects.toBe(error);

    await expect(service.isNumericColumn(object, 'PERSON_ID')).resolves.toBe(true);
    await expect(service.resolveKeyColumn(object, ['person_id', 'username'])).resolves.toBe('person_id');
    await expect(service.hasColumn(object, 'PERSON_ID')).resolves.toBe(true);
    expect(describeColumns).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty program contract instead of enabling guessed arguments', async () => {
    const describeArguments = jest.fn().mockResolvedValue([]);
    const { service } = make({ describeArguments } as Partial<jest.Mocked<OracleMetadataService>>);
    await expect(service.resolveParams('XXHMC_SND_CHILD_DETS_VIEW')).rejects.toMatchObject({ status: 503 });
    await expect(service.resolveParams('XXHMC_SND_CHILD_DETS_VIEW')).rejects.toMatchObject({ status: 503 });
    expect(describeArguments).toHaveBeenCalledTimes(2);
  });

  it('rejects an empty view contract instead of choosing the first candidate', async () => {
    const { service } = make({ describeColumns: jest.fn().mockResolvedValue([]) });
    await expect(service.resolveKeyColumn(object, ['username', 'person_id']))
      .rejects.toMatchObject({ status: 503 });
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
