import * as oracledb from 'oracledb';
import { Logger } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { OracleContractCatalog } from '@core/database/oracle-contracts';
import { OracleContractUnavailableException } from '@core/database/oracle.error';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { TicketOracleRepository } from './annual-ticket.oracle.repository';

/**
 * Pins the op-72 read shapes against the real static catalog with a mocked
 * driver: the caller's PERSON_ID comes from EMPLOYMENT_DETAILS_V by USER_NAME,
 * and the three cancellation views are filtered on the contract's PERSON_ID
 * column with a NUMBER bind. The op-66 master reads (TICKET_MASTER and the
 * ANNUAL_TICKT_LOV eligibility flag) are filtered on USER_NAME.
 */
describe('TicketOracleRepository — master and cancellation reads', () => {
  function make(
    query: jest.Mock = jest.fn().mockResolvedValue([]),
    schema = new OracleSchemaService(new OracleContractCatalog()),
  ) {
    const ora = { query } as unknown as OracleService;
    const repository = new TicketOracleRepository(ora, schema);
    const issued = () =>
      query.mock.calls.map(([sql, binds]) => ({
        sql: String(sql).replace(/\s+/g, ' ').trim(),
        binds: binds as Record<string, unknown>,
      }));
    return { repository, query, issued };
  }

  describe('resolvePersonId', () => {
    it('reads EMPLOYMENT_DETAILS_V by the upper-cased USER_NAME', async () => {
      const { repository, issued } = make(jest.fn().mockResolvedValue([{ PERSON_ID: 26023 }]));

      await expect(repository.resolvePersonId('aibrahim39')).resolves.toBe('26023');

      expect(issued()).toEqual([
        {
          sql: 'SELECT * FROM XXHMC_SND_EMPLOYMENT_DETAILS_V WHERE user_name IN (:k0)',
          binds: { k0: 'AIBRAHIM39' },
        },
      ]);
    });

    it.each([[[]], [[{ PERSON_ID: null }]], [[{ PERSON_ID: '' }]]])(
      'returns null when there is no usable PERSON_ID (%j)',
      async (rows) => {
        const { repository } = make(jest.fn().mockResolvedValue(rows));
        await expect(repository.resolvePersonId('AIBRAHIM39')).resolves.toBeNull();
      },
    );
  });

  describe('cancelOptions', () => {
    it('reads the three views in parallel by PERSON_ID, bound as a NUMBER', async () => {
      const rowsByObject: Record<string, Record<string, unknown>[]> = {
        [ORACLE_OBJECTS.CANCEL_TICKETS_V]: [{ PERSON_ID: 26023, ANNUAL_LEAVE_PASS_TKT_VALUE: 'T' }],
        [ORACLE_OBJECTS.CANCEL_TAKENAS_V]: [{ PERSON_ID: 26023, TAKES_AS: 'Cash' }],
        [ORACLE_OBJECTS.CANCEL_REPAYMENT_METHODS_V]: [
          { PERSON_ID: 26023, FLEX_VALUE: 'Payroll Deduction' },
        ],
      };
      const query = jest.fn((sql: string) =>
        Promise.resolve(rowsByObject[String(sql).split(' ')[3]] ?? []),
      );
      const { repository, issued } = make(query);

      await expect(repository.cancelOptions('26023')).resolves.toEqual({
        tickets: rowsByObject[ORACLE_OBJECTS.CANCEL_TICKETS_V],
        takenAs: rowsByObject[ORACLE_OBJECTS.CANCEL_TAKENAS_V],
        repaymentMethods: rowsByObject[ORACLE_OBJECTS.CANCEL_REPAYMENT_METHODS_V],
      });

      const NUMBER = { p: { type: oracledb.DB_TYPE_NUMBER, val: 26023 } };
      expect(issued()).toEqual([
        { sql: 'SELECT * FROM XXHMC_SND_CANCEL_TICKETS_V WHERE person_id = :p', binds: NUMBER },
        { sql: 'SELECT * FROM XXHMC_SND_CANCEL_TAKENAS_V WHERE person_id = :p', binds: NUMBER },
        {
          sql: 'SELECT * FROM XXHMC_SND_CANCEL_REPAYMENT_METHODS_V WHERE person_id = :p',
          binds: NUMBER,
        },
      ]);
    });

    it.each(['', 'abc', '26023 OR 1=1', '1e3'])(
      'never queries with a non-numeric id (%p)',
      async (personId) => {
        const { repository, query } = make();

        await expect(repository.cancelOptions(personId)).resolves.toEqual({
          tickets: [],
          takenAs: [],
          repaymentMethods: [],
        });
        expect(query).not.toHaveBeenCalled();
      },
    );

    it('takes the key column from the view contract and fails closed without one', async () => {
      const describeColumns = jest
        .fn()
        .mockResolvedValue([{ name: 'OTHER_ID', dataType: 'NUMBER', position: 1, nullable: true }]);
      const schema = new OracleSchemaService({
        describeColumns,
        describeArguments: jest.fn(),
      } as unknown as OracleContractCatalog);
      const { repository, query } = make(jest.fn().mockResolvedValue([]), schema);

      await expect(repository.cancelOptions('26023')).rejects.toBeInstanceOf(
        OracleContractUnavailableException,
      );
      expect(describeColumns).toHaveBeenCalledWith(ORACLE_OBJECTS.CANCEL_TICKETS_V);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('getMaster (op 66)', () => {
    it('reads TICKET_MASTER by the upper-cased USER_NAME and returns the raw rows', async () => {
      const rows = [{ TAG1: 'DESTINATION', NAME_EN: 'Cairo', USER_NAME: 'AIBRAHIM39' }];
      const { repository, issued } = make(jest.fn().mockResolvedValue(rows));

      await expect(repository.getMaster('aibrahim39')).resolves.toEqual(rows);

      expect(issued()).toEqual([
        {
          sql: 'SELECT * FROM XXHMC_SND_TICKET_MASTER WHERE user_name IN (:k0)',
          binds: { k0: 'AIBRAHIM39' },
        },
      ]);
    });

    it('never reads the view unfiltered', async () => {
      const { repository, query } = make();

      await expect(repository.getMaster('  ')).resolves.toEqual([]);
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('getEligibility (op 66)', () => {
    it('reads ANNUAL_TICKT_LOV by the upper-cased USER_NAME and returns the flag', async () => {
      const { repository, issued } = make(
        jest
          .fn()
          .mockResolvedValue([
            { ANUAL_TKT_DEFAULT: 'Yes', USER_NAME: 'AIBRAHIM39', ANUAL_TKT_DEFAULT_AR: 'نعم' },
          ]),
      );

      await expect(repository.getEligibility('aibrahim39')).resolves.toEqual({
        eligible: 'Yes',
        eligibleAr: 'نعم',
      });

      expect(issued()).toEqual([
        {
          sql: 'SELECT * FROM XXHMC_SND_ANNUAL_TICKT_LOV WHERE user_name IN (:k0)',
          binds: { k0: 'AIBRAHIM39' },
        },
      ]);
    });

    it('returns null when the user has no row', async () => {
      const { repository } = make();
      await expect(repository.getEligibility('AIBRAHIM39')).resolves.toBeNull();
    });

    it.each([
      [{ ANUAL_TKT_DEFAULT: ' no ', ANUAL_TKT_DEFAULT_AR: 'لا' }, { eligible: 'No', eligibleAr: 'لا' }],
      [{ ANUAL_TKT_DEFAULT: 'Maybe', ANUAL_TKT_DEFAULT_AR: 'ربما' }, { eligible: null, eligibleAr: null }],
      [{ ANUAL_TKT_DEFAULT: null, ANUAL_TKT_DEFAULT_AR: null }, { eligible: null, eligibleAr: null }],
    ])('normalizes the flag %j to Yes | No | null', async (row, expected) => {
      const { repository } = make(jest.fn().mockResolvedValue([row]));
      await expect(repository.getEligibility('AIBRAHIM39')).resolves.toEqual(expected);
    });

    it('degrades a failed read to null with a READ_DEGRADED warning (never throws)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { repository } = make(jest.fn().mockRejectedValue(new Error('ORA-00942')));

      await expect(repository.getEligibility('AIBRAHIM39')).resolves.toBeNull();

      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[READ_DEGRADED] object=XXHMC_SND_ANNUAL_TICKT_LOV failed: ORA-00942'),
      );
      warn.mockRestore();
    });
  });

  it('registers the confirmed columns of TICKET_MASTER and ANNUAL_TICKT_LOV', async () => {
    const catalog = new OracleContractCatalog();
    const columns = async (object: string) =>
      (await catalog.describeColumns(object)).map(({ name, dataType }) => `${name}:${dataType}`);

    await expect(columns(ORACLE_OBJECTS.TICKET_MASTER)).resolves.toEqual([
      'TAG1:VARCHAR2',
      'PERSON_ID:NUMBER',
      'CONTACT_ID:NUMBER',
      'USER_NAME:VARCHAR2',
      'RECORD_TYPE:VARCHAR2',
      'NAME_EN:VARCHAR2',
      'NAME_AR:VARCHAR2',
      'CURRENT_EMPLOYEE_FLAG:VARCHAR2',
      'CONTACT_TYPE:VARCHAR2',
      'DATE_OF_BIRTH:DATE',
      'SEX:VARCHAR2',
      'ROW_NUM:NUMBER',
      'EMPLOYEE_NUMBER:VARCHAR2',
      'DATE_START:DATE',
      'LAW:VARCHAR2',
      'TOT_COUNT:NUMBER',
      'FROM_DATE:NUMBER',
      'TOO_DATE:NUMBER',
      'CONTRACT_YEAR:VARCHAR2',
      'CONTRACT_YEAR_DEF:VARCHAR2',
      'CONTRACT_YEAR_DEF_AR:VARCHAR2',
    ]);
    await expect(columns(ORACLE_OBJECTS.ANNUAL_TICKT_LOV)).resolves.toEqual([
      'ANUAL_TKT_DEFAULT:VARCHAR2',
      'USER_NAME:VARCHAR2',
      'ANUAL_TKT_DEFAULT_AR:VARCHAR2',
    ]);
  });

  it('registers the confirmed columns of the three cancellation views', async () => {
    const catalog = new OracleContractCatalog();
    const columns = async (object: string) =>
      (await catalog.describeColumns(object)).map(({ name, dataType }) => `${name}:${dataType}`);

    await expect(columns(ORACLE_OBJECTS.CANCEL_TICKETS_V)).resolves.toEqual([
      'PERSON_ID:NUMBER',
      'ANALYSIS_CRITERIA_ID:NUMBER',
      'ANNUAL_LEAVE_PASS_TKT_VALUE:VARCHAR2',
    ]);
    await expect(columns(ORACLE_OBJECTS.CANCEL_TAKENAS_V)).resolves.toEqual([
      'PERSON_ID:NUMBER',
      'ANALYSIS_CRITERIA_ID:NUMBER',
      'TAKES_AS:VARCHAR2',
      'TAKEN_AS_AR:VARCHAR2',
    ]);
    await expect(columns(ORACLE_OBJECTS.CANCEL_REPAYMENT_METHODS_V)).resolves.toEqual([
      'PERSON_ID:NUMBER',
      'ANALYSIS_CRITERIA_ID:NUMBER',
      'FLEX_VALUE:VARCHAR2',
      'DESCRIPTION:VARCHAR2',
      'FLEX_VALUE_AR:VARCHAR2',
    ]);
  });
});
