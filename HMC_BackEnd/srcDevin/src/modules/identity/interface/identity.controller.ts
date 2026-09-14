import { Body, Controller, Get, Post, Query, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { LovUserQueryDto } from '@shared/dto/common-query.dto';
import { LovResponseDto } from '@shared/dto/lov-response.dto';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { ApiActionOkResponse } from '@shared/swagger/api-action-ok-response.decorator';
import { IdCardService, QidService } from '../application/identity.service';
import { SAMPLE_ATTACHMENT, VerifiedBody } from '@shared/dto/verified-body';
import { CompanyIdApplyRequestDto, QidUpdateRequestDto } from './dto/identity.dto';
import {
  IDENTITY_DELIVERY_LOCATION_LOV_EXAMPLE,
  IDENTITY_IDCARD_APPLY_EXAMPLE,
  IDENTITY_QID_EXAMPLE,
  IDENTITY_QID_UPDATE_EXAMPLE,
  IDENTITY_REASON_LOV_EXAMPLE,
  IDENTITY_WORK_LOCATION_LOV_EXAMPLE,
} from './identity.examples';

/** Identity endpoints (ops 18, 19, 53b, 54, 59, 60). See Docs_Ai/API/README.md. */
@ApiTags('identity')
@ApiBearerAuth()
@Controller('identity')
export class IdentityController {
  constructor(
    private readonly qid: QidService,
    private readonly idCard: IdCardService,
  ) {}

  @Get('qid')
  @ApiOperation({ summary: 'op 18 — QID details', operationId: 'identity_qid' })
  @ApiReadOkResponse({ example: IDENTITY_QID_EXAMPLE })
  getQid(@Query() q: LovUserQueryDto) {
    return this.qid.getQid(q.username, q.lang);
  }

  @Post('qid/update')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 19 — QID update', operationId: 'identity_qidUpdate' })
  @ApiActionOkResponse({ example: IDENTITY_QID_UPDATE_EXAMPLE })
  @VerifiedBody(
    QidUpdateRequestDto,
    {
      p_qid_number: '28481809470',
      p_iss_date: '2025-10-17',
      p_exp_date: '2029-10-16',
      p_qid_job: 'Analyst',
      p_file_name1: 'qid-front.jpg',
      p_attachment1: SAMPLE_ATTACHMENT,
    },
    'Verified against staging. Dates accept yyyy-MM-dd or dd-Mon-yyyy; an attachment of the QID is expected.',
  )
  updateQid(
    @Body() body: QidUpdateRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's QID_CHG_PR body (p_* keys, incl. attachments).
    return this.qid.updateQid(body, user, lang);
  }

  @Post('idcard/apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 54 — Request company ID', operationId: 'identity_idCardApply' })
  @ApiActionOkResponse({ example: IDENTITY_IDCARD_APPLY_EXAMPLE })
  @VerifiedBody(
    CompanyIdApplyRequestDto,
    {
      p_reason: 'Damaged',
      p_charge_for_new_id: 'No',
      p_delivery_loc: 'Al Wakra Hospital',
      p_working_location: 'Others',
      p_comments: 'test',
    },
    'Verified against staging. All three list values come from the op 54 LOVs (GET /identity/lov/reason, /lov/delivery-location, /lov/work-location).',
  )
  requestCompanyId(
    @Body() body: CompanyIdApplyRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's COID_REQ_PR body (p_* keys, incl. attachments).
    return this.idCard.requestCompanyId(body, user, lang);
  }

  @Get('lov/work-location')
  @ApiOperation({ summary: 'op 53b — Work location LOV', operationId: 'identity_workLocLov' })
  @ApiOkResponse({ type: LovResponseDto })
  @ApiReadOkResponse({ example: IDENTITY_WORK_LOCATION_LOV_EXAMPLE })
  async workLocationLov(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.idCard.workLocationLov(q.lang) };
  }

  @Get('lov/delivery-location')
  @ApiOperation({ summary: 'op 59 — Delivery location LOV', operationId: 'identity_deliveryLov' })
  @ApiOkResponse({ type: LovResponseDto })
  @ApiReadOkResponse({ example: IDENTITY_DELIVERY_LOCATION_LOV_EXAMPLE })
  async deliveryLocationLov(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.idCard.deliveryLocationLov(q.lang) };
  }

  @Get('lov/reason')
  @ApiOperation({ summary: 'op 60 — ID reason LOV', operationId: 'identity_reasonLov' })
  @ApiOkResponse({ type: LovResponseDto })
  @ApiReadOkResponse({ example: IDENTITY_REASON_LOV_EXAMPLE })
  async reasonLov(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.idCard.reasonLov(q.lang) };
  }
}
