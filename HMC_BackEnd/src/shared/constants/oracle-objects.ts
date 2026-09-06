/**
 * Central registry of the 95 Oracle `XXHMC_SND_*` objects the backend calls
 * (the "data contract"). Repositories MUST reference names from here — never
 * hard-code table/view/procedure identifiers (OCP + SQL-injection allow-list).
 *
 * Source: Docs_Ai/Database/README.md + Docs_Ai/operation-inventory.md.
 */

export const ORACLE_PREFIX = 'XXHMC_SND_' as const;

const o = (name: string) => `${ORACLE_PREFIX}${name}`;

export const ORACLE_OBJECTS = {
  // ── Views (_V) ────────────────────────────────────────────
  ABSENCE_REASON_V: o('ABSENCE_REASON_V'),
  ABSENCE_TYPE_V: o('ABSENCE_TYPE_V'),
  ABSENCE_V: o('ABSENCE_V'),
  ACTION_HISTORY_V: o('ACTION_HISTORY_V'),
  APPROVE_SUMRY_V: o('APPROVE_SUMRY_V'),
  BEREAV_RELAT_V: o('BEREAV_RELAT_V'),
  // Ticket-cancellation inputs (op 72). All three are PERSON-scoped.
  CANCEL_TICKETS_V: o('CANCEL_TICKETS_V'),
  CANCEL_TAKENAS_V: o('CANCEL_TAKENAS_V'),
  CANCEL_REPAYMENT_METHODS_V: o('CANCEL_REPAYMENT_METHODS_V'),
  CHILD_DETS_VIEW: o('CHILD_DETS_VIEW'),
  CONTRACT_YEARS_V: o('CONTRACT_YEARS_V'),
  DELIVERY_LOC_V: o('DELIVERY_LOC_V'),
  DEP_ADDRESS_V: o('DEP_ADDRESS_V'),
  DEP_PHONE_V: o('DEP_PHONE_V'),
  EMP_CONTACT_V: o('EMP_CONTACT_V'),
  EMP_IN_ADDRESS_V: o('EMP_IN_ADDRESS_V'),
  EMP_OUT_ADDRESS_V: o('EMP_OUT_ADDRESS_V'),
  EMP_PHONE_V: o('EMP_PHONE_V'),
  EMPLOYMENT_DETAILS_V: o('EMPLOYMENT_DETAILS_V'),
  EMPLOYMENT_V: o('EMPLOYMENT_V'),
  EXAM_CENTRE_V: o('EXAM_CENTRE_V'),
  LEAV_CLASS_V: o('LEAV_CLASS_V'),
  LEAVE_AMEND_V: o('LEAVE_AMEND_V'),
  ABSENCE_AMEND_TYPE_V: o('ABSENCE_AMEND_TYPE_V'),
  LEAVE_CANCEL_V: o('LEAVE_CANCEL_V'),
  LEAVE_TYPE_V: o('LEAVE_TYPE_V'),
  MY_REQEST_SUMMARY_V: o('MY_REQEST_SUMMARY_V'),
  NOTYFY_APPR_V: o('NOTYFY_APPR_V'),
  NUM_OF_CHILD_V: o('NUM_OF_CHILD_V'),
  PERFORMANCE_V: o('PERFORMANCE_V'),
  PERSONAL_DETAILS_V: o('PERSONAL_DETAILS_V'),
  PND_DEPENDENT_ADDR_V: o('PND_DEPENDENT_ADDR_V'),
  DEPENDENT_ADDR_V: o('DEPENDENT_ADDR_V'),
  PHONE_TYPE_V: o('PHONE_TYPE_V'),
  PNDNG_QID_V: o('PNDNG_QID_V'),

  /**
   * Per-request DETAIL views. An approvals/my-requests row carries the name of
   * the view holding its own payload in `SERVICE_VIEW`: the summary describes
   * the request, these hold what the employee actually submitted, keyed by
   * `ITEM_KEY`. Matched against `REQUEST_DETAIL_VIEWS` before use, so a row can
   * never point us at an arbitrary object.
   */
  PNDNG_BANK_V: o('PNDNG_BANK_V'),
  PNDNG_COID_V: o('PNDNG_COID_V'),
  PNDNG_EXT_PERMIT_V: o('PNDNG_EXT_PERMIT_V'),
  PNDNG_HR_LETTER_V: o('PNDNG_HR_LETTER_V'),
  PNDNG_LEAVE_V: o('PNDNG_LEAVE_V'),
  PNDNG_LEAV_AMEND_V: o('PNDNG_LEAV_AMEND_V'),
  PNDNG_LEAV_CNCL_V: o('PNDNG_LEAV_CNCL_V'),
  PNDNG_PASS_DTL_V: o('PNDNG_PASS_DTL_V'),
  PNDNG_RET_FRM_LV_V: o('PNDNG_RET_FRM_LV_V'),
  PNDNG_SCHOO_FEE_V: o('PNDNG_SCHOO_FEE_V'),
  PNDNG_SUPERVISOR_V: o('PNDNG_SUPERVISOR_V'),
  PNDNG_UPD_PERSON_V: o('PNDNG_UPD_PERSON_V'),
  PND_DEPENDENT_PHN_V: o('PND_DEPENDENT_PHN_V'),
  PND_DEPENDENT_V: o('PND_DEPENDENT_V'),
  PND_REMOV_DEPNT_V: o('PND_REMOV_DEPNT_V'),

  /** Files attached to a request (FILE_DATA is the BLOB), keyed by ITEM_KEY. */
  HR_ATTACHMENTS_V: o('HR_ATTACHMENTS_V'),
  QID_DET_V: o('QID_DET_V'),
  RFL_LEAVE_DET_V: o('RFL_LEAVE_DET_V'),
  RFL_REL_LEAVE1_V: o('RFL_REL_LEAVE1_V'),
  RFL_REL_LEAVE2_V: o('RFL_REL_LEAVE2_V'),
  SALARY_V: o('SALARY_V'),
  SIT_DELEV_LOC_V: o('SIT_DELEV_LOC_V'),
  SIT_REASON_V: o('SIT_REASON_V'),
  SIT_WORK_LOC_V: o('SIT_WORK_LOC_V'),
  SUPERVISOR_VIEW: o('SUPERVISOR_VIEW'),
  TEMP_ADD_TYPE_V: o('TEMP_ADD_TYPE_V'),
  WORKLISTS_V: o('WORKLISTS_V'),

  // ── LOVs (_LOV) ───────────────────────────────────────────
  ACAD_YR_STRT_END_LOV: o('ACAD_YR_STRT_END_LOV'),
  ALSR_DFALT_LOV: o('ALSR_DFALT_LOV'),
  ANNUAL_TICKT_LOV: o('ANNUAL_TICKT_LOV'),
  COUNTRY_LOV: o('COUNTRY_LOV'),
  DEP_LOOKUP_LOV: o('DEP_LOOKUP_LOV'),
  DEP_PLACE_LOV: o('DEP_PLACE_LOV'),
  EDU_STAGE_LOV: o('EDU_STAGE_LOV'),
  EMP_MARITAL_LOV: o('EMP_MARITAL_LOV'),
  /**
   * Employment status of a dependent (add/update dependent screens). Unlike its
   * siblings the object does NOT end in `_LOV`; it is
   * `XXHMC_SND_EMPLOYMENT_STATUS_V`. Pointing at the `_LOV` spelling made every
   * call fail with ORA-00942, surfaced to the client as a bare HTTP 500.
   */
  EMPLOYMENT_STATUS_V: o('EMPLOYMENT_STATUS_V'),
  EXIT_COPIES_LOV: o('EXIT_COPIES_LOV'),
  LEAVE_BAL_PLAN_LOV: o('LEAVE_BAL_PLAN_LOV'),
  LETTER_COUNTRY_LOV: o('LETTER_COUNTRY_LOV'),
  LETTER_LANGUAGE_LOV: o('LETTER_LANGUAGE_LOV'),
  LETTER_MOBILE_NO_LOV: o('LETTER_MOBILE_NO_LOV'),
  LETTER_NAME_LOV: o('LETTER_NAME_LOV'),
  LIBR_DFALT_LOV: o('LIBR_DFALT_LOV'),
  REQUEST_TYPE_LOV: o('REQUEST_TYPE_LOV'),
  RFMI_USER_LOV: o('RFMI_USER_LOV'),
  SCHOOL_NAME_LOV: o('SCHOOL_NAME_LOV'),
  SCHOOL_TERM_LOV: o('SCHOOL_TERM_LOV'),
  YES_NO_LOV: o('YES_NO_LOV'),

  // ── Procedures / Packages (_PR, _PKG) — business logic ────
  ADD_DEPENDENT_PR: o('ADD_DEPENDENT_PR'),
  ADD_DEPENDENT_PKG: o('ADD_DEPENDENT_PKG'),
  APPROVE_REJECT_PR: o('APPROVE_REJECT_PR'),
  CALC_LEAV_DUR_PR: o('CALC_LEAV_DUR_PR'),
  COID_REQ_PR: o('COID_REQ_PR'),
  CREATE_ADDRESS_PR: o('CREATE_ADDRESS_PR'),
  DEL_PHONE_NUMBER_PR: o('DEL_PHONE_NUMBER_PR'),
  HR_EMPLYMNT_LTR_PR: o('HR_EMPLYMNT_LTR_PR'),
  HR_LEAV_AMEND_PR: o('HR_LEAV_AMEND_PR'),
  HR_LEAV_CANCEL_PR: o('HR_LEAV_CANCEL_PR'),
  HR_RFMI_PR: o('HR_RFMI_PR'),
  LEAV_OF_ABSEN_NEW_PR: o('LEAV_OF_ABSEN_NEW_PR'),
  LEAVE_BALANCE_PR: o('LEAVE_BALANCE_PR'),
  PASS_DTL_PR: o('PASS_DTL_PR'),
  PAYSLIP_PR: o('PAYSLIP_PR'),
  PHONE_PKG: o('PHONE_PKG'),
  QID_CHG_PR: o('QID_CHG_PR'),
  REASSIGN_PR: o('REASSIGN_PR'),
  REMOVE_DEPENDENT_PR: o('REMOVE_DEPENDENT_PR'),
  RET_FRM_LEAV_PR: o('RET_FRM_LEAV_PR'),
  SCHOOL_FEE_PR: o('SCHOOL_FEE_PR'),
  SUPERVISOR_PR: o('SUPERVISOR_PR'),
  TICKET_REQ_PR: o('TICKET_REQ_PR'),
  CANCEL_TKT_PR: o('CANCEL_TKT_PR'),
  UPD_ADDRESS_PR: o('UPD_ADDRESS_PR'),
  UPD_PERSONAL_INFO_PR: o('UPD_PERSONAL_INFO_PR'),
  UPDATE_DEPENDENT_PR: o('UPDATE_DEPENDENT_PR'),

  // ── Other (proc / func / table) ──────────────────────────
  CHK_PAYROLL_CNT: o('CHK_PAYROLL_CNT'),
  GET_PAYSLIP_PERIODS: o('GET_PAYSLIP_PERIODS'),
  PASSPORT_TYPE: o('PASSPORT_TYPE'),
  TICKET_MASTER: o('TICKET_MASTER'),
  CHILD_DETL: o('CHILD_DETL'),
  EMP_LTR_DEFAULT_COPY: o('EMP_LTR_DEFAULT_COPY'),

  // ── Package procedure references (pkg.proc) ──────────────
  // The dependent add/update procedures live inside ADD_DEPENDENT_PKG; calling
  // them by their bare name raises PLS-00201 (identifier must be declared).
  PHONE_PKG_ADD_OR_UPDATE: `${o('PHONE_PKG')}.ADD_OR_UPDATE_PHONE`,
  DEPENDENT_PKG_ADD: `${o('ADD_DEPENDENT_PKG')}.${o('ADD_DEPENDENT_PR')}`,
  DEPENDENT_PKG_UPDATE: `${o('ADD_DEPENDENT_PKG')}.${o('UPDATE_DEPENDENT_PR')}`,
} as const;

export type OracleObjectKey = keyof typeof ORACLE_OBJECTS;
export type OracleObjectName = (typeof ORACLE_OBJECTS)[OracleObjectKey];

/** All object names as a readonly set — used to validate dynamic lookups. */
export const ORACLE_OBJECT_NAMES: ReadonlySet<string> = new Set(
  Object.values(ORACLE_OBJECTS),
);

export function isKnownOracleObject(name: string): boolean {
  return ORACLE_OBJECT_NAMES.has(name);
}

/**
 * Views a request row may legitimately point to through its `SERVICE_VIEW`
 * column. That column is DATA, so it is matched against this set before it ever
 * reaches a statement — an unexpected value yields "no payload" instead of a
 * query against whatever the row happens to contain.
 */
export const REQUEST_DETAIL_VIEWS: ReadonlySet<string> = new Set([
  ORACLE_OBJECTS.PNDNG_BANK_V,
  ORACLE_OBJECTS.PNDNG_COID_V,
  ORACLE_OBJECTS.PNDNG_EXT_PERMIT_V,
  ORACLE_OBJECTS.PNDNG_HR_LETTER_V,
  ORACLE_OBJECTS.PNDNG_LEAVE_V,
  ORACLE_OBJECTS.PNDNG_LEAV_AMEND_V,
  ORACLE_OBJECTS.PNDNG_LEAV_CNCL_V,
  ORACLE_OBJECTS.PNDNG_PASS_DTL_V,
  ORACLE_OBJECTS.PNDNG_QID_V,
  ORACLE_OBJECTS.PNDNG_RET_FRM_LV_V,
  ORACLE_OBJECTS.PNDNG_SCHOO_FEE_V,
  ORACLE_OBJECTS.PNDNG_SUPERVISOR_V,
  ORACLE_OBJECTS.PNDNG_UPD_PERSON_V,
  ORACLE_OBJECTS.PND_DEPENDENT_ADDR_V,
  ORACLE_OBJECTS.PND_DEPENDENT_PHN_V,
  ORACLE_OBJECTS.PND_DEPENDENT_V,
  ORACLE_OBJECTS.PND_REMOV_DEPNT_V,
]);
