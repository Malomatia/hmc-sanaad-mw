import { attachmentProperties, nullAttachmentExample } from '@shared/swagger/request-body.util';

/**
 * Request body for the annual-ticket submit procedure. `p_user_name`/`p_language`
 * are injected server-side and must NOT be sent. Field names are the
 * procedure's `p_*` binds (the backend also accepts the bare form). Passenger
 * slots `p_passenger1..4` and attachment slots `p_file_name1..10` /
 * `p_attachment1..10` are optional.
 */

const COMPOSITE_2025 =
  'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920';
const COMPOSITE_2024 =
  'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2024 to 31-AUG-2025 |Cash |20920';

const option = (value: string) => ({ value, label: value });

/**
 * op 66 — GET /annual-ticket/master?lang=en result for the test user
 * AIBRAHIM39, built from its 12 TICKET_MASTER rows (EBSDEV/EBSPRJ
 * 2026-09-29). This is the wire shape: the ResponseInterceptor has already
 * folded every `*Ar` twin into its base field (lang=ar puts the Arabic text
 * in `label` / `name` / `eligible`; `value` and `contactId` never change).
 */
export const ANNUAL_TICKET_MASTER_EXAMPLE = {
  eligible: 'Yes',
  contractualYears: ['2025', '2026', '2027'].map((from) => {
    const year = `01-SEP-${from} to 31-AUG-${Number(from) + 1}`;
    return {
      ...option(year),
      fromYear: Number(from),
      toYear: Number(from) + 1,
      law: 'HMC LAW',
      totalCount: 18,
    };
  }),
  destinations: [option('Cairo')],
  passengers: [
    ['26023', 'Mr. Amir Sami Samir Ibrahim', 'Self', 'EMP', 'Y', '1984-05-15', 'M'],
    ['42465', 'Caroline Victor Francis Fam', 'Family', 'S', null, null, 'F'],
    ['329302', 'Jerome Amir Sami Samir Ibrahim', 'Family', 'C', null, null, 'M'],
    ['329303', 'Jolie Amir Sami Samir Ibrahim', 'Family', 'C', null, null, 'F'],
  ].map(([contactId, name, type, contactType, currentEmployee, dateOfBirth, sex]) => ({
    value: name,
    contactId,
    name,
    type,
    contactType,
    currentEmployee,
    dateOfBirth,
    sex,
  })),
  requestFor: [option('Family'), option('Self'), option('Self and Family')],
  ticketClasses: [option('Economy')],
  requestType: 'Annual Ticket',
  other: [],
};

/**
 * op 72 — GET /annual-ticket/cancel-options?lang=en result for PERSON_ID
 * 26023 (staging): the two cancellable tickets, each joined with its own
 * taken-as and repayment methods on ANALYSIS_CRITERIA_ID. The flat
 * `takenAs` / `repaymentMethods` lists are the deduplicated legacy fields.
 */
export const ANNUAL_TICKET_CANCEL_OPTIONS_EXAMPLE = {
  tickets: [
    ['71794897', COMPOSITE_2025, '01-SEP-2025 to 31-AUG-2026'],
    ['71803898', COMPOSITE_2024, '01-SEP-2024 to 31-AUG-2025'],
  ].map(([analysisCriteriaId, value, contractualYear]) => ({
    analysisCriteriaId,
    value,
    requestFor: 'Self and Family',
    employeeName: 'Amir',
    passengers: ['Caroline', 'Jerome Amir Sami', 'Jolie Amir Sami'],
    contractualYear,
    takenAs: 'Cash',
    amount: '20920',
    repaymentMethods: [{ value: 'Payroll Deduction', label: 'Payroll Deduction', appliesTo: 'Cash' }],
  })),
  takenAs: [{ TAKES_AS: 'Cash' }, { TAKES_AS: 'Voucher' }],
  repaymentMethods: [
    { FLEX_VALUE: 'Payroll Deduction', DESCRIPTION: 'Cash' },
    { FLEX_VALUE: 'Cancel Voucher', DESCRIPTION: 'Voucher' },
  ],
};

/** op 72 — POST /annual-ticket/cancel body: the ticket id from cancel-options plus the user's text. */
export const ANNUAL_TICKET_CANCEL_BODY = {
  analysis_criteria_id: '71794897',
  p_reason: 'Travel plans cancelled',
  p_comments: 'Cancelling the unused ticket.',
};

/** op 67 — POST /annual-ticket/apply request body (TICKET_REQ_PR). */
export const ANNUAL_TICKET_APPLY_BODY = {
  description: 'Annual-ticket request payload (TICKET_REQ_PR `p_*` binds).',
  schema: {
    type: 'object',
    required: [
      'p_request_for',
      'p_employee',
      'p_request_type',
      'p_contractual_year',
      'p_traveling_dest',
      'p_travel_class',
    ],
    properties: {
      p_request_for: { type: 'string', example: 'Self' },
      p_employee: {
        type: 'string',
        example: '26023',
        description:
          'Oracle PERSON_ID of the employee (NOT the employee number) — validated against the HMC_HR_PASSAGE_TICKET_EMPLOYEE_NAME value set.',
      },
      p_passenger1: {
        type: 'string',
        nullable: true,
        example: null,
        description:
          'Passenger NAME (GET /annual-ticket/master → passengers[type=Family].value, the English NAME_EN), ' +
          'e.g. "Caroline Victor Francis Fam" — not the CONTACT_ID. Null when p_request_for is Self.',
      },
      p_passenger2: { type: 'string', nullable: true, example: null, description: 'Passenger name, as p_passenger1.' },
      p_passenger3: { type: 'string', nullable: true, example: null, description: 'Passenger name, as p_passenger1.' },
      p_passenger4: { type: 'string', nullable: true, example: null, description: 'Passenger name, as p_passenger1.' },
      p_request_type: { type: 'string', example: 'Annual Ticket' },
      p_contractual_year: { type: 'string', example: '01-SEP-2025 to 31-AUG-2026' },
      p_traveling_dest: { type: 'string', example: 'Doha' },
      p_travel_class: { type: 'string', example: 'Economy' },
      p_comments: { type: 'string', example: '' },
      ...attachmentProperties(),
    },
    example: {
      p_request_for: 'Self',
      p_employee: '26023',
      p_passenger1: null,
      p_passenger2: null,
      p_passenger3: null,
      p_passenger4: null,
      p_request_type: 'Annual Ticket',
      p_contractual_year: '01-SEP-2025 to 31-AUG-2026',
      p_traveling_dest: 'Doha',
      p_travel_class: 'Economy',
      p_comments: '',
      ...nullAttachmentExample(),
    },
  },
};
