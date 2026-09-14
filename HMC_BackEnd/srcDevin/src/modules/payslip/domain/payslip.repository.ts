import { Lang } from '@shared/domain/lang';

export interface PayslipPeriod {
  period: string;
  [extra: string]: unknown;
}

/**
 * CHK_PAYROLL_CNT returns its assignment details through a REF CURSOR whose
 * rows are (PERIOD_NAME, PERIOD_NAME_AR, ASSIGNMENT_ACTION_ID); the *_AR twin
 * is collapsed into PERIOD_NAME per `lang` by the ResponseInterceptor.
 */
export interface PayslipCount {
  count: number;
  rows: Record<string, unknown>[];
}

/**
 * PAYSLIP_PR's confirmed signature returns the payslip as 7 separate row sets
 * (not a file) plus a handful of summary scalars:
 *   xxhmc_snd_payslip_pr(p_person_id IN, p_period IN, p_assignment_id IN,
 *     p_get_earnings OUT SYS_REFCURSOR, p_get_deductions OUT SYS_REFCURSOR,
 *     p_get_totals OUT SYS_REFCURSOR, p_get_balances OUT SYS_REFCURSOR,
 *     p_get_informations OUT SYS_REFCURSOR, p_get_net_payments OUT SYS_REFCURSOR,
 *     p_get_housing OUT SYS_REFCURSOR, p_success_flag OUT, p_error_msg OUT,
 *     p_profile OUT, p_total_earnings OUT, p_total_deductions OUT)
 */
export interface PayslipDocument {
  earnings: Record<string, unknown>[];
  deductions: Record<string, unknown>[];
  totals: Record<string, unknown>[];
  balances: Record<string, unknown>[];
  informations: Record<string, unknown>[];
  netPayments: Record<string, unknown>[];
  housing: Record<string, unknown>[];
  profile?: string;
  totalEarnings?: string;
  totalDeductions?: string;
  successFlag?: string;
  errorMessage?: string;
}

export interface GeneratePayslipQuery {
  personId: string;
  lang: Lang;
  payPeriod: string;
  assignmentId: string;
}

/** Port: payslip periods (5), count (6), generate (11). All Oracle procs/functions. */
export interface PayslipRepository {
  getPeriods(username: string, lang: Lang): Promise<PayslipPeriod[]>;
  checkCount(personId: string, lang: Lang, payslipPeriod: string): Promise<PayslipCount>;
  generate(query: GeneratePayslipQuery): Promise<PayslipDocument>;
}

export const PAYSLIP_REPOSITORY = Symbol('PAYSLIP_REPOSITORY');
