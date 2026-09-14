import * as oracledb from 'oracledb';
import { validate } from 'class-validator';
import { BaseOracleRepository } from './base.repository';
import { OracleService } from './oracle.service';
import { OracleSchemaService } from './oracle-schema.service';
import { OracleMetadataService } from './oracle-metadata.service';
import { SchemaColumnNotFoundException } from './schema-column-not-found.error';
import { SchoolFeeOracleRepository } from '@modules/school-fees/infrastructure/oracle/school-fees.oracle.repository';
import { IdCardOracleRepository, QidOracleRepository } from '@modules/identity/infrastructure/oracle/identity.oracle.repository';
import { CompanyIdApplyRequestDto, QidUpdateRequestDto } from '@modules/identity/interface/dto/identity.dto';
import { PayslipOracleRepository } from '@modules/payslip/infrastructure/oracle/payslip.oracle.repository';
import { SupervisorOracleRepository } from '@modules/employee/infrastructure/oracle/employee.oracle.repository';
import { LeaveOracleRepository } from '@modules/leave/infrastructure/oracle/leave.oracle.repository';

describe('Documented Oracle calls without dictionary discovery', () => {
  function make() {
    const call = jest.fn().mockResolvedValue({ p_success_flag: 'S', p_error_msg: null });
    const callCursor = jest.fn().mockResolvedValue([{ PERIOD_NAME: 'September 2026' }]);
    const callMultiCursor = jest.fn().mockResolvedValue({
      cursors: { p_get_earnings: [{ AMOUNT: ' 100.00 ' }] },
      scalars: { p_success_flag: 'S', p_total_earnings: ' 100.00 ' },
    });
    const resolveParams = jest.fn().mockRejectedValue(new Error('Dictionary must not be queried'));
    return {
      ora: { call, callCursor, callMultiCursor } as unknown as OracleService,
      schema: { resolveParams } as unknown as OracleSchemaService,
      call,
      callCursor,
      callMultiCursor,
      resolveParams,
    };
  }

  function expectCall(sql: string, binds: Record<string, unknown>, object: string, names: string[]) {
    expect(sql).toContain(`BEGIN ${object}(`);
    expect(Object.keys(binds).sort()).toEqual([...names].sort());
    for (const name of names) expect(sql).toContain(`${name} => :${name}`);
  }

  describe('School-fee submission contract', () => {
    const fields = {
      p_academic_year: '2025-2026',
      p_acd_st_dt: '20250901',
      p_acd_end_dt: '20260630',
      p_child_name: 'Test Child||Female||01-JAN-15',
      p_child_date_birth: '20150101',
      p_school_name: 'Test School',
      p_educational_stage: 'Primary',
      p_request_type: 'Cash',
      p_term: 'Term1',
      p_amount: '1000',
    };

    it.each(['en', 'ar'] as const)('matches the supplied Oracle school-fee declaration for %s', async (lang) => {
      const { ora, schema, call, resolveParams } = make();
      call.mockResolvedValue({ p_success_flag: 'Y', p_error_msg: null, p_error_msg_ar: null });
      const result = await new SchoolFeeOracleRepository(ora, schema).apply({
        username: 'test.User',
        lang,
        fields: {
          ...fields,
          p_user_name: 'OTHER_USER',
          p_language: 'OTHER_LANGUAGE',
          p_file_name1: 'receipt.pdf',
          p_attachment1: Buffer.from('receipt').toString('base64'),
          p_file_name10: 'last.pdf',
          p_attachment10: Buffer.from('last').toString('base64'),
        },
      });

      const [sql, binds] = call.mock.calls[0];
      expectCall(sql, binds, 'XXHMC_SND_SCHOOL_FEE_PR', [
        'p_user_name', 'p_academic_year', 'p_acd_st_dt', 'p_acd_end_dt',
        'p_child_name', 'p_child_date_birth', 'p_passport_number', 'p_rp_number',
        'p_school_name', 'p_educational_stage', 'p_request_type', 'p_term',
        'p_amount', 'p_receipt_number', 'p_spouse_working', 'p_comments',
        ...Array.from({ length: 10 }, (_, i) => [`p_file_name${i + 1}`, `p_attachment${i + 1}`]).flat(),
        'p_success_flag', 'p_error_msg', 'p_error_msg_ar',
      ]);
      expect(binds).toMatchObject({
        ...fields,
        p_user_name: 'TEST.USER',
        p_acd_st_dt: { type: oracledb.DB_TYPE_DATE, val: new Date('2025-09-01T00:00:00.000Z') },
        p_acd_end_dt: { type: oracledb.DB_TYPE_DATE, val: new Date('2026-06-30T00:00:00.000Z') },
        p_amount: { type: oracledb.DB_TYPE_NUMBER, val: 1000 },
      });
      expect(binds.p_child_date_birth).toBe('20150101');
      expect(binds).not.toHaveProperty('p_language');
      expect(sql).not.toContain('p_language');
      expect(binds.p_attachment1).toEqual({ type: oracledb.DB_TYPE_BLOB, val: Buffer.from('receipt') });
      expect(binds.p_attachment10).toEqual({ type: oracledb.DB_TYPE_BLOB, val: Buffer.from('last') });
      for (let i = 2; i < 10; i++) {
        expect(binds[`p_file_name${i}`]).toBeNull();
        expect(binds[`p_attachment${i}`]).toEqual({ type: oracledb.DB_TYPE_BLOB, val: null });
      }
      for (const name of ['p_success_flag', 'p_error_msg', 'p_error_msg_ar']) {
        expect(binds[name]).toMatchObject({ dir: oracledb.BIND_OUT, type: oracledb.STRING });
      }
      expect(result).toMatchObject({ status: 'success', successflag: 'S' });
      expect(call).toHaveBeenCalledTimes(1);
      expect(resolveParams).not.toHaveBeenCalled();
    });

    it.each([
      ['20250901', '20260630'],
      ['2025-09-01', '2026-06-30'],
      ['01-Sep-2025', '30-Jun-2026'],
    ])('binds academic dates natively while keeping birth date textual: %s', async (start, end) => {
      const { ora, schema, call } = make();
      await new SchoolFeeOracleRepository(ora, schema).apply({
        username: 'TESTUSER', lang: 'en', fields: { ...fields, p_acd_st_dt: start, p_acd_end_dt: end },
      });
      const binds = call.mock.calls[0][1];
      expect(binds.p_acd_st_dt).toEqual({
        type: oracledb.DB_TYPE_DATE, val: new Date('2025-09-01T00:00:00.000Z'),
      });
      expect(binds.p_acd_end_dt).toEqual({
        type: oracledb.DB_TYPE_DATE, val: new Date('2026-06-30T00:00:00.000Z'),
      });
      expect(binds.p_child_date_birth).toBe(fields.p_child_date_birth);
    });

    it.each([
      ['123321', 123321],
      ['123.45', 123.45],
      [' 00100.50 ', 100.5],
      ['0', 0],
      ['1e3', 1000],
    ])('binds amount %s as an Oracle NUMBER', async (input, expected) => {
      const { ora, schema, call } = make();
      await new SchoolFeeOracleRepository(ora, schema).apply({
        username: 'TESTUSER', lang: 'en', fields: { ...fields, p_amount: input },
      });
      expect(call.mock.calls[0][1].p_amount).toEqual({ type: oracledb.DB_TYPE_NUMBER, val: expected });
    });

    it.each(['', '   ', 'not-a-number', 'Infinity', '0x10', '1e999', '9007199254740993'])(
      'rejects an invalid or unsupported amount before Oracle execution: %s',
      async (p_amount) => {
        const { ora, schema, call, resolveParams } = make();
        await expect(new SchoolFeeOracleRepository(ora, schema).apply({
          username: 'TESTUSER', lang: 'en', fields: { ...fields, p_amount },
        })).rejects.toMatchObject({ status: 400 });
        expect(call).not.toHaveBeenCalled();
        expect(resolveParams).not.toHaveBeenCalled();
      },
    );

    it('binds omitted school-fee optional fields as null', async () => {
      const { ora, schema, call } = make();
      await new SchoolFeeOracleRepository(ora, schema).apply({ username: 'TESTUSER', lang: 'en', fields });
      const binds = call.mock.calls[0][1];
      for (const name of ['p_passport_number', 'p_rp_number', 'p_receipt_number', 'p_spouse_working', 'p_comments']) {
        expect(binds[name]).toBeNull();
      }
      for (let i = 1; i <= 10; i++) {
        expect(binds[`p_attachment${i}`]).toEqual({ type: oracledb.DB_TYPE_BLOB, val: null });
      }
    });

    it('preserves school-fee business rejection without retrying', async () => {
      const { ora, schema, call, resolveParams } = make();
      call.mockResolvedValue({ p_success_flag: 'N', p_error_msg: 'A request is pending approval.' });
      const result = await new SchoolFeeOracleRepository(ora, schema).apply({
        username: 'TESTUSER', lang: 'en', fields,
      });
      expect(result).toMatchObject({
        status: 'error', successflag: 'N', errormessage: 'A request is pending approval.',
      });
      expect(call).toHaveBeenCalledTimes(1);
      expect(resolveParams).not.toHaveBeenCalled();
    });

    it('propagates school-fee execution errors without falling back to discovery', async () => {
      const { ora, schema, call, resolveParams } = make();
      const error = new Error('Oracle execution failed');
      call.mockRejectedValue(error);
      await expect(new SchoolFeeOracleRepository(ora, schema).apply({
        username: 'TESTUSER', lang: 'en', fields,
      })).rejects.toBe(error);
      expect(call).toHaveBeenCalledTimes(1);
      expect(resolveParams).not.toHaveBeenCalled();
    });
  });

  describe('QID update contract', () => {
    const fields = { p_qid_number: '12345678901', p_exp_date: '2029-10-16', p_qid_job: 'Analyst' };
    const validation = { whitelist: true, forbidNonWhitelisted: true };

    it.each([
      ['2025-10-17', '2029-10-16'],
      ['20251017', '20291016'],
      ['17-Oct-2025', '16-Oct-2029'],
    ])('binds two native dates and exactly eight attachment pairs: %s', async (issue, expiry) => {
      const { ora, schema, call, resolveParams } = make();
      call.mockResolvedValue({ p_success_flag: 'Y', p_error_msg: null, p_error_msg_ar: null });
      const result = await new QidOracleRepository(ora, schema).updateQid({
        username: 'test.User',
        lang: 'ar',
        fields: {
          ...fields,
          p_user_name: 'OTHER_USER',
          p_iss_date: issue,
          p_exp_date: expiry,
          p_file_name1: 'qid-front.jpg',
          p_attachment1: Buffer.from('front').toString('base64'),
          p_file_name8: 'last.jpg',
          p_attachment8: Buffer.from('last').toString('base64'),
        },
      });

      const [sql, binds] = call.mock.calls[0];
      expectCall(sql, binds, 'XXHMC_SND_QID_CHG_PR', [
        'p_user_name', 'p_qid_number', 'p_iss_date', 'p_exp_date', 'p_qid_job',
        ...Array.from({ length: 8 }, (_, i) => [`p_file_name${i + 1}`, `p_attachment${i + 1}`]).flat(),
        'p_success_flag', 'p_error_msg', 'p_error_msg_ar',
      ]);
      expect(binds.p_user_name).toBe('TEST.USER');
      expect(binds.p_iss_date).toEqual({
        type: oracledb.DB_TYPE_DATE, val: new Date('2025-10-17T00:00:00.000Z'),
      });
      expect(binds.p_exp_date).toEqual({
        type: oracledb.DB_TYPE_DATE, val: new Date('2029-10-16T00:00:00.000Z'),
      });
      expect(binds.p_attachment1).toEqual({ type: oracledb.DB_TYPE_BLOB, val: Buffer.from('front') });
      expect(binds.p_attachment8).toEqual({ type: oracledb.DB_TYPE_BLOB, val: Buffer.from('last') });
      for (let i = 2; i < 8; i++) {
        expect(binds[`p_file_name${i}`]).toBeNull();
        expect(binds[`p_attachment${i}`]).toEqual({ type: oracledb.DB_TYPE_BLOB, val: null });
      }
      for (const name of ['p_success_flag', 'p_error_msg', 'p_error_msg_ar']) {
        expect(binds[name]).toMatchObject({ dir: oracledb.BIND_OUT, type: oracledb.STRING });
      }
      expect(result).toMatchObject({ status: 'success', successflag: 'S' });
      expect(call).toHaveBeenCalledTimes(1);
      expect(resolveParams).not.toHaveBeenCalled();
    });

    it('binds an omitted optional issue date as a native DATE null', async () => {
      const { ora, schema, call } = make();
      await new QidOracleRepository(ora, schema).updateQid({ username: 'TESTUSER', lang: 'en', fields });
      expect(call.mock.calls[0][1].p_iss_date).toEqual({ type: oracledb.DB_TYPE_DATE, val: null });
    });

    it('preserves a business rejection without replaying the procedure', async () => {
      const { ora, schema, call, resolveParams } = make();
      call.mockResolvedValue({ p_success_flag: 'N', p_error_msg: 'A request is pending approval.' });
      const result = await new QidOracleRepository(ora, schema).updateQid({
        username: 'TESTUSER', lang: 'en', fields,
      });
      expect(result).toMatchObject({
        status: 'error', successflag: 'N', errormessage: 'A request is pending approval.',
      });
      expect(call).toHaveBeenCalledTimes(1);
      expect(resolveParams).not.toHaveBeenCalled();
    });

    it('propagates an execution error without retrying metadata discovery', async () => {
      const { ora, schema, call, resolveParams } = make();
      const error = new Error('Oracle execution failed');
      call.mockRejectedValue(error);
      await expect(new QidOracleRepository(ora, schema).updateQid({
        username: 'TESTUSER', lang: 'en', fields,
      })).rejects.toBe(error);
      expect(call).toHaveBeenCalledTimes(1);
      expect(resolveParams).not.toHaveBeenCalled();
    });

    it.each(['p_file_name9', 'p_attachment9', 'p_file_name10', 'p_attachment10'])(
      'rejects a non-empty unsupported %s instead of discarding it',
      async (field) => {
        const dto = Object.assign(new QidUpdateRequestDto(), { ...fields, [field]: 'not-empty' });
        const errors = await validate(dto, validation);
        expect(errors.map((error) => error.property)).toContain(field);
      },
    );

    it('accepts the eighth attachment and empty legacy slots 9 and 10', async () => {
      const dto = Object.assign(new QidUpdateRequestDto(), {
        ...fields,
        p_file_name8: 'last.jpg', p_attachment8: 'bGFzdA==',
        p_file_name9: null, p_attachment9: null, p_file_name10: '', p_attachment10: '',
      });
      await expect(validate(dto, validation)).resolves.toEqual([]);
    });

    it('leaves the company-ID ten-attachment contract unchanged', async () => {
      const dto = Object.assign(new CompanyIdApplyRequestDto(), {
        p_reason: 'Damaged', p_charge_for_new_id: 'No', p_delivery_loc: 'Test location',
        p_working_location: 'Others', p_file_name10: 'last.jpg', p_attachment10: 'bGFzdA==',
      });
      await expect(validate(dto, validation)).resolves.toEqual([]);
    });
  });

  it('calls the supplied ID-card contract with BLOB inputs and preserves business rejection', async () => {
    const { ora, schema, call, resolveParams } = make();
    const message = 'A Request is pending for approval.';
    call.mockResolvedValue({ p_success_flag: 'N', p_error_msg: message, p_error_msg_ar: null });
    const repo = new IdCardOracleRepository(ora, schema);
    const result = await repo.requestCompanyId({
      username: 'test.User',
      lang: 'ar',
      fields: {
        p_user_name: 'OTHER_USER',
        p_reason: 'Damaged',
        p_charge_for_new_id: 'No',
        p_delivery_loc: 'Test location',
        p_working_location: 'Others',
        p_comments: 'test',
        p_file_name1: 'proof.txt',
        p_attachment1: Buffer.from('proof').toString('base64'),
      },
    });

    const [sql, binds] = call.mock.calls[0];
    expectCall(sql, binds, 'XXHMC_SND_COID_REQ_PR', [
      'p_user_name', 'p_reason', 'p_charge_for_new_id', 'p_delivery_loc',
      'p_working_location', 'p_comments',
      ...Array.from({ length: 10 }, (_, i) => [`p_file_name${i + 1}`, `p_attachment${i + 1}`]).flat(),
      'p_success_flag', 'p_error_msg', 'p_error_msg_ar',
    ]);
    expect(binds.p_user_name).toBe('TEST.USER');
    expect(binds.p_attachment1).toEqual({ type: oracledb.DB_TYPE_BLOB, val: Buffer.from('proof') });
    for (let i = 2; i <= 10; i++) {
      expect(binds[`p_file_name${i}`]).toBeNull();
      expect(binds[`p_attachment${i}`]).toEqual({ type: oracledb.DB_TYPE_BLOB, val: null });
    }
    for (const name of ['p_success_flag', 'p_error_msg', 'p_error_msg_ar']) {
      expect(binds[name]).toMatchObject({ dir: oracledb.BIND_OUT, type: oracledb.STRING });
    }
    expect(result).toMatchObject({ status: 'error', successflag: 'N', errormessage: message });
    expect(call).toHaveBeenCalledTimes(1);
    expect(resolveParams).not.toHaveBeenCalled();
  });

  it.each(['supervisor', 'leave-cancel'] as const)('calls the confirmed %s submit directly', async (kind) => {
    const { ora, schema, call, resolveParams } = make();
    const cmd = {
      username: 'test.User',
      lang: 'en' as const,
      fields: {
        p_user_name: 'OTHER_USER',
        p_new_supervisor: 'SUPERVISOR',
        p_reason: 'Change',
        p_leave_type: 'Annual Leave',
        p_leave_to_cancel: 'leave-reference',
        p_reason_for_cancel: 'Change',
        p_attachment1: Buffer.from('proof').toString('base64'),
      },
    };
    const result = kind === 'supervisor'
      ? await new SupervisorOracleRepository(ora, schema).updateSupervisor(cmd)
      : await new LeaveOracleRepository(ora, schema).cancel(cmd);
    const [sql, binds] = call.mock.calls[0];
    expect(sql).toContain(kind === 'supervisor' ? 'XXHMC_SND_SUPERVISOR_PR(' : 'XXHMC_SND_HR_LEAV_CANCEL_PR(');
    expect(binds.p_user_name).toBe('TEST.USER');
    expect(binds.p_attachment1).toEqual({ type: oracledb.DB_TYPE_BLOB, val: Buffer.from('proof') });
    expect(binds).not.toHaveProperty('p_language');
    expect(binds).not.toHaveProperty('p_status');
    expect(binds).toHaveProperty('p_error_msg_ar');
    expect(result.successflag).toBe('S');
    expect(resolveParams).not.toHaveBeenCalled();
  });

  it.each(['periods', 'count'] as const)('calls payroll %s with all required OUT binds', async (kind) => {
    const { ora, schema, callCursor, resolveParams } = make();
    const repo = new PayslipOracleRepository(ora, schema);
    const result = kind === 'periods'
      ? await repo.getPeriods('test.User', 'ar')
      : await repo.checkCount('123', 'ar', 'September 2026');
    const [sql, binds, cursorName] = callCursor.mock.calls[0];
    const cursor = kind === 'periods' ? 'p_get_periods' : 'p_get_pay_assignment_details';
    expectCall(sql, binds, kind === 'periods' ? 'XXHMC_SND_GET_PAYSLIP_PERIODS' : 'XXHMC_SND_CHK_PAYROLL_CNT', [
      ...(kind === 'periods' ? ['p_user_name'] : ['p_person_id', 'p_period', 'p_flag']),
      cursor, 'p_success_flag', 'p_error_msg',
    ]);
    expect(cursorName).toBe(cursor);
    expect(binds[cursor]).toEqual({ dir: oracledb.BIND_OUT, type: oracledb.CURSOR });
    expect(binds.p_user_name ?? binds.p_person_id).toBe(kind === 'periods' ? 'TEST.USER' : '123');
    expect(kind === 'periods' ? result : (result as { rows: unknown[] }).rows).toEqual([
      { PERIOD_NAME: 'September 2026', used_value: 'September 2026' },
    ]);
    expect(resolveParams).not.toHaveBeenCalled();
  });

  it('calls payroll generation with its three inputs, seven cursors, and five scalar outputs', async () => {
    const { ora, schema, callMultiCursor, resolveParams } = make();
    const result = await new PayslipOracleRepository(ora, schema).generate({
      personId: '123', payPeriod: 'September 2026', assignmentId: '456', lang: 'en',
    });
    const cursors = [
      'p_get_earnings', 'p_get_deductions', 'p_get_totals', 'p_get_balances',
      'p_get_informations', 'p_get_net_payments', 'p_get_housing',
    ];
    const scalars = ['p_success_flag', 'p_error_msg', 'p_profile', 'p_total_earnings', 'p_total_deductions'];
    const [sql, binds, cursorNames] = callMultiCursor.mock.calls[0];
    expectCall(sql, binds, 'XXHMC_SND_PAYSLIP_PR', [
      'p_person_id', 'p_period', 'p_assignment_id', ...cursors, ...scalars,
    ]);
    expect(binds).toMatchObject({ p_person_id: '123', p_period: 'September 2026', p_assignment_id: '456' });
    expect(cursorNames).toEqual(cursors);
    for (const name of cursors) expect(binds[name]).toEqual({ dir: oracledb.BIND_OUT, type: oracledb.CURSOR });
    for (const name of scalars) expect(binds[name]).toMatchObject({ dir: oracledb.BIND_OUT, type: oracledb.STRING });
    expect(result.earnings).toEqual([{ AMOUNT: '100.00' }]);
    expect(result.totalEarnings).toBe('100.00');
    expect(resolveParams).not.toHaveBeenCalled();
  });
});

/** Minimal concrete subclass so the protected `toSubmitResult` can be tested
 * directly, without going through a real Oracle call. */
class TestRepository extends BaseOracleRepository {
  constructor(ora?: Partial<OracleService>, schema?: Partial<OracleSchemaService>) {
    super((ora ?? {}) as OracleService, schema as OracleSchemaService);
  }

  public expose(out: Record<string, any>) {
    return this.toSubmitResult(out);
  }

  public exposeReadIn(
    object: string,
    values: readonly (string | undefined)[],
    candidates: readonly string[],
  ) {
    return this.readByResolvedKeyIn(object, values, candidates);
  }

  public exposeTableFn(
    object: string,
    args: readonly unknown[],
    maxRows?: number,
    containsFilter?: { column: string; value: string },
  ) {
    return this.queryTableFunction(object, args, maxRows, containsFilter);
  }

  public exposeConfigured(kind: 'submit' | 'rows' | 'function' | 'multi') {
    const object = 'XXHMC_SND_TEST_PR';
    const params = ['p_user_name'];
    const values = { p_user_name: 'TESTUSER' };
    if (kind === 'submit') return this.callSubmitProc(object, params, values);
    if (kind === 'rows') return this.callRowsProc(object, params, values);
    if (kind === 'multi') return this.callMultiCursorProc(object, params, values, ['p_cursor']);
    return this.callRowsOrTableFunction(object, params, values);
  }
}

/**
 * XXHMC_SND_APPROVE_REJECT_PR returned `{ p_success_flag: null, p_error_msg:
 * null, p_error_msg_ar: null }` for a decision on an item that does not exist
 * (or was already actioned) — every OUT bind left unset instead of
 * `p_success_flag = 'N'` with an explanation. Before this fix that produced
 * the generic "Operation failed", indistinguishable from a real failure.
 */
describe('BaseOracleRepository.toSubmitResult', () => {
  const repo = new TestRepository();

  it('reports a specific message when every OUT bind is null (no signal at all)', () => {
    const result = repo.expose({
      p_success_flag: null,
      p_error_msg: null,
      p_error_msg_ar: null,
    });
    expect(result.status).toBe('error');
    expect(result.successflag).toBe('N');
    expect(result.errormessage).toBe(
      'No matching record was found for this request, or it has already been processed.',
    );
  });

  it('still reports the real message for an ordinary business-rule failure', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'Dependent does not exist',
      p_error_msg_ar: 'المعال غير موجود.',
    });
    expect(result.status).toBe('error');
    expect(result.errormessage).toBe('Dependent does not exist');
  });

  it('still reports success when the flag is S/Y', () => {
    const result = repo.expose({ p_success_flag: 'Y', p_error_msg: null });
    expect(result.status).toBe('success');
    expect(result.successflag).toBe('S');
    expect(result.errormessage).toBe('Success');
  });

  /**
   * `select`/`from`/`update` are ordinary English words: op 10's real
   * validation text (" 01-OCT-26 does not fall between 01-SEP-2025 to
   * 31-AUG-2026. Please select the correct Contractual Year") was suppressed to
   * the generic database-error message because the leak filter matched bare
   * `\bSELECT\b`. Business prose must pass through untouched.
   */
  it('returns validation prose containing SQL keywords as English words', () => {
    const prose =
      ' 01-OCT-26 does not fall between   01-SEP-2025 to 31-AUG-2026. ' +
      'Please select the correct Contractual Year';
    const result = repo.expose({ p_success_flag: 'N', p_error_msg: prose });
    expect(result.status).toBe('error');
    expect(result.errormessage).toBe(prose);
  });

  it.each(['p_message', 'p_error_msg', 'msg', 'errormessage'])(
    'returns the Oracle description from %s without the code or stack',
    (field) => {
      const result = repo.expose({
        p_success_flag: 'N',
        [field]: 'ORA-01403: no data found\nORA-06512: at "APPS.XXHMC_SND_TEST", line 12',
      });
      expect(result).toMatchObject({
        status: 'error',
        successflag: 'N',
        errormessage: 'no data found',
      });
    },
  );

  it('does not let a blank message hide the real Oracle error', () => {
    expect(repo.expose({
      p_success_flag: 'N',
      p_message: '  ',
      p_error_msg: 'ORA-01403: no data found',
    }).errormessage).toBe('no data found');
  });

  it('strips Oracle prefixes independently in the Arabic message', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'ORA-01403: no data found',
      p_error_msg_ar: encodeURIComponent('ORA-01403: المعال غير موجود.'),
    });
    expect(result.errormessage).toBe('no data found');
    expect(result.errormessageAr).toBe('المعال غير موجود.');
  });

  it('drops unsafe Arabic detail even when the English error is plain text', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'Dependent does not exist',
      p_error_msg_ar: 'ORA-20001: failure in XXHMC_SND_LEAV_PKG',
    });
    expect(result.errormessage).toBe('Dependent does not exist');
    expect(result.errormessageAr).toBeUndefined();
  });

  it('still suppresses genuinely technical proc messages', () => {
    for (const leak of [
      'error in XXHMC_SND_LEAV_OF_ABSEN_NEW_PR',
      'failed: SELECT NVL(days, 0) FROM absence_table WHERE id = :1',
    ]) {
      const result = repo.expose({ p_success_flag: 'N', p_error_msg: leak });
      expect(result.errormessage).toBe('The database request failed.');
    }
  });

  it('surfaces the human text of an ORA-20xxx business raise in p_error_msg', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'ORA-20001: Leave dates overlap an existing request ORA-06512: at line 12',
    });
    expect(result.errormessage).toBe('Leave dates overlap an existing request');
  });

  it('falls back to the generic business message when the raise text is itself technical', () => {
    const result = repo.expose({
      p_success_flag: 'N',
      p_error_msg: 'ORA-20001: failure in XXHMC_SND_LEAV_PKG ORA-06512: at line 12',
    });
    expect(result.errormessage).toBe('The requested operation cannot be completed.');
  });
});

/**
 * readByResolvedKeyIn fetches child rows keyed by IDs gathered from a parent
 * view (profile: DEP_PHONE_V by the EMP_CONTACT_V dependents' DEPENDENT_ID,
 * DEP_ADDRESS_V by their ADDRESS_ID).
 */
describe('BaseOracleRepository.readByResolvedKeyIn', () => {
  const makeRepo = (rows: Record<string, any>[] = []) => {
    const query = jest.fn().mockResolvedValue(rows);
    const resolveKeyColumn = jest.fn().mockResolvedValue('DEPENDENT_ID');
    const repo = new TestRepository({ query } as any, { resolveKeyColumn } as any);
    return { repo, query, resolveKeyColumn };
  };

  it('binds each distinct id and filters with IN on the resolved column', async () => {
    const { repo, query } = makeRepo([{ PHONE_ID: '1' }]);
    const rows = await repo.exposeReadIn('XXHMC_SND_DEP_PHONE_V', ['11', '22', '11'], [
      'dependent_id',
    ]);
    expect(rows).toEqual([{ PHONE_ID: '1' }]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM XXHMC_SND_DEP_PHONE_V WHERE DEPENDENT_ID IN (:k0, :k1)',
      { k0: '11', k1: '22' },
    );
  });

  it('skips the round trip entirely when no usable id exists', async () => {
    const { repo, query, resolveKeyColumn } = makeRepo();
    const rows = await repo.exposeReadIn('XXHMC_SND_DEP_PHONE_V', [undefined, ''], [
      'dependent_id',
    ]);
    expect(rows).toEqual([]);
    expect(resolveKeyColumn).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });

  it('degrades to an empty result on a schema mismatch (like readByResolvedKey)', async () => {
    const query = jest.fn();
    const resolveKeyColumn = jest
      .fn()
      .mockRejectedValue(
        new SchemaColumnNotFoundException('XXHMC_SND_DEP_PHONE_V', ['dependent_id'], ['OTHER']),
      );
    const repo = new TestRepository({ query } as any, { resolveKeyColumn } as any);
    await expect(
      repo.exposeReadIn('XXHMC_SND_DEP_PHONE_V', ['11'], ['dependent_id']),
    ).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('chunks past the 1000-item Oracle IN-list limit', async () => {
    const { repo, query } = makeRepo([]);
    const ids = Array.from({ length: 1001 }, (_, i) => String(i));
    await repo.exposeReadIn('XXHMC_SND_DEP_PHONE_V', ids, ['dependent_id']);
    expect(query).toHaveBeenCalledTimes(2);
    expect((query.mock.calls[1][0] as string)).toContain('IN (:k0)');
  });
});

/**
 * queryTableFunction's containsFilter backs the supervisor-view search
 * (GET /employee/supervisor/views?searchKeyWord=): the filter must sit in the
 * same WHERE as the ROWNUM cap so it applies to the full row set (31k+ rows on
 * staging), not just the first `maxRows` fetched.
 */
describe('BaseOracleRepository.queryTableFunction containsFilter', () => {
  const makeRepo = () => {
    const query = jest.fn().mockResolvedValue([]);
    const repo = new TestRepository({ query } as any);
    return { repo, query };
  };

  it('adds a bound case-insensitive LIKE before the ROWNUM cap', async () => {
    const { repo, query } = makeRepo();
    await repo.exposeTableFn('XXHMC_SND_SUPERVISOR_VIEW', ['V-TEST', null], undefined, {
      column: 'FULL_NAME',
      value: ' hajar ',
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM TABLE(XXHMC_SND_SUPERVISOR_VIEW(:arg0, :arg1)) ' +
        'WHERE UPPER(FULL_NAME) LIKE :filterValue AND ROWNUM <= :maxRows',
      { maxRows: 2000, arg0: 'V-TEST', arg1: null, filterValue: '%HAJAR%' },
    );
  });

  it('keeps the plain ROWNUM-only query when no filter (or a blank one) is given', async () => {
    const { repo, query } = makeRepo();
    await repo.exposeTableFn('XXHMC_SND_SUPERVISOR_VIEW', ['V-TEST', null], undefined, {
      column: 'FULL_NAME',
      value: '   ',
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT * FROM TABLE(XXHMC_SND_SUPERVISOR_VIEW(:arg0, :arg1)) WHERE ROWNUM <= :maxRows',
      { maxRows: 2000, arg0: 'V-TEST', arg1: null },
    );
  });
});

describe('SchoolFeeOracleRepository.getChildren', () => {
  const input = { employeeNumber: 'test.User', academicYearStartDate: '20250901', lang: 'en' as const };
  const sql =
    'SELECT * FROM TABLE(XXHMC_SND_CHILD_DETS_VIEW(:arg0, :arg1)) WHERE ROWNUM <= :maxRows';
  const binds = { maxRows: 2000, arg0: '20250901', arg1: 'TEST.USER' };

  function make() {
    const rows = [{ CHILD_ID: 101, USER_NAME: 'TEST.USER', EXTRA: 'preserved' }];
    const query = jest.fn().mockResolvedValue(rows);
    const callCursor = jest.fn().mockResolvedValue([]);
    const schema = {
      resolveParams: jest.fn().mockResolvedValue(undefined),
      resolveSignature: jest.fn().mockResolvedValue(undefined),
      resolveKeyColumn: jest.fn().mockResolvedValue('USER_NAME'),
    };
    const repo = new SchoolFeeOracleRepository(
      { query, callCursor } as unknown as OracleService,
      schema as unknown as OracleSchemaService,
    );
    return { repo, query, callCursor, schema, rows };
  }

  it.each(['en', 'ar'] as const)('uses the confirmed positional function call for %s', async (lang) => {
    const { repo, query, callCursor, schema, rows } = make();

    await expect(repo.getChildren({ ...input, lang })).resolves.toBe(rows);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(sql, binds);
    expect(callCursor).not.toHaveBeenCalled();
    expect(schema.resolveParams).not.toHaveBeenCalled();
    expect(schema.resolveSignature).not.toHaveBeenCalled();
  });

  it.each(['empty', 'unavailable', 'stale'])('does not depend on %s metadata', async (state) => {
    const { repo, query, callCursor, schema } = make();
    if (state === 'unavailable') {
      schema.resolveParams.mockRejectedValue(new Error('Metadata unavailable'));
    } else if (state === 'empty') {
      schema.resolveParams.mockResolvedValue(null);
    } else {
      schema.resolveParams.mockResolvedValue([
        { name: 'p_cursor', direction: 'OUT', dataType: 'REF CURSOR', defaulted: false },
      ]);
      schema.resolveSignature.mockResolvedValue({ params: [] });
    }

    await repo.getChildren(input);

    expect(query).toHaveBeenCalledWith(sql, binds);
    expect(callCursor).not.toHaveBeenCalled();
    expect(schema.resolveParams).not.toHaveBeenCalled();
    expect(schema.resolveSignature).not.toHaveBeenCalled();
    expect(schema.resolveKeyColumn).not.toHaveBeenCalled();
  });

  it('preserves an empty result', async () => {
    const { repo, query } = make();
    query.mockResolvedValue([]);

    await expect(repo.getChildren(input)).resolves.toEqual([]);
  });

  it('propagates query errors without retrying as a procedure', async () => {
    const { repo, query, callCursor } = make();
    const error = new Error('Oracle query failed');
    query.mockRejectedValue(error);

    await expect(repo.getChildren(input)).rejects.toBe(error);
    expect(query).toHaveBeenCalledTimes(1);
    expect(callCursor).not.toHaveBeenCalled();
  });
});

describe('BaseOracleRepository static contract requirements', () => {
  const kinds = ['submit', 'rows', 'function', 'multi'] as const;

  function make(schema?: Partial<OracleSchemaService>) {
    const ora = {
      call: jest.fn().mockResolvedValue({ p_success_flag: 'S' }),
      callCursor: jest.fn().mockResolvedValue([]),
      callMultiCursor: jest.fn().mockResolvedValue({ cursors: {}, scalars: {} }),
      query: jest.fn().mockResolvedValue([]),
    };
    return { ora, repo: new TestRepository(ora, schema) };
  }

  function expectNoSql(ora: ReturnType<typeof make>['ora']) {
    for (const method of Object.values(ora)) expect(method).not.toHaveBeenCalled();
  }

  describe.each(kinds)('%s', (kind) => {
    it.each([undefined, null, []])('rejects a missing or empty contract: %s', async (params) => {
      const { repo, ora } = make({
        resolveParams: jest.fn().mockResolvedValue(params),
        resolveSignature: jest.fn().mockResolvedValue(undefined),
      });
      await expect(repo.exposeConfigured(kind)).rejects.toMatchObject({ status: 503 });
      expectNoSql(ora);
    });

    it('rejects a missing contract resolver rather than using documented guesses', async () => {
      const { repo, ora } = make();
      await expect(repo.exposeConfigured(kind)).rejects.toMatchObject({ status: 503 });
      expectNoSql(ora);
    });
  });

  it.each(['rows', 'multi'] as const)('rejects a %s contract with no cursor', async (kind) => {
    const { repo, ora } = make({
      resolveParams: jest.fn().mockResolvedValue([
        { name: 'p_user_name', direction: 'IN', dataType: 'VARCHAR2', defaulted: false },
      ]),
    });
    await expect(repo.exposeConfigured(kind)).rejects.toMatchObject({ status: 503 });
    expectNoSql(ora);
  });

  it('does not read only the last cursor from a multi-cursor contract', async () => {
    const { repo, ora } = make({
      resolveParams: jest.fn().mockResolvedValue(['p_first', 'p_second'].map((name) => ({
        name, direction: 'OUT', dataType: 'REF CURSOR', defaulted: false,
      }))),
    });
    await expect(repo.exposeConfigured('rows')).rejects.toMatchObject({ status: 503 });
    expectNoSql(ora);
  });
});

describe('BaseOracleRepository metadata failures', () => {
  it.each(['submit', 'rows', 'function'] as const)(
    'does not execute guessed SQL for %s after signature discovery fails',
    async (kind) => {
      const error = new Error('Signature discovery failed');
      const describeArguments = jest.fn().mockRejectedValue(error);
      const schema = new OracleSchemaService({ describeArguments } as unknown as OracleMetadataService);
      const ora = {
        call: jest.fn().mockResolvedValue({ p_success_flag: 'S' }),
        callCursor: jest.fn().mockResolvedValue([]),
        query: jest.fn().mockResolvedValue([]),
      };
      const repo = new TestRepository(ora, schema);

      for (let attempt = 1; attempt <= 2; attempt++) {
        await expect(repo.exposeConfigured(kind)).rejects.toBe(error);
        expect(describeArguments).toHaveBeenCalledTimes(attempt);
      }
      expect(ora.call).not.toHaveBeenCalled();
      expect(ora.callCursor).not.toHaveBeenCalled();
      expect(ora.query).not.toHaveBeenCalled();
    },
  );

  it('does not read a view with an assumed key after column discovery fails', async () => {
    const error = new Error('Column discovery failed');
    const describeColumns = jest.fn().mockRejectedValueOnce(error).mockResolvedValue([
      { name: 'PERSON_ID', dataType: 'NUMBER', nullable: false, position: 1 },
    ]);
    const schema = new OracleSchemaService({ describeColumns } as unknown as OracleMetadataService);
    const query = jest.fn().mockResolvedValue([]);
    const repo = new TestRepository({ query }, schema);

    await expect(repo.exposeReadIn('TEST_VIEW', ['1'], ['person_id'])).rejects.toBe(error);
    expect(query).not.toHaveBeenCalled();

    await expect(repo.exposeReadIn('TEST_VIEW', ['1'], ['person_id'])).resolves.toEqual([]);
    expect(describeColumns).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith('SELECT * FROM TEST_VIEW WHERE person_id IN (:k0)', { k0: '1' });
  });
});
