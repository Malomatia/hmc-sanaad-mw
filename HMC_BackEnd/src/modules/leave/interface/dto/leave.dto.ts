import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { EFFECTIVE_DATE_ALL } from '@shared/utils/date.util';
import {
  ATTACHMENT_FIELDS,
  defineOptionalStringFields,
  RequiredString,
} from '@shared/dto/oracle-submit.dto';

/** `dd-Mon-yyyy` display dates as used in the mapping (e.g. 12-Jun-2025). */
const DISPLAY_DATE = /^\d{2}-[A-Za-z]{3}-\d{4}$/;

/**
 * Dates on the leave-apply submit: `dd-Mon-yyyy` (mobile display form) or
 * `yyyy-MM-dd` (ISO, e.g. 2025-06-12) — both are parsed to a real DATE bind
 * by `parseOracleDate` in LeaveApplyBinds.
 */
const SUBMIT_DATE = /^(\d{2}-[A-Za-z]{3}-\d{4}|\d{4}-\d{2}-\d{2})$/;
const SUBMIT_DATE_MSG = 'must be dd-Mon-yyyy or yyyy-MM-dd.';

/**
 * op 9 — `?username&lang&accurlpln&effectivedate`.
 *
 * Keyed by USERNAME, bound to LEAVE_BALANCE_PR's `p_user_name` exactly as
 * received (client request 2026-08-30 — no PERSON_ID resolution). `person_id`
 * is still accepted as a legacy alias; whichever is present is what gets
 * bound (username wins when both are sent).
 */
export class LeaveBalanceQueryDto extends LangQueryDto {
  @ApiPropertyOptional({ example: 'AIBRAHIM39', description: 'Oracle username, bound to p_user_name as-is. Required unless person_id is sent.' })
  @ValidateIf((o: LeaveBalanceQueryDto) => !o.person_id)
  @IsString()
  @IsNotEmpty({ message: 'username (or the legacy person_id) is required.' })
  username?: string;

  @ApiPropertyOptional({ example: '852709', description: 'LEGACY alias — bound to p_user_name as-is when username is absent.' })
  @IsOptional()
  @IsString()
  person_id?: string;

  @ApiPropertyOptional({ description: 'Accrual plan id.' })
  @IsOptional()
  @IsString()
  accurlpln?: string;

  @ApiPropertyOptional({ default: EFFECTIVE_DATE_ALL, example: EFFECTIVE_DATE_ALL })
  @IsOptional()
  @IsString()
  effectivedate: string = EFFECTIVE_DATE_ALL;
}

/**
 * Optional LEAV_OF_ABSEN_NEW_PR request params (the procedure's documented
 * `p_*` binds beyond the core absence-type/reason/start/end), passed through
 * `extra` to LeaveApplyBinds. Date-like values among them accept
 * `dd-Mon-yyyy` or `yyyy-MM-dd`; all may be sent as `null` (treated as unset).
 */
export const LEAVE_APPLY_OPTIONAL_PARAMS = [
  'p_adv_leave_salary',
  'p_travel_days',
  'p_leave_inc_bonus',
  'p_annual_tkt',
  'p_contractual_year',
  'p_remarks',
  'p_relationship_bereaved',
  'p_bereavement_date',
  'p_leave_classification',
  'p_exam_date',
  'p_examination_centre',
  'p_marriage_date',
  'p_delivery_date',
  'p_number_of_children',
  'p_doctor_comments',
  'p_med_commt_decision',
  'p_hc_number',
  'p_order_id',
  'p_order_date',
  'p_encounter_id',
  'p_visit_date',
  'p_discharge_date',
  'p_medical_service',
  'p_facility',
  'p_special_instructions',
  'p_work_related_injury',
  'p_unfit_number_of_days',
  'p_practitioner_name',
  'p_practitionr_corp_number',
  'p_electronicaly_signed_on',
  'p_deliver_date',
  'p_primary_diagnosis',
  'p_spouse_name',
  'p_spouse_id',
] as const;

/**
 * op 10 — Leave submission (LEAV_OF_ABSEN_NEW_PR). Accepts the procedure's
 * documented `p_*` request payload directly (`p_absence_type`,
 * `p_absence_reason`, `p_start_date`, `p_end_date`, every optional
 * `p_*` param above, and the ten attachment slots `p_file_name1..10` /
 * `p_attachment1..10`, base64 content bound as BLOBs by LeaveApplyBinds).
 * The pre-existing camelCase spellings (`absenceType`/`absenceReason`/
 * `startDate`/`endDate`) remain accepted for backward compatibility; each
 * core field is required in exactly one of the two spellings.
 */
export class ApplyLeaveRequestDto {
  @ApiPropertyOptional({ example: 'Casual Leave', description: 'Required unless p_absence_type is sent.' })
  @ValidateIf((o: ApplyLeaveRequestDto) => o.p_absence_type === undefined || o.p_absence_type === null)
  @IsString()
  @IsNotEmpty()
  absenceType?: string;

  @ApiPropertyOptional({ example: 'Personal' })
  @IsOptional()
  @IsString()
  absenceReason?: string;

  @ApiPropertyOptional({ example: '12-Jun-2025', description: 'Required unless p_start_date is sent.' })
  @ValidateIf((o: ApplyLeaveRequestDto) => o.p_start_date === undefined || o.p_start_date === null)
  @IsString()
  @Matches(DISPLAY_DATE, { message: 'startDate must be dd-Mon-yyyy.' })
  startDate?: string;

  @ApiPropertyOptional({ example: '14-Jun-2025', description: 'Required unless p_end_date is sent.' })
  @ValidateIf((o: ApplyLeaveRequestDto) => o.p_end_date === undefined || o.p_end_date === null)
  @IsString()
  @Matches(DISPLAY_DATE, { message: 'endDate must be dd-Mon-yyyy.' })
  endDate?: string;

  // ── Spec `p_*` spellings of the core params (LEAV_OF_ABSEN_NEW_PR binds) ──
  @ApiPropertyOptional({ example: 'Casual Leave' })
  @IsOptional()
  @IsString()
  p_absence_type?: string;

  @ApiPropertyOptional({ example: 'Personal' })
  @IsOptional()
  @IsString()
  p_absence_reason?: string;

  @ApiPropertyOptional({ example: '2025-06-12' })
  @IsOptional()
  @IsString()
  @Matches(SUBMIT_DATE, { message: `p_start_date ${SUBMIT_DATE_MSG}` })
  p_start_date?: string;

  @ApiPropertyOptional({ example: '2025-06-14' })
  @IsOptional()
  @IsString()
  @Matches(SUBMIT_DATE, { message: `p_end_date ${SUBMIT_DATE_MSG}` })
  p_end_date?: string;

  [key: string]: unknown;
}

defineOptionalStringFields(ApplyLeaveRequestDto, [
  ...LEAVE_APPLY_OPTIONAL_PARAMS,
  ...ATTACHMENT_FIELDS,
]);

/**
 * ops 61/62 — GET /leave/lov/amend and /leave/lov/cancel.
 *
 * Both views (`XXHMC_SND_LEAVE_AMEND_V`, `XXHMC_SND_LEAVE_CANCEL_V`) expose
 * PERSON_ID and no username column, so `person_id` is the parameter that
 * actually filters; `username`/`enum` are accepted for legacy payloads and used
 * as the filter value when `person_id` is absent.
 *
 * These lists are not cosmetic: each procedure resolves its input against the
 * matching view (`XXHMC_SND_HR_LEAV_CANCEL_PR` line 163 does
 * `SELECT id FROM xx_leave_cancel_v WHERE value = p_leave_to_cancel`), so the
 * `used_value` returned here is the ONLY text the submit will accept. Anything
 * assembled by hand — for instance from `GET /leaves`, whose dates read
 * `12-03-2026` rather than `12-MAR-2026` — raises "no data found".
 */
export class LeaveAmendLovQueryDto extends LangQueryDto {
  @ApiPropertyOptional({ example: '26023', description: 'Oracle PERSON_ID (preferred — the view is person-scoped).' })
  @IsOptional()
  @IsString()
  person_id?: string;

  @ApiPropertyOptional({ example: 'AIBRAHIM39', description: 'Oracle username form (legacy).' })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ example: '037400', description: 'Employee number (legacy).' })
  @IsOptional()
  @IsString()
  enum?: string;

  @ApiPropertyOptional({
    example: 'Casual Leave',
    description:
      'Filter by leave type — case-insensitive CONTAINS match on the view\'s NAME column ' +
      '(NAME holds display strings like "Casual Leave|19-APR-2026|19-APR-2026"). Omit for all rows.',
  })
  @IsOptional()
  @IsString()
  leave_type?: string;
}

/** op 13 — GET /leave/lov/reasons `?lang=&leave_type=` (ABSENCE_REASON_V). */
export class LeaveReasonsQueryDto extends LangQueryDto {
  @ApiPropertyOptional({
    example: 'Compassionate Leave',
    description:
      'Optional LEAVE_TYPE filter (English value from the leave-types LOV) — returns only that type’s reasons.',
  })
  @IsOptional()
  @IsString()
  leave_type?: string;
}

/** GET /leaves — `?user_name=&leave_type=&lang=` against ABSENCE_V. */
export class LeavesQueryDto extends LangQueryDto {
  @ApiProperty({ example: 'V-NFERNANDO', description: 'Oracle username (ABSENCE_V.USER_NAME).' })
  @IsString()
  @IsNotEmpty()
  user_name!: string;

  @ApiPropertyOptional({
    example: 'Casual Leave',
    description: 'Optional ABSENCE_TYPE filter (English value from the leave-types LOV).',
  })
  @IsOptional()
  @IsString()
  leave_type?: string;
}

/** One ABSENCE_V row (GET /leaves). `absenceType`/`absenceReason` follow the request's lang. */
export class LeaveRecordDto {
  @ApiProperty({ example: 'Casual Leave' })
  absenceType?: string;

  @ApiPropertyOptional({ example: 'Personal' })
  absenceReason?: string;

  @ApiProperty({ example: '12-Jun-2025' })
  actualStartDate?: string;

  @ApiProperty({ example: '14-Jun-2025' })
  actualEndDate?: string;

  @ApiProperty({ example: 3 })
  absenceDays?: number;
}

/** op 47 — Leave duration calculation. */
export class LeaveCalcRequestDto {
  @ApiProperty({ example: 'Casual Leave' })
  @IsString()
  absenceType!: string;

  @ApiProperty({ example: '12-Jun-2025' })
  @IsString()
  @Matches(DISPLAY_DATE, { message: 'startDate must be dd-Mon-yyyy.' })
  startDate!: string;

  @ApiProperty({ example: '14-Jun-2025' })
  @IsString()
  @Matches(DISPLAY_DATE, { message: 'endDate must be dd-Mon-yyyy.' })
  endDate!: string;
}

/** op 57 — POST /leave/amend (HR_LEAV_AMEND_PR request template). */
export class LeaveAmendRequestDto {
  @RequiredString('Annual Leave')
  p_leave_type!: string;

  // COMPOSITE string 'Leave Type|DD-MON-YYYY|DD-MON-YYYY' (type|start|end) —
  // confirmed by the DB team and verified live 2026-08-24 (successflag S with
  // 'Annual Leave|12-MAR-2026|12-MAR-2026'). Values come from the op 62 amend
  // LOV rows; a plain numeric id raises ORA-01403 inside the procedure.
  @RequiredString('Annual Leave|12-MAR-2026|12-MAR-2026')
  p_leave_to_amend!: string;

  /** New end date — `yyyy-MM-dd` or `dd-Mon-yyyy` (DATE formals bind natively). */
  @RequiredString('2026-03-13')
  p_new_end_date!: string;

  /**
   * Accepted for spec-payload compatibility but NOT honored: the authenticated
   * JWT username is always enforced server-side as `p_user_name`.
   */
  @ApiPropertyOptional({
    example: 'AIBRAHIM39',
    description: 'Optional; ignored — the authenticated username is enforced server-side.',
  })
  @IsOptional()
  @IsString()
  p_user_name?: string;

  [key: string]: unknown;
}

defineOptionalStringFields(LeaveAmendRequestDto, ['p_comments', ...ATTACHMENT_FIELDS]);

/** op 58 — POST /leave/cancel (HR_LEAV_CANCEL_PR request template). */
export class LeaveCancelRequestDto {
  @RequiredString('Annual Leave')
  p_leave_type!: string;

  // COMPOSITE string 'Leave Type|DD-MON-YYYY|DD-MON-YYYY' (type|start|end) —
  // verified live 2026-08-24 (successflag S with
  // 'Annual Leave|12-MAR-2026|12-MAR-2026'). A plain numeric id raises
  // ORA-01403 inside the procedure.
  @RequiredString('Annual Leave|12-MAR-2026|12-MAR-2026')
  p_leave_to_cancel!: string;

  @RequiredString('Plans changed')
  p_reason_for_cancel!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(LeaveCancelRequestDto, ['p_remarks', ...ATTACHMENT_FIELDS]);

/** op 56 — POST /leave/return (RET_FRM_LEAV_PR request template). */
export class LeaveReturnRequestDto {
  /**
   * The leave's ABSENCE_ATTENDANCE_ID, as a numeric string.
   *
   * Verified live 2026-09-01: '56949953' → successflag S, while every text
   * form ('Casual Leave|19-APR-2026|19-APR-2026', the op 55 display string,
   * the bare type) answers ORA-01722 — the procedure runs TO_NUMBER on this
   * argument. An earlier note here described a short composite; that was the
   * shape that stopped overflowing VARCHAR2(60), not the shape that resolves.
   *
   * Read it from GET /leave/lov/return → `id`. That field was added for this
   * (`code`/`meaning`/`used_value` still carry the display string, so nothing
   * changed for clients that do not need the id). Success additionally
   * requires the caller to have submitted the Policy Awareness questionnaire.
   */
  @RequiredString('56949953')
  p_leave_details!: string;

  /** Return date — `yyyy-MM-dd` or `dd-Mon-yyyy` (DATE formals bind natively). */
  @RequiredString('20-Apr-2026')
  p_return_date!: string;

  /**
   * Accepted for spec-payload compatibility but NOT honored: the authenticated
   * JWT username is always enforced server-side as `p_user_name`.
   */
  @ApiPropertyOptional({
    example: 'AIBRAHIM39',
    description: 'Optional; ignored — the authenticated username is enforced server-side.',
  })
  @IsOptional()
  @IsString()
  p_user_name?: string;

  [key: string]: unknown;
}

defineOptionalStringFields(
  LeaveReturnRequestDto,
  ['p_related_leave1', 'p_related_leave2', 'p_comments', ...ATTACHMENT_FIELDS],
  { p_comments: 'Returned early.' },
);
