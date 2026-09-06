import { ORACLE_OBJECTS } from './oracle-objects';

/**
 * Public LOV name (the `Lovname` query param on `/data/lovlookup`) → Oracle object.
 * This registry is the ONLY place the LOV-name → Oracle-object mapping lives, and
 * doubles as an allow-list for the generic lookups reader (injection-safe).
 *
 * Source: Docs_Ai/operation-inventory.md + Docs_Ai/API/README.md.
 */
export const LOV_OBJECT: Readonly<Record<string, string>> = Object.freeze({
  // profile / contact
  EMP_MARITAL_LOV: ORACLE_OBJECTS.EMP_MARITAL_LOV,
  COUNTRY_LOV: ORACLE_OBJECTS.COUNTRY_LOV,
  PHONE_TYPE_LOV: ORACLE_OBJECTS.PHONE_TYPE_V,

  // leave
  LEAVE_BAL_PLAN_LOV: ORACLE_OBJECTS.LEAVE_BAL_PLAN_LOV,
  ABSENCE_TYPE_LOV: ORACLE_OBJECTS.ABSENCE_TYPE_V,
  ABSENCE_REASON_LOV: ORACLE_OBJECTS.ABSENCE_REASON_V,
  LEAV_CLASS_LOV: ORACLE_OBJECTS.LEAV_CLASS_V,
  LEAVE_TYPE_LOV: ORACLE_OBJECTS.LEAVE_TYPE_V,
  NUM_OF_CHILD_LOV: ORACLE_OBJECTS.NUM_OF_CHILD_V,
  EXAM_CENTRE_LOV: ORACLE_OBJECTS.EXAM_CENTRE_V,
  BEREAV_RELAT_LOV: ORACLE_OBJECTS.BEREAV_RELAT_V,
  // Legacy spelling used by the old gateway (`Lovname=BEREAVED_RELATIONSHIP_LOV`,
  // see sanaad-api-service-mapping.html) — same view as BEREAV_RELAT_LOV.
  BEREAVED_RELATIONSHIP_LOV: ORACLE_OBJECTS.BEREAV_RELAT_V,
  CONTRACT_YEAR_LOV: ORACLE_OBJECTS.CONTRACT_YEARS_V,
  // Object-named spelling (the DB renamed XXHMC_SND_CONTRACT_YEAR_V to
  // …_CONTRACT_YEARS_V); same view as CONTRACT_YEAR_LOV above.
  CONTRACT_YEARS_V: ORACLE_OBJECTS.CONTRACT_YEARS_V,
  ANNUAL_TICKT_LOV: ORACLE_OBJECTS.ANNUAL_TICKT_LOV,
  LIBR_DFALT_LOV: ORACLE_OBJECTS.LIBR_DFALT_LOV,
  ALSR_DFALT_LOV: ORACLE_OBJECTS.ALSR_DFALT_LOV,
  RFL_REL_LEAVE1_LOV: ORACLE_OBJECTS.RFL_REL_LEAVE1_V,
  RFL_REL_LEAVE2_LOV: ORACLE_OBJECTS.RFL_REL_LEAVE2_V,
  RFL_LEAVE_DET_LOV: ORACLE_OBJECTS.RFL_LEAVE_DET_V,
  LEAVE_CANCEL_LOV: ORACLE_OBJECTS.LEAVE_CANCEL_V,
  LEAVE_TO_AMEND_LOV: ORACLE_OBJECTS.LEAVE_AMEND_V,
  ABSENCE_AMEND_TYPE_V: ORACLE_OBJECTS.ABSENCE_AMEND_TYPE_V,

  // letters
  LETTER_MOBILE_NO_LOV: ORACLE_OBJECTS.LETTER_MOBILE_NO_LOV,
  LETTER_COUNTRY_LOV: ORACLE_OBJECTS.LETTER_COUNTRY_LOV,
  LETTER_NAME_LOV: ORACLE_OBJECTS.LETTER_NAME_LOV,
  LETTER_LANGUAGE_LOV: ORACLE_OBJECTS.LETTER_LANGUAGE_LOV,
  EXIT_COPIES_LOV: ORACLE_OBJECTS.EXIT_COPIES_LOV,
  DELIVERY_LOC_LOV: ORACLE_OBJECTS.DELIVERY_LOC_V,
  EMP_LTR_DEFAULT_COPY: ORACLE_OBJECTS.EMP_LTR_DEFAULT_COPY,

  // identity
  SIT_WORK_LOC_LOV: ORACLE_OBJECTS.SIT_WORK_LOC_V,
  SIT_DELEV_LOC_LOV: ORACLE_OBJECTS.SIT_DELEV_LOC_V,
  SIT_REASON_LOV: ORACLE_OBJECTS.SIT_REASON_V,

  // dependents
  DEP_LOOKUP_LOV: ORACLE_OBJECTS.DEP_LOOKUP_LOV,
  DEP_PLACE_LOV: ORACLE_OBJECTS.DEP_PLACE_LOV,
  PASSPORT_TYPE_LOV: ORACLE_OBJECTS.PASSPORT_TYPE,

  // school-fees
  SCHOOL_NAME_LOV: ORACLE_OBJECTS.SCHOOL_NAME_LOV,
  SCHOOL_TERM_LOV: ORACLE_OBJECTS.SCHOOL_TERM_LOV,
  EDU_STAGE_LOV: ORACLE_OBJECTS.EDU_STAGE_LOV,
  ACAD_YR_STRT_END_LOV: ORACLE_OBJECTS.ACAD_YR_STRT_END_LOV,
  REQUEST_TYPE_LOV: ORACLE_OBJECTS.REQUEST_TYPE_LOV,

  // annual-ticket
  TICKET_MASTER_LOV: ORACLE_OBJECTS.TICKET_MASTER,

  // shared
  YES_NO_LOV: ORACLE_OBJECTS.YES_NO_LOV,
  RFMI_USER_LOV: ORACLE_OBJECTS.RFMI_USER_LOV,
  // Named after the object, like ABSENCE_AMEND_TYPE_V above: the view is
  // XXHMC_SND_EMPLOYMENT_STATUS_V, not …_LOV. The `EMPLOYMENT_STATUS_LOV`
  // spelling is deliberately NOT registered — it pointed at a non-existent
  // object and answered HTTP 500 for its whole life, so nothing can depend on
  // it, and keeping both spellings would just hide which one matches Oracle.
  EMPLOYMENT_STATUS_V: ORACLE_OBJECTS.EMPLOYMENT_STATUS_V,
});

export type LovName = keyof typeof LOV_OBJECT;

export function resolveLovObject(lovname: string): string | undefined {
  return LOV_OBJECT[lovname];
}

/**
 * Master-lookup names (`/data/masterlookup?lookupname=...`). Some resolve to an
 * Oracle view; the Cerner* ones are served by the appointments ACL client and are
 * intentionally NOT mapped to an Oracle object here.
 */
export const MASTER_LOOKUP_OBJECT: Readonly<Record<string, string>> = Object.freeze({
  GetLeaveType: ORACLE_OBJECTS.ABSENCE_TYPE_V,
  GetLeaveReasonType: ORACLE_OBJECTS.ABSENCE_REASON_V,
  GetLeaveclassType: ORACLE_OBJECTS.LEAV_CLASS_V,
  GetYesno: ORACLE_OBJECTS.YES_NO_LOV,
});

/** Cerner-backed master lookups (served by appointments module, not Oracle). */
export const CERNER_MASTER_LOOKUPS = [
  'CernerClinics',
  'CernerLocation',
  'CernerMedicalServices',
] as const;

export type CernerMasterLookup = (typeof CERNER_MASTER_LOOKUPS)[number];

export function isCernerMasterLookup(name: string): name is CernerMasterLookup {
  return (CERNER_MASTER_LOOKUPS as readonly string[]).includes(name);
}
