import { attachmentProperties, ATTACHMENT_EXAMPLE } from '@shared/swagger/request-body.util';

/**
 * Real successful `result` payloads captured from api_test.json, used as Swagger
 * examples. These are the inner `result` values; the ResponseInterceptor wraps
 * them in the Sanaad success envelope.
 */

/** op 2 — GET /profile?enum=&lang= */
export const PROFILE_GET_EXAMPLE = {
  personal: {
    username: 'V-NFERNANDO',
    employeeNumber: '053613',
    joiningDate: '18-Jun-2019',
    emailAddress: 'username@null.qa',
    fullName: 'Mr. Mohammad Danish Imam',
    firstName: 'Mohammad Danish',
    lastName: 'Imam',
    dateOfBirth: '28-Feb-1981',
    qidNumber: '28135659441',
    gender: 'Male',
    maritalStatus: 'Married',
  },
  phones: [
    {
      phoneId: '787415',
      username: 'V-NFERNANDO',
      employeeNumber: '053613',
      phoneType: 'Home',
      phoneNumber: '34098571',
      dependentId: '852709',
    },
  ],
  outsideAddresses: [
    {
      addressId: '1720616',
      username: 'V-NFERNANDO',
      employeeNumber: '053613',
      addressLine1: 'S/o- Mohammad Khalid Imam',
      addressLine2: 'Mohalla-Irki, Near-Urdu Primary School',
      addressLine3: 'Eidgah Masjid Road',
      addressType: 'Primary Home Country Address',
      addressTypeAr: 'عنوان الوطن الأم الرئيسي',
      country: 'IN',
      townOrCity: 'jehanabaa',
      region1: 'Bihar',
      postalCode: '804408',
      style: 'GENERIC',
    },
  ],
  insideAddresses: [
    {
      addressId: '1720617',
      username: 'V-NFERNANDO',
      employeeNumber: '053613',
      addressLine1: 'Building 12, Zone 25',
      addressLine2: 'Street 830',
      addressType: 'Qatar Address',
      addressTypeAr: 'عنوان قطر',
      country: 'QA',
      townOrCity: 'Doha',
    },
  ],
  // XXHMC_SND_DEP_PHONE_V rows, keyed by the dependents' DEPENDENT_ID.
  dependentPhones: [
    {
      phoneId: '787416',
      dependentId: '1607679',
      phoneType: 'Qatar Mobile Number',
      typeCode: 'M_QA',
      phoneNumber: '55512345',
    },
  ],
  // XXHMC_SND_DEP_ADDRESS_V rows, keyed by the dependents' ADDRESS_ID.
  dependentAddresses: [
    {
      addressId: '1720617',
      addressLine1: 'Building 12, Zone 25',
      addressLine2: 'Street 830',
      addressType: 'Qatar Address',
      addressTypeAr: 'عنوان قطر',
      typeCode: 'QATAR',
      country: 'QA',
      townOrCity: 'Doha',
    },
  ],
  // XXHMC_SND_EMP_CONTACT_V rows (dependent list with QID/passport/visa + address).
  dependents: [
    {
      dependentId: '1607679',
      username: 'V-NFERNANDO',
      employeeNumber: '053613',
      firstName: 'Jerome Amir',
      middleName: 'Sami Samir',
      lastName: 'Ibrahim',
      dateOfBirth: '23-Sep-2010',
      gender: 'Male',
      qidNumber: '31063641234',
      contactType: 'Child',
      relationshipStartDate: '23-Sep-2010',
      passportNumber: 'A12345678',
      dateOfIssue: '01-Jan-2022',
      dateOfExpiry: '01-Jan-2032',
      placeOfIssue: 'Doha',
      countryOfIssue: 'Qatar',
      countryOfIssueCode: 'QA',
      visaType: 'QID(Qatari)',
      visaValidity: 'Yes',
      idNumber: '31063641234',
      expiryDate: '22-Sep-2030',
      typeOfSponsorship: 'Family',
      addressId: '1720617',
      addressLine1: 'Building 12, Zone 25',
      addressLine2: 'Street 830',
      addressType: 'Qatar Address',
      addressTypeAr: 'عنوان قطر',
      country: 'QA',
      townOrCity: 'Doha',
      contactTypeId: '271821',
      relationshipId: '1607680',
      depStatus: 'Active',
      employmentStatus: 'Active Assignment',
    },
  ],
};

/**
 * GET /profile/notifications?username=&lang= — raw WORKLISTS_V rows, ALL
 * columns relayed as-is (SELECT *, no mapping). Captured live 2026-09-01.
 */
export const PROFILE_NOTIFICATIONS_EXAMPLE = [
  {
    NOTIFICATION_ID: 123859434,
    FROM_USER: 'SYSADMIN',
    TO_USER: '037400    - Amir Ibrahim',
    SUBJECT:
      'Return from Leave has been forwarded for approval to 037911    - Rizwan Aboobacker',
    LANGUAGE: 'US',
    BEGIN_DATE: '2026-09-01T11:06:32.000Z',
    DUE_DATE: null,
    STATUS: 'OPEN',
    RECIPIENT_ROLE: 'AIBRAHIM39',
    END_DATE: null,
    TYPE: 'HR',
    MORE_INFO_ROLE: null,
    FROM_ROLE: 'SYSADMIN',
    MESSAGE_TYPE: 'HRSSA',
    ITEM_KEY: '18876168',
    MESSAGE_NAME: 'HR_EMBD_NTFY_APPROVAL_FWD_MSG',
    MAIL_STATUS: 'MAIL',
    ORIGINAL_RECIPIENT: 'AIBRAHIM39',
  },
];

/**
 * op 69 — GET /profile/notifications/summary?username=&notificationId=&lang= —
 * the same raw WORKLISTS_V rows as /profile/notifications, scoped to one
 * NOTIFICATION_ID (getworklistsummary).
 */
export const PROFILE_NOTIFICATION_SUMMARY_EXAMPLE = PROFILE_NOTIFICATIONS_EXAMPLE;

/**
 * op 70 — GET /profile/notifications/:id/history?itemType=&lang= — raw
 * ACTION_HISTORY_V rows plus the query's `rownum sequence_num`
 * (getworklistactionhistory). Row shape from the staging capture of the
 * approvals history route (same repository read).
 */
export const PROFILE_NOTIFICATION_HISTORY_EXAMPLE = [
  {
    SEQUENCE_NUM: 1,
    NOTIFICATION_ID: 0,
    FROM_ROLE: 'AIBRAHIM39',
    FROM_USER: '037400    - Amir Ibrahim',
    TO_ROLE: null,
    TO_USER: null,
    ACTION_NAME: 'Submit',
    ACTION_COMMENT: null,
    ACTION_DATE: '2026-08-23T08:54:26.000Z',
    ITEM_TYPE: 'HRSSA',
    ITEM_KEY: '18875965',
  },
  {
    SEQUENCE_NUM: 2,
    NOTIFICATION_ID: 123859198,
    FROM_ROLE: 'MIMRAN2',
    FROM_USER: '048945    - Mohammed Imran',
    TO_ROLE: null,
    TO_USER: null,
    ACTION_NAME: 'Pending',
    ACTION_COMMENT: null,
    ACTION_DATE: null,
    ITEM_TYPE: 'HRSSA',
    ITEM_KEY: '18875965',
  },
];

/** op 63 — GET /profile/lov/marital-status?lang= */
export const PROFILE_MARITAL_LOV_EXAMPLE = {
  items: [
    { code: 'Widower/Widow', meaning: 'Widower/Widow' },
    { code: 'Divorced', meaning: 'Divorced' },
    { code: 'Married', meaning: 'Married' },
    { code: 'Single', meaning: 'Single' },
  ],
};

/**
 * op 48 — POST /profile/personal request body (UPD_PERSONAL_INFO_PR).
 * Field names are the procedure's `p_*` bind names (the backend also accepts the
 * bare `first_name` form). `p_user_name` is taken from the JWT and must NOT be
 * sent. `p_marital_status` uses a code from GET /profile/lov/marital-status.
 * Attachment slots `p_file_name1..10` / `p_attachment1..10` are optional.
 */
export const PROFILE_UPDATE_PERSONAL_BODY = {
  description: 'Personal-details update payload (UPD_PERSONAL_INFO_PR `p_*` binds).',
  schema: {
    type: 'object',
    required: ['p_effective_date', 'p_first_name', 'p_last_name', 'p_marital_status'],
    properties: {
      p_effective_date: { type: 'string', example: '01-Jan-2026', description: 'Effective date (DD-Mon-YYYY).' },
      p_first_name: { type: 'string', example: 'Amir' },
      p_middle_name: { type: 'string', example: 'Sami Samir' },
      p_last_name: { type: 'string', example: 'Ibrahim' },
      p_marital_status: { type: 'string', example: 'Married', description: 'Code from the marital-status LOV.' },
      p_name_in_arabic: { type: 'string', example: 'امير سامي سمير ابراهيم' },
      p_title: { type: 'string', example: 'Mr.' },
      p_relationship: { type: 'string', example: '' },
      p_place_of_issue: { type: 'string', example: 'Doha' },
      p_country_of_issue: { type: 'string', example: 'QA' },
      p_visa_type: { type: 'string', example: 'Work' },
      p_visa_number: { type: 'string', example: '' },
      p_visa_validity: { type: 'string', example: '' },
      p_type_of_sponsership: { type: 'string', example: '' },
      ...attachmentProperties(),
    },
    // Pinned to the payload verified live on staging 2026-08-23 (successflag S).
    example: {
      p_effective_date: '01-Jan-2026',
      p_first_name: 'Amir',
      p_middle_name: 'Sami Samir',
      p_last_name: 'Ibrahim',
      p_marital_status: 'Married',
      p_file_name1: 'marriage-cert.pdf',
      p_attachment1: 'dGVzdCBhdHRhY2htZW50',
    },
  },
};

/** op 48 — POST /profile/personal response (action envelope). */
export const PROFILE_UPDATE_PERSONAL_EXAMPLE = {
  status: 'success',
  successflag: 'S',
  message: 'Success',
  httpStatusCode: 200,
};
