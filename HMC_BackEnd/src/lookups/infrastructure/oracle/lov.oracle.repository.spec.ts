import { ConfigService } from '@nestjs/config';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { LovOracleRepository } from './lov.oracle.repository';

const object = 'XXHMC_SND_SCHOOL_NAME_LOV';

describe('LovOracleRepository', () => {
  function make() {
    const query = jest.fn().mockResolvedValue([{ NAME: 'Doha School', USER_NAME: 'V-TEST' }]);
    const ora = { query } as unknown as OracleService;
    const hasColumn = jest.fn().mockImplementation((_object: string, column: string) =>
      Promise.resolve(['USER_NAME', 'NAME'].includes(column.toUpperCase())),
    );
    const schema = { hasColumn, isNumericColumn: jest.fn().mockResolvedValue(false) } as unknown as OracleSchemaService;
    const config = {
      get: jest.fn().mockReturnValue(300000),
    } as unknown as ConfigService;
    return { repository: new LovOracleRepository(ora, schema, config), query };
  }

  it('applies the user filter, search, and bounded Oracle pagination', async () => {
    const { repository, query } = make();
    const items = await repository.readLov(object, 'en', 'V-TEST', {
      search: 'doha',
      offset: 100,
      limit: 100,
    });
    expect(items).toEqual([expect.objectContaining({ meaning: 'Doha School' })]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'WHERE user_name IN (:u0) AND UPPER(NAME) LIKE :search ORDER BY 1 OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY',
      ),
      { u0: 'V-TEST', search: '%DOHA%', offset: 100, limit: 100 },
    );
  });

  it.each(['en', 'ar'] as const)(
    'preserves academic-year dates and existing LOV fields for lang=%s, including cached reads',
    async (lang) => {
      const { repository, query } = make();
      query.mockResolvedValue([
        { ACAD_YEAR: '2025-2026', ACD_STARD_DT: '01-SEP-2025', ACD_END_DT: '30-JUN-2026' },
        { ACAD_YEAR: '2026-2027', ACD_STARD_DT: '01-SEP-2026', ACD_END_DT: '30-JUN-2027' },
      ]);

      const items = await repository.readLov('XXHMC_SND_ACAD_YR_STRT_END_LOV', lang);

      expect(items).toEqual([
        {
          code: '2025-2026',
          meaning: '2025-2026',
          used_value: '2025-2026',
          ACCAD_YEAR: '2025-2026',
          ACD_START_DT: '01-SEP-2025',
          ACD_END_DT: '30-JUN-2026',
        },
        {
          code: '2026-2027',
          meaning: '2026-2027',
          used_value: '2026-2027',
          ACCAD_YEAR: '2026-2027',
          ACD_START_DT: '01-SEP-2026',
          ACD_END_DT: '30-JUN-2027',
        },
      ]);
      expect(query).toHaveBeenCalledWith('SELECT * FROM XXHMC_SND_ACAD_YR_STRT_END_LOV', {});
      await expect(repository.readLov('XXHMC_SND_ACAD_YR_STRT_END_LOV', lang)).resolves.toEqual(
        items,
      );
      expect(query).toHaveBeenCalledTimes(1);
    },
  );

  it('does not add academic-year fields to a different LOV', async () => {
    const { repository, query } = make();
    query.mockResolvedValue([
      { NAME: 'Doha School', ACAD_YEAR: '2025-2026', ACD_STARD_DT: '01-SEP-2025' },
    ]);

    const [item] = await repository.readLov(object, 'en');

    expect(item.code).toBe('Doha School');
    expect(item).not.toHaveProperty('ACCAD_YEAR');
    expect(item).not.toHaveProperty('ACD_START_DT');
    expect(item).not.toHaveProperty('ACD_END_DT');
  });

  it('coalesces and caches identical LOV requests', async () => {
    const { repository, query } = make();
    await Promise.all([
      repository.readLov(object, 'en', 'V-TEST'),
      repository.readLov(object, 'en', 'V-TEST'),
    ]);
    await repository.readLov(object, 'en', 'V-TEST');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('filters the multi-type LOV by its grouping column when dataType is passed (DEP_LOOKUP_LOV)', async () => {
    const query = jest.fn().mockResolvedValue([{ CODE: 'C', DATA: 'Child', D_DATA_TYPE: 'CONTACT' }]);
    const ora = { query } as unknown as OracleService;
    const hasColumn = jest
      .fn()
      .mockImplementation((_o: string, c: string) => Promise.resolve(c.toUpperCase() === 'D_DATA_TYPE'));
    const schema = { hasColumn, isNumericColumn: jest.fn().mockResolvedValue(false) } as unknown as OracleSchemaService;
    const config = { get: jest.fn().mockReturnValue(300000) } as unknown as ConfigService;
    const repository = new LovOracleRepository(ora, schema, config);

    const items = await repository.readLov('XXHMC_SND_DEP_LOOKUP_LOV', 'en', undefined, {
      dataType: 'contact',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE UPPER(D_DATA_TYPE) = :dataType'),
      { dataType: 'CONTACT' },
    );
    expect(items).toEqual([expect.objectContaining({ code: 'C', meaning: 'Child', type: 'CONTACT' })]);
  });

  it('filters the reasons LOV by its LEAVE_TYPE column when leaveType is passed (ABSENCE_REASON_V)', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([
        { LEAVE_TYPE: 'Compassionate Leave', LEAVE_REASON: 'Death of 2nd Degree Relative' },
      ]);
    const ora = { query } as unknown as OracleService;
    const hasColumn = jest
      .fn()
      .mockImplementation((_o: string, c: string) => Promise.resolve(c.toUpperCase() === 'LEAVE_TYPE'));
    const schema = { hasColumn, isNumericColumn: jest.fn().mockResolvedValue(false) } as unknown as OracleSchemaService;
    const config = { get: jest.fn().mockReturnValue(300000) } as unknown as ConfigService;
    const repository = new LovOracleRepository(ora, schema, config);

    const items = await repository.readLov('XXHMC_SND_ABSENCE_REASON_V', 'en', undefined, {
      leaveType: 'Compassionate Leave',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE UPPER(LEAVE_TYPE) = :leaveType'),
      { leaveType: 'COMPASSIONATE LEAVE' },
    );
    expect(items).toEqual([
      expect.objectContaining({ meaning: 'Death of 2nd Degree Relative' }),
    ]);
  });

  it('filters on NAME when the view has no dedicated leave-type column (LEAVE_CANCEL_V, ops 61/62)', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([{ NAME: 'Casual Leave', VALUE: 'Casual Leave|19-APR-2026|19-APR-2026' }]);
    const ora = { query } as unknown as OracleService;
    const hasColumn = jest
      .fn()
      .mockImplementation((_o: string, c: string) =>
        Promise.resolve(['NAME', 'PERSON_ID'].includes(c.toUpperCase())),
      );
    // PERSON_ID really is a NUMBER on this view
    const schema = {
      hasColumn,
      isNumericColumn: jest.fn().mockResolvedValue(true),
    } as unknown as OracleSchemaService;
    const config = { get: jest.fn().mockReturnValue(300000) } as unknown as ConfigService;
    const repository = new LovOracleRepository(ora, schema, config);

    await repository.readLov('XXHMC_SND_LEAVE_CANCEL_V', 'en', '26023', {
      leaveType: 'Casual Leave',
      scopeAlternatives: ['AIBRAHIM39'],
    });

    // NAME holds display strings ("Casual Leave|19-APR-2026|…") → contains
    // match. Only the numeric identifier reaches PERSON_ID: this case used to
    // offer the username too, and Oracle then rejected the entire IN-list
    // (ORA-01722), so the view's 15 rows came back as 0.
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPPER(NAME) LIKE :leaveType'),
      expect.objectContaining({ u0: '26023', leaveType: '%CASUAL LEAVE%' }),
    );
    expect((query.mock.calls[0] as unknown[])[0]).toContain('IN (:u0)');
    expect(query.mock.calls[0][1]).not.toHaveProperty('u1');
  });

  it('falls back to the employee-number column when the view has no user column (LEAVE_AMEND_V)', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const ora = { query } as unknown as OracleService;
    const hasColumn = jest
      .fn()
      .mockImplementation((_o: string, c: string) => Promise.resolve(c.toUpperCase() === 'EMPLOYEE_NUMBER'));
    const schema = { hasColumn, isNumericColumn: jest.fn().mockResolvedValue(false) } as unknown as OracleSchemaService;
    const config = { get: jest.fn().mockReturnValue(300000) } as unknown as ConfigService;
    const repository = new LovOracleRepository(ora, schema, config);

    await repository.readLov('XXHMC_SND_LEAVE_AMEND_V', 'en', '053613');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE employee_number IN (:u0)'),
      { u0: '053613' },
    );
  });

  it('matches leave_type case-insensitively (lowercase input, any column case)', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const ora = { query } as unknown as OracleService;
    const hasColumn = jest
      .fn()
      .mockImplementation((_o: string, c: string) => Promise.resolve(c.toUpperCase() === 'NAME'));
    const schema = { hasColumn, isNumericColumn: jest.fn().mockResolvedValue(false) } as unknown as OracleSchemaService;
    const config = { get: jest.fn().mockReturnValue(300000) } as unknown as ConfigService;
    const repository = new LovOracleRepository(ora, schema, config);

    await repository.readLov('XXHMC_SND_LEAVE_CANCEL_V', 'en', undefined, {
      leaveType: '  casual leave ',
    });

    // Input is trimmed + upper-cased, and the column is wrapped in UPPER() —
    // so the match is case-insensitive on both sides.
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPPER(NAME) LIKE :leaveType'),
      { leaveType: '%CASUAL LEAVE%' },
    );
  });

  it('filters a person-scoped view by PERSON_ID when personId is passed (CONTRACT_YEARS_V)', async () => {
    const query = jest.fn().mockResolvedValue([{ CONTRACT_YEAR: '2026' }]);
    const ora = { query } as unknown as OracleService;
    const hasColumn = jest
      .fn()
      .mockImplementation((_o: string, c: string) => Promise.resolve(c.toUpperCase() === 'PERSON_ID'));
    const schema = { hasColumn, isNumericColumn: jest.fn().mockResolvedValue(false) } as unknown as OracleSchemaService;
    const config = { get: jest.fn().mockReturnValue(300000) } as unknown as ConfigService;
    const repository = new LovOracleRepository(ora, schema, config);

    await repository.readLov('XXHMC_SND_CONTRACT_YEARS_V', 'en', undefined, {
      personId: ' 852709 ',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE person_id = :personId'),
      { personId: '852709' },
    );
  });

  it('ignores personId when the view has no PERSON_ID column', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const ora = { query } as unknown as OracleService;
    const hasColumn = jest.fn().mockResolvedValue(false);
    const schema = { hasColumn, isNumericColumn: jest.fn().mockResolvedValue(false) } as unknown as OracleSchemaService;
    const config = { get: jest.fn().mockReturnValue(300000) } as unknown as ConfigService;
    const repository = new LovOracleRepository(ora, schema, config);

    await repository.readLov('XXHMC_SND_YES_NO_LOV', 'en', undefined, { personId: '852709' });

    expect(query).toHaveBeenCalledWith(expect.not.stringContaining('WHERE'), {});
  });

  it('keeps the exact match on a dedicated LEAVE_TYPE column (op 13 unchanged)', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const ora = { query } as unknown as OracleService;
    const hasColumn = jest
      .fn()
      .mockImplementation((_o: string, c: string) => Promise.resolve(c.toUpperCase() === 'LEAVE_TYPE'));
    const schema = { hasColumn, isNumericColumn: jest.fn().mockResolvedValue(false) } as unknown as OracleSchemaService;
    const config = { get: jest.fn().mockReturnValue(300000) } as unknown as ConfigService;
    const repository = new LovOracleRepository(ora, schema, config);

    await repository.readLov('XXHMC_SND_ABSENCE_REASON_V', 'en', undefined, {
      leaveType: 'Casual Leave',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('UPPER(LEAVE_TYPE) = :leaveType'),
      { leaveType: 'CASUAL LEAVE' },
    );
  });
});
