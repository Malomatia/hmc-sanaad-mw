/*
 * Generates a complete, production-ready Postman Collection + Environment for
 * every endpoint in the NestJS app (94 routes across 22 controllers).
 *
 * Success examples are sourced, in priority order, from:
 *   1. Compiled *.examples.js modules (built from real captured api_test*.json
 *      data — see Docs history) for profile/employee/identity/leave/payslip/letters.
 *   2. A generic-but-realistic example matching the actual response envelope
 *      shape (read envelope / action envelope / LOV envelope) for every other
 *      endpoint, since no captured example exists for those yet.
 * Error examples always match the CURRENT real envelope shape produced by
 * AllExceptionsFilter: { success, message, status, httpStatusCode, errors? }
 * — no `category` field (it was intentionally removed from the wire response;
 * see all-exceptions.filter.ts).
 *
 * Run with: node postman/generate-full-collection.js
 * Outputs: postman/HMC-Sanaad-Full.postman_collection.json
 *          postman/HMC-Sanaad-Full.postman_environment.json
 */
const fs = require('fs');
const path = require('path');

if (fs.existsSync(path.join(__dirname, 'HMC-Sanaad-Full.postman_collection.json'))) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'version-collection.js'), ...process.argv.slice(2)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

const distDir = path.join(__dirname, '..', 'dist');
const outDir = __dirname;

function req(relPath) {
  try {
    return require(path.join(distDir, relPath));
  } catch (err) {
    console.warn(`WARN: could not load ${relPath}: ${err.message}`);
    return {};
  }
}

const profileEx = req('modules/profile/interface/profile.examples.js');
const employeeEx = req('modules/employee/interface/employee.examples.js');
const identityEx = req('modules/identity/interface/identity.examples.js');
const leaveEx = req('modules/leave/interface/leave.examples.js');
const payslipEx = req('modules/payslip/interface/payslip.examples.js');
const lettersEx = req('modules/letters/interface/letters.examples.js');

// ── Generic envelope templates (used when no real capture exists) ──────────
const readEnvelope = (result) => ({ result, opstatus: 0, status: 'success', httpStatusCode: 200 });
const actionSuccess = { status: 'success', successflag: 'S', message: 'Success', httpStatusCode: 200 };
const lovGeneric = (items) => ({ items });

// Standard error bodies — matches the REAL current AllExceptionsFilter shape
// (no `category`, only `success`/`message`/`status`/`httpStatusCode`, plus
// `errors` for 400 validation failures).
const ERRORS = {
  400: { success: false, message: 'Validation failed.', status: 'error', httpStatusCode: 400, errors: { details: ['field must not be empty'] } },
  401: { success: false, message: 'Authentication failed.', status: 'error', httpStatusCode: 401 },
  403: { success: false, message: 'You do not have permission to perform this action.', status: 'error', httpStatusCode: 403 },
  404: { success: false, message: 'The requested resource was not found.', status: 'error', httpStatusCode: 404 },
  409: { success: false, message: 'The requested operation cannot be completed.', status: 'error', httpStatusCode: 409 },
  500: { success: false, message: 'A database operation could not be completed. Please contact support if the problem persists.', status: 'error', httpStatusCode: 500 },
  503: { success: false, message: 'An external service is currently unavailable.', status: 'error', httpStatusCode: 503 },
};

/**
 * Endpoint registry — hand-compiled from every controller in src/**\/*.controller.ts.
 * kind: 'read' (GET, wrapped in the success envelope), 'action' (POST/PUT/etc.
 * mutating a SubmitResult, wrapped in the action envelope), 'lov' (GET
 * returning { items }), or 'raw' (health/diagnostics — unwrapped, @SkipEnvelope()).
 * errors: which of the standard error examples apply to this route.
 */
const MODULES = [
  {
    folder: 'Auth',
    items: [
      { name: 'API-1 Health Check (app launch)', method: 'POST', p: 'healthcheck', auth: 'public', kind: 'raw',
        body: { username: 'hmc12345', imeinumber: '356789012345678', platform: 'Android', appname: 'Sanaad', version: '1.0.0' },
        success: { status: 'ok' }, errors: [400, 500] },
      { name: 'API-2 User Validate (LDAP + send OTP)', method: 'POST', p: 'auth/initiate', auth: 'public', kind: 'raw',
        body: { username: 'hmc12345', imeinumber: '356789012345678', platform: 'Android' },
        success: { employeeusername: 'hmc12345', employeename: 'Name of employee', newuser: 'Yes', employeeflag: 'Yes', employeephonenumber: '7786XXXX', requestid: '35233177903C44859C82269212F48088' },
        errors: [400, 404, 500] },
      { name: 'API-3 Validate OTP', method: 'POST', p: 'auth/otp/validate', auth: 'public', kind: 'raw',
        body: { username: 'hmc12345', imeinumber: '356789012345678', otp: '232323', requestid: '13131313123' },
        success: { status: 'success', message: 'OTP Validated successfully' }, errors: [400, 401, 500] },
      { name: 'API-4 Set MPIN (first-time)', method: 'POST', p: 'auth/mpin/update', auth: 'public', kind: 'raw',
        body: { username: 'hmc12345', imeinumber: '356789012345678', mpin: '1234' },
        success: { status: 'success', message: 'MPIN set successfully' }, errors: [400, 500] },
      { name: 'API-5 Login (MPIN to JWT)', method: 'POST', p: 'auth/login', auth: 'public', kind: 'raw',
        body: { username: 'hmc12345', imeinumber: '356789012345678', mpin: '555407' },
        success: { status: 'success', token: '<jwt>', tokenType: 'Bearer', expiresIn: '1h', employeeusername: 'hmc12345', employeenumber: '053613', employeename: 'Name of employee', functionaccesslist: [{ functionname: 'Payroll SSRS', functioncode: 'PYSRS', status: '1' }] },
        errors: [400, 401, 500], savesToken: true },
      { name: 'API-6 Initiate Forgot MPIN', method: 'POST', p: 'auth/mpin/forgot', auth: 'public', kind: 'raw',
        body: { username: 'hmc12345', imeinumber: '356789012345678' },
        success: { status: 'initiated successfully', requestid: '13131313123' }, errors: [400, 404, 500] },
      { name: 'API-7 Reset MPIN', method: 'POST', p: 'auth/mpin/update/reset', auth: 'public', kind: 'raw',
        body: { username: 'hmc12345', imeinumber: '356789012345678', newmpin: '4321', otp: '987654', requestid: '13131313123' },
        success: { status: 'success', message: 'MPIN reset successfully' }, errors: [400, 401, 500] },
      { name: 'Current identity (me)', method: 'GET', p: 'auth/me', auth: 'bearer', kind: 'raw',
        success: { username: 'V-NFERNANDO', employeeNumber: '053613', roles: ['EMPLOYEE'], functions: ['PYSRS', 'LEAVE'] },
        errors: [401, 500] },
    ],
  },
  {
    folder: 'Profile',
    items: [
      { name: 'Get profile', method: 'GET', p: 'profile', auth: 'bearer', kind: 'read', query: { username: 'AIBRAHIM39', lang: 'en' },
        success: profileEx.PROFILE_GET_EXAMPLE, errors: [401, 404, 500] },
      { name: 'Update personal details', method: 'POST', p: 'profile/personal', auth: 'bearer', kind: 'action',
        body: { p_effective_date: '01-Jan-2026', p_first_name: 'Amir', p_middle_name: 'Sami Samir', p_last_name: 'Ibrahim', p_marital_status: 'Married', p_name_in_arabic: 'امير سامي سمير ابراهيم', p_title: 'Mr.', p_place_of_issue: 'Doha', p_country_of_issue: 'QA', p_visa_type: 'Work' },
        success: profileEx.PROFILE_UPDATE_PERSONAL_EXAMPLE, errors: [400, 401, 409, 500] },
      { name: 'Marital-status LOV', method: 'GET', p: 'profile/lov/marital-status', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: profileEx.PROFILE_MARITAL_LOV_EXAMPLE, errors: [401, 500] },
    ],
  },
  {
    folder: 'Employee',
    items: [
      { name: 'Employment details', method: 'GET', p: 'employee/employment', auth: 'bearer', kind: 'read', query: { enum: '053613', lang: 'en' },
        success: employeeEx.EMPLOYEE_EMPLOYMENT_EXAMPLE, errors: [401, 404, 500] },
      { name: 'Basic employee info', method: 'GET', p: 'employee/basic', auth: 'bearer', kind: 'read', query: { enum: '053613', lang: 'en' },
        success: employeeEx.EMPLOYEE_EMPLOYMENT_EXAMPLE, errors: [401, 404, 500] },
      { name: 'Performance records', method: 'GET', p: 'employee/performance', auth: 'bearer', kind: 'read', query: { username: 'V-ISIDDIQUI', lang: 'en' },
        success: employeeEx.EMPLOYEE_PERFORMANCE_EXAMPLE, errors: [401, 404, 500] },
      { name: 'Supervisor view', method: 'GET', p: 'employee/supervisor/views', auth: 'bearer', roles: ['SUPERVISOR'], kind: 'read', query: { username: 'AIBRAHIM39', lang: 'en' },
        success: employeeEx.EMPLOYEE_SUPERVISOR_VIEWS_EXAMPLE, errors: [401, 403, 404, 500] },
      { name: 'Supervisor update', method: 'POST', p: 'employee/supervisor', auth: 'bearer', roles: ['SUPERVISOR'], kind: 'action',
        body: { p_new_supervisor: '037915', p_reason: 'Team restructure' },
        success: employeeEx.EMPLOYEE_SUPERVISOR_UPDATE_EXAMPLE, errors: [400, 401, 403, 409, 500] },
    ],
  },
  {
    folder: 'Identity',
    items: [
      { name: 'QID details', method: 'GET', p: 'identity/qid', auth: 'bearer', kind: 'read', query: { username: 'AIBRAHIM39', lang: 'en' },
        success: identityEx.IDENTITY_QID_EXAMPLE, errors: [401, 404, 500] },
      { name: 'QID update', method: 'POST', p: 'identity/qid/update', auth: 'bearer', kind: 'action',
        body: { p_qid_number: '28481809470', p_iss_date: '2025-10-17', p_exp_date: '2029-10-16', p_qid_job: 'Analyst', p_file_name1: 'qid-front.jpg', p_attachment1: 'JVBERi0xLjQK' },
        success: identityEx.IDENTITY_QID_UPDATE_EXAMPLE, errors: [400, 401, 409, 500] },
      { name: 'Request company ID', method: 'POST', p: 'identity/idcard/apply', auth: 'bearer', kind: 'action',
        body: { p_reason: 'Lost', p_charge_for_new_id: 'No', p_delivery_loc: 'Main Office - Doha', p_working_location: 'WWRC, ACC, QRI', p_comments: 'Card lost.' },
        success: identityEx.IDENTITY_IDCARD_APPLY_EXAMPLE, errors: [400, 401, 409, 500] },
      { name: 'Work-location LOV', method: 'GET', p: 'identity/lov/work-location', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: identityEx.IDENTITY_WORK_LOCATION_LOV_EXAMPLE, errors: [401, 500] },
      { name: 'Delivery-location LOV', method: 'GET', p: 'identity/lov/delivery-location', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: identityEx.IDENTITY_DELIVERY_LOCATION_LOV_EXAMPLE, errors: [401, 500] },
      { name: 'ID reason LOV', method: 'GET', p: 'identity/lov/reason', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: identityEx.IDENTITY_REASON_LOV_EXAMPLE, errors: [401, 500] },
    ],
  },
  {
    folder: 'Leave',
    items: [
      { name: 'Leave balance', method: 'GET', p: 'leave/balance', auth: 'bearer', kind: 'read', query: { person_id: '852709', lang: 'en' },
        success: [], errors: [401, 404, 500] },
      { name: 'Leave history (ABSENCE_V)', method: 'GET', p: 'leaves', auth: 'bearer', kind: 'read',
        // leave_type is an optional ABSENCE_TYPE filter (English value).
        query: { user_name: 'V-NFERNANDO', leave_type: 'Casual Leave', lang: 'en' },
        success: leaveEx.LEAVES_LIST_EXAMPLE, errors: [400, 401, 500] },
      { name: 'Submit leave application', method: 'POST', p: 'leave/apply', auth: 'bearer', kind: 'action',
        // Full LEAV_OF_ABSEN_NEW_PR `p_*` payload (legacy camelCase
        // absenceType/absenceReason/startDate/endDate still accepted). Unused
        // params are sent as null (equivalent to omitting them); dates accept
        // yyyy-MM-dd or dd-Mon-yyyy. Up to 10 optional attachment slots:
        // p_file_name1..10 (file name) + p_attachment1..10 (base64 content,
        // bound to Oracle as BLOB).
        body: {
          p_absence_type: 'Casual Leave', p_absence_reason: 'Personal',
          p_start_date: '2025-06-12', p_end_date: '2025-06-14',
          p_adv_leave_salary: null, p_travel_days: null, p_leave_inc_bonus: null,
          p_annual_tkt: null, p_contractual_year: null, p_remarks: null,
          p_relationship_bereaved: null, p_bereavement_date: null,
          p_leave_classification: null, p_exam_date: null, p_examination_centre: null,
          p_marriage_date: null, p_delivery_date: null, p_number_of_children: null,
          p_doctor_comments: null, p_med_commt_decision: null, p_hc_number: null,
          p_order_id: null, p_order_date: null, p_encounter_id: null,
          p_visit_date: null, p_discharge_date: null, p_medical_service: null,
          p_facility: null, p_special_instructions: null, p_work_related_injury: null,
          p_unfit_number_of_days: null, p_practitioner_name: null,
          p_practitionr_corp_number: null, p_electronicaly_signed_on: null,
          p_deliver_date: null, p_primary_diagnosis: null,
          p_spouse_name: null, p_spouse_id: null,
          p_file_name1: null, p_attachment1: null, p_file_name2: null, p_attachment2: null,
          p_file_name3: null, p_attachment3: null, p_file_name4: null, p_attachment4: null,
          p_file_name5: null, p_attachment5: null, p_file_name6: null, p_attachment6: null,
          p_file_name7: null, p_attachment7: null, p_file_name8: null, p_attachment8: null,
          p_file_name9: null, p_attachment9: null, p_file_name10: null, p_attachment10: null },
        success: leaveEx.LEAVE_APPLY_EXAMPLE, errors: [400, 401, 409, 500] },
      { name: 'Leave duration calculation', method: 'POST', p: 'leave/calculate', auth: 'bearer', kind: 'read',
        body: { absenceType: 'Casual Leave', startDate: '12-Jun-2025', endDate: '14-Jun-2025' },
        success: leaveEx.LEAVE_CALCULATE_EXAMPLE, errors: [400, 401, 500] },
      { name: 'Leave amend', method: 'POST', p: 'leave/amend', auth: 'bearer', kind: 'action',
        // p_user_name is accepted but the authenticated username is enforced
        // server-side. Dates accept yyyy-MM-dd or dd-Mon-yyyy. Unused
        // attachment slots may be sent as null (equivalent to omitting them).
        body: {
          p_leave_type: 'Annual Leave', p_user_name: 'AIBRAHIM39',
          p_leave_to_amend: '62', p_new_end_date: '2026-06-20',
          p_comments: 'Extending by two days.',
          p_file_name1: null, p_attachment1: null, p_file_name2: null, p_attachment2: null,
          p_file_name3: null, p_attachment3: null, p_file_name4: null, p_attachment4: null,
          p_file_name5: null, p_attachment5: null, p_file_name6: null, p_attachment6: null,
          p_file_name7: null, p_attachment7: null, p_file_name8: null, p_attachment8: null,
          p_file_name9: null, p_attachment9: null, p_file_name10: null, p_attachment10: null },
        success: actionSuccess, errors: [400, 401, 409, 500] },
      { name: 'Leave cancel', method: 'POST', p: 'leave/cancel', auth: 'bearer', kind: 'action',
        body: { p_leave_type: 'Annual Leave', p_leave_to_cancel: '62', p_reason_for_cancel: 'Plans changed', p_remarks: 'Will re-apply later.' },
        success: actionSuccess, errors: [400, 401, 409, 500] },
      { name: 'Return from leave', method: 'POST', p: 'leave/return', auth: 'bearer', kind: 'action',
        body: { p_leave_details: '62', p_return_date: '15-Jun-2026', p_comments: 'Returned early.' },
        success: leaveEx.LEAVE_RETURN_EXAMPLE, errors: [400, 401, 409, 500] },
      { name: 'Leave types LOV', method: 'GET', p: 'leave/lov/types', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: leaveEx.LEAVE_TYPES_LOV_EXAMPLE, errors: [401, 500] },
      { name: 'Leave reasons LOV', method: 'GET', p: 'leave/lov/reasons', auth: 'bearer', kind: 'lov',
        // leave_type is optional — omit it to get every type's reasons.
        query: { lang: 'en', leave_type: 'Compassionate Leave' },
        success: leaveEx.LEAVE_REASONS_LOV_EXAMPLE, errors: [401, 500] },
      { name: 'Leave classes LOV', method: 'GET', p: 'leave/lov/classes', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: leaveEx.LEAVE_CLASSES_LOV_EXAMPLE, errors: [401, 500] },
      { name: 'Leave defaults', method: 'GET', p: 'leave/lov/defaults', auth: 'bearer', kind: 'read', query: { enum: '053613', lang: 'en' },
        success: leaveEx.LEAVE_DEFAULTS_EXAMPLE, errors: [401, 404, 500] },
      { name: 'Leave request LOVs (aggregate)', method: 'GET', p: 'leave/lov/request-lov', auth: 'bearer', kind: 'read', query: { enum: '053613', lang: 'en' },
        success: leaveEx.LEAVE_REQUEST_LOV_EXAMPLE, errors: [401, 500] },
      { name: 'Return-from-leave LOV', method: 'GET', p: 'leave/lov/return', auth: 'bearer', kind: 'lov', query: { username: 'V-ISIDDIQUI', lang: 'en' },
        success: leaveEx.LEAVE_EMPTY_ITEMS_EXAMPLE, errors: [401, 500] },
      { name: 'Leave cancel LOV', method: 'GET', p: 'leave/lov/cancel', auth: 'bearer', kind: 'lov', query: { username: 'V-ISIDDIQUI', lang: 'en' },
        success: leaveEx.LEAVE_EMPTY_ITEMS_EXAMPLE, errors: [401, 500] },
      { name: 'Leave amend LOV', method: 'GET', p: 'leave/lov/amend', auth: 'bearer', kind: 'lov', query: { username: 'V-ISIDDIQUI', lang: 'en' },
        success: leaveEx.LEAVE_EMPTY_ITEMS_EXAMPLE, errors: [401, 500] },
    ],
  },
  {
    folder: 'Payslip',
    items: [
      { name: 'Payslip periods', method: 'GET', p: 'payslip/periods', auth: 'bearer', kind: 'read', query: { username: 'AIBRAHIM39', lang: 'en' },
        success: payslipEx.PAYSLIP_PERIODS_EXAMPLE, errors: [401, 404, 500] },
      { name: 'Payslip count for a period', method: 'GET', p: 'payslip/count', auth: 'bearer', kind: 'read', query: { person_id: '852709', lang: 'en', payslipperiod: 'August 2024' },
        success: payslipEx.PAYSLIP_COUNT_EXAMPLE, errors: [401, 404, 500] },
      { name: 'Generate payslip', method: 'GET', p: 'payslip', auth: 'bearer', kind: 'read', query: { person_id: '852709', lang: 'en', payperiod: 'January 2026', assignmentid: '7179444713' },
        success: payslipEx.PAYSLIP_GENERATE_EXAMPLE, errors: [401, 404, 500] },
    ],
  },
  {
    folder: 'Letters',
    items: [
      { name: 'Letter request LOVs', method: 'GET', p: 'letters/lov', auth: 'bearer', kind: 'read', query: { enum: 'V-ISIDDIQUI', lang: 'en' },
        success: lettersEx.LETTERS_LOV_EXAMPLE, errors: [401, 404, 500] },
      { name: 'Submit letter request', method: 'POST', p: 'letters/apply', auth: 'bearer', kind: 'action',
        body: { p_letter_language: 'English', p_letter_name: 'Bank letter with details with effective date', p_country: 'Qatar', p_no_of_copies: '1', p_mobile_number: '66043671', p_letter_delivery_loc: 'Main Office - Doha', p_purpose_comments: 'Bank loan application' },
        success: actionSuccess, errors: [400, 401, 409, 500] },
    ],
  },
  {
    folder: 'Contact',
    items: [
      { name: 'Phone-type LOV', method: 'GET', p: 'contact/lov/phone-type', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'Qatar Mobile Number', meaning: 'Qatar Mobile Number' }]), errors: [401, 500] },
      { name: 'Update phone number(s)', method: 'POST', p: 'contact/phone', auth: 'bearer', kind: 'action',
        body: { phones: [{ phoneId: '', phoneType: 'Qatar Mobile Number', phoneNumber: '55512345' }] },
        success: actionSuccess, errors: [400, 401, 409, 500] },
      { name: 'Delete phone', method: 'POST', p: 'contact/phone/delete', auth: 'bearer', kind: 'action',
        body: { phoneId: '12345' }, success: actionSuccess, errors: [400, 401, 404, 500] },
      { name: 'Create address', method: 'POST', p: 'contact/address', auth: 'bearer', kind: 'action',
        body: { addressType: 'Primary Home Country Address', country: 'QA' }, success: actionSuccess, errors: [400, 401, 409, 500] },
      { name: 'Update address', method: 'POST', p: 'contact/address/update', auth: 'bearer', kind: 'action',
        body: { p_address_id: '1720601', addressType: 'Primary Home Country Address', country: 'QA' }, success: actionSuccess, errors: [400, 401, 404, 500] },
      { name: 'Country LOV', method: 'GET', p: 'contact/lov/country', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'QA', meaning: 'Qatar' }]), errors: [401, 500] },
    ],
  },
  {
    folder: 'Dependents',
    items: [
      { name: 'Add dependent', method: 'POST', p: 'dependents', auth: 'bearer', kind: 'action',
        body: { p_dependent_name: 'Sara Amir Ibrahim', p_relationship: 'Daughter', p_dob: '01-Jan-2015' },
        success: actionSuccess, errors: [400, 401, 409, 500] },
      { name: 'Update dependent', method: 'POST', p: 'dependents/update', auth: 'bearer', kind: 'action',
        body: { p_dependent_id: '12345', p_dependent_name: 'Sara Amir Ibrahim' }, success: actionSuccess, errors: [400, 401, 404, 500] },
      { name: 'Delete dependent', method: 'POST', p: 'dependents/delete', auth: 'bearer', kind: 'action',
        body: { p_dependent_id: '12345' }, success: actionSuccess, errors: [400, 401, 404, 500] },
      { name: 'Dependent LOV', method: 'GET', p: 'dependents/lov', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'Daughter', meaning: 'Daughter' }]), errors: [401, 500] },
      { name: 'Passport types', method: 'GET', p: 'dependents/passport/types', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'Ordinary', meaning: 'Ordinary' }]), errors: [401, 500] },
      { name: 'Passport detail request', method: 'POST', p: 'dependents/passport/apply', auth: 'bearer', kind: 'action',
        body: { p_dependent_id: '12345', p_passport_type: 'Ordinary', p_passport_number: 'Q1234567' }, success: actionSuccess, errors: [400, 401, 409, 500] },
      { name: 'Passport issue-place LOV', method: 'GET', p: 'dependents/passport/issue-place', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'Doha', meaning: 'Doha' }]), errors: [401, 500] },
    ],
  },
  {
    folder: 'School Fees',
    items: [
      { name: 'Submit school-fee request', method: 'POST', p: 'school-fees/apply', auth: 'bearer', kind: 'action',
        body: { p_child_name: 'Sara Amir Ibrahim', p_school_name: 'DPS Modern Indian School', p_academic_year: '2025-2026', p_term: 'Term 1' },
        success: actionSuccess, errors: [400, 401, 409, 500] },
      { name: 'School name LOV', method: 'GET', p: 'school-fees/lov/schools', auth: 'bearer', kind: 'lov', query: { lang: 'en', username: 'AIBRAHIM39' },
        success: lovGeneric([{ code: 'DPS Modern Indian School', meaning: 'DPS Modern Indian School' }]), errors: [401, 500] },
      { name: 'School term LOV', method: 'GET', p: 'school-fees/lov/terms', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'Term 1', meaning: 'Term 1' }]), errors: [401, 500] },
      { name: 'Education stage LOV', method: 'GET', p: 'school-fees/lov/edu-stage', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'Primary', meaning: 'Primary' }]), errors: [401, 500] },
      { name: 'Academic year LOV', method: 'GET', p: 'school-fees/lov/academic-year', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: '2025-2026', meaning: '2025-2026' }]), errors: [401, 500] },
      { name: 'Request type LOV', method: 'GET', p: 'school-fees/lov/request-type', auth: 'bearer', kind: 'lov', query: { lang: 'en', username: 'AIBRAHIM39' },
        success: lovGeneric([{ code: 'New', meaning: 'New' }]), errors: [401, 500] },
      { name: 'Child details', method: 'GET', p: 'school-fees/children', auth: 'bearer', kind: 'read', query: { enum: '053613', lang: 'en', acadyrstrtdt: '20200202' },
        success: [], errors: [401, 404, 500] },
    ],
  },
  {
    folder: 'Annual Ticket',
    items: [
      { name: 'Annual ticket master LOV', method: 'GET', p: 'annual-ticket/master', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'Economy', meaning: 'Economy' }]), errors: [401, 500] },
      { name: 'Submit annual ticket', method: 'POST', p: 'annual-ticket/apply', auth: 'bearer', kind: 'action',
        body: { p_ticket_class: 'Economy', p_travel_year: '2026' }, success: actionSuccess, errors: [400, 401, 409, 500] },
    ],
  },
  {
    folder: 'Approvals',
    items: [
      { name: 'Approvals summary', method: 'GET', p: 'approvals', auth: 'bearer', roles: ['APPROVER', 'SUPERVISOR'], kind: 'read', query: { enum: '053613', lang: 'en' },
        success: [], errors: [401, 403, 500] },
      { name: 'My requests', method: 'GET', p: 'approvals/my-requests', auth: 'bearer', roles: ['APPROVER', 'SUPERVISOR'], kind: 'read', query: { enum: '053613', lang: 'en' },
        success: [], errors: [401, 403, 500] },
      { name: 'Worklist main', method: 'GET', p: 'approvals/worklist', auth: 'bearer', roles: ['APPROVER', 'SUPERVISOR'], kind: 'read', query: { enum: '053613', lang: 'en' },
        success: [], errors: [401, 403, 500] },
      { name: 'Worklist summary', method: 'GET', p: 'approvals/worklist/summary', auth: 'bearer', roles: ['APPROVER', 'SUPERVISOR'], kind: 'read', query: { enum: '053613', lang: 'en', notificationId: '99001' },
        success: [], errors: [401, 403, 500] },
      { name: 'Worklist action history', method: 'GET', p: 'approvals/worklist/:id/history', auth: 'bearer', roles: ['APPROVER', 'SUPERVISOR'], kind: 'read', pathVar: { id: '99001' }, query: { lang: 'en', itemType: 'HRSSA' },
        success: [], errors: [401, 403, 404, 500] },
      { name: 'Approval detail', method: 'GET', p: 'approvals/:id/details', auth: 'bearer', roles: ['APPROVER', 'SUPERVISOR'], kind: 'read', pathVar: { id: '99001' }, query: { lang: 'en' },
        success: {}, errors: [401, 403, 404, 500] },
      { name: 'Approve/Reject', method: 'POST', p: 'approvals/:id/decision', auth: 'bearer', roles: ['APPROVER', 'SUPERVISOR'], kind: 'action', pathVar: { id: '99001' },
        body: { decision: 'APPROVE', itemKey: '99001', itemType: 'HRSSA', comment: 'Approved.' }, success: actionSuccess, errors: [400, 401, 403, 404, 409, 500] },
      { name: 'Reassign approval', method: 'POST', p: 'approvals/:id/reassign', auth: 'bearer', roles: ['APPROVER', 'SUPERVISOR'], kind: 'action', pathVar: { id: '99001' },
        body: { assignTo: '037915', type: 'DELEGATE', comment: 'Reassigning while on leave.' }, success: actionSuccess, errors: [400, 401, 403, 404, 409, 500] },
    ],
  },
  {
    folder: 'Appointments',
    items: [
      { name: 'Upcoming appointments', method: 'GET', p: 'appointments/upcoming', auth: 'bearer', kind: 'read', query: { enum: '053613', lang: 'en' },
        success: [], errors: [401, 500, 503] },
      { name: 'Clinic master details', method: 'GET', p: 'appointments/masters', auth: 'bearer', kind: 'read', query: { lang: 'en' },
        success: {}, errors: [401, 500, 503] },
      { name: 'Booking screen init', method: 'GET', p: 'appointments/booking-init', auth: 'bearer', kind: 'read', query: { enum: '053613', lang: 'en' },
        success: {}, errors: [401, 500, 503] },
      { name: 'Book appointment', method: 'POST', p: 'appointments/book', auth: 'bearer', kind: 'action',
        body: { clinicId: 'CLINIC-001', locationId: 'LOC-001' }, success: actionSuccess, errors: [400, 401, 409, 500, 503] },
    ],
  },
  {
    folder: 'Lookups',
    items: [
      { name: 'Yes/No LOV', method: 'GET', p: 'lookups/yes-no', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'Yes', meaning: 'Yes' }, { code: 'No', meaning: 'No' }]), errors: [401, 500] },
      { name: 'RFMI user LOV', method: 'GET', p: 'lookups/rfmi-user', auth: 'bearer', kind: 'lov', query: { lang: 'en' },
        success: lovGeneric([{ code: 'V-NFERNANDO', meaning: 'V-NFERNANDO' }]), errors: [401, 500] },
      { name: 'Generic LOV read by name', method: 'GET', p: 'lookups/lov', auth: 'bearer', kind: 'lov', query: { lovname: 'EMP_MARITAL_LOV', lang: 'en' },
        success: lovGeneric([{ code: 'Married', meaning: 'Married' }]), errors: [401, 404, 500] },
      { name: 'Generic master-lookup read by name', method: 'GET', p: 'lookups/master', auth: 'bearer', kind: 'lov', query: { lookupname: 'GetLeaveType', lang: 'en' },
        success: lovGeneric([{ code: 'Annual Leave', meaning: 'Annual Leave' }]), errors: [401, 404, 500] },
    ],
  },
  {
    folder: 'Health',
    items: [
      { name: 'Liveness check', method: 'GET', p: 'health', auth: 'public', kind: 'raw',
        success: { status: 'ok', uptime: 120, oracle: { enabled: true, reachable: true } }, errors: [500] },
      { name: 'Oracle DB connectivity test', method: 'GET', p: 'health/db', auth: 'public', kind: 'raw',
        success: { status: 'ok', connected: true, latencyMs: 12 }, errors: [500] },
    ],
  },
  {
    folder: 'Internal - Diagnostics (dev only)',
    items: [
      { name: 'Oracle logs dashboard', method: 'GET', p: 'diagnostics/oracle-logs/view', auth: 'bearer', kind: 'raw', success: '<html>...</html>', errors: [401, 500] },
      { name: 'Oracle logs (JSON)', method: 'GET', p: 'diagnostics/oracle-logs', auth: 'bearer', kind: 'read', query: { limit: '100' }, success: { items: [], total: 0 }, errors: [401, 500] },
      { name: 'Oracle logs stats', method: 'GET', p: 'diagnostics/oracle-logs/stats', auth: 'bearer', kind: 'read', success: {}, errors: [401, 500] },
      { name: 'Oracle object metadata', method: 'GET', p: 'diagnostics/oracle-object', auth: 'bearer', kind: 'read', query: { name: 'XXHMC_SND_PAYSLIP_PR' }, success: {}, errors: [401, 404, 500] },
      { name: 'Clear Oracle log buffer', method: 'DELETE', p: 'diagnostics/oracle-logs', auth: 'bearer', kind: 'action', success: { cleared: true }, errors: [401, 500] },
      { name: 'API logs dashboard', method: 'GET', p: 'api-logs/view', auth: 'bearer', kind: 'raw', success: '<html>...</html>', errors: [401, 500] },
      { name: 'API logs (JSON)', method: 'GET', p: 'api-logs', auth: 'bearer', kind: 'read', query: { limit: '100' }, success: { items: [], total: 0 }, errors: [401, 500] },
      { name: 'API logs statistics', method: 'GET', p: 'api-logs/statistics', auth: 'bearer', kind: 'read', success: {}, errors: [401, 500] },
      { name: 'API logs — errors only', method: 'GET', p: 'api-logs/errors', auth: 'bearer', kind: 'read', success: { items: [], total: 0 }, errors: [401, 500] },
      { name: 'API logs — success only', method: 'GET', p: 'api-logs/success', auth: 'bearer', kind: 'read', success: { items: [], total: 0 }, errors: [401, 500] },
      { name: 'API logs — slow requests', method: 'GET', p: 'api-logs/slow', auth: 'bearer', kind: 'read', success: { items: [], total: 0 }, errors: [401, 500] },
      { name: 'API log by id', method: 'GET', p: 'api-logs/:id', auth: 'bearer', kind: 'read', pathVar: { id: '1' }, success: {}, errors: [401, 404, 500] },
      { name: 'Clear API log buffer', method: 'DELETE', p: 'api-logs', auth: 'bearer', kind: 'action', success: { cleared: true }, errors: [401, 500] },
    ],
  },
];

// ── Builders ─────────────────────────────────────────────────────────────

function toPostmanUrl(p, query, pathVar) {
  let pathStr = p;
  const pathParts = [];
  for (const seg of p.split('/')) {
    if (seg.startsWith(':')) {
      const key = seg.slice(1);
      pathParts.push(`:${key}`);
    } else {
      pathParts.push(seg);
    }
  }
  const variable = pathVar
    ? Object.entries(pathVar).map(([key, value]) => ({ key, value }))
    : undefined;
  const queryArr = query ? Object.entries(query).map(([key, value]) => ({ key, value: String(value) })) : undefined;
  const rawQuery = queryArr && queryArr.length ? '?' + queryArr.map((q) => `${q.key}=${encodeURIComponent(q.value)}`).join('&') : '';
  return {
    raw: `{{baseUrl}}/${pathParts.join('/')}${rawQuery}`,
    host: ['{{baseUrl}}'],
    path: pathParts,
    query: queryArr,
    variable,
  };
}

function toResponseEntry(name, code, request, body) {
  return {
    name,
    originalRequest: request,
    status: code >= 200 && code < 300 ? 'OK' : code === 401 ? 'Unauthorized' : code === 403 ? 'Forbidden' : code === 404 ? 'Not Found' : code === 409 ? 'Conflict' : code === 503 ? 'Service Unavailable' : code >= 500 ? 'Internal Server Error' : 'Bad Request',
    code,
    _postman_previewlanguage: 'json',
    header: [{ key: 'Content-Type', value: 'application/json' }],
    body: JSON.stringify(body, null, 2),
  };
}

function testScript(ep, successCode) {
  const lines = [
    `pm.test("Status is ${successCode}", function () {`,
    `    pm.response.to.have.status(${successCode});`,
    `});`,
    ``,
    `pm.test("Response time is less than 5 seconds", function () {`,
    `    pm.expect(pm.response.responseTime).to.be.below(5000);`,
    `});`,
    ``,
    `pm.test("Response is valid JSON", function () {`,
    `    pm.response.to.be.json;`,
    `});`,
  ];
  if (ep.kind === 'read') {
    lines.push(
      ``,
      `pm.test("Has success envelope fields", function () {`,
      `    const json = pm.response.json();`,
      `    pm.expect(json).to.have.property('status', 'success');`,
      `    pm.expect(json).to.have.property('result');`,
      `    pm.expect(json).to.have.property('httpStatusCode');`,
      `});`,
    );
  } else if (ep.kind === 'action') {
    lines.push(
      ``,
      `pm.test("Has action envelope fields", function () {`,
      `    const json = pm.response.json();`,
      `    pm.expect(json).to.have.property('status');`,
      `    pm.expect(json).to.have.property('successflag');`,
      `    pm.expect(json).to.have.property('message');`,
      `});`,
    );
  } else if (ep.kind === 'lov') {
    lines.push(
      ``,
      `pm.test("Has items array", function () {`,
      `    const json = pm.response.json();`,
      `    pm.expect(json.result).to.have.property('items');`,
      `    pm.expect(json.result.items).to.be.an('array');`,
      `});`,
    );
  }
  if (ep.savesToken) {
    lines.push(
      ``,
      `if (pm.response.code === 200) {`,
      `    const json = pm.response.json();`,
      `    if (json.token) {`,
      `        pm.collectionVariables.set('token', json.token);`,
      `        console.log('Saved {{token}} from login response.');`,
      `    }`,
      `}`,
    );
  }
  return lines;
}

function errorTestScript(code) {
  return [
    `pm.test("Status is ${code}", function () {`,
    `    pm.response.to.have.status(${code});`,
    `});`,
    ``,
    `pm.test("Response is valid JSON", function () {`,
    `    pm.response.to.be.json;`,
    `});`,
    ``,
    `pm.test("Has error envelope fields", function () {`,
    `    const json = pm.response.json();`,
    `    pm.expect(json).to.have.property('success', false);`,
    `    pm.expect(json).to.have.property('message');`,
    `    pm.expect(json).to.have.property('status', 'error');`,
    `});`,
  ];
}

function docDescription(ep) {
  const lines = [];
  lines.push(`**Purpose:** ${ep.name}`);
  lines.push('');
  lines.push(`**Auth:** ${ep.auth === 'public' ? 'Public — no token required' : 'Bearer {{token}} required'}`);
  if (ep.roles && ep.roles.length) lines.push(`**Required role(s):** ${ep.roles.join(', ')}`);
  if (ep.query) lines.push(`**Query parameters:** ${Object.keys(ep.query).join(', ')}`);
  if (ep.pathVar) lines.push(`**Path variables:** ${Object.keys(ep.pathVar).join(', ')}`);
  if (ep.body) lines.push(`**Request body:** see the raw body below.`);
  lines.push('');
  lines.push(
    ep.kind === 'action'
      ? '**Response:** Sanaad action envelope — `{ status, successflag, message, httpStatusCode, result? }`.'
      : ep.kind === 'lov'
        ? '**Response:** Sanaad read envelope wrapping `{ items: [...] }`.'
        : ep.kind === 'read'
          ? '**Response:** Sanaad read envelope — `{ result, opstatus, status, httpStatusCode }`.'
          : '**Response:** unwrapped (not part of the standard envelope).',
  );
  return lines.join('\n');
}

let totalEndpoints = 0;
let totalSuccessExamples = 0;
let totalErrorExamples = 0;
const manualReview = [];

const folders = MODULES.map((mod) => {
  const items = mod.items.map((ep) => {
    totalEndpoints++;
    const url = toPostmanUrl(ep.p, ep.query, ep.pathVar);
    const request = {
      auth: ep.auth === 'public' ? { type: 'noauth' } : undefined,
      method: ep.method,
      header: ep.body ? [{ key: 'Content-Type', value: 'application/json' }] : [],
      url,
      ...(ep.body
        ? { body: { mode: 'raw', raw: JSON.stringify(ep.body, null, 2), options: { raw: { language: 'json' } } } }
        : {}),
      description: docDescription(ep),
    };

    const successCode = 200;
    let successBody = ep.success;
    const usedRealCapture = !!(
      (mod.folder === 'Profile' && (ep.success === profileEx.PROFILE_GET_EXAMPLE || ep.success === profileEx.PROFILE_MARITAL_LOV_EXAMPLE || ep.success === profileEx.PROFILE_UPDATE_PERSONAL_EXAMPLE)) ||
      (mod.folder === 'Employee' && Object.values(employeeEx).includes(ep.success)) ||
      (mod.folder === 'Identity' && Object.values(identityEx).includes(ep.success)) ||
      (mod.folder === 'Leave' && Object.values(leaveEx).includes(ep.success)) ||
      (mod.folder === 'Payslip' && Object.values(payslipEx).includes(ep.success)) ||
      (mod.folder === 'Letters' && Object.values(lettersEx).includes(ep.success))
    );
    if (!usedRealCapture) {
      manualReview.push(`${ep.method} /${ep.p} (${mod.folder}) — no captured real response; used a generic placeholder example.`);
    }

    let envelopeBody = successBody;
    if (ep.kind === 'read') envelopeBody = readEnvelope(successBody);
    else if (ep.kind === 'lov') envelopeBody = readEnvelope(successBody);
    // 'action' bodies are already full envelopes (actionSuccess or *_EXAMPLE constants); 'raw' bodies are used as-is.

    const responses = [];
    responses.push(toResponseEntry('Success (200)', successCode, request, envelopeBody));
    totalSuccessExamples++;
    for (const code of ep.errors || []) {
      responses.push(toResponseEntry(`Error (${code})`, code, request, ERRORS[code]));
      totalErrorExamples++;
    }

    const event = [
      {
        listen: 'test',
        script: { type: 'text/javascript', exec: testScript(ep, successCode) },
      },
    ];

    const item = {
      name: `${ep.method} /${ep.p}`,
      event,
      request,
      response: responses,
    };
    return item;
  });
  return { name: mod.folder, item: items };
});

const collection = {
  info: {
    name: 'HMC Sanaad B2E API — Full Collection',
    _postman_id: 'hmc-sanaad-full-collection-0001',
    description:
      'Auto-generated from every controller in the NestJS project (94 endpoints, 22 controllers). ' +
      'Success examples use real captured data (api_test_work.json) where available (Profile, Employee, ' +
      'Identity, Leave, Payslip, Letters); every other endpoint uses a generic-but-realistic example matching ' +
      'its actual envelope shape and is flagged for manual review in the accompanying report. ' +
      'Error examples match the CURRENT response shape produced by AllExceptionsFilter: ' +
      '{ success, message, status, httpStatusCode, errors? } — no `category` field (removed from the wire response).\n\n' +
      'Run "API-5 Login" first — its test script auto-saves {{token}}, used by every other request via collection-level Bearer auth.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:443/api/v1', type: 'string' },
    { key: 'token', value: '', type: 'string' },
  ],
  item: folders,
};

fs.writeFileSync(path.join(outDir, 'HMC-Sanaad-Full.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');

const environment = {
  id: 'hmc-sanaad-full-env-0001',
  name: 'HMC Sanaad — Full Collection Env',
  values: [
    { key: 'baseUrl', value: 'http://localhost:443/api/v1', type: 'default', enabled: true },
    { key: 'token', value: '', type: 'secret', enabled: true },
    { key: 'username', value: 'AIBRAHIM39', type: 'default', enabled: true },
    { key: 'enum', value: '053613', type: 'default', enabled: true },
    { key: 'person_id', value: '852709', type: 'default', enabled: true },
    { key: 'language', value: 'en', type: 'default', enabled: true },
    { key: 'companyCode', value: 'HMC', type: 'default', enabled: true },
    { key: 'employeeId', value: '053613', type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

fs.writeFileSync(path.join(outDir, 'HMC-Sanaad-Full.postman_environment.json'), JSON.stringify(environment, null, 2) + '\n');

console.log(`Modules: ${MODULES.length}`);
console.log(`Endpoints: ${totalEndpoints}`);
console.log(`Success examples: ${totalSuccessExamples}`);
console.log(`Error examples: ${totalErrorExamples}`);
console.log(`Endpoints needing manual review (no real capture): ${manualReview.length}`);
fs.writeFileSync(
  path.join(outDir, 'GENERATION_REPORT.md'),
  [
    '# Postman Collection Generation Report',
    '',
    `- Total modules: ${MODULES.length}`,
    `- Total endpoints: ${totalEndpoints}`,
    `- Total success examples: ${totalSuccessExamples}`,
    `- Total error examples: ${totalErrorExamples}`,
    '',
    '## Endpoints requiring manual review (no captured real response — generic placeholder used)',
    '',
    ...manualReview.map((m) => `- ${m}`),
  ].join('\n') + '\n',
);
