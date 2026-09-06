import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { LovUserQueryDto } from '@shared/dto/common-query.dto';

/**
 * op 69 (getworklistsummary) — `/profile/notifications/summary?username=&notificationId=&lang=`.
 * WORKLISTS_V scoped to one NOTIFICATION_ID; omit it for the full list.
 */
export class NotificationSummaryQueryDto extends LovUserQueryDto {
  @ApiPropertyOptional({
    example: '123859434',
    description: 'NOTIFICATION_ID from the notification rows; omit for the full list.',
  })
  @IsOptional()
  @IsString()
  notificationId?: string;
}

/**
 * op 70 (getworklistactionhistory) — `/profile/notifications/:id/history?itemType=&lang=`.
 * ACTION_HISTORY_V is keyed by ITEM_TYPE + ITEM_KEY; the path parameter carries
 * the item key and the type defaults to the HR self-service workflow.
 */
export class NotificationHistoryQueryDto extends LangQueryDto {
  @ApiPropertyOptional({ example: 'HRSSA', default: 'HRSSA' })
  @IsOptional()
  @IsString()
  itemType?: string;
}
