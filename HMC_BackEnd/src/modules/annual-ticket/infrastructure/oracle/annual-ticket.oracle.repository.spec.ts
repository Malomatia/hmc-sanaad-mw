import * as oracledb from 'oracledb';
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
 * column with a NUMBER bind.
 */
describe('TicketOracleRepository — cancellation reads', () => {
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
