/**
 * Real successful `result` payloads captured from api_test_work.json, used as
 * Swagger examples. These are the inner `result` values; the ResponseInterceptor
 * wraps them in the Sanaad success envelope.
 */

/** op 5 — GET /payslip/periods?username=&lang= */
export const PAYSLIP_PERIODS_EXAMPLE = [
  { PERIOD_NAME: 'January 2026', TIT: 4061, PERSON_ID: 26023, START_DATE: '2026-01-01T00:00:00.000Z' },
  { PERIOD_NAME: 'December 2025', TIT: 1960, PERSON_ID: 26023, START_DATE: '2025-12-01T00:00:00.000Z' },
  { PERIOD_NAME: 'November 2025', TIT: 1959, PERSON_ID: 26023, START_DATE: '2025-11-01T00:00:00.000Z' },
  { PERIOD_NAME: 'October 2025', TIT: 1958, PERSON_ID: 26023, START_DATE: '2025-10-01T00:00:00.000Z' },
];

/** op 6 — GET /payslip/count?person_id=&lang=&payslipperiod= */
export const PAYSLIP_COUNT_EXAMPLE = {
  count: 1,
  rows: [{ PERIOD_NAME: 'August 2023', ASSIGNMENT_ACTION_ID: 45178342 }],
};

/**
 * op 11 — GET /payslip?person_id=&lang=&payperiod=&assignmentid=
 * Numeric display values arrive from PAYSLIP_PR LPAD-padded for the legacy
 * report layout; the repository trims them before the response (client
 * request 2026-08-24), so this example shows the trimmed wire form.
 */
export const PAYSLIP_GENERATE_EXAMPLE = {
  earnings: [
    { REPORT_NAME: 'Basic Salary', VALUES1: '16,738.00' },
    { REPORT_NAME: 'Car Loan Government Payment', VALUES1: '0.00' },
    { REPORT_NAME: 'Cost Of Living Loan Payment', VALUES1: '0.00' },
    { REPORT_NAME: 'Government Professional Allowance', VALUES1: '4,184.00' },
    { REPORT_NAME: 'Housing Allowance', VALUES1: '4,000.00' },
    { REPORT_NAME: 'Phone Allowance', VALUES1: '50.00' },
    { REPORT_NAME: 'Social Allowance', VALUES1: '6,400.00' },
    { REPORT_NAME: 'Transportation Allowance', VALUES1: '1,500.00' },
  ],
  deductions: [
    { REPORTING_NAME_DED: 'Absent Hours Deduction', VALUES2: '0.00' },
    { REPORTING_NAME_DED: 'Car Loan Government Recover', VALUES2: '1,044.00' },
    { REPORTING_NAME_DED: 'Cost Of Living Loan Recover', VALUES2: '1,345.00' },
    { REPORTING_NAME_DED: 'Leave Advance Deduction', VALUES2: '0.00' },
    { REPORTING_NAME_DED: 'Pension Employee Contribution', VALUES2: '1,900.00' },
  ],
  totals: [
    {
      DED_TOT: '4,289.00',
      EAR_TOT: '32,872.00',
      GROSS_PAY: '32,872.00',
      NETPAY: '28,583.00',
    },
  ],
  balances: [
    { BALANCE_NAME: 'Annual Leave Balance', AMOUNT: '54.00' },
    { BALANCE_NAME: 'Car Loan Government Repayment', AMOUNT: '4,178.00' },
    { BALANCE_NAME: 'Cost Of Living Loan Repayment', AMOUNT: '67,240.00' },
  ],
  informations: [],
  netPayments: [
    {
      PAY_DATE: '18-Jan-2024',
      NETPAY: '28,583.00',
      BANK_NAME: 'Qatar International Islamic Bank',
      BANK_BRANCH: 'SALWA BR.',
      ACCOUNT_NUMBER: 'QA95QIIB000000007773453923001',
      PAYMENT_METHOD: 'Bank Transfer',
    },
  ],
  housing: [{ AID: 7179444713, ENDDATE: '31 December 4712' }],
  profile: 'No',
  totalEarnings: '32,872.00',
  totalDeductions: '4,289.00',
  successFlag: 'S',
  errorMessage: 'Success',
};
