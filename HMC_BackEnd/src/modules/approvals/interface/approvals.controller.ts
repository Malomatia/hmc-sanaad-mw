import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  HttpCode,
  Res,
  Version,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { currentIdentity, requireIdentity } from '@core/auth/current-identity';
import { apiVersionPrefix } from '@core/http/api-versioning';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { SkipEnvelope } from '@core/http/response.interceptor';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { ProfileQueryDto } from '@shared/dto/common-query.dto';
import { SubmitResultDto } from '@shared/dto/submit-result.dto';
import { VerifiedBody } from '@shared/dto/verified-body';
import { ApprovalsService, WorklistService } from '../application/approvals.service';
import {
  ActionHistoryQueryDto,
  ApproveRejectRequestDto,
  OwnScopeQueryDto,
  PendingCountQueryDto,
  PendingCountV2QueryDto,
  PendingCountResponseDto,
  ReassignApprovalRequestDto,
  RequestInfoRequestDto,
  WorklistSummaryQueryDto,
  WorklistSummaryV2QueryDto,
} from './dto/approvals.dto';

/**
 * Approvals/Worklist endpoints (ops 20-23, 68-71).
 *
 * APPROVER/SUPERVISOR by default, with ops 20 and 23 exempt: they return only
 * the caller's own rows, so identity is the filter and the role adds nothing —
 * and while no identity adapter grants those roles, the class rule made them
 * permanently unreachable. The routes that ACT on a request (decision,
 * request-info, reassign) keep the role.
 */
@ApiTags('approvals')
@ApiBearerAuth()
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly worklist: WorklistService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  @Get()
  @Version('2')
  @ApiOperation({ summary: 'op 20 — Approvals summary', operationId: 'approvals_summary_v2' })
  summaryV2(@Query() q: LangQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.approvals.summary(currentIdentity(user), q.lang);
  }

  @Get('my-requests')
  @Version('2')
  @ApiOperation({ summary: 'op 23 — My requests', operationId: 'approvals_myRequests_v2' })
  myRequestsV2(@Query() q: LangQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.approvals.myRequests(currentIdentity(user), q.lang);
  }

  @Get('pending-count')
  @Version('2')
  @ApiOperation({
    summary: 'Pending request counts filtered by requestor and request type',
    operationId: 'approvals_pendingCount_v2',
  })
  @ApiOkResponse({ type: PendingCountResponseDto })
  async pendingCountV2(
    @Query() q: PendingCountV2QueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PendingCountResponseDto> {
    return { items: await this.approvals.pendingCounts(currentIdentity(user), q.pendreq) };
  }

  @Get('worklist')
  @Version('2')
  @ApiOperation({ summary: 'op 68 — Worklist main', operationId: 'approvals_worklist_v2' })
  worklistMainV2(@Query() q: LangQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.worklist.worklist(requireIdentity(user, 'username'), q.lang);
  }

  @Get('worklist/summary')
  @Version('2')
  @ApiOperation({ summary: 'op 69 — Worklist summary', operationId: 'approvals_worklistSummary_v2' })
  worklistSummaryV2(@Query() q: WorklistSummaryV2QueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.worklist.worklistSummary(requireIdentity(user, 'username'), q.lang, q.notificationId);
  }

  @Get(':id/details')
  @Version('2')
  @ApiOperation({ summary: 'op 21 — Approval detail', operationId: 'approvals_details_v2' })
  async detailsV2(
    @Param('id') id: string,
    @Query() q: LangQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.approvals.details(id, q.lang, currentIdentity(user));
    const prefix = apiVersionPrefix(
      this.config?.get<string>('app.apiPrefix') ?? process.env.API_PREFIX ?? 'api/v1',
      '2',
    );
    return {
      ...result,
      attachments: result.attachments.map((attachment) => ({
        ...attachment,
        url: `/${prefix}/approvals/attachments/${attachment.id}`,
      })),
    };
  }

  @SkipEnvelope()
  @Get('attachments/:documentId')
  @Version('2')
  @ApiOperation({
    summary: 'op 21b — Download a request attachment (binary)',
    operationId: 'approvals_attachment_v2',
  })
  @ApiOkResponse({
    description: 'The file itself, with its own content-type.',
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  })
  async attachmentV2(
    @Param('documentId') documentId: string,
    @Query() q: LangQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const file = await this.approvals.attachment(documentId, currentIdentity(user));
    const body = Buffer.from(file.contentBase64, 'base64');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', body.length);
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
    res.send(body);
  }

  /**
   * What is waiting for the CALLER's approval — APPROVE_SUMRY_V and
   * PNDNG_QID_V are both filtered on the APPROVER side, so this is an
   * approver's inbox, not a list of the caller's own requests (that is
   * `my-requests` below).
   *
   * Scoped by identity rather than gated by role. The role gate made it a
   * permanent 403 — nothing in the system assigns APPROVER/SUPERVISOR — while
   * the identity filter already gives each caller exactly their own rows: an
   * employee who approves nothing sees an empty list, and a real approver sees
   * their queue. `enum` is accepted for payload compatibility but IGNORED;
   * honouring it on an open route would let anyone read another approver's
   * inbox by passing their number.
   */
  @Get()
  @ApiOperation({ summary: 'op 20 — Approvals summary', operationId: 'approvals_summary' })
  summary(
    @Query() q: OwnScopeQueryDto,
    @Lang() lang: LangCode,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvals.summary(user, lang, q.enum ?? q.username);
  }

  /**
   * "What I submitted" — an employee's OWN requests and their approval
   * status. That is not approver data, so it does not take the approver role
   * the rest of this controller requires: the empty `@Roles()` overrides the
   * class decorator (RolesGuard resolves handler over class). Nothing in the
   * system grants APPROVER/SUPERVISOR today, so under the class rule this
   * endpoint was unreachable for everyone — including the person whose own
   * requests it lists.
   *
   * `enum` stays accepted for payload compatibility but is IGNORED: the rows
   * are scoped to the authenticated caller. Honouring a client-supplied
   * identifier on an employee-open endpoint would let anyone read another
   * employee's requests by passing their number.
   */
  @Get('my-requests')
  @ApiOperation({ summary: 'op 23 — My requests', operationId: 'approvals_myRequests' })
  myRequests(
    @Query() q: OwnScopeQueryDto,
    @Lang() lang: LangCode,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvals.myRequests(user, lang, q.enum ?? q.username);
  }

  @Get('pending-count')
  @ApiOperation({
    summary: 'Pending request counts filtered by requestor and request type',
    operationId: 'approvals_pendingCount',
  })
  @ApiOkResponse({ type: PendingCountResponseDto })
  async pendingCount(
    @Query() q: PendingCountQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PendingCountResponseDto> {
    return { items: await this.approvals.pendingCounts(user, q.pendreq, q.username) };
  }

  @Get('worklist')
  @ApiOperation({ summary: 'op 68 — Worklist main', operationId: 'approvals_worklist' })
  worklistMain(@Query() q: ProfileQueryDto) {
    return this.worklist.worklist(q.enum, q.lang);
  }

  @Get('worklist/summary')
  @ApiOperation({ summary: 'op 69 — Worklist summary', operationId: 'approvals_worklistSummary' })
  worklistSummary(@Query() q: WorklistSummaryQueryDto) {
    return this.worklist.worklistSummary(q.enum, q.lang, q.notificationId);
  }

  /** `id` is the workflow ITEM_KEY that ACTION_HISTORY_V is keyed by. */
  @Get('worklist/:id/history')
  @ApiOperation({ summary: 'op 70 — Worklist action history', operationId: 'approvals_history' })
  history(@Param('id') id: string, @Query() q: ActionHistoryQueryDto) {
    return this.worklist.history(id, q.lang, q.itemType);
  }

  @Get(':id/details')
  @ApiOperation({ summary: 'op 21 — Approval detail', operationId: 'approvals_details' })
  /**
   * How an employee opens one of their own requests, so it is not approver-only
   * either. The read resolves by notification id with no caller in the query,
   * and the ids are sequential — so the service checks that the caller is the
   * request's requestor or its approver, and answers 403 otherwise. That check
   * is what replaces the role gate; do not remove one without the other.
   */

  details(
    @Param('id') id: string,
    @Query() q: OwnScopeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvals.details(id, q.lang, user, q.enum ?? q.username);
  }

  /**
   * Download one of the files listed by `:id/details` → `attachments[].url`.
   *
   * Serves the FILE, not a description of it: real bytes, the stored
   * content-type, and a `Content-Disposition` filename. That is what lets a
   * client point an image view or a PDF viewer straight at the URL. It
   * previously answered a JSON envelope with the bytes base64-encoded inside,
   * which nothing could render without unwrapping it first — and which was
   * empty anyway, since BLOBs arrive as Lob streams and the reader tested for
   * a Buffer.
   *
   * `@SkipEnvelope` because the Sanaad wrapper would turn a PDF into a JSON
   * string. Open alongside `:id/details`, which advertises these URLs — gating
   * one and not the other would ship a download button that always fails — and
   * the service still requires the caller to own the request the file belongs
   * to, since a document id identifies only the file.
   */
 
  @SkipEnvelope()
  @Get('attachments/:documentId')
  @ApiOperation({
    summary: 'op 21b — Download a request attachment (binary)',
    operationId: 'approvals_attachment',
  })
  @ApiOkResponse({
    description: 'The file itself, with its own content-type.',
    content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } },
  })
  async attachment(
    @Param('documentId') documentId: string,
    @Query() q: OwnScopeQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const file = await this.approvals.attachment(documentId, user, q.enum ?? q.username);
    const body = Buffer.from(file.contentBase64, 'base64');

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', body.length);
    // `inline` so a viewer renders it in place; a client that wants to save it
    // can still do so. The name is quoted because filenames contain spaces.
    res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
    res.send(body);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 22 — Approve/Reject', operationId: 'approvals_decision' })
  @ApiOkResponse({ type: SubmitResultDto })
  // `id` (notification id) and `itemKey` must come from the SAME row of
  // GET /approvals/worklist — Oracle Workflow rejects a mismatched pair with
  // "Attribute 'RESULT' does not exist for notification".
  @VerifiedBody(
    ApproveRejectRequestDto,
    { decision: 'APPROVE', itemKey: '18875905', itemType: 'HRSSA', comment: 'Approved.' },
    'Take the path id AND itemKey from one row of GET /approvals/worklist (STATUS=OPEN and actionable — FYI notifications reject APPROVE).',
  )
  decision(
    @Param('id') id: string,
    @Body() dto: ApproveRejectRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.approvals.decide(
      id,
      {
        decision: dto.decision,
        itemKey: dto.itemKey,
        itemType: dto.itemType ?? 'HRSSA',
        comment: dto.comment,
      },
      user,
      lang,
    );
  }

  /** `id` is the notification id, like the decision route. */
  @Post(':id/request-info')
  @HttpCode(200)
  @ApiOperation({
    summary: 'RFMI — Request more information (HR_RFMI_PR)',
    operationId: 'approvals_requestInfo',
  })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    RequestInfoRequestDto,
    {
      itemKey: '18875965',
      itemType: 'HRSSA',
      mode: 'QUESTION',
      toUsername: 'V-NFERNANDO',
      comment: 'Please attach the supporting documents.',
    },
    'Verified against staging (successflag S) with a real OPEN notification of the caller — take id + itemKey from GET /approvals/worklist.',
  )
  requestInfo(
    @Param('id') id: string,
    @Body() dto: RequestInfoRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.approvals.requestInfo(
      id,
      {
        itemKey: dto.itemKey,
        itemType: dto.itemType ?? 'HRSSA',
        mode: dto.mode ?? 'QUESTION',
        comment: dto.comment,
        toUsername: dto.toUsername,
      },
      user,
      lang,
    );
  }

  @Post(':id/reassign')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 71 — Reassign approval', operationId: 'approvals_reassign' })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    ReassignApprovalRequestDto,
    { assignTo: 'V-NFERNANDO', type: 'DELEGATE', comment: 'Reassigning while on leave.' },
    'Verified against staging (successflag S) with an OPEN notification owned by the caller — the path id comes from GET /approvals/worklist.',
  )
  reassign(
    @Param('id') id: string,
    @Body() dto: ReassignApprovalRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.worklist.reassign(
      id,
      { assignTo: dto.assignTo, type: dto.type ?? 'DELEGATE', comment: dto.comment },
      user,
      lang,
    );
  }

  @Get('worklist/:id/history')
  @Version('2')
  @ApiOperation({ summary: 'op 70 — Worklist action history', operationId: 'approvals_history_v2' })
  historyV2(@Param('id') id: string, @Query() q: ActionHistoryQueryDto) {
    return this.history(id, q);
  }

  @Post(':id/decision')
  @Version('2')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 22 — Approve/Reject', operationId: 'approvals_decision_v2' })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    ApproveRejectRequestDto,
    { decision: 'APPROVE', itemKey: '18875905', itemType: 'HRSSA', comment: 'Approved.' },
    'Take the path id AND itemKey from one row of GET /approvals/worklist (STATUS=OPEN and actionable — FYI notifications reject APPROVE).',
  )
  decisionV2(
    @Param('id') id: string,
    @Body() dto: ApproveRejectRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.decision(id, dto, user, lang);
  }

  @Post(':id/request-info')
  @Version('2')
  @HttpCode(200)
  @ApiOperation({
    summary: 'RFMI — Request more information (HR_RFMI_PR)',
    operationId: 'approvals_requestInfo_v2',
  })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    RequestInfoRequestDto,
    {
      itemKey: '18875965',
      itemType: 'HRSSA',
      mode: 'QUESTION',
      toUsername: 'V-NFERNANDO',
      comment: 'Please attach the supporting documents.',
    },
    'Verified against staging (successflag S) with a real OPEN notification of the caller — take id + itemKey from GET /approvals/worklist.',
  )
  requestInfoV2(
    @Param('id') id: string,
    @Body() dto: RequestInfoRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.requestInfo(id, dto, user, lang);
  }

  @Post(':id/reassign')
  @Version('2')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 71 — Reassign approval', operationId: 'approvals_reassign_v2' })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    ReassignApprovalRequestDto,
    { assignTo: 'V-NFERNANDO', type: 'DELEGATE', comment: 'Reassigning while on leave.' },
    'Verified against staging (successflag S) with an OPEN notification owned by the caller — the path id comes from GET /approvals/worklist.',
  )
  reassignV2(
    @Param('id') id: string,
    @Body() dto: ReassignApprovalRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.reassign(id, dto, user, lang);
  }
}
