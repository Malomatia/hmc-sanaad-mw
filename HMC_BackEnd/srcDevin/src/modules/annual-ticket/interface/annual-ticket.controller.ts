import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { LovResponseDto } from '@shared/dto/lov-response.dto';
import { SubmitResultDto } from '@shared/dto/submit-result.dto';
import { VerifiedBody } from '@shared/dto/verified-body';
import { AnnualTicketService } from '../application/annual-ticket.service';
import {
  AnnualTicketApplyRequestDto,
  AnnualTicketCancelRequestDto,
  TicketCancelOptionsQueryDto,
} from './dto/annual-ticket.dto';
import { ANNUAL_TICKET_APPLY_BODY } from './annual-ticket.examples';

/** Annual-ticket endpoints (ops 66, 67, 72). See Docs_Ai/API/README.md. */
@ApiTags('annual-ticket')
@ApiBearerAuth()
@Controller('annual-ticket')
export class AnnualTicketController {
  constructor(private readonly service: AnnualTicketService) {}

  @Get('master')
  @ApiOperation({ summary: 'op 66 — Annual ticket master LOV', operationId: 'annualTicket_master' })
  @ApiOkResponse({ type: LovResponseDto })
  async master(
    @Query() q: LangQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<LovResponseDto> {
    return { items: await this.service.master(q.lang, user.username) };
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
   * Inputs of the cancellation form. Three PERSON-scoped views in one call:
   * the cancellable tickets, how each was taken (Cash|Voucher) and the
   * available repayment methods.
   */
  @Get('cancel-options')
  @ApiOperation({
    summary: 'op 72 — Ticket-cancellation options (tickets + takenAs + repayment)',
    operationId: 'annualTicket_cancelOptions',
  })
  cancelOptions(@Query() q: TicketCancelOptionsQueryDto) {
    return this.service.cancelOptions(q.person_id);
  }

  @Post('cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 72 — Cancel annual ticket', operationId: 'annualTicket_cancel' })
  @ApiOkResponse({ type: SubmitResultDto })
  // `p_annual_tkt` is the composite ANNUAL_LEAVE_PASS_TKT_VALUE returned by
  // GET /annual-ticket/cancel-options — send it exactly as received.
  @VerifiedBody(
    AnnualTicketCancelRequestDto,
    {
      p_annual_tkt:
        'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920',
      p_contractual_year: '01-SEP-2025 to 31-AUG-2026',
      p_reason: 'Travel plans cancelled',
      p_ticket_as: 'Cash',
      p_repayment_method: 'Payroll Deduction',
      p_comments: 'Cancelling the unused ticket.',
    },
    'Real cancellable ticket of the test user (person_id 26023), read from GET /annual-ticket/cancel-options. p_ticket_as pairs with p_repayment_method: Cash -> Payroll Deduction, Voucher -> Cancel Voucher.',
  )
  cancel(
    @Body() body: AnnualTicketCancelRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.service.cancel(body, user, lang);
  }
}
