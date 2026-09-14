import { BadRequestException, Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { ProfileQueryDto, LovUserQueryDto, LovScopedQueryDto } from '@shared/dto/common-query.dto';
import { LovResponseDto } from '@shared/dto/lov-response.dto';
import { SubmitResultDto } from '@shared/dto/submit-result.dto';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { ApiActionOkResponse } from '@shared/swagger/api-action-ok-response.decorator';
import { LeaveService } from '../application/leave.service';
import { VerifiedBody } from '@shared/dto/verified-body';
import {
  ApplyLeaveRequestDto,
  LeaveAmendLovQueryDto,
  LeaveAmendRequestDto,
  LeaveBalanceQueryDto,
  LeaveCalcRequestDto,
  LeaveCancelRequestDto,
  LeaveReasonsQueryDto,
  LeaveReturnRequestDto,
} from './dto/leave.dto';
import {
  LEAVE_AMEND_BODY,
  LEAVE_APPLY_BODY,
  LEAVE_APPLY_EXAMPLE,
  LEAVE_CALCULATE_EXAMPLE,
  LEAVE_CANCEL_BODY,
  LEAVE_CLASSES_LOV_EXAMPLE,
  LEAVE_DEFAULTS_EXAMPLE,
  LEAVE_EMPTY_ITEMS_EXAMPLE,
  LEAVE_REASONS_LOV_EXAMPLE,
  LEAVE_REQUEST_LOV_EXAMPLE,
  LEAVE_RETURN_BODY,
  LEAVE_RFL_LOV_EXAMPLE,
  LEAVE_RETURN_EXAMPLE,
  LEAVE_TYPES_LOV_EXAMPLE,
} from './leave.examples';

/** Leave endpoints (14 ops). See Docs_Ai/API/README.md — Module: leave. */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave')
export class LeaveController {
  constructor(private readonly service: LeaveService) {}

  @Get('balance')
  @ApiOperation({ summary: 'op 9 — Leave balance', operationId: 'leave_balance' })
  balance(@Query() q: LeaveBalanceQueryDto) {
    return this.service.getBalance({
      username: q.username,
      personId: q.person_id,
      lang: q.lang,
      effectiveDate: q.effectivedate,
      accrualPlan: q.accurlpln,
    });
  }

  @Post('apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 10 — Leave submission', operationId: 'leave_apply' })
  @ApiBody(LEAVE_APPLY_BODY)
  @ApiActionOkResponse({ example: LEAVE_APPLY_EXAMPLE })
  apply(
    @Body() dto: ApplyLeaveRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Core params accept both the spec `p_*` spelling and the legacy camelCase
    // (camelCase wins when both are sent). Everything else — the optional p_*
    // params + attachment slots (p_file_name1..10 / p_attachment1..10,
    // base64 → BLOB) — travels in `extra` and is bound by LeaveApplyBinds by
    // its documented p_* name.
    const {
      absenceType,
      absenceReason,
      startDate,
      endDate,
      p_absence_type,
      p_absence_reason,
      p_start_date,
      p_end_date,
      ...extra
    } = dto;
    return this.service.apply(
      {
        absenceType: (absenceType ?? p_absence_type) as string,
        absenceReason: absenceReason ?? p_absence_reason ?? undefined,
        startDate: (startDate ?? p_start_date) as string,
        endDate: (endDate ?? p_end_date) as string,
        extra,
      },
      user,
      lang,
    );
  }

  @Post('calculate')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 47 — Leave duration calculation', operationId: 'leave_calculate' })
  @ApiReadOkResponse({ example: LEAVE_CALCULATE_EXAMPLE })
  @VerifiedBody(LeaveCalcRequestDto, {
    absenceType: 'Casual Leave',
    startDate: '12-Jun-2025',
    endDate: '14-Jun-2025',
  })
  calculate(
    @Body() dto: LeaveCalcRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.service.calculate(dto.absenceType, dto.startDate, dto.endDate, user, lang);
  }

  @Post('amend')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 57 — Leave amend', operationId: 'leave_amend' })
  @ApiBody(LEAVE_AMEND_BODY)
  @ApiOkResponse({ type: SubmitResultDto })
  amend(
    @Body() body: LeaveAmendRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's HR_LEAV_AMEND_PR body (p_* keys, incl. attachments).
    return this.service.amend(body, user, lang);
  }

  @Post('cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 58 — Leave cancel', operationId: 'leave_cancel' })
  @ApiBody(LEAVE_CANCEL_BODY)
  @ApiOkResponse({ type: SubmitResultDto })
  cancel(
    @Body() body: LeaveCancelRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's HR_LEAV_CANCEL_PR body (p_* keys, incl. attachments).
    return this.service.cancel(body, user, lang);
  }

  @Post('return')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 56 — Return from leave', operationId: 'leave_return' })
  @ApiBody(LEAVE_RETURN_BODY)
  @ApiActionOkResponse({ example: LEAVE_RETURN_EXAMPLE })
  returnFromLeave(
    @Body() body: LeaveReturnRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's RET_FRM_LEAV_PR body (p_* keys, incl. attachments).
    return this.service.returnFromLeave(body, user, lang);
  }

  @Get('lov/types')
  @ApiOperation({ summary: 'op 12 — Leave types LOV', operationId: 'leave_typesLov' })
  @ApiOkResponse({ type: LovResponseDto })
  @ApiReadOkResponse({ example: LEAVE_TYPES_LOV_EXAMPLE })
  async types(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.types(q.lang) };
  }

  @Get('lov/reasons')
  @ApiOperation({
    summary: 'op 13 — Leave reasons LOV (optionally filtered by ?leave_type=)',
    operationId: 'leave_reasonsLov',
  })
  @ApiOkResponse({ type: LovResponseDto })
  @ApiReadOkResponse({ example: LEAVE_REASONS_LOV_EXAMPLE })
  async reasons(@Query() q: LeaveReasonsQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.reasons(q.lang, q.leave_type) };
  }

  @Get('lov/classes')
  @ApiOperation({ summary: 'op 14 — Leave classes LOV', operationId: 'leave_classesLov' })
  @ApiOkResponse({ type: LovResponseDto })
  @ApiReadOkResponse({ example: LEAVE_CLASSES_LOV_EXAMPLE })
  async classes(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.classes(q.lang) };
  }

  @Get('lov/defaults')
  @ApiOperation({ summary: 'op 45 — Leave defaults', operationId: 'leave_defaults' })
  @ApiReadOkResponse({ example: LEAVE_DEFAULTS_EXAMPLE })
  defaults(@Query() q: ProfileQueryDto) {
    return this.service.defaults(q.enum, q.lang);
  }

  @Get('lov/request-lov')
  @ApiOperation({ summary: 'op 46 — Leave request LOVs', operationId: 'leave_requestLov' })
  @ApiReadOkResponse({ example: LEAVE_REQUEST_LOV_EXAMPLE })
  requestLov(@Query() q: ProfileQueryDto) {
    return this.service.requestLov(q.lang);
  }

  @Get('lov/return')
  @ApiOperation({ summary: 'op 55 — Return-from-leave LOV', operationId: 'leave_returnLov' })
  @ApiOkResponse({ type: LovResponseDto })
  @ApiReadOkResponse({ example: LEAVE_EMPTY_ITEMS_EXAMPLE })
  async returnLov(@Query() q: LovUserQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.returnLov(q.username, q.lang) };
  }

  @Get('lov/return-details')
  @ApiOperation({
    summary: 'RFL_LEAVE_DET_LOV — return-from-leave details (all view columns)',
    operationId: 'leave_returnDetailsLov',
  })
  @ApiReadOkResponse({ example: LEAVE_RFL_LOV_EXAMPLE })
  async returnDetailsLov(@Query() q: LovUserQueryDto) {
    return { items: await this.service.returnDetailsLov(q.username) };
  }

  @Get('lov/return-related1')
  @ApiOperation({
    summary: 'RFL_REL_LEAVE1_LOV — related leave 1 (all view columns)',
    operationId: 'leave_relatedLeave1Lov',
  })
  @ApiReadOkResponse({ example: LEAVE_RFL_LOV_EXAMPLE })
  async relatedLeave1Lov(@Query() q: LovUserQueryDto) {
    return { items: await this.service.relatedLeave1Lov(q.username) };
  }

  @Get('lov/return-related2')
  @ApiOperation({
    summary: 'RFL_REL_LEAVE2_LOV — related leave 2 (all view columns)',
    operationId: 'leave_relatedLeave2Lov',
  })
  @ApiReadOkResponse({ example: LEAVE_RFL_LOV_EXAMPLE })
  async relatedLeave2Lov(@Query() q: LovUserQueryDto) {
    return { items: await this.service.relatedLeave2Lov(q.username) };
  }

  /**
   * The values POST /leave/cancel accepts. The same person is keyed
   * differently per view (LEAVE_CANCEL_V/AMEND_V expose PERSON_ID, others a
   * username column), so EVERY identifier the caller sent (person_id,
   * username, enum) is forwarded and matched with `IN (...)` against
   * whichever scoping column the view really has — no more empty lists when
   * the client sends the "wrong" form. Same shape as op 62 below.
   */
  @Get('lov/cancel')
  @ApiOperation({ summary: 'op 61 — Leave cancel LOV', operationId: 'leave_cancelLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async cancelLov(@Query() q: LeaveAmendLovQueryDto): Promise<LovResponseDto> {
    return {
      items: await this.service.cancelLov(LeaveController.lovKeys(q), q.lang, q.leave_type),
    };
  }

  @Get('lov/amend')
  @ApiOperation({ summary: 'op 62 — Leave amend LOV', operationId: 'leave_amendLov' })
  @ApiOkResponse({ type: LovResponseDto })
  async amendLov(@Query() q: LeaveAmendLovQueryDto): Promise<LovResponseDto> {
    return {
      items: await this.service.amendLov(LeaveController.lovKeys(q), q.lang, q.leave_type),
    };
  }

  /** Every identifier form supplied by the caller (at least one required). */
  private static lovKeys(q: LeaveAmendLovQueryDto): string[] {
    const keys = [q.person_id, q.username, q.enum].filter((v): v is string => !!v);
    if (!keys.length) {
      throw new BadRequestException('person_id, username or enum query parameter is required.');
    }
    return keys;
  }
}
