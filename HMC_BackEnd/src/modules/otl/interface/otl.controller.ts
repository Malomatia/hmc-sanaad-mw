import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { DEFAULT_LANG, SUPPORTED_LANGS } from '@shared/domain/lang';
import { VerifiedBody } from '@shared/dto/verified-body';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { ApiActionOkResponse } from '@shared/swagger/api-action-ok-response.decorator';
import { OtlService } from '../application/otl.service';
import {
  OtlCostCenterQueryDto,
  OtlDateRangeQueryDto,
  OtlPeriodQueryDto,
  OtlPeriodsQueryDto,
  OtlSummaryQueryDto,
  OtlTimecardNotificationQueryDto,
  SubmitTimecardRequestDto,
} from './dto/otl.dto';
import {
  OTL_ABSENCE_EXAMPLE,
  OTL_COST_CENTERS_EXAMPLE,
  OTL_DETAILS_EXAMPLE,
  OTL_ELEMENT_DETAILS_EXAMPLE,
  OTL_ELEMENTS_EXAMPLE,
  OTL_FACILITIES_EXAMPLE,
  OTL_PERIODS_EXAMPLE,
  OTL_SUBMIT_BODY,
  OTL_SUBMIT_EXAMPLE,
  OTL_SUMMARY_ELEMENTS_EXAMPLE,
  OTL_SUMMARY_EXAMPLE,
  OTL_TEMPLATE_EXAMPLE,
  OTL_TIMECARD_NOTIFICATION_EXAMPLE,
} from './otl.examples';

/** `lang` of the two global lookups; their views have no `_AR` columns, so it changes nothing. */
const LANG_QUERY = {
  name: 'lang',
  required: false,
  enum: SUPPORTED_LANGS as unknown as string[],
  example: DEFAULT_LANG,
};

/**
 * OTL timecard (XXHMC_SND_OTL_PKG + XXHMC_SND_OTL_*_V). Every read and the
 * submit act on the authenticated caller; a `username` query value is ignored.
 * See Docs_Ai/API/README.md — Module: otl.
 */
@ApiTags('otl')
@ApiBearerAuth()
@Controller('otl')
export class OtlController {
  constructor(private readonly service: OtlService) {}

  @Get('absence-details')
  @ApiOperation({
    summary: 'OTL absences overlapping a date window (get_absence_details)',
    operationId: 'otl_getAbsenceDetails',
  })
  @ApiReadOkResponse({ example: OTL_ABSENCE_EXAMPLE })
  absenceDetails(@Query() q: OtlDateRangeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.absenceDetails(user, q);
  }

  @Get('element-details')
  @ApiOperation({
    summary: 'Hour types the caller may enter — the manual-row picker (get_element_name)',
    operationId: 'otl_getElementDetails',
  })
  @ApiReadOkResponse({ example: OTL_ELEMENT_DETAILS_EXAMPLE })
  elementDetails(@Query() q: OtlDateRangeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.elementDetails(user, q);
  }

  @Get('template')
  @ApiOperation({
    summary: 'Month pre-fill: scheduled hours per day + absences (get_template)',
    operationId: 'otl_getTemplate',
  })
  @ApiReadOkResponse({ example: OTL_TEMPLATE_EXAMPLE })
  template(@Query() q: OtlDateRangeQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.template(user, q);
  }

  @Get('timecard/elements')
  @ApiOperation({
    summary: 'Hour-type catalog (ELEMENT_V) — display only, never the picker',
    operationId: 'otl_getElements',
  })
  @ApiReadOkResponse({ example: OTL_ELEMENTS_EXAMPLE })
  @ApiQuery(LANG_QUERY)
  elements() {
    return this.service.elements();
  }

  @Get('timecard/summary')
  @ApiOperation({
    summary: 'Timecard totals per period (SUMMARY_V)',
    operationId: 'otl_getSummary',
  })
  @ApiReadOkResponse({ example: OTL_SUMMARY_EXAMPLE })
  summary(@Query() q: OtlSummaryQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.summary(user, q.period);
  }

  @Get('timecard/summary/elements')
  @ApiOperation({
    summary: 'Hours by hour type for one period (SUMMARY_ELE_V)',
    operationId: 'otl_getSummaryByElement',
  })
  @ApiReadOkResponse({ example: OTL_SUMMARY_ELEMENTS_EXAMPLE })
  summaryByElement(@Query() q: OtlPeriodQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.summaryByElement(user, q.period);
  }

  @Get('timecard/periods')
  @ApiOperation({
    summary:
      'Periods the caller may submit, with derived status (EMP_TIME_PERIOD_V + SUMMARY_V). No deadline/actioned-date fields exist in Oracle.',
    operationId: 'otl_getPeriods',
  })
  @ApiReadOkResponse({ example: OTL_PERIODS_EXAMPLE })
  periods(@Query() q: OtlPeriodsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.periods(user, { year: q.year, status: q.status });
  }

  @Get('timecard/details')
  @ApiOperation({
    summary:
      'Timecard grid for one period (TIMECARD_DEATIS_V; month template when no card exists yet)',
    operationId: 'otl_getDetails',
  })
  @ApiReadOkResponse({ example: OTL_DETAILS_EXAMPLE })
  details(@Query() q: OtlPeriodQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.service.details(user, q.period);
  }

  @Get('timecard/facilities')
  @ApiOperation({
    summary: 'Facility LOV for cross-charge entries (FACILITY_V)',
    operationId: 'otl_getFacilities',
  })
  @ApiReadOkResponse({ example: OTL_FACILITIES_EXAMPLE })
  @ApiQuery(LANG_QUERY)
  facilities() {
    return this.service.facilities();
  }

  @Get('timecard/cost-centers')
  @ApiOperation({
    summary: 'Cost centers of a facility (COST_CENTER_V)',
    operationId: 'otl_getCostCenters',
  })
  @ApiReadOkResponse({ example: OTL_COST_CENTERS_EXAMPLE })
  costCenters(@Query() q: OtlCostCenterQueryDto) {
    return this.service.costCenters(q.facilityId);
  }

  @Post('timecard/submit')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Submit a month timecard (XXHMC_SND_TIMECARD_SUBMIT_PR) — the server builds the JSON envelope',
    operationId: 'otl_submitTimecard',
  })
  @VerifiedBody(
    SubmitTimecardRequestDto,
    OTL_SUBMIT_BODY,
    'Complete July 2026 month. Not yet run against Oracle (OTL is not deployed on staging, and bugs B1-B3 block a real submit) — replace the facility/cost-center codes with values from the LOVs.',
  )
  @ApiActionOkResponse({ example: OTL_SUBMIT_EXAMPLE })
  submitTimecard(
    @Body() body: SubmitTimecardRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    return this.service.submit(body, user, lang);
  }
}

/**
 * Approval-notification details (plan 4.8), served from the OTL module under
 * the approvals path the plan proposes: feature modules may not import each
 * other, and the call is OTL-specific (HXCEMP notifications).
 */
@ApiTags('otl')
@ApiBearerAuth()
@Controller('approvals')
export class OtlApprovalsController {
  constructor(private readonly service: OtlService) {}

  @Get(':id/timecard-details')
  @ApiOperation({
    summary:
      'Timecard behind an approval notification (get_time_card_details); caller must be its recipient',
    operationId: 'approvals_getTimecardDetails',
  })
  @ApiReadOkResponse({ example: OTL_TIMECARD_NOTIFICATION_EXAMPLE })
  timecardDetails(
    @Param('id') id: string,
    @Query() q: OtlTimecardNotificationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.timecardNotificationDetails(user, id, q.requestor);
  }
}
