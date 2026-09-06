import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '@core/config/configuration';
import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';
import { ERROR_MESSAGES } from '@shared/constants/error-codes';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import {
  APPROVALS_REPOSITORY,
  ApprovalDecision,
  ApprovalRow,
  ApprovalsRepository,
  ApprovalsSummary,
  AttachmentContent,
  MyRequests,
  ReassignType,
  RequestAttachment,
  WORKLIST_REPOSITORY,
  WorklistRepository,
} from '../domain/approvals.repository';
import { RequestField, buildRequestFields, requestTypeKeyOf } from '../domain/request-fields';

/** Controller-facing shape of the RFMI submit (route carries the notification id). */
export interface RequestInfoDto {
  itemType: string;
  itemKey: string;
  mode: string;
  comment: string;
  toUsername?: string;
}

/** Display-ready response of op 21 — see `details()`. */
export interface RequestDetailResponse {
  notificationId: string;
  itemKey: string | null;
  itemType: string | null;
  /** Localised label, e.g. `Request School Fee Reimb`. */
  requestType: string | null;
  /** Stable key for client-side branching, e.g. `SCHOOL_FEE`. */
  requestTypeKey: string | null;
  serviceView: string | null;
  subject: string | null;
  requestor: { userName: string | null; name: string | null };
  approver: { userName: string | null; name: string | null };
  submittedAt: string | null;
  dueDate: string | null;
  /** False when the notification id matched nothing (still HTTP 200). */
  found: boolean;
  fields: RequestField[];
  values: Record<string, string | number | null>;
  attachments: RequestAttachment[];
}

/** Approvals summary/detail/decision/my-requests (ops 20, 21, 22, 23). */
@Injectable()
export class ApprovalsService {
  /** Outside production, a caller may scope these reads to someone else. */
  private readonly actAsAllowed: boolean;

  constructor(
    @Inject(APPROVALS_REPOSITORY) private readonly repo: ApprovalsRepository,
    config: ConfigService,
  ) {
    this.actAsAllowed = config.getOrThrow<AppConfig>('app').nodeEnv !== 'production';
  }

  /**
   * op 20 — what is waiting for the CALLER's approval. Scoped to the
   * authenticated identity, like op 23: the route is open to any employee, so
   * a client-supplied identifier must not be able to widen it to another
   * approver's queue.
   */
  summary(user: AuthenticatedUser, lang: Lang = 'en', actAs?: string): Promise<ApprovalsSummary> {
    return this.repo.getSummary(this.keysOf(user, actAs), lang);
  }

  /**
   * The identifiers these reads are scoped to.
   *
   * Always the caller in every form the views may store — they disagree about
   * whether that is the login or the employee number. OUTSIDE PRODUCTION a
   * client-supplied `?enum=`/`?username=` is added too, so a tester can point
   * any of these endpoints at a real approver and get real rows back; the
   * accounts that hold data are listed in AGENTS.md.
   *
   * In production it is dropped. Honouring it there would let any employee
   * read another's requests — and read one of the approval detail views, whose
   * notification ids are sequential — simply by passing their number. Same
   * `NODE_ENV` rule the SQL consoles use, so there is no new switch to
   * remember or to leak.
   */
  private keysOf(user: AuthenticatedUser, actAs?: string): string[] {
    const own = [user.username, user.employeeNumber];
    const supplied = this.actAsAllowed && actAs ? [actAs] : [];
    return [...new Set([...own, ...supplied].filter(Boolean))] as string[];
  }

  /**
   * op 21 — one request, ready to render.
   *
   * The client gets an ordered `fields` list (label key + value + value kind)
   * instead of the raw columns of whichever of the 17 detail views this request
   * happens to live in, so a single screen renders every request type and a new
   * column does not need an app release. `values` is the same data as a flat
   * map, for validation/filtering, and `attachments` carries a download path
   * per file.
   */
  async details(
    approvalId: string,
    lang: Lang,
    user: AuthenticatedUser,
    actAs?: string,
  ): Promise<RequestDetailResponse> {
    // The route is open to every employee (it is how they see their own
    // request), and the read below resolves purely by notification id — so
    // ownership is checked here. Without it, sequential ids would expose every
    // request in the organisation.
    await this.assertOwns(approvalId, user, actAs);
    const src = await this.repo.getDetails(approvalId, lang);
    const header = src.header ?? {};
    const { fields, values } = buildRequestFields(src.serviceView, src.detailRow);
    const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
    const date = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

    return {
      notificationId: approvalId,
      itemKey: src.itemKey,
      itemType: str(header.ITEM_TYPE),
      requestType: str(header.SERVICE_REQUEST),
      requestTypeKey: requestTypeKeyOf(src.serviceView),
      serviceView: src.serviceView,
      subject: str(header.SUBJECT),
      requestor: { userName: str(header.REQUESTOR_USER_NAME), name: str(header.REQUESTOR_NAME) },
      approver: { userName: str(header.APPROVER_USER_NAME), name: str(header.APPROVER_NAME) },
      submittedAt: date(src.detailRow?.DATE_OF_SUBMISSION ?? header.BEGIN_DATE),
      dueDate: date(header.DUE_DATE),
      found: !!src.header,
      fields,
      values,
      attachments: src.attachments,
    };
  }

  async attachment(
    attachedDocumentId: string,
    user: AuthenticatedUser,
    actAs?: string,
  ): Promise<AttachmentContent> {
    // Same exposure as details(), one step worse: this returns the file
    // itself. The document id identifies the file and nothing else, so the
    // request it belongs to is resolved and checked first.
    const itemKey = await this.repo.itemKeyOfAttachment(attachedDocumentId);
    if (!itemKey || !(await this.repo.isItemOwnedBy(itemKey, this.keysOf(user, actAs)))) {
      throw new ForbiddenException(ERROR_MESSAGES.FORBIDDEN);
    }

    const file = await this.repo.getAttachmentContent(attachedDocumentId);
    if (!file) throw new NotFoundException(`Attachment ${attachedDocumentId} was not found.`);
    return file;
  }

  /** 403 unless the caller is the request's requestor or its approver. */
  private async assertOwns(
    approvalId: string,
    user: AuthenticatedUser,
    actAs?: string,
  ): Promise<void> {
    if (!(await this.repo.isOwnedBy(approvalId, this.keysOf(user, actAs)))) {
      throw new ForbiddenException(ERROR_MESSAGES.FORBIDDEN);
    }
  }

  decide(
    approvalId: string,
    dto: { decision: ApprovalDecision; itemType: string; itemKey: string; comment?: string },
    user: AuthenticatedUser,
    lang: Lang,
  ): Promise<SubmitResult> {
    return this.repo.decide({ username: user.username, lang, approvalId, ...dto });
  }

  requestInfo(
    approvalId: string,
    dto: RequestInfoDto,
    user: AuthenticatedUser,
    lang: Lang,
  ): Promise<SubmitResult> {
    return this.repo.requestInfo({ username: user.username, lang, approvalId, ...dto });
  }

  /**
   * op 23 — the CALLER's own requests. Scoped to the authenticated identity
   * only: the endpoint is open to every employee (it is their own data), so a
   * client-supplied identifier must not be able to widen it to someone else's
   * rows. Both forms of the caller are still sent, because the two views
   * behind the response store different ones.
   */
  myRequests(user: AuthenticatedUser, lang: Lang = 'en', actAs?: string): Promise<MyRequests> {
    return this.repo.getMyRequests(this.keysOf(user, actAs), lang);
  }
}

/** Worklist main/summary/history + reassign (ops 68, 69, 70, 71). */
@Injectable()
export class WorklistService {
  constructor(@Inject(WORKLIST_REPOSITORY) private readonly repo: WorklistRepository) {}

  worklist(username: string, lang: Lang): Promise<ApprovalRow[]> {
    return this.repo.getWorklist(username, lang);
  }

  worklistSummary(username: string, lang: Lang, notificationId?: string): Promise<ApprovalRow[]> {
    return this.repo.getWorklistSummary(username, lang, notificationId);
  }

  history(itemKey: string, lang: Lang, itemType?: string): Promise<ApprovalRow[]> {
    return this.repo.getActionHistory(itemKey, lang, itemType);
  }

  reassign(
    approvalId: string,
    dto: { assignTo: string; type: ReassignType; comment?: string },
    user: AuthenticatedUser,
    lang: Lang,
  ): Promise<SubmitResult> {
    return this.repo.reassign({ username: user.username, lang, approvalId, ...dto });
  }
}
