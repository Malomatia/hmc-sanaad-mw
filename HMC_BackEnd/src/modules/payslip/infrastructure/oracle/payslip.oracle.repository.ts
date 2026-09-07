import { Injectable } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { sanitizeOracleMessage } from '@core/http/error-category';
import { Lang, toOracleLanguage } from '@shared/domain/lang';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import {
  GeneratePayslipQuery,
  PayslipCount,
  PayslipDocument,
  PayslipPeriod,
  PayslipRepository,
} from '../../domain/payslip.repository';

/**
 * GET_PAYSLIP_PERIODS confirmed signature:
 *   (p_user_name IN, p_get_periods OUT sys_refcursor,
 *    p_success_flag OUT, p_error_msg OUT)
 * It is keyed by the caller's login (`p_user_name`), takes no language, and
 * declares two scalar OUT params besides the cursor — omitting them raised
 * PLS-00306 (see BaseOracleRepository.callRowsProc). The cursor OUT parameter is
 * `p_get_periods` (used only when the data dictionary is unreadable).
 */
const PERIODS_PARAMS = ['user_name'] as const;

/**
 * CHK_PAYROLL_CNT confirmed signature (client's proc-call sample — no language):
 *   xxhmc_snd_chk_payroll_cnt(p_person_id IN, p_period IN,
 *     p_get_pay_assignment_details OUT SYS_REFCURSOR,
 *     p_flag OUT, p_success_flag OUT, p_error_msg OUT)
 * Cursor rows: (PERIOD_NAME, PERIOD_NAME_AR, ASSIGNMENT_ACTION_ID).
 */
const COUNT_PARAMS = ['person_id', 'period'] as const;

/**
 * PAYSLIP_PR confirmed signature (there is NO p_language):
 *   xxhmc_snd_payslip_pr(p_person_id IN NUMBER, p_period IN VARCHAR2,
 *     p_assignment_id IN NUMBER, p_get_earnings OUT SYS_REFCURSOR,
 *     p_get_deductions OUT SYS_REFCURSOR, p_get_totals OUT SYS_REFCURSOR,
 *     p_get_balances OUT SYS_REFCURSOR, p_get_informations OUT SYS_REFCURSOR,
 *     p_get_net_payments OUT SYS_REFCURSOR, p_get_housing OUT SYS_REFCURSOR,
 *     p_success_flag OUT VARCHAR2, p_error_msg OUT VARCHAR2,
 *     p_profile OUT VARCHAR2, p_total_earnings OUT VARCHAR2,
 *     p_total_deductions OUT VARCHAR2)
 * It returns the payslip as 7 separate REF CURSORs, not one row set — binding
 * all of them but reading only one back (the old `callRowsProc` shape) raised
 * `NJS-107: invalid cursor` / `ORA-24338`. See BaseOracleRepository.callMultiCursorProc.
 */
const GENERATE_PARAMS = ['person_id', 'period', 'assignment_id'] as const;
const GENERATE_CURSOR_PARAMS = [
  'p_get_earnings',
  'p_get_deductions',
  'p_get_totals',
  'p_get_balances',
  'p_get_informations',
  'p_get_net_payments',
  'p_get_housing',
] as const;
const GENERATE_SCALAR_OUT_PARAMS = [
  'p_success_flag',
  'p_error_msg',
  'p_profile',
  'p_total_earnings',
  'p_total_deductions',
] as const;

/**
 * PAYSLIP_PR renders its numeric display values LPAD-padded for the legacy
 * report layout ("      18,900.00"). Trim leading/trailing whitespace from
 * every string — interior spaces (e.g. "Basic Salary") are kept.
 */
const trimValue = (v: unknown): unknown => (typeof v === 'string' ? v.trim() : v);
const trimRows = (rows?: Record<string, unknown>[]): Record<string, unknown>[] =>
  (rows ?? []).map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, trimValue(v)])),
  );

/**
 * Add `used_value`: the period name to send BACK, whatever the display language.
 *
 * These cursors carry `PERIOD_NAME` plus its Arabic twin, and the
 * ResponseInterceptor collapses the pair — so with `lang=ar` the `PERIOD_NAME`
 * field itself holds `يناير  2026`. A client that echoes what it displayed then
 * sends Arabic into `payperiod`/`payslipperiod`, and the procedures only match
 * the canonical English name.
 *
 * Capturing it here, before localization runs, gives the client one stable
 * value it can always return — the same `used_value` contract the LOV endpoints
 * already use.
 */
function withPeriodValue<T extends Record<string, unknown>>(row: T): T {
  const period = row.PERIOD_NAME ?? row.period;
  return typeof period === 'string' ? { ...row, used_value: period.trim() } : row;
}

/**
 * Payroll is served by Oracle program units (GET_PAYSLIP_PERIODS,
 * CHK_PAYROLL_CNT, PAYSLIP_PR) that return their rows through a REF CURSOR.
 *
 * The mapping documents the inputs of the legacy services but not the formal
 * parameter names, so the calls are built from the declared signature when the
 * data dictionary is readable (see BaseOracleRepository) and fall back to the
 * documented names otherwise; `pick` tolerates the `p_` prefix either way.
 */
@Injectable()
export class PayslipOracleRepository extends BaseOracleRepository implements PayslipRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async getPeriods(username: string, lang: Lang): Promise<PayslipPeriod[]> {
    const rows = await this.callRowsProc<PayslipPeriod>(
      ORACLE_OBJECTS.GET_PAYSLIP_PERIODS,
      PERIODS_PARAMS,
      {
        user_name: username,
        language: toOracleLanguage(lang),
      },
      'p_get_periods',
    );
    return rows.map(withPeriodValue);
  }

  async checkCount(
    personId: string,
    lang: Lang,
    payslipPeriod: string,
  ): Promise<PayslipCount> {
    const rows = await this.callRowsProc<Record<string, unknown>>(
      ORACLE_OBJECTS.CHK_PAYROLL_CNT,
      COUNT_PARAMS,
      {
        person_id: personId,
        period: payslipPeriod,
      },
      'p_get_pay_assignment_details',
    );
    return { count: rows.length, rows: rows.map(withPeriodValue) };
  }

  async generate(query: GeneratePayslipQuery): Promise<PayslipDocument> {
    const { cursors, scalars } = await this.callMultiCursorProc(
      ORACLE_OBJECTS.PAYSLIP_PR,
      GENERATE_PARAMS,
      {
        person_id: query.personId,
        period: query.payPeriod,
        assignment_id: query.assignmentId,
      },
      GENERATE_CURSOR_PARAMS,
      GENERATE_SCALAR_OUT_PARAMS,
    );
    return {
      earnings: trimRows(cursors.p_get_earnings),
      deductions: trimRows(cursors.p_get_deductions),
      totals: trimRows(cursors.p_get_totals),
      balances: trimRows(cursors.p_get_balances),
      informations: trimRows(cursors.p_get_informations),
      netPayments: trimRows(cursors.p_get_net_payments),
      housing: trimRows(cursors.p_get_housing),
      profile: trimValue(scalars.p_profile) as string,
      totalEarnings: trimValue(scalars.p_total_earnings) as string,
      totalDeductions: trimValue(scalars.p_total_deductions) as string,
      successFlag: scalars.p_success_flag,
      errorMessage: trimValue(sanitizeOracleMessage(scalars.p_error_msg)) as string,
    };
  }
}
