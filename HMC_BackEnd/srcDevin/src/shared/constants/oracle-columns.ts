/**
 * Key-column names used when filtering the `XXHMC_SND_*` views.
 *
 * The Sanaad mapping documents the legacy *request parameter* names, not the
 * view column names, and they differ per object (`USER_NAME` in the school-fee
 * and approval services, `USERNAME` elsewhere). Rather than guessing, adapters
 * pass the candidate lists below to `readByResolvedKey`, which asks the data
 * dictionary which column actually exists (see OracleSchemaService) — the same
 * check is available at runtime via `GET /diagnostics/oracle-object`.
 */
export const EMP_KEY_COLUMN = 'employee_number';
export const USERNAME_COLUMN = 'username';
export const USER_NAME_COLUMN = 'user_name';
export const PERSON_ID_COLUMN = 'person_id';
export const ASSIGNMENT_ID_COLUMN = 'assignment_id';

/** Candidates for a view keyed by the caller's login (`V-xxx`). */
export const USERNAME_KEY_CANDIDATES = [USER_NAME_COLUMN, USERNAME_COLUMN] as const;

/**
 * The approvals views name their key column after the ROLE, not the person:
 * APPROVE_SUMRY_V / MY_REQEST_SUMMARY_V / PNDNG_QID_V expose
 * `APPROVER_USER_NAME` + `REQUESTOR_USER_NAME` and NO plain `user_name`.
 * With only the generic candidates above, `resolveKeyColumn` found nothing, the
 * read degraded to an empty array (by design, silently) and ops 20 and 23
 * returned `{approvals: [], pendingQid: []}` for every user even though the
 * views held their rows.
 *
 * Which side to filter on depends on the question being asked:
 *  - "what is waiting for MY approval" → APPROVER_*
 *  - "what did I submit"               → REQUESTOR_*
 */
export const APPROVER_KEY_CANDIDATES = [
  'approver_user_name',
  USER_NAME_COLUMN,
  USERNAME_COLUMN,
] as const;

export const REQUESTOR_KEY_CANDIDATES = [
  'requestor_user_name',
  USER_NAME_COLUMN,
  USERNAME_COLUMN,
] as const;

/** Candidates for a view keyed by the employee number. */
export const EMPLOYEE_KEY_CANDIDATES = [
  EMP_KEY_COLUMN,
  'emp_num',
  USER_NAME_COLUMN,
  USERNAME_COLUMN,
] as const;

/** Workflow columns of WORKLISTS_V / ACTION_HISTORY_V (documented SQL). */
export const RECIPIENT_ROLE_COLUMN = 'recipient_role';
export const MORE_INFO_ROLE_COLUMN = 'more_info_role';
export const NOTIFICATION_ID_COLUMN = 'notification_id';
export const ITEM_TYPE_COLUMN = 'item_type';
export const ITEM_KEY_COLUMN = 'item_key';
