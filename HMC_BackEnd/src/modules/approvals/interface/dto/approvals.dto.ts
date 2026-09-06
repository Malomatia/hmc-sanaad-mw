import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { ProfileQueryDto } from '@shared/dto/common-query.dto';
import { ApprovalDecision, ReassignType } from '../../domain/approvals.repository';

/** Query for detail routes carrying only `lang` (id is a path param). */
export class ApprovalDetailQueryDto extends LangQueryDto {}

/**
 * ops 20 and 23 — routes scoped to the authenticated caller, where a
 * client-supplied identifier is deliberately ignored (see the controller).
 *
 * It still has to be ACCEPTED, though: the global pipe runs with
 * `forbidNonWhitelisted`, so dropping the property would answer 400 "property
 * enum should not exist" to every existing client, while keeping
 * ProfileQueryDto's required `enum` would answer 400 to a client that
 * correctly stops sending it. Optional here, so both work.
 */
export class OwnScopeQueryDto extends LangQueryDto {
  @ApiPropertyOptional({
    example: '037400',
    description: 'Accepted for compatibility and IGNORED — rows follow the authenticated caller.',
  })
  @IsOptional()
  @IsString()
  enum?: string;

  @ApiPropertyOptional({
    example: 'AIBRAHIM39',
    description: 'Accepted for compatibility and IGNORED — rows follow the authenticated caller.',
  })
  @IsOptional()
  @IsString()
  username?: string;
}

/**
 * op 70 — action history. ACTION_HISTORY_V is keyed by ITEM_TYPE + ITEM_KEY;
 * the path parameter carries the item key and the type defaults to the HR
 * self-service workflow.
 */
export class ActionHistoryQueryDto extends LangQueryDto {
  @ApiPropertyOptional({ example: 'HRSSA', default: 'HRSSA' })
  @IsOptional()
  @IsString()
  itemType?: string;
}

/** op 69 — worklist summary is scoped to a single notification. */
export class WorklistSummaryQueryDto extends ProfileQueryDto {
  @ApiPropertyOptional({ example: '123859197', description: 'NOTIFICATION_ID from the worklist rows; omit for the full list.' })
  @IsOptional()
  @IsString()
  notificationId?: string;
}

/**
 * op 22 — Approve/Reject. APPROVE_REJECT_PR needs the workflow item type and
 * key in addition to the notification id taken from the route.
 */
export class ApproveRejectRequestDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'], example: 'APPROVE' })
  @IsIn(['APPROVE', 'REJECT'])
  decision!: ApprovalDecision;

  @ApiProperty({
    example: '18875905',
    description: 'Workflow ITEM_KEY of the request (from the worklist rows); the route :id is the NOTIFICATION_ID.',
  })
  @IsString()
  @IsNotEmpty()
  itemKey!: string;

  @ApiPropertyOptional({ example: 'HRSSA', default: 'HRSSA' })
  @IsOptional()
  @IsString()
  itemType?: string;

  @ApiPropertyOptional({ example: 'Approved.' })
  @IsOptional()
  @IsString()
  comment?: string;
}

/**
 * RFMI — request more information on a notification (HR_RFMI_PR, companion to
 * the op 26 RFMI user LOV). The notification id comes from the route.
 */
export class RequestInfoRequestDto {
  @ApiProperty({
    example: '18875965',
    description: 'Workflow ITEM_KEY of the request (from the worklist rows); the route :id is the NOTIFICATION_ID.',
  })
  @IsString()
  @IsNotEmpty()
  itemKey!: string;

  @ApiPropertyOptional({ example: 'HRSSA', default: 'HRSSA' })
  @IsOptional()
  @IsString()
  itemType?: string;

  @ApiPropertyOptional({
    example: 'QUESTION',
    default: 'QUESTION',
    description: "Procedure p_mode (e.g. 'QUESTION' to ask, 'ANSWER' to respond).",
  })
  @IsOptional()
  @IsString()
  mode?: string;

  @ApiPropertyOptional({
    example: 'V-NFERNANDO',
    description: 'Username the question is directed to (p_to_user_name) — see the RFMI user LOV (op 26).',
  })
  @IsOptional()
  @IsString()
  toUsername?: string;

  @ApiProperty({ example: 'Please attach the supporting documents.' })
  @IsString()
  @IsNotEmpty()
  comment!: string;
}

/** op 71 — Reassign approval (delegate or transfer). */
export class ReassignApprovalRequestDto {
  @ApiProperty({ example: 'V-NFERNANDO', description: 'Username to reassign the task to (username form, not employee number).' })
  @IsString()
  @IsNotEmpty()
  assignTo!: string;

  @ApiPropertyOptional({ enum: ['DELEGATE', 'TRANSFER'], default: 'DELEGATE', example: 'DELEGATE' })
  @IsOptional()
  @IsIn(['DELEGATE', 'TRANSFER'])
  type?: ReassignType;

  @ApiPropertyOptional({ example: 'Reassigning while on leave.' })
  @IsOptional()
  @IsString()
  comment?: string;
}
