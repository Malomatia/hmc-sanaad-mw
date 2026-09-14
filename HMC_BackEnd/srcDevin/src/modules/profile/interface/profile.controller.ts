import { Body, Controller, Get, Param, Post, Query, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Lang } from '@core/i18n/lang.decorator';
import type { Lang as LangCode } from '@shared/domain/lang';
import { CurrentUser } from '@core/auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LovUserQueryDto } from '@shared/dto/common-query.dto';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { LovResponseDto } from '@shared/dto/lov-response.dto';
import { ApiReadOkResponse } from '@shared/swagger/api-read-ok-response.decorator';
import { ApiActionOkResponse } from '@shared/swagger/api-action-ok-response.decorator';
import { ProfileService } from '../application/profile.service';
import { UpdatePersonalRequestDto } from './dto/update-personal.request.dto';
import {
  NotificationHistoryQueryDto,
  NotificationSummaryQueryDto,
} from './dto/notifications-query.dto';
import {
  PROFILE_GET_EXAMPLE,
  PROFILE_MARITAL_LOV_EXAMPLE,
  PROFILE_NOTIFICATION_HISTORY_EXAMPLE,
  PROFILE_NOTIFICATION_SUMMARY_EXAMPLE,
  PROFILE_NOTIFICATIONS_EXAMPLE,
  PROFILE_UPDATE_PERSONAL_BODY,
  PROFILE_UPDATE_PERSONAL_EXAMPLE,
} from './profile.examples';

/** Profile endpoints (ops 2, 48, 63). See Docs_Ai/API/README.md. */
@ApiTags('profile')
@ApiBearerAuth()
@Controller('profile')
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  @Get()
  @ApiOperation({ summary: 'op 2 — Personal detail', operationId: 'profile_get' })
  @ApiReadOkResponse({ example: PROFILE_GET_EXAMPLE })
  get(@Query() q: LovUserQueryDto) {
    return this.service.getProfile(q.username, q.lang);
  }

  @Post('personal')
  @HttpCode(200)
  @ApiOperation({ summary: 'op 48 — Update personal details', operationId: 'profile_updatePersonal' })
  @ApiBody(PROFILE_UPDATE_PERSONAL_BODY)
  @ApiActionOkResponse({ example: PROFILE_UPDATE_PERSONAL_EXAMPLE })
  updatePersonal(
    @Body() body: UpdatePersonalRequestDto,
    @CurrentUser() user: AuthenticatedUser,
    @Lang() lang: LangCode,
  ) {
    // Accepts the spec's UPDATE_PERSONAL_INFO_PR body (p_* keys, incl. attachments).
    return this.service.updatePersonal(body, user, lang);
  }

  /**
   * Notification list (WORKLISTS_V, getworklist query). Same data as op 68
   * `GET /approvals/worklist`, but reachable by every authenticated user —
   * the approvals route is APPROVER/SUPERVISOR-only while notifications
   * (FYI, RFMI answers) go to regular employees too.
   */
  @Get('notifications')
  @ApiOperation({ summary: 'Notification list (WORKLISTS_V)', operationId: 'profile_notifications' })
  @ApiReadOkResponse({ example: PROFILE_NOTIFICATIONS_EXAMPLE })
  notifications(@Query() q: LovUserQueryDto) {
    return this.service.notifications(q.username, q.lang);
  }

  /**
   * op 69 getworklistsummary — one notification's WORKLISTS_V row (the list
   * query + `NOTIFICATION_ID = :id`). Same data as `GET
   * /approvals/worklist/summary` but without the APPROVER/SUPERVISOR gate.
   */
  @Get('notifications/summary')
  @ApiOperation({
    summary: 'op 69 — Notification summary (WORKLISTS_V by NOTIFICATION_ID)',
    operationId: 'profile_notificationSummary',
  })
  @ApiReadOkResponse({ example: PROFILE_NOTIFICATION_SUMMARY_EXAMPLE })
  notificationSummary(@Query() q: NotificationSummaryQueryDto) {
    return this.service.notificationSummary(q.username, q.lang, q.notificationId);
  }

  /**
   * op 70 getworklistactionhistory — `id` is the workflow ITEM_KEY that
   * ACTION_HISTORY_V is keyed by (from the notification rows), NOT the
   * notification id. Same data as `GET /approvals/worklist/:id/history` but
   * without the APPROVER/SUPERVISOR gate.
   */
  @Get('notifications/:id/history')
  @ApiOperation({
    summary: 'op 70 — Notification action history (ACTION_HISTORY_V)',
    operationId: 'profile_notificationHistory',
  })
  @ApiReadOkResponse({ example: PROFILE_NOTIFICATION_HISTORY_EXAMPLE })
  notificationHistory(@Param('id') id: string, @Query() q: NotificationHistoryQueryDto) {
    return this.service.notificationHistory(id, q.lang, q.itemType);
  }

  @Get('lov/marital-status')
  @ApiOperation({ summary: 'op 63 — Marital status LOV', operationId: 'profile_maritalLov' })
  @ApiOkResponse({ type: LovResponseDto })
  @ApiReadOkResponse({ example: PROFILE_MARITAL_LOV_EXAMPLE })
  async maritalStatusLov(@Query() q: LangQueryDto): Promise<LovResponseDto> {
    return { items: await this.service.maritalStatusLov(q.lang) };
  }
}
