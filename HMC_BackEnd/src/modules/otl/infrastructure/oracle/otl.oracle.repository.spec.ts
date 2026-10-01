import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { OracleContractCatalog } from '@core/database/oracle-contracts';
import { OracleLogStore } from '@core/database/oracle-log.store';
import { OracleQueryError } from '@core/database/oracle.error';
import { OtlOracleRepository } from './otl.oracle.repository';

/**
 * Pins the OTL call shapes against the real static catalog with a mocked
 * driver: TABLE(...) reads with positional, typed binds; every person-scoped
 * view filtered by USER_NAME (and the heavy HXC views by month as well); the
 * INVALID summary view degrading instead of failing.
 */
describe('OtlOracleRepository', () => {
  const localMidnight = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  const DATE = (y: number, m: number, d: number) => ({
    type: oracledb.DB_TYPE_DATE,
    val: localMidnight(y, m, d),
  });

  function make(rows: Record<string, unknown>[] = []) {
    const query = jest.fn().mockResolvedValue(rows);
    const ora = { query } as unknown as OracleService;
    const repository = new OtlOracleRepository(
      ora,
      new OracleSchemaService(new OracleContractCatalog()),
    );
    const issued = (i = 0) => {
      const [sql, binds] = query.mock.calls[i];
      return {
        sql: String(sql).replace(/\s+/g, ' ').trim(),
        binds: (binds ?? {}) as Record<string, any>,
      };
    };
    return { repository, query, issued };
  }

  describe('table functions', () => {
    it.each([
      ['getAbsenceDetails', 'GET_ABSENCE_DETAILS'],
      ['getElementDetails', 'GET_ELEMENT_NAME'],
      ['getTemplate', 'GET_TEMPLATE'],
    ] as const)(
      '%s reads TABLE(XXHMC_SND_OTL_PKG.%s(user, start DATE, end DATE))',
      async (method, fn) => {
        const { repository, issued } = make([{ USER_NAME: 'AIBRAHIM39' }]);

        const rows = await repository[method]('aibrahim39', '2026-07-01', '2026-07-31');

        const { sql, binds } = issued();
        expect(sql).toBe(
          `SELECT * FROM TABLE(XXHMC_SND_OTL_PKG.${fn}(:arg0, :arg1, :arg2)) WHERE ROWNUM <= :maxRows`,
        );
        expect(binds).toEqual({
          arg0: 'AIBRAHIM39',
          arg1: DATE(2026, 7, 1),
          arg2: DATE(2026, 7, 31),
          maxRows: 2000,
        });
        expect(rows).toEqual([{ USER_NAME: 'AIBRAHIM39' }]);
      },
    );

    it('get_time_card_details binds the notification id as NUMBER first, then the OWNER', async () => {
      const { repository, issued } = make();

      await repository.getTimecardNotificationDetails('123864402', 'v-nfernando');

      const { sql, binds } = issued();
      expect(sql).toBe(
        'SELECT * FROM TABLE(XXHMC_SND_OTL_PKG.GET_TIME_CARD_DETAILS(:arg0, :arg1)) WHERE ROWNUM <= :maxRows',
      );
      expect(binds.arg0).toEqual({ type: oracledb.DB_TYPE_NUMBER, val: 123864402 });
      expect(binds.arg1).toBe('V-NFERNANDO');
    });

    it('rejects a non-numeric notification id with 400 before any SQL runs', async () => {
      const { repository, query } = make();
      await expect(repository.getTimecardNotificationDetails('12ab', 'X')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe('views are always filtered by the caller', () => {
    it('TIMECARD_DEATIS_V: USER_NAME + month, never unfiltered', async () => {
      const { repository, issued } = make();
      await repository.getDetails('aibrahim39', '2026-07-01');
      const { sql, binds } = issued();
      expect(sql).toBe(
        'SELECT * FROM XXHMC_SND_OTL_TIMECARD_DEATIS_V WHERE USER_NAME = :p_user_name AND TRUNC(START_TIME) = :p_start_date',
      );
      expect(binds).toEqual({ p_user_name: 'AIBRAHIM39', p_start_date: DATE(2026, 7, 1) });
    });

    it('SUMMARY_ELE_V: USER_NAME + month, never unfiltered', async () => {
      const { repository, issued } = make();
      await repository.getSummaryByElement('aibrahim39', '2026-07-01');
      const { sql, binds } = issued();
      expect(sql).toBe(
        'SELECT * FROM XXHMC_SND_OTL_SUMMARY_ELE_V WHERE USER_NAME = :p_user_name AND TRUNC(START_TIME) = :p_start_date',
      );
      expect(binds).toEqual({ p_user_name: 'AIBRAHIM39', p_start_date: DATE(2026, 7, 1) });
    });

    it('SUMMARY_V: USER_NAME, optionally a START_TIME window', async () => {
      const { repository, issued } = make([{ PERIOD: 'Jul 2026' }]);
      await expect(repository.getSummary('aibrahim39')).resolves.toEqual({
        rows: [{ PERIOD: 'Jul 2026' }],
        available: true,
      });
      await repository.getSummary('aibrahim39', { from: '2026-02-01', to: '2026-10-31' });

      expect(issued(0)).toEqual({
        sql: 'SELECT * FROM XXHMC_SND_OTL_SUMMARY_V WHERE USER_NAME = :p_user_name',
        binds: { p_user_name: 'AIBRAHIM39' },
      });
      expect(issued(1)).toEqual({
        sql: 'SELECT * FROM XXHMC_SND_OTL_SUMMARY_V WHERE USER_NAME = :p_user_name AND TRUNC(START_TIME) BETWEEN :p_from AND :p_to',
        binds: { p_user_name: 'AIBRAHIM39', p_from: DATE(2026, 2, 1), p_to: DATE(2026, 10, 31) },
      });
    });

    it('EMP_TIME_PERIOD_V: USER_NAME, optional year, newest first', async () => {
      const { repository, issued } = make();
      await repository.getPeriods('aibrahim39');
      await repository.getPeriods('aibrahim39', 2026);
      expect(issued(0)).toEqual({
        sql: 'SELECT * FROM XXHMC_SND_OTL_EMP_TIME_PERIOD_V WHERE USER_NAME = :p_user_name ORDER BY START_DATE DESC',
        binds: { p_user_name: 'AIBRAHIM39' },
      });
      expect(issued(1).sql).toContain('AND EXTRACT(YEAR FROM START_DATE) = :p_year');
      expect(issued(1).binds).toEqual({ p_user_name: 'AIBRAHIM39', p_year: 2026 });
    });

    it('WORKLISTS_V recipient check uses the documented role predicate', async () => {
      const { repository, issued, query } = make([{ NOTIFICATION_ID: 123864402 }]);
      await expect(repository.isWorklistRecipient('123864402', 'aibrahim39')).resolves.toBe(true);
      expect(issued()).toEqual({
        sql:
          'SELECT notification_id FROM XXHMC_SND_WORKLISTS_V WHERE notification_id = :id ' +
          'AND ((recipient_role = :u AND more_info_role IS NULL) OR more_info_role = :u)',
        binds: { id: '123864402', u: 'AIBRAHIM39' },
      });
      query.mockResolvedValueOnce([]);
      await expect(repository.isWorklistRecipient('1', 'aibrahim39')).resolves.toBe(false);
    });

    it('global lookups: ELEMENT_V, FACILITY_V, and COST_CENTER_V by FACILITY_CODE', async () => {
      const { repository, issued } = make();
      await repository.getElements();
      await repository.getFacilities();
      await repository.getCostCenters('09');
      expect(issued(0).sql).toBe(
        'SELECT ELEMENT_TYPE_ID, ELEMENT_NAME FROM XXHMC_SND_OTL_ELEMENT_V ORDER BY ELEMENT_NAME',
      );
      expect(issued(1).sql).toBe(
        'SELECT FACILITY_CODE, DESCRIPTION, FACILITY FROM XXHMC_SND_OTL_FACILITY_V ORDER BY FACILITY_CODE',
      );
      expect(issued(2)).toEqual({
        sql:
          'SELECT FACILITY_CODE, COST_CENTER_CODE, COST_CENTER_DESCRIPTION, COST_CENTER FROM XXHMC_SND_OTL_COST_CENTER_V ' +
          'WHERE FACILITY_CODE = :p_facility_code ORDER BY COST_CENTER_CODE',
        binds: { p_facility_code: '09' },
      });
    });
  });

  describe('SUMMARY_V is INVALID on EBSDEV (B4)', () => {
    it('degrades ORA-04063 to an unavailable empty read plus a warning, instead of a 500', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const { repository, query } = make();
      query.mockRejectedValueOnce(
        new OracleQueryError('ORA-04063: view "APPS.XXHMC_SND_OTL_SUMMARY_V" has errors'),
      );
      await expect(repository.getSummary('aibrahim39')).resolves.toEqual({
        rows: [],
        available: false,
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[SCHEMA_MISMATCH]'));
      warn.mockRestore();
    });

    it('still propagates every other Oracle failure', async () => {
      const { repository, query } = make();
      const failure = new OracleQueryError('ORA-00942: table or view does not exist');
      query.mockRejectedValueOnce(failure);
      await expect(repository.getSummary('aibrahim39')).rejects.toBe(failure);
    });
  });

  /**
   * The submit runs through the real OracleService with a fake connection, so
   * the never-opened p_approval_chain cursor is handled exactly as in
   * production: fetched (or found null) before the connection is released.
   */
  describe('XXHMC_SND_TIMECARD_SUBMIT_PR', () => {
    function submitWith(outBinds: Record<string, unknown>) {
      const service = new OracleService(
        {
          getOrThrow: jest.fn().mockReturnValue({ callTimeout: 25000 }),
        } as unknown as ConfigService,
        new OracleLogStore(),
      );
      const execute = jest.fn().mockResolvedValue({ outBinds });
      const close = jest.fn().mockResolvedValue(undefined);
      service['pool'] = {
        getConnection: jest.fn().mockResolvedValue({ execute, close }),
      } as unknown as oracledb.Pool;
      for (const level of ['log', 'debug', 'warn', 'error'] as const) {
        jest.spyOn(service['logger'], level).mockImplementation(() => undefined);
      }
      const repository = new OtlOracleRepository(
        service,
        new OracleSchemaService(new OracleContractCatalog()),
      );
      const result = repository.submitTimecard({
        username: 'aibrahim39',
        period: 'July 2026',
        confirmationFlag: 'Y',
        language: 'EN',
        comments: 'July',
        entries: '{"p_user_name":"AIBRAHIM39"}',
      });
      return { result, execute, close };
    }

    afterEach(() => jest.restoreAllMocks());

    it('binds the CLOB and reads a NULL approval-chain cursor as []', async () => {
      const submittedDate = new Date('2026-08-02T06:15:00.000Z');
      const { result, execute, close } = submitWith({
        p_success_flag: 'S',
        p_error_msg: 'Success',
        p_reference_no: null,
        p_submitted_date: submittedDate,
        p_card_status: 'Submitted',
        p_approval_chain: null,
      });

      await expect(result).resolves.toMatchObject({
        successflag: 'S',
        status: 'success',
        result: {
          referenceNo: null,
          submittedDate: '2026-08-02T06:15:00.000Z',
          cardStatus: 'Submitted',
          approvalChain: [],
        },
      });
      const binds = execute.mock.calls[1][1] as Record<string, any>;
      expect(binds.p_entries).toEqual({
        type: oracledb.DB_TYPE_CLOB,
        val: '{"p_user_name":"AIBRAHIM39"}',
      });
      expect(binds.p_user_name).toBe('AIBRAHIM39');
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('treats an unopened cursor (NJS-107) as [] and maps Oracle E to N', async () => {
      const cursor = {
        getRows: jest.fn().mockRejectedValue(new Error('NJS-107: invalid cursor')),
        close: jest.fn().mockResolvedValue(undefined),
      };
      const { result } = submitWith({
        p_success_flag: 'E',
        p_error_msg: 'Partial records exists in timecard.',
        p_reference_no: null,
        p_submitted_date: new Date('2026-08-02T06:15:00.000Z'),
        p_card_status: 'Error',
        p_approval_chain: cursor,
      });

      await expect(result).resolves.toMatchObject({
        successflag: 'N',
        status: 'error',
        errormessage: 'Partial records exists in timecard.',
        result: { cardStatus: 'Error', approvalChain: [] },
      });
      expect(cursor.getRows).toHaveBeenCalled();
    });
  });
});
