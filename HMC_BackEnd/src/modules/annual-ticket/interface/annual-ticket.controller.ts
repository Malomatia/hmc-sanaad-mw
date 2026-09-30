import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { SubmitResultDto } from '@shared/dto/submit-result.dto';
import { VerifiedBody } from '@shared/dto/verified-body';
import { AnnualTicketService } from '../application/annual-ticket.service';
import {
  AnnualTicketApplyRequestDto,
  AnnualTicketCancelRequestDto,
  AnnualTicketMasterQueryDto,
  AnnualTicketMasterResponseDto,
  TicketCancelOptionsQueryDto,
  TicketCancelOptionsResponseDto,
} from './dto/annual-ticket.dto';
import {
  ANNUAL_TICKET_APPLY_BODY,
  ANNUAL_TICKET_CANCEL_BODY,
  ANNUAL_TICKET_CANCEL_OPTIONS_EXAMPLE,
  ANNUAL_TICKET_MASTER_EXAMPLE,
} from './annual-ticket.examples';

/** Annual-ticket endpoints (ops 66, 67, 72). See Docs_Ai/API/README.md. */
@ApiTags('annual-ticket')
@ApiBearerAuth()
@Controller('annual-ticket')
export class AnnualTicketController {
  constructor(private readonly service: AnnualTicketService) {}

  /**
   * The annual-ticket form master of the JWT caller: TICKET_MASTER grouped by
   * TAG1 into the five pickers plus the ANNUAL_TICKT_LOV eligibility flag.
   * Each group feeds one POST /annual-ticket/apply field (see the operation
   * description). A `person_id` query param is optional and answers 403 when
   * it is not the caller's.
   */
  @Get('master')
  @ApiOperation({
    summary: 'op 66 — Annual ticket master (TICKET_MASTER grouped by TAG1 + eligibility flag)',
    operationId: 'annualTicket_master',
    description: [
      'Always for the JWT caller (`XXHMC_SND_TICKET_MASTER WHERE USER_NAME = <token username>`), grouped by `TAG1`.',
      'How each group maps to the POST /annual-ticket/apply body:',
      '- `requestFor[].value` → `p_request_for` (`Self` | `Family` | `Self and Family`)',
      '- `passengers[]` with `type: Self` → `value` (= `contactId` = the PERSON_ID) → `p_employee`',
      '- `passengers[]` with `type: Family` → `value` (= `contactId`) → `p_passenger1..4` — ids, never names: TICKET_REQ_PR validates them against contact_id value sets (ORA-01722 for a name)',
      '- `contractualYears[].value` → `p_contractual_year` (e.g. `01-SEP-2025 to 31-AUG-2026`)',
      '- `destinations[].value` → `p_traveling_dest`',
      '- `ticketClasses[].value` → `p_travel_class`',
      '- `requestType` → `p_request_type` (constant `Annual Ticket`)',
      '',
      '`eligible` is the ANNUAL_TICKT_LOV Yes/No flag (null when it could not be read). `*Ar` twins',
      '(`labelAr`, `nameAr`, `eligibleAr`) are folded into their base field per `lang`; `value` and',
      '`contactId` are never localized. Unknown TAG1 rows are returned in `other`.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: AnnualTicketMasterResponseDto,
    description: 'Read envelope `result` (example: lang=en).',
    example: ANNUAL_TICKET_MASTER_EXAMPLE,
  })
  master(@Query() q: AnnualTicketMasterQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.master(user, q);
  }

  @Post('apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 67 — Submit annual ticket', operationId: 'annualTicket_apply' })
  @ApiBody(ANNUAL_TICKET_APPLY_BODY)
  @ApiOkResponse({ type: SubmitResultDto })
  apply(
    @Body() body: AnnualTicketApplyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's TICKET_REQ_PR body (p_* keys, incl. passengers + attachments).
    return this.service.apply(body, user, lang);
  }

  /**
   * Inputs of the cancellation form, always the JWT caller's own: one entry
   * per cancellable ticket with its taken-as (Cash|Voucher) and its own
   * repayment methods, joined on ANALYSIS_CRITERIA_ID. The PERSON_ID is
   * derived server-side (EMPLOYMENT_DETAILS_V); a `person_id` query param is
   * optional and answers 403 when it is not the caller's.
   */
  @Get('cancel-options')
  @ApiOperation({
    summary: 'op 72 — Ticket-cancellation options (one entry per ticket, joined on ANALYSIS_CRITERIA_ID)',
    operationId: 'annualTicket_cancelOptions',
    description:
      'Send `tickets[].analysisCriteriaId` (plus, when the ticket has several, one of its ' +
      '`repaymentMethods[].value`) to POST /annual-ticket/cancel. `value` is the composite ticket ' +
      'text for display only. The flat `takenAs` / `repaymentMethods` lists are deprecated and deduplicated.',
  })
  @ApiOkResponse({
    type: TicketCancelOptionsResponseDto,
    description: 'Read envelope `result` (example: lang=en).',
    example: ANNUAL_TICKET_CANCEL_OPTIONS_EXAMPLE,
  })
  cancelOptions(@Query() q: TicketCancelOptionsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.cancelOptions(user, q);
  }

  /**
   * Cancels one of the caller's tickets by its id. The server resolves
   * `p_annual_tkt`, `p_contractual_year`, `p_ticket_as` and (when omitted and
   * unambiguous) `p_repayment_method` from the caller's own cancel options:
   * 404 when the id is not one of them, 400 when the repayment method is
   * ambiguous or not one of the ticket's.
   */
  @Post('cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 72 — Cancel annual ticket', operationId: 'annualTicket_cancel' })
  @ApiOkResponse({ type: SubmitResultDto })
  @VerifiedBody(
    AnnualTicketCancelRequestDto,
    ANNUAL_TICKET_CANCEL_BODY,
    'analysis_criteria_id = tickets[].analysisCriteriaId from GET /annual-ticket/cancel-options (71794897 is a real cancellable ticket of the test user, person_id 26023). p_repayment_method is optional when the ticket has a single method. The old p_annual_tkt / p_contractual_year / p_ticket_as keys are rejected (400).',
  )
  cancel(
    @Body() body: AnnualTicketCancelRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.service.cancel(body, user, lang);
  }
}
