import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';

export type ApprovalRow = Record<string, unknown>;

export interface ApprovalsSummary {
  approvals: ApprovalRow[];
  pendingQid: ApprovalRow[];
}

export interface MyRequests {
  requests: ApprovalRow[];
  pendingQid: ApprovalRow[];
}

export type ApprovalDecision = 'APPROVE' | 'REJECT';

/** How a worklist task is handed over (documented `p_type` of REASSIGN_PR). */
export type ReassignType = 'DELEGATE' | 'TRANSFER';

export interface DecisionCommand {
  username: string;
  lang: Lang;
  /** Notification id — the path parameter of the decision route. */
  approvalId: string;
  /** Workflow item type, `HRSSA` for the HR self-service flows. */
  itemType: string;
  /** Workflow item key of the request being approved. */
  itemKey: string;
  decision: ApprovalDecision;
  comment?: string;
}

export interface ReassignCommand {
  username: string;
  lang: Lang;
  approvalId: string;
  assignTo: string;
  type: ReassignType;
  comment?: string;
}

/**
 * Request-more-information on a notification (HR_RFMI_PR). `mode` is the
 * procedure's `p_mode`; `toUsername` (`p_to_user_name`, optional) is who the
 * question is directed to — pick from the RFMI user LOV (op 26).
 */
export interface RequestInfoCommand {
  /** Caller — bound as `p_from_user_name`. */
  username: string;
  lang: Lang;
  /** Notification id — the path parameter of the route (`p_notification_id`). */
  approvalId: string;
  toUsername?: string;
  /** Workflow item type, `HRSSA` for the HR self-service flows. */
  itemType: string;
  itemKey: string;
  mode: string;
  comment: string;
}

/** One file attached to a request. The bytes are fetched separately. */
export interface RequestAttachment {
  id: number;
  fileName: string;
  contentType: string;
  sizeBytes: number | null;
  uploadedAt: string | null;
  /** Ready-to-call path for the download endpoint. */
  url: string;
}

/** Raw material for op 21: the notification row, its payload row and its files. */
export interface RequestDetailSource {
  header: ApprovalRow | undefined;
  serviceView: string | null;
  itemKey: string | null;
  detailRow: ApprovalRow | undefined;
  attachments: RequestAttachment[];
}

/** A file's bytes, for the download endpoint. */
export interface AttachmentContent {
  fileName: string;
  contentType: string;
  /** Base64 — the same encoding the submit endpoints accept for uploads. */
  contentBase64: string;
}

/**
 * Port: approvals summary/detail/decision/my-requests (ops 20, 21, 22, 23).
 * The reads are scoped by the caller's username — the legacy services take
 * USER_NAME, and the views carry no employee-number column.
 */
export interface ApprovalsRepository {
  /**
   * `keys` are the caller's identifiers in BOTH forms (login + employee
   * number): APPROVE_SUMRY_V / MY_REQEST_SUMMARY_V store the employee number
   * while PNDNG_QID_V stores the login, and one response reads both.
   */
  getSummary(keys: readonly string[], lang: Lang): Promise<ApprovalsSummary>;
  /** op 21 — notification row + the payload the employee submitted + its files. */
  getDetails(approvalId: string, lang: Lang): Promise<RequestDetailSource>;
  getAttachmentContent(attachedDocumentId: string): Promise<AttachmentContent | undefined>;
  decide(cmd: DecisionCommand): Promise<SubmitResult>;
  requestInfo(cmd: RequestInfoCommand): Promise<SubmitResult>;
  getMyRequests(keys: readonly string[], lang: Lang): Promise<MyRequests>;
  /**
   * Ownership checks for the routes that resolve a request by ID ALONE.
   * op 21 and the attachment download carry no caller in their queries and the
   * notification ids run in sequence, so these stand in for the role gate they
   * were behind — without them, opening those routes would let any employee
   * read every request in the organisation.
   */
  isOwnedBy(approvalId: string, keys: readonly string[]): Promise<boolean>;
  isItemOwnedBy(itemKey: string, keys: readonly string[]): Promise<boolean>;
  itemKeyOfAttachment(attachedDocumentId: string): Promise<string | undefined>;
}
export const APPROVALS_REPOSITORY = Symbol('APPROVALS_REPOSITORY');

/** Port: worklist main/summary/history + reassign (ops 68, 69, 70, 71). */
export interface WorklistRepository {
  getWorklist(username: string, lang: Lang): Promise<ApprovalRow[]>;
  getWorklistSummary(
    username: string,
    lang: Lang,
    notificationId?: string,
  ): Promise<ApprovalRow[]>;
  getActionHistory(itemKey: string, lang: Lang, itemType?: string): Promise<ApprovalRow[]>;
  reassign(cmd: ReassignCommand): Promise<SubmitResult>;
}
export const WORKLIST_REPOSITORY = Symbol('WORKLIST_REPOSITORY');
