import { Injectable } from '@nestjs/common';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import type { OracleArgumentInfo, OracleColumnInfo } from './oracle-metadata.service';
import { OracleContractUnavailableException } from './oracle.error';

interface ContractParameter {
  name: string;
  direction: string;
  dataType: string;
  defaulted: boolean;
  typeOwner?: string;
  typeName?: string;
  typeSubname?: string;
}

interface ProgramContract {
  params: readonly ContractParameter[];
  returnType?: Pick<ContractParameter, 'dataType' | 'typeOwner' | 'typeName' | 'typeSubname'>;
}

type ColumnContract = Readonly<Record<string, string>>;

const input = (name: string, dataType = 'VARCHAR2', defaulted = false): ContractParameter =>
  ({ name, direction: 'IN', dataType, defaulted });
const output = (name: string, dataType = 'VARCHAR2'): ContractParameter =>
  ({ name, direction: 'OUT', dataType, defaulted: false });
const inputs = (...names: string[]): ContractParameter[] => names.map((name) => input(name));
const attachments = (count = 10): ContractParameter[] => Array.from({ length: count }, (_, i) => [
  input(`p_file_name${i + 1}`, 'VARCHAR2', true),
  input(`p_attachment${i + 1}`, 'BLOB', true),
]).flat();
const status = (): ContractParameter[] => [
  output('p_success_flag'), output('p_error_msg'), output('p_error_msg_ar'),
];
const dates = (...names: string[]): ContractParameter[] => names.map((name) => input(name, 'DATE'));
/** PL/SQL associative array declared inside a package (bound by qualified type name). */
const table = (name: string, pkg: string, subname: string): ContractParameter => ({
  name, direction: 'IN', dataType: 'PL/SQL TABLE', defaulted: false,
  typeOwner: 'APPS', typeName: pkg, typeSubname: subname,
});
const DEP_PKG = ORACLE_OBJECTS.ADD_DEPENDENT_PKG;
const depTable = (name: string) => table(name, DEP_PKG, 'MY_TYPE');
const phoneTable = (name: string) => table(name, ORACLE_OBJECTS.PHONE_PKG, 'ETSND_VARCHAR');

const PROGRAMS: Readonly<Record<string, ProgramContract>> = Object.freeze({
  [ORACLE_OBJECTS.COID_REQ_PR]: {
    params: [
      ...inputs('p_user_name', 'p_reason', 'p_charge_for_new_id', 'p_delivery_loc',
        'p_working_location', 'p_comments'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.QID_CHG_PR]: {
    params: [
      ...inputs('p_user_name', 'p_qid_number'),
      input('p_iss_date', 'DATE'), input('p_exp_date', 'DATE'), input('p_qid_job'),
      ...attachments(8), ...status(),
    ],
  },
  [ORACLE_OBJECTS.SCHOOL_FEE_PR]: {
    params: [
      ...inputs('p_user_name', 'p_academic_year'),
      input('p_acd_st_dt', 'DATE'), input('p_acd_end_dt', 'DATE'),
      ...inputs('p_child_name', 'p_child_date_birth', 'p_passport_number', 'p_rp_number',
        'p_school_name', 'p_educational_stage', 'p_request_type', 'p_term'),
      input('p_amount', 'NUMBER'),
      ...inputs('p_receipt_number', 'p_spouse_working', 'p_comments'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.LEAVE_BALANCE_PR]: {
    params: [
      input('p_user_name'), input('p_effective_date', 'DATE'),
      output('p_get_balances', 'REF CURSOR'), ...status(),
    ],
  },
  [ORACLE_OBJECTS.CALC_LEAV_DUR_PR]: {
    params: [
      ...inputs('p_user_name', 'p_absence_type'),
      input('p_start_date', 'DATE'), input('p_end_date', 'DATE'),
      output('p_duration', 'NUMBER'), ...status(),
    ],
  },
  [ORACLE_OBJECTS.HR_LEAV_CANCEL_PR]: {
    params: [
      ...inputs('p_leave_type', 'p_user_name', 'p_leave_to_cancel', 'p_reason_for_cancel', 'p_remarks'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.SUPERVISOR_PR]: {
    params: [
      input('p_user_name'), input('p_new_supervisor', 'NUMBER'), input('p_reason'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.HR_EMPLYMNT_LTR_PR]: {
    params: [
      ...inputs('p_user_name', 'p_letter_language', 'p_letter_name'),
      input('p_country', 'VARCHAR2', true),
      ...inputs('p_no_of_copies', 'p_mobile_number', 'p_letter_delivery_loc', 'p_purpose_comments'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.HR_RFMI_PR]: {
    params: [
      ...inputs('p_from_user_name', 'p_to_user_name', 'p_itemtype', 'p_item_key'),
      input('p_notification_id', 'NUMBER'), ...inputs('p_mode', 'p_comments'), ...status(),
    ],
  },
  [ORACLE_OBJECTS.GET_PAYSLIP_PERIODS]: {
    params: [input('p_user_name'), output('p_get_periods', 'REF CURSOR'),
      output('p_success_flag'), output('p_error_msg')],
  },
  [ORACLE_OBJECTS.CHK_PAYROLL_CNT]: {
    params: [
      input('p_person_id', 'NUMBER'), input('p_period'),
      output('p_get_pay_assignment_details', 'REF CURSOR'),
      output('p_flag'), output('p_success_flag'), output('p_error_msg'),
    ],
  },
  [ORACLE_OBJECTS.PAYSLIP_PR]: {
    params: [
      input('p_person_id', 'NUMBER'), input('p_period'), input('p_assignment_id', 'NUMBER'),
      ...['p_get_earnings', 'p_get_deductions', 'p_get_totals', 'p_get_balances',
        'p_get_informations', 'p_get_net_payments', 'p_get_housing'].map((name) => output(name, 'REF CURSOR')),
      ...['p_success_flag', 'p_error_msg', 'p_profile', 'p_total_earnings',
        'p_total_deductions'].map((name) => output(name)),
    ],
  },
  [ORACLE_OBJECTS.CHILD_DETS_VIEW]: {
    params: inputs('p_acad_yr_strt_dt', 'p_user_name'),
    returnType: { dataType: 'TABLE', typeOwner: 'APPS', typeName: 'XXHMC_SND_CHILD_DETL_NT' },
  },

  // ── Declarations transcribed from the client's ALL_ARGUMENTS export
  //    (424 rows, 2026-09-14; see orcale/transcription.md). None of these
  //    declares p_language, although the legacy request templates listed one.
  [ORACLE_OBJECTS.APPROVE_REJECT_PR]: {
    params: [
      ...inputs('p_user_name', 'p_itemtype', 'p_item_key', 'p_result'),
      input('p_notification_id', 'NUMBER'), input('p_user_comment'), ...status(),
    ],
  },
  [ORACLE_OBJECTS.DEL_PHONE_NUMBER_PR]: {
    params: [...inputs('p_user_name', 'p_phone_id', 'p_phone_type', 'p_phone_number'), ...status()],
  },
  [ORACLE_OBJECTS.PHONE_PKG_ADD_OR_UPDATE]: {
    params: [
      input('p_user_name'),
      ...['p_phone_id', 'p_object_version_number', 'p_phone_type', 'p_phone_number'].map(phoneTable),
      ...status(),
    ],
  },
  [ORACLE_OBJECTS.CREATE_ADDRESS_PR]: {
    params: [
      input('p_user_name'), input('p_effective_date', 'DATE'),
      ...inputs('p_main_address', 'p_primary_flag', 'p_country', 'p_address_type',
        'p_address_line1', 'p_address_line2', 'p_address_line3', 'p_town_or_city',
        'p_region1', 'p_region2', 'p_region3', 'p_po_box'),
      ...status(),
    ],
  },
  [ORACLE_OBJECTS.UPD_ADDRESS_PR]: {
    params: [
      input('p_user_name'), input('p_effective_date', 'DATE'), input('p_address_id', 'NUMBER'),
      ...inputs('p_address_line1', 'p_address_line2', 'p_address_line3', 'p_city',
        'p_region_1', 'p_region_2', 'p_region_3', 'p_po_box', 'p_address_type', 'p_country'),
      ...status(),
    ],
  },
  [ORACLE_OBJECTS.UPD_PERSONAL_INFO_PR]: {
    params: [
      input('p_user_name'), input('p_effective_date', 'DATE'),
      ...inputs('p_first_name', 'p_middle_name', 'p_last_name', 'p_marital_status',
        'p_name_in_arabic', 'p_title', 'p_relationship', 'p_place_of_issue', 'p_country_of_issue',
        'p_visa_type', 'p_visa_number', 'p_visa_validity', 'p_type_of_sponsership'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.HR_LEAV_AMEND_PR]: {
    params: [
      ...inputs('p_leave_type', 'p_user_name', 'p_leave_to_amend'),
      input('p_new_end_date', 'DATE'), input('p_comments'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.RET_FRM_LEAV_PR]: {
    params: [
      ...inputs('p_user_name', 'p_leave_details', 'p_related_leave1', 'p_related_leave2'),
      input('p_return_date', 'DATE'), input('p_comments'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.PASS_DTL_PR]: {
    params: [
      ...inputs('p_user_name', 'p_passport_number'),
      ...dates('p_date_of_issue', 'p_date_of_expiry'),
      ...inputs('p_type_of_passport', 'p_place_of_issue', 'p_country_of_issue'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.REMOVE_DEPENDENT_PR]: {
    params: [
      ...inputs('p_user_name', 'p_dependent_id', 'p_contact_type', 'p_relation_ship'),
      input('p_relation_ship_end_date', 'DATE'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.TICKET_REQ_PR]: {
    params: [
      ...inputs('p_user_name', 'p_request_for', 'p_employee',
        'p_passenger1', 'p_passenger2', 'p_passenger3', 'p_passenger4',
        'p_request_type', 'p_contractual_year', 'p_traveling_dest', 'p_travel_class', 'p_comments'),
      ...attachments(), ...status(),
    ],
  },
  [ORACLE_OBJECTS.CANCEL_TKT_PR]: {
    params: [
      ...inputs('p_user_name', 'p_annual_tkt', 'p_contractual_year', 'p_reason',
        'p_ticket_as', 'p_repayment_method', 'p_comments', 'p_voucher_ref'),
      ...attachments(), ...status(),
    ],
  },
  // Package members: P_EMPLOYMENT_STATUS / P_COMMENTS are declared AFTER the
  // OUT parameters (positions 68-69 / 74-75); named notation makes that safe.
  [ORACLE_OBJECTS.DEPENDENT_PKG_ADD]: {
    params: [
      ...inputs('p_user_name', 'p_title', 'p_first_name', 'p_middle_name', 'p_last_name',
        'p_suffix', 'p_prefix', 'p_email_address', 'p_relationship'),
      input('p_relationship_start_date', 'DATE'),
      ...inputs('p_gender', 'p_national_identifier'),
      input('p_date_of_birth', 'DATE'), input('p_passport_number'),
      ...dates('p_pp_issue_date', 'p_pp_expiry_date'),
      ...inputs('p_place_of_issue', 'p_country_of_issue', 'p_visa_type', 'p_visa_number'),
      ...dates('p_visa_issue_date', 'p_visa_expiry_date'),
      ...inputs('p_visa_validity', 'p_id_number'),
      ...dates('p_id_expiry_date', 'p_id_issue_date'),
      ...inputs('p_job_as_in_qid', 'p_type_of_sponsorship', 'p_sponsor_contact_name', 'p_other_sponsor'),
      input('p_effective_date', 'DATE'),
      ...inputs('p_address_line1', 'p_address_line2', 'p_address_line3', 'p_city',
        'p_region_1', 'p_region_2', 'p_region_3', 'p_po_box', 'p_address_type', 'p_country'),
      depTable('p_phone_type'), depTable('p_phone_number'), input('p_phone_enabled'),
      ...attachments(), ...status(),
      ...inputs('p_employment_status', 'p_comments'),
    ],
  },
  [ORACLE_OBJECTS.DEPENDENT_PKG_UPDATE]: {
    params: [
      input('p_user_name'), input('p_dependent_id', 'NUMBER'),
      ...inputs('p_title', 'p_first_name', 'p_middle_name', 'p_last_name', 'p_suffix', 'p_prefix',
        'p_email_address', 'p_relation_ship'),
      input('p_relation_ship_start_date', 'DATE'), input('p_passport_number'),
      ...dates('p_date_of_issue', 'p_date_of_expire'),
      ...inputs('p_place_of_issue', 'p_country_of_issue', 'p_visa_type', 'p_visa_number'),
      ...dates('p_date_of_issue_visa', 'p_date_of_expire_visa'),
      ...inputs('p_visa_validy', 'p_id_number'),
      ...dates('p_expiry_date', 'p_date_of_issue_qid'),
      ...inputs('p_type_of_sponsership', 'p_name_of_contact', 'p_name_of_sponsor'),
      depTable('p_phone_type'), depTable('p_phone_number'), depTable('p_phone_id'), input('p_phone_enabled'),
      depTable('p_phone_type1'), depTable('p_phone_number1'), depTable('p_phone_id1'), input('p_phone_enabled1'),
      ...inputs('p_gendar', 'p_qid_number'),
      ...dates('p_date_of_birth', 'p_effective_date'),
      input('p_country'), input('p_address_id', 'NUMBER'),
      ...inputs('p_address_line1', 'p_address_line2', 'p_address_line3', 'p_city',
        'p_region_1', 'p_region_2', 'p_region_3', 'p_po_box', 'p_address_type'),
      ...attachments(), ...status(),
      ...inputs('p_employment_status', 'p_comments'),
    ],
  },
});

const GLOBAL_LOVS: readonly string[] = [
  ORACLE_OBJECTS.EMP_MARITAL_LOV, ORACLE_OBJECTS.COUNTRY_LOV, ORACLE_OBJECTS.PHONE_TYPE_V,
  ORACLE_OBJECTS.ABSENCE_TYPE_V, ORACLE_OBJECTS.LEAV_CLASS_V, ORACLE_OBJECTS.LEAVE_TYPE_V,
  ORACLE_OBJECTS.NUM_OF_CHILD_V, ORACLE_OBJECTS.EXAM_CENTRE_V, ORACLE_OBJECTS.BEREAV_RELAT_V,
  ORACLE_OBJECTS.LETTER_COUNTRY_LOV, ORACLE_OBJECTS.LETTER_NAME_LOV, ORACLE_OBJECTS.LETTER_LANGUAGE_LOV,
  ORACLE_OBJECTS.EXIT_COPIES_LOV, ORACLE_OBJECTS.DELIVERY_LOC_V, ORACLE_OBJECTS.SIT_WORK_LOC_V,
  ORACLE_OBJECTS.SIT_DELEV_LOC_V, ORACLE_OBJECTS.SIT_REASON_V, ORACLE_OBJECTS.DEP_PLACE_LOV,
  ORACLE_OBJECTS.PASSPORT_TYPE, ORACLE_OBJECTS.SCHOOL_TERM_LOV, ORACLE_OBJECTS.EDU_STAGE_LOV,
  ORACLE_OBJECTS.ACAD_YR_STRT_END_LOV, ORACLE_OBJECTS.YES_NO_LOV, ORACLE_OBJECTS.RFMI_USER_LOV,
  ORACLE_OBJECTS.EMPLOYMENT_STATUS_V,
];

const COLUMNS: Readonly<Record<string, ColumnContract>> = Object.freeze({
  ...Object.fromEntries(GLOBAL_LOVS.map((object) => [object, {}])),
  [ORACLE_OBJECTS.PERSONAL_DETAILS_V]: { USER_NAME: 'VARCHAR2', EMPLOYEE_NUMBER: 'VARCHAR2' },
  [ORACLE_OBJECTS.EMPLOYMENT_DETAILS_V]: { USER_NAME: 'VARCHAR2', PERSON_ID: 'NUMBER' },
  // Confirmed from the client's view definition (2026-09-14): REVIEW_DATE,
  // RELATED_EVENT, RELATED_EVENT_AR, USER_NAME (NOT NULL), LAST_RATING.
  [ORACLE_OBJECTS.PERFORMANCE_V]: { USER_NAME: 'VARCHAR2' },
  // Confirmed view definition (2026-09-14): USER_NAME NOT NULL, CHANGE_DATE,
  // MONTHLY_BASIC_SALARY, GRADE.
  [ORACLE_OBJECTS.SALARY_V]: { USER_NAME: 'VARCHAR2' },
  // Confirmed view definition (2026-09-14): USER_NAME NOT NULL plus the
  // assignment status/dates, department, job, grade and their _AR twins.
  [ORACLE_OBJECTS.EMPLOYMENT_V]: { USER_NAME: 'VARCHAR2' },
  // Confirmed view definition (2026-09-14): USER_NAME NOT NULL, DEPENDENT_ID,
  // PHONE_TYPE_AR, EMPLOYEE_NUMBER, PHONE_TYPE, PHONE_NUMBER, PHONE_ID.
  [ORACLE_OBJECTS.EMP_PHONE_V]: {
    USER_NAME: 'VARCHAR2', EMPLOYEE_NUMBER: 'VARCHAR2', DEPENDENT_ID: 'NUMBER', PHONE_ID: 'NUMBER',
  },
  // Confirmed view definitions (2026-09-14): both address views are keyed by
  // USER_NAME NOT NULL and expose ADDRESS_TYPE (the outside-address filter);
  // EMP_OUT_ADDRESS_V additionally has STYLE and COUNTRY_MEANING.
  [ORACLE_OBJECTS.EMP_IN_ADDRESS_V]: {
    USER_NAME: 'VARCHAR2', EMPLOYEE_NUMBER: 'VARCHAR2', ADDRESS_ID: 'NUMBER', ADDRESS_TYPE: 'VARCHAR2',
  },
  [ORACLE_OBJECTS.EMP_OUT_ADDRESS_V]: {
    USER_NAME: 'VARCHAR2', EMPLOYEE_NUMBER: 'VARCHAR2', ADDRESS_ID: 'NUMBER', ADDRESS_TYPE: 'VARCHAR2',
  },
  // Confirmed column list (2026-09-14): keyed by USER_NAME; DEPENDENT_ID /
  // ADDRESS_ID are the join keys the profile read uses for DEP_PHONE_V /
  // DEP_ADDRESS_V. The 54 payload columns are read with SELECT *.
  [ORACLE_OBJECTS.EMP_CONTACT_V]: {
    USER_NAME: 'VARCHAR2', EMPLOYEE_NUMBER: 'VARCHAR2', DEPENDENT_ID: 'NUMBER', ADDRESS_ID: 'NUMBER',
  },
  [ORACLE_OBJECTS.DEP_PHONE_V]: { DEPENDENT_ID: 'NUMBER' },
  [ORACLE_OBJECTS.DEP_ADDRESS_V]: { ADDRESS_ID: 'NUMBER' },
  [ORACLE_OBJECTS.APPROVE_SUMRY_V]: { APPROVER_USER_NAME: 'VARCHAR2', REQUESTOR_USER_NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.MY_REQEST_SUMMARY_V]: { APPROVER_USER_NAME: 'VARCHAR2', REQUESTOR_USER_NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.PNDNG_QID_V]: { APPROVER_USER_NAME: 'VARCHAR2', REQUESTOR_USER_NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.RFL_LEAVE_DET_V]: { USER_NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.RFL_REL_LEAVE1_V]: { USER_NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.RFL_REL_LEAVE2_V]: { USER_NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.LEAVE_CANCEL_V]: { PERSON_ID: 'NUMBER', NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.LEAVE_AMEND_V]: { PERSON_ID: 'NUMBER', NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.CONTRACT_YEAR_V]: { USER_NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.LETTER_MOBILE_NO_LOV]: { USER_NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.SCHOOL_NAME_LOV]: { USER_NAME: 'VARCHAR2', NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.REQUEST_TYPE_LOV]: { USER_NAME: 'VARCHAR2' },
  [ORACLE_OBJECTS.DEP_LOOKUP_LOV]: { D_DATA_TYPE: 'VARCHAR2' },
  [ORACLE_OBJECTS.ABSENCE_REASON_V]: { LEAVE_TYPE: 'VARCHAR2' },
});

export const SCOPED_ORACLE_LOVS: ReadonlySet<string> = new Set([
  ORACLE_OBJECTS.LEAVE_BAL_PLAN_LOV, ORACLE_OBJECTS.ANNUAL_TICKT_LOV,
  ORACLE_OBJECTS.LIBR_DFALT_LOV, ORACLE_OBJECTS.ALSR_DFALT_LOV,
  ORACLE_OBJECTS.RFL_LEAVE_DET_V, ORACLE_OBJECTS.RFL_REL_LEAVE1_V, ORACLE_OBJECTS.RFL_REL_LEAVE2_V,
  ORACLE_OBJECTS.LEAVE_CANCEL_V, ORACLE_OBJECTS.LEAVE_AMEND_V,
  ORACLE_OBJECTS.LETTER_MOBILE_NO_LOV, ORACLE_OBJECTS.SCHOOL_NAME_LOV, ORACLE_OBJECTS.REQUEST_TYPE_LOV,
]);

@Injectable()
export class OracleContractCatalog {
  async describeColumns(object: string): Promise<OracleColumnInfo[]> {
    const key = object.trim().toUpperCase();
    const columns = COLUMNS[key];
    if (!columns) throw new OracleContractUnavailableException(key, 'view columns');
    return Object.entries(columns).map(([name, dataType], index) => ({
      name, dataType, position: index + 1, nullable: true,
    }));
  }

  async describeArguments(object: string): Promise<OracleArgumentInfo[]> {
    const key = object.trim().toUpperCase();
    const contract = PROGRAMS[key];
    if (!contract) throw new OracleContractUnavailableException(key, 'program parameters');
    const [root, member] = key.split('.');
    const base: OracleArgumentInfo = {
      owner: '', ownerRank: 0, packageName: member ? root : null, objectName: member ?? root,
      overload: null, subprogramId: 1, name: null, position: 0, sequence: 0, dataLevel: 0,
      dataType: null, typeOwner: null, typeName: null, typeSubname: null, direction: null,
      defaulted: false,
    };
    const args = contract.params.map((param, index) => ({
      ...base,
      name: param.name.toUpperCase(), position: index + 1, sequence: index + 1,
      dataType: param.dataType, direction: param.direction, defaulted: param.defaulted,
      typeOwner: param.typeOwner ?? null, typeName: param.typeName ?? null,
      typeSubname: param.typeSubname ?? null,
    }));
    return contract.returnType ? [{
      ...base, dataType: contract.returnType.dataType,
      typeOwner: contract.returnType.typeOwner ?? null,
      typeName: contract.returnType.typeName ?? null,
      typeSubname: contract.returnType.typeSubname ?? null,
    }, ...args] : args;
  }

  inventory(): { views: string[]; programs: string[] } {
    return { views: Object.keys(COLUMNS), programs: Object.keys(PROGRAMS) };
  }
}
