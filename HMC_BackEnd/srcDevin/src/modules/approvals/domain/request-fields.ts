import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';

/**
 * Display contract for "one request" (op 21).
 *
 * A request row only NAMES the view holding its payload (`SERVICE_VIEW`), and
 * each of those 17 views has a different shape. Handing the raw columns to the
 * client means every app has to carry a template per request type — which is
 * exactly what the legacy Kony app did, and why adding a column to a view
 * required an app release.
 *
 * So the shaping happens here instead: the catalog below says, per view, which
 * columns to show, in what order, under which i18n key and as what kind of
 * value. The client renders one generic list for all 17 types.
 *
 * `labelKey` values are deliberately the SAME keys the Kony templates already
 * use (`SAcademicYear`, `QatarID`, …): translations stay in the app, ordering
 * and field selection stay here.
 */
export type FieldType = 'text' | 'longtext' | 'date' | 'amount' | 'number' | 'boolean';

export interface RequestField {
  /** Stable, separator-free key (`academicyear`) — also the `values` map key. */
  key: string;
  /** i18n key the app already owns. */
  labelKey: string;
  /** Readable English fallback, for logs and clients without the key. */
  label: string;
  value: string | number | null;
  type: FieldType;
}

interface FieldSpec {
  /** Column as the view spells it — may contain spaces (`QID Number`). */
  column: string;
  labelKey: string;
  type?: FieldType;
}

interface ViewSpec {
  /** Stable machine key for the request type, for client-side branching. */
  requestTypeKey: string;
  fields: FieldSpec[];
}

const f = (column: string, labelKey: string, type: FieldType = 'text'): FieldSpec => ({
  column,
  labelKey,
  type,
});

/**
 * Columns present in every view: they describe the workflow, not the request,
 * and are already returned as top-level properties of the response.
 */
const PLUMBING = new Set([
  'REQUESTOR_USER_NAME',
  'REQUESTOR_NAME',
  'APPROVER_USER_NAME',
  'APPROVER_NAME',
  'DATE_OF_SUBMISSION',
  'SUBMISSION_DATE',
  'TRANSACTION_ID',
  'ITEM_TYPE',
  'ITEM_KEY',
  'NOTIFICATION_ID',
]);

export const REQUEST_FIELD_CATALOG: Readonly<Record<string, ViewSpec>> = {
  [ORACLE_OBJECTS.PNDNG_QID_V]: {
    requestTypeKey: 'QID',
    fields: [
      f('QID Number', 'QatarID'),
      f('Issue Date', 'DATEOFISSUEOFQID', 'date'),
      f('Expiry Date', 'EXPIRYDATEOFQID1', 'date'),
      f('Job as in QID', 'JOBINQID'),
    ],
  },
  [ORACLE_OBJECTS.PNDNG_PASS_DTL_V]: {
    requestTypeKey: 'PASSPORT',
    fields: [
      f('PASSPORT_NUMBER', 'PASSPORTNUM1'),
      f('DATE_OF_ISSUE', 'PDateofIssue', 'date'),
      f('DATE_OF_EXPIRY', 'EXPIRYDATE1', 'date'),
      f('TYPE_OF_PASSPORT', 'TypeofPassport'),
      f('PLACE_OF_ISSUE', 'PLACEOFISSUE'),
      f('COUNTRY_OF_ISSUE', 'COUNTRYOFISSUE1'),
    ],
  },
  [ORACLE_OBJECTS.PNDNG_UPD_PERSON_V]: {
    requestTypeKey: 'PERSONAL_INFO',
    fields: [
      f('TITLE', 'TITLE'),
      f('FIRST_NAME', 'FIRSTNAME'),
      f('MIDDLE_NAME', 'MIDDLENAME'),
      f('LAST_NAME', 'LASTNAME'),
      f('DATE_OF_BIRTH', 'DOB1', 'date'),
      f('MARITAL_STATUS', 'MARITALSTATS'),
      f('NAME_IN_ARABIC', 'ARABICNAME'),
      f('EFFECTIVE_DATE', 'EFFECTIVEDATE', 'date'),
    ],
  },
  [ORACLE_OBJECTS.PNDNG_LEAV_CNCL_V]: {
    requestTypeKey: 'LEAVE_CANCELLATION',
    fields: [
      f('LEAVE_TO_CANCEL', 'LEAVETOCANCEL1'),
      f('REASON_FOR_CANCELLATION', 'REASONFORCANCEL'),
      f('REMARKS', 'REMARKS', 'longtext'),
    ],
  },
  [ORACLE_OBJECTS.PNDNG_LEAV_AMEND_V]: {
    requestTypeKey: 'LEAVE_AMENDMENT',
    fields: [
      f('LEAVE_TO_AMEND', 'LEAVETOAMEND1'),
      f('NEW_END_DATE', 'NEWENDDATE1', 'date'),
      f('COMMENTS', 'COMMENTS', 'longtext'),
    ],
  },
  [ORACLE_OBJECTS.PNDNG_SUPERVISOR_V]: {
    requestTypeKey: 'SUPERVISOR_CHANGE',
    fields: [f('NEW_SUPERVISOR', 'SNewSupervisor'), f('REASON', 'SReasonnew', 'longtext')],
  },
  [ORACLE_OBJECTS.PNDNG_COID_V]: {
    requestTypeKey: 'COMPANY_ID',
    fields: [
      f('REASON', 'SReasonnew'),
      f('CHARGE_NEW_ID', 'CHARGE'),
      f('DELIVERY_LOCATION', 'DeliveryLocation'),
      f('WORKING_LOCATION', 'WorkingLocation'),
      f('COMMENTS', 'SComments', 'longtext'),
    ],
  },
  [ORACLE_OBJECTS.PNDNG_SCHOO_FEE_V]: {
    requestTypeKey: 'SCHOOL_FEE',
    fields: [
      f('ACADEMIC_YEAR', 'SAcademicYear'),
      f('ACADEMIC_YEAR_START_DATE', 'SASTARTDATE', 'date'),
      f('ACADEMIC_YEAR_END_DATE', 'SAENDDATE', 'date'),
      f('CHILD_NAME', 'SChildName'),
      f('CHILD_DATE_OF_BIRTH', 'SChildDateofBirth', 'date'),
      f('PASSPORT_NUMBER', 'PASSPORTNUM1'),
      f('RP_NUMBER', 'SRPNumber'),
      f('SCHOOL_NAME', 'SchoolName'),
      f('EDUCATIONAL_STAGE', 'SEducationalStage'),
      f('REQUEST_TYPE', 'REQTYPE'),
      f('TERM', 'STerm'),
      f('AMOUNT', 'amount', 'amount'),
      f('RECEIPT_NUMBER', 'SReceiptNumber'),
      f('SPOUSE_WORKING', 'SSpouseWorking', 'boolean'),
      f('COMMENTS', 'COMMENTS', 'longtext'),
    ],
  },
  [ORACLE_OBJECTS.PNDNG_RET_FRM_LV_V]: {
    requestTypeKey: 'RETURN_FROM_LEAVE',
    fields: [
      f('LEAVE_DETAILS', 'LEAVEDETS1'),
      f('RELATED_LEAVE1', 'RELATEDLEAVE1'),
      f('RELATED_LEAVE2', 'RELATEDLEAVE2'),
      f('RETURN_DATE', 'DUTYRESEMPTIONDATE1', 'date'),
      f('COMMENTS', 'COMMENTS', 'longtext'),
    ],
  },
  /**
   * One view backs every leave type, so this is the union of the per-type Kony
   * templates in their original order: the common block first, then the
   * type-specific blocks. Empty values are dropped from the response, which is
   * what reduces the list to the fields that matter for the leave at hand — a
   * casual leave simply has no marriage date.
   */
  [ORACLE_OBJECTS.PNDNG_LEAVE_V]: {
    requestTypeKey: 'LEAVE_REQUEST',
    fields: [
      f('LEAVE_TYPE', 'leavetype'),
      f('ABSENCE_REASON', 'ABSENCEREASON1'),
      f('DATE_START', 'startdate', 'date'),
      f('DATE_END', 'ENDDATE1', 'date'),
      f('ABSENCE_DAYS', 'NOOFDAYS', 'number'),
      // Annual
      f('ADV_LEAVE_SALARY', 'ADVLEAVESALARYREQ1', 'boolean'),
      f('LEAVE_INC_BONUS', 'LEAVEINCENTIVEBONUSREQ', 'boolean'),
      f('ANNUAL_TKT', 'TravellingDaysRequest1'),
      f('CONTRACTUAL_YEAR', 'CONTRACTYEAR1'),
      // Compassionate / Iddat
      f('RELATIONSHIP_BEREAVED', 'RELATIONOFBEREAVED1'),
      f('BEREAVEMENT_DATE', 'DATEOFBEREAVEMENT1', 'date'),
      f('LEAVE_CLASSIFICATION', 'LEAVECLASIFICATION1'),
      // Examination
      f('EXAMINATION_CENTRE', 'EXAMCENTER'),
      f('EXAM_DATE', 'EXAMDATE', 'date'),
      // Marriage
      f('MARRIAGE_DATE', 'MARRIAGEDATE', 'date'),
      f('SPOUSE_NAME', 'spousename'),
      f('SPOUSE_QID', 'spouseQID'),
      // Maternity
      f('NO_OF_CHILDREN', 'NChild', 'number'),
      f('DELIVERY_DATE', 'DATEOFDELIVERY1', 'date'),
      // Sick
      f('DOCTOR_COMMENTS', 'DOCTORCOMMENTS', 'longtext'),
      f('MED_COMMT_DECISION', 'MEDICALCOMMITTEDECI'),
      f('HC_NUMBER', 'HCNumber'),
      f('ORDER_ID', 'OrderID'),
      f('ORDER_DATE', 'OrderDate', 'date'),
      f('ENCOUNTER_ID', 'EncounterID'),
      f('VISIT_DATE', 'VisitDate', 'date'),
      f('DISCHARGE_DATE', 'DischargeDate', 'date'),
      f('MEDICAL_SERVICE', 'MedicalService'),
      f('FACILITY', 'Facility'),
      f('PRIMARY_DIAGNOSIS', 'PrimaryDiagnosis'),
      f('SPECIAL_INSTRUCTIONS', 'SpecialInstruction', 'longtext'),
      f('WORK_RELATED_INJURY', 'WorkRelatedInjury', 'boolean'),
      f('UNFIT_NUMBER_OF_DAYS', 'UnfitNoofDays', 'number'),
      f('PRACTITIONER_NAME', 'PractitionerName'),
      f('PRACTITIONER_CORP_NUMBER', 'PractitionerCorpNumber'),
      f('ELECTRONICALLY_SIGNED_ON', 'ElectonicallySignedOn', 'date'),
      f('REMARKS', 'REMARKS', 'longtext'),
    ],
  },
};

/** `ACADEMIC_YEAR` / `QID Number` → `academicyear` / `qidnumber`. */
export function fieldKey(column: string): string {
  return column.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** `ACADEMIC_YEAR_START_DATE` → `Academic Year Start Date` (English fallback). */
function humanize(column: string): string {
  return column
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Guess a type for views with no catalog entry yet, from the column name. */
function inferType(column: string, value: unknown): FieldType {
  const c = column.toUpperCase();
  if (value instanceof Date || /DATE|_ON$/.test(c)) return 'date';
  if (/AMOUNT|SALARY|FEE/.test(c)) return 'amount';
  if (/NUMBER_OF|NO_OF|_DAYS|COUNT/.test(c)) return 'number';
  if (/COMMENT|REMARK|INSTRUCTION|DIAGNOSIS/.test(c)) return 'longtext';
  if (typeof value === 'string' && /^(yes|no|y|n)$/i.test(value.trim())) return 'boolean';
  return 'text';
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

const MONTHS = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');

/**
 * Several of these views keep dates in VARCHAR2 columns, in whichever format
 * the submitting page used: `23-SEP-2010` (CHILD_DATE_OF_BIRTH),
 * `1984/05/15` (DATE_OF_BIRTH), `2026/01/21 00:00:00` (DATE_OF_ISSUE). None of
 * them parse on a client, so the unambiguous ones are converted to ISO 8601.
 *
 * `01/01/2026` is deliberately NOT converted: day-first and month-first are
 * indistinguishable, and the views hold no row that could settle it (checked on
 * staging). Guessing would silently corrupt dates, so such a value keeps its
 * original text and its field is downgraded to `text` — that way `type: 'date'`
 * always means "this value is ISO 8601", with no exceptions for the client to
 * defend against.
 */
function isoFromOracleDate(text: string): string | null {
  const s = text.trim();

  // Already ISO (a DATE column that reached us as a string — e.g. through a
  // JSON hop, or a TIMESTAMP the driver renders as text).
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}|$)/.test(s)) {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  const dmy = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(s);
  if (dmy) {
    const month = MONTHS.indexOf(dmy[2].toUpperCase());
    if (month < 0) return null;
    const y = Number(dmy[3]);
    // Oracle's RR rule for two-digit years: 00-49 → 2000s, 50-99 → 1900s.
    const year = dmy[3].length === 4 ? y : y < 50 ? 2000 + y : 1900 + y;
    return new Date(Date.UTC(year, month, Number(dmy[1]))).toISOString();
  }

  const ymd = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (ymd) {
    const [, y, m, d, hh = '0', mi = '0', ss = '0'] = ymd;
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mi), Number(ss)),
    ).toISOString();
  }
  return null;
}

/** Value as the client should receive it, plus the type that actually applies. */
function render(value: unknown, type: FieldType): { value: string | number | null; type: FieldType } {
  if (isEmpty(value)) return { value: null, type };
  if (value instanceof Date) return { value: value.toISOString(), type: 'date' };

  if (type === 'date') {
    const iso = isoFromOracleDate(String(value));
    return iso ? { value: iso, type } : { value: String(value), type: 'text' };
  }
  if (type === 'boolean') {
    const v = String(value).trim().toLowerCase();
    if (v === 'y' || v === 'yes') return { value: 'Yes', type };
    if (v === 'n' || v === 'no') return { value: 'No', type };
  }
  if (type === 'number' || type === 'amount') {
    const n = Number(String(value).replace(/,/g, ''));
    if (Number.isFinite(n)) return { value: n, type };
  }
  // Identifiers (QID, RP, receipt…) stay strings even when the column is
  // NUMBER, so no client formats them with thousand separators.
  return { value: String(value), type };
}

/**
 * Turn one detail row into the ordered, display-ready field list.
 *
 * Empty values are dropped so the screen has no blank rows — and, for the
 * shared leave view, that is also what narrows 37 possible fields down to the
 * ones belonging to the leave type in hand.
 *
 * Views without a catalog entry still work: their columns are emitted in view
 * order with a humanised label and an inferred type, so a newly exposed
 * request type is visible before anyone touches this file.
 */
export function buildRequestFields(serviceView: string | null, row: Record<string, unknown> | undefined) {
  const fields: RequestField[] = [];
  const values: Record<string, string | number | null> = {};
  if (!row) return { fields, values };

  const spec = serviceView ? REQUEST_FIELD_CATALOG[serviceView] : undefined;
  const specs: FieldSpec[] = spec
    ? spec.fields
    : Object.keys(row)
        .filter((c) => !PLUMBING.has(c.toUpperCase()) && !/_AR$/i.test(c))
        .map((c) => ({ column: c, labelKey: fieldKey(c) }));

  for (const s of specs) {
    if (!(s.column in row)) continue;
    const declared = s.type ?? inferType(s.column, row[s.column]);
    const { value, type } = render(row[s.column], declared);
    const key = fieldKey(s.column);
    values[key] = value;
    if (value === null) continue; // no blank rows on the screen
    fields.push({ key, labelKey: s.labelKey, label: humanize(s.column), value, type });
  }
  return { fields, values };
}

export function requestTypeKeyOf(serviceView: string | null): string | null {
  return (serviceView && REQUEST_FIELD_CATALOG[serviceView]?.requestTypeKey) ?? null;
}
