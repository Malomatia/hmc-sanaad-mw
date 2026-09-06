import {
  attachmentProperties,
  ATTACHMENT_EXAMPLE,
  nullAttachmentExample,
} from '@shared/swagger/request-body.util';
import { LEAVE_APPLY_OPTIONAL_PARAMS } from './dto/leave.dto';

/**
 * Real successful `result` payloads captured from api_test.json, used as Swagger
 * examples. These are the inner `result` values; the ResponseInterceptor wraps
 * them in the Sanaad success envelope.
 */

/** op 12 — GET /leave/lov/types?lang= */
export const LEAVE_TYPES_LOV_EXAMPLE = {
  items: [
    { code: 'Annual Leave', meaning: 'Annual Leave' },
    { code: 'Casual Leave', meaning: 'Casual Leave' },
    { code: 'Compassionate Leave', meaning: 'Compassionate Leave' },
    { code: 'Examination leave', meaning: 'Examination leave' },
    { code: 'Haj Leave', meaning: 'Haj Leave' },
    { code: 'Iddat Leave', meaning: 'Iddat Leave' },
    { code: 'Leave without Pay', meaning: 'Leave without Pay' },
    { code: 'Marriage Leave', meaning: 'Marriage Leave' },
    { code: 'Maternity Leave', meaning: 'Maternity Leave' },
    { code: 'Sick Leave', meaning: 'Sick Leave' },
  ],
};

/**
 * op 13 — GET /leave/lov/reasons?lang=[&leave_type=] — ABSENCE_REASON_V's
 * LEAVE_REASON labels. `?leave_type=Compassionate Leave` narrows the list to
 * that type's reasons (shown here); omitting it returns every reason.
 */
export const LEAVE_REASONS_LOV_EXAMPLE = {
  items: [
    { code: 'Death of 1st Degree Relative', meaning: 'Death of 1st Degree Relative' },
    { code: 'Death of 2nd Degree Relative', meaning: 'Death of 2nd Degree Relative' },
    { code: 'Death of 3rd Degree Relative', meaning: 'Death of 3rd Degree Relative' },
    { code: 'Death of 4th Degree Relative', meaning: 'Death of 4th Degree Relative' },
  ],
};

/** op 14 — GET /leave/lov/classes?lang= */
export const LEAVE_CLASSES_LOV_EXAMPLE = {
  items: [
    { code: 'Inside Qatar', meaning: 'Inside Qatar' },
    { code: 'Outside Qatar', meaning: 'Outside Qatar' },
  ],
};

/** op 45 — GET /leave/lov/defaults?enum=&lang= */
export const LEAVE_DEFAULTS_EXAMPLE = {
  employment: {
    PERSON_ID: 852709,
    USER_NAME: 'V-NFERNANDO',
    EMPLOYEE_NUMBER: '053613',
    JOINING_DATE: '28-10-2018',
    EMAIL_ADDRESS: 'username@null.qa',
    DEPARTMENT:
      'Admin.Information Communication and Technology.Health Information and Communication Technology',
    JOB: '112216.HICT Analyst.HMC.',
    SUPERVISOR_NUMBER: '037915',
    SUPERVISOR_NAME: 'Mr. Usama Mahmoud Mohamed Maabed Abdelsamad',
  },
  lovs: {
    annualTicket: [],
    library: [{ code: 'No', meaning: 'No' }],
    alsr: [{ code: 'No', meaning: 'No' }],
    contractYear: [],
  },
};

/** op 46 — GET /leave/lov/request-lov?enum=&lang= */
export const LEAVE_REQUEST_LOV_EXAMPLE = {
  numOfChild: [
    { code: 'Single', meaning: 'Single' },
    { code: 'Special Child', meaning: 'Special Child' },
    { code: 'Twins or more', meaning: 'Twins or more' },
  ],
  leaveClass: [
    { code: 'Inside Qatar', meaning: 'Inside Qatar' },
    { code: 'Outside Qatar', meaning: 'Outside Qatar' },
  ],
  examCentre: [
    { code: 'Inside Qatar', meaning: 'Inside Qatar' },
    { code: 'Outside Qatar', meaning: 'Outside Qatar' },
  ],
  bereavement: [
    { code: 'Aunt', meaning: 'Aunt' },
    { code: 'Sibling', meaning: 'Sibling' },
    { code: 'Parents', meaning: 'Parents' },
    { code: 'Spouse', meaning: 'Spouse' },
  ],
  contractYear: [],
  types: [
    { code: 'Annual Leave', meaning: 'Annual Leave' },
    { code: 'Casual Leave', meaning: 'Casual Leave' },
    { code: 'Sick Leave', meaning: 'Sick Leave' },
  ],
  reasons: [
    { code: 'Annual Leave', meaning: 'Annual Leave' },
    { code: 'Sick Leave', meaning: 'Sick Leave' },
    { code: 'Casual Leave', meaning: 'Casual Leave' },
  ],
  leaveType: [
    { code: 'Annual Leave', meaning: 'Annual Leave' },
    { code: 'Casual Leave', meaning: 'Casual Leave' },
    { code: 'Leave without Pay', meaning: 'Leave without Pay' },
    { code: 'Sick Leave', meaning: 'Sick Leave' },
  ],
};

/** ops 55/61/62 — GET /leave/lov/{return,cancel,amend}?username=&lang= (empty when there's nothing eligible). */
export const LEAVE_EMPTY_ITEMS_EXAMPLE = { items: [] };

/**
 * GET /leave/lov/{return-details,return-related1,return-related2}?username=&lang=
 * (RFL_LEAVE_DET_LOV / RFL_REL_LEAVE1_LOV / RFL_REL_LEAVE2_LOV) — the raw
 * `SELECT * ... WHERE USER_NAME = :u` rows with EVERY view column, so the op 56
 * submit can bind the full LEAVE value string and keep the record id.
 */
export const LEAVE_RFL_LOV_EXAMPLE = {
  items: [
    {
      USER_NAME: 'V-NFERNANDO',
      ABSENCE_ATTENDANCE_ID: 56944958,
      LEAVE: 'Casual Leave|Leave Start Date : 19-APR-2026 and Leave End Date : 19-APR-2026',
    },
  ],
};

/** op 47 — POST /leave/calculate (CALC_LEAV_DUR_PR: read result, not a submit envelope). */
export const LEAVE_CALCULATE_EXAMPLE = {
  days: 3,
  successFlag: 'Y',
  errorMessage: ' ',
};

/**
 * op 10 — POST /leave/apply response (action envelope) — a real business-rule
 * rejection from LEAV_OF_ABSEN_NEW_PR. `message` is the English text here
 * because this example's request used `lang=en` (default); the same call
 * with `lang=ar` would return the Arabic text instead — the client never
 * sees both.
 */
export const LEAVE_APPLY_EXAMPLE = {
  status: 'error',
  successflag: 'N',
  message: 'Reason does not exist with Absence',
  httpStatusCode: 200,
  result: { leaveDays: 0 },
};

/**
 * op 56 — POST /leave/return response (action envelope) — a real
 * business-rule rejection from RET_FRM_LEAV_PR. `message` reflects `lang=en`
 * (the default); the same call with `lang=ar` returns the Arabic text
 * instead.
 */
export const LEAVE_RETURN_EXAMPLE = {
  status: 'error',
  successflag: 'N',
  message: 'Duty resumption date should not be in future.',
  httpStatusCode: 200,
};

/*
 * Request bodies for the leave submit procedures. `p_user_name` and
 * `p_language` are injected server-side and must NOT be sent. Field names are the
 * procedures' `p_*` binds (the backend also accepts the bare form). Attachment
 * slots `p_file_name1..10` / `p_attachment1..10` are optional.
 */

/**
 * GET /leaves — leave history from ABSENCE_V. `absenceType`/`absenceReason`
 * carry the requested `lang` (the `*Ar` twins are collapsed by the
 * ResponseInterceptor before the response leaves the app).
 */
export const LEAVES_LIST_EXAMPLE = [
  {
    absenceType: 'Casual Leave',
    absenceReason: 'Personal',
    actualStartDate: '12-Jun-2025',
    actualEndDate: '14-Jun-2025',
    absenceDays: 3,
  },
  {
    absenceType: 'Annual Leave',
    absenceReason: 'Annual Leave',
    actualStartDate: '02-Feb-2025',
    actualEndDate: '20-Feb-2025',
    absenceDays: 19,
  },
];

/**
 * op 10 — POST /leave/apply request body (LEAV_OF_ABSEN_NEW_PR `p_*` binds).
 * The legacy camelCase core spellings (absenceType/absenceReason/startDate/
 * endDate) remain accepted; the example below is the full documented `p_*`
 * payload — unused params sent explicitly as null (equivalent to omitting
 * them). Dates accept `yyyy-MM-dd` or `dd-Mon-yyyy`.
 */
export const LEAVE_APPLY_BODY = {
  description:
    'Leave-apply payload (LEAV_OF_ABSEN_NEW_PR `p_*` binds). `p_user_name` and the OUT params are injected server-side and must NOT be sent.',
  schema: {
    type: 'object',
    required: ['p_absence_type', 'p_start_date', 'p_end_date'],
    properties: {
      p_absence_type: { type: 'string', example: 'Casual Leave' },
      p_absence_reason: { type: 'string', example: 'Personal', nullable: true },
      p_start_date: {
        type: 'string',
        example: '2025-06-12',
        description: 'Leave start date (yyyy-MM-dd or dd-Mon-yyyy) — bound as a DATE.',
      },
      p_end_date: {
        type: 'string',
        example: '2025-06-14',
        description: 'Leave end date (yyyy-MM-dd or dd-Mon-yyyy) — bound as a DATE.',
      },
      ...Object.fromEntries(
        LEAVE_APPLY_OPTIONAL_PARAMS.map((name) => [name, { type: 'string', nullable: true }]),
      ),
      ...attachmentProperties(),
    },
    example: {
      p_absence_type: 'Casual Leave',
      p_absence_reason: 'Personal',
      p_start_date: '2025-06-12',
      p_end_date: '2025-06-14',
      ...Object.fromEntries(LEAVE_APPLY_OPTIONAL_PARAMS.map((name) => [name, null])),
      ...nullAttachmentExample(),
    },
  },
};

/**
 * op 57 — POST /leave/amend request body (HR_LEAV_AMEND_PR). Unused attachment
 * slots may be sent explicitly as null (equivalent to omitting them);
 * `p_user_name` is accepted but the authenticated username is enforced
 * server-side; `p_language` is injected server-side and must NOT be sent.
 */
export const LEAVE_AMEND_BODY = {
  description: 'Leave-amend payload (HR_LEAV_AMEND_PR `p_*` binds).',
  schema: {
    type: 'object',
    required: ['p_leave_type', 'p_leave_to_amend', 'p_new_end_date'],
    properties: {
      p_leave_type: { type: 'string', example: 'Annual Leave' },
      p_user_name: {
        type: 'string',
        example: 'AIBRAHIM39',
        description: 'Optional; ignored — the authenticated username is enforced server-side.',
      },
      p_leave_to_amend: {
        type: 'string',
        example: 'Annual Leave|12-MAR-2026|12-MAR-2026',
        description:
          "COMPOSITE 'Leave Type|DD-MON-YYYY|DD-MON-YYYY' (type|start|end) — verified live (successflag S). Build it from the op 62 amend LOV rows; a numeric id raises ORA-01403.",
      },
      p_new_end_date: {
        type: 'string',
        example: '2026-03-13',
        description: 'New end date (yyyy-MM-dd or dd-Mon-yyyy) — bound as a DATE.',
      },
      p_comments: { type: 'string', example: 'Extending by one day.', nullable: true },
      ...attachmentProperties(),
    },
    example: {
      p_leave_type: 'Annual Leave',
      p_leave_to_amend: 'Annual Leave|12-MAR-2026|12-MAR-2026',
      p_new_end_date: '2026-03-13',
      ...nullAttachmentExample(),
    },
  },
};

/** op 58 — POST /leave/cancel request body (HR_LEAV_CANCEL_PR). */
export const LEAVE_CANCEL_BODY = {
  description: 'Leave-cancel payload (HR_LEAV_CANCEL_PR `p_*` binds).',
  schema: {
    type: 'object',
    required: ['p_leave_type', 'p_leave_to_cancel', 'p_reason_for_cancel'],
    properties: {
      p_leave_type: { type: 'string', example: 'Annual Leave' },
      p_leave_to_cancel: {
        type: 'string',
        example: 'Annual Leave|12-MAR-2026|12-MAR-2026',
        description:
          "COMPOSITE 'Leave Type|DD-MON-YYYY|DD-MON-YYYY' (type|start|end) — verified live (successflag S). Build it from the op 61 cancel LOV rows; a numeric id raises ORA-01403.",
      },
      p_reason_for_cancel: { type: 'string', example: 'Plans changed' },
      p_remarks: { type: 'string', example: 'Will re-apply later.' },
      ...attachmentProperties(),
    },
    example: {
      p_leave_type: 'Annual Leave',
      p_leave_to_cancel: 'Annual Leave|12-MAR-2026|12-MAR-2026',
      p_reason_for_cancel: 'Plans changed',
      ...ATTACHMENT_EXAMPLE,
    },
  },
};

/** op 56 — POST /leave/return request body (RET_FRM_LEAV_PR). */
export const LEAVE_RETURN_BODY = {
  description: 'Return-from-leave payload (RET_FRM_LEAV_PR `p_*` binds).',
  schema: {
    type: 'object',
    required: ['p_leave_details', 'p_return_date'],
    properties: {
      p_user_name: {
        type: 'string',
        example: 'AIBRAHIM39',
        description: 'Optional; ignored — the authenticated username is enforced server-side.',
      },
      p_leave_details: {
        type: 'string',
        example: '56949953',
        description:
          "The leave's ABSENCE_ATTENDANCE_ID as a numeric string — read it from GET /leave/lov/return → `id`. The procedure runs TO_NUMBER on this argument, so every text form (the composite 'Leave Type|DD-MON-YYYY|DD-MON-YYYY', the LOV's display string, the bare type) answers ORA-01722.",
      },
      p_related_leave1: { type: 'string', nullable: true, example: null },
      p_related_leave2: { type: 'string', nullable: true, example: null },
      p_return_date: {
        type: 'string',
        example: '20-Apr-2026',
        description: 'Return date (yyyy-MM-dd or dd-Mon-yyyy) — bound as a DATE.',
      },
      p_comments: { type: 'string', example: 'Returned early.', nullable: true },
      ...attachmentProperties(),
    },
    example: {
      p_leave_details: '56949953',
      p_related_leave1: null,
      p_related_leave2: null,
      p_return_date: '20-Apr-2026',
      p_comments: 'Returned early.',
      ...nullAttachmentExample(),
    },
  },
};
