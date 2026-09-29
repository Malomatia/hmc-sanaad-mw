import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import { OTL_MAX_RANGE_DAYS } from '../../application/otl-timecard.util';

/** Calendar dates are exchanged as `YYYY-MM-DD` (the TIME_PERIOD_V START_DATE/END_DATE form). */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_MSG = 'must be a real calendar date in YYYY-MM-DD form.';

/** A `YYYY-MM-DD` that is also a real day (2026-02-30 is rejected). */
function IsoDate(): PropertyDecorator {
  return (target, key) => {
    IsString()(target, key);
    Matches(ISO_DATE, { message: `${String(key)} ${ISO_DATE_MSG}` })(target, key);
    IsISO8601({ strict: true }, { message: `${String(key)} ${ISO_DATE_MSG}` })(target, key);
  };
}

/** Status values of GET /otl/timecard/periods (derived from SUMMARY_V.APPROVAL_STATUS). */
export const OTL_PERIOD_STATUSES = [
  'OPEN',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'ERROR',
  'UNKNOWN',
] as const;

/**
 * Base query of every OTL read: `lang` plus a tolerated `username`. The
 * employee is ALWAYS the authenticated caller; a client-supplied username is
 * accepted so existing clients do not get 400, and ignored.
 */
export class OtlUserQueryDto extends LangQueryDto {
  @ApiPropertyOptional({
    example: 'AIBRAHIM39',
    description:
      'Accepted for compatibility and IGNORED — every OTL read uses the authenticated caller.',
  })
  @IsOptional()
  @IsString()
  username?: string;
}

/** `?startDate=&endDate=` — get_absence_details / get_element_name / get_template. */
export class OtlDateRangeQueryDto extends OtlUserQueryDto {
  @ApiProperty({
    example: '2026-07-01',
    description: 'Period START_DATE from GET /otl/timecard/periods.',
  })
  @IsoDate()
  startDate!: string;

  @ApiProperty({
    example: '2026-07-31',
    description: `Period END_DATE from GET /otl/timecard/periods. At most ${OTL_MAX_RANGE_DAYS} days after startDate.`,
  })
  @IsoDate()
  endDate!: string;
}

/** `?period=` — the period START_DATE, required (SUMMARY_ELE_V, TIMECARD_DEATIS_V). */
export class OtlPeriodQueryDto extends OtlUserQueryDto {
  @ApiProperty({
    example: '2026-07-01',
    description:
      "The period START_DATE from GET /otl/timecard/periods (not its label). Matched against the view's START_TIME.",
  })
  @IsoDate()
  period!: string;
}

/** `?period=` optional — SUMMARY_V. */
export class OtlSummaryQueryDto extends OtlUserQueryDto {
  @ApiPropertyOptional({
    example: '2026-07-01',
    description: 'Optional period START_DATE; omit for every timecard of the caller.',
  })
  @IsOptional()
  @IsoDate()
  period?: string;
}

/** `?year=&status=` — EMP_TIME_PERIOD_V joined with SUMMARY_V. */
export class OtlPeriodsQueryDto extends OtlUserQueryDto {
  @ApiPropertyOptional({ example: '2026', description: 'Only periods starting in this year.' })
  @IsOptional()
  @Matches(/^\d{4}$/, { message: 'year must be a four-digit year.' })
  year?: string;

  @ApiPropertyOptional({
    enum: OTL_PERIOD_STATUSES,
    description:
      'Filter on the derived status. OPEN = no timecard yet or a WORKING draft; UNKNOWN = the summary view could not be read.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn(OTL_PERIOD_STATUSES as unknown as string[])
  status?: string;
}

/** `?facilityId=` — COST_CENTER_V is the dependent LOV of FACILITY_V. */
export class OtlCostCenterQueryDto extends LangQueryDto {
  @ApiProperty({ example: '09', description: 'FACILITY_CODE from GET /otl/timecard/facilities.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(25)
  facilityId!: string;
}

/** `GET /approvals/:id/timecard-details?requestor=`. */
export class OtlTimecardNotificationQueryDto extends LangQueryDto {
  @ApiProperty({
    example: 'V-NFERNANDO',
    description:
      "Username of the timecard OWNER (the worklist row's requestor), not the approver — " +
      "get_time_card_details returns nothing for the approver's own username.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  requestor!: string;
}

/**
 * One `p_entries[]` object of the submit JSON (findings §4). One entry per
 * element per day: range entries (`p_from_date`/`p_to_date`/`p_days`) are
 * parsed but not stored by Oracle (B8), so they are not accepted.
 */
export class TimecardEntryDto {
  @ApiProperty({
    example: 'Regular Hours',
    description:
      'Element NAME (ELEMENT_NAME from GET /otl/element-details, or a leave element such as "Annual Leave"), ' +
      'never ELEMENT_TYPE_ID — Oracle matches it against lookup XXHMC_OTL_INT_ELEMENT_MAP by name.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  @Matches(/[A-Za-z]/, {
    message: 'p_hour_type_id must be the element NAME (e.g. "Regular Hours"), not an id.',
  })
  p_hour_type_id!: string;

  @ApiProperty({
    example: '2026-07-01',
    description: 'Sent to Oracle as DD-Mon-YYYY (01-Jul-2026).',
  })
  @IsoDate()
  p_entry_date!: string;

  @ApiProperty({
    example: 8,
    description: 'Hours (decimal). The hours of one day must total 0..24.',
  })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: 'p_value must be a number of hours.' },
  )
  @Min(0)
  @Max(24)
  p_value!: number;

  @ApiProperty({
    enum: ['Y', 'N'],
    example: 'N',
    description: 'Y = charged to another facility/cost center.',
  })
  @IsIn(['Y', 'N'])
  p_cross_dept_flag!: 'Y' | 'N';

  @ApiPropertyOptional({
    example: '09',
    description:
      'Raw FACILITY_CODE (not the "code-description" label). Required when p_cross_dept_flag is Y.',
  })
  @ValidateIf((o: TimecardEntryDto) => o.p_cross_dept_flag === 'Y' || o.p_dept_id !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  p_dept_id?: string;

  @ApiPropertyOptional({
    example: '4471',
    description: 'Raw COST_CENTER_CODE (not the label). Required when p_cross_dept_flag is Y.',
  })
  @ValidateIf((o: TimecardEntryDto) => o.p_cross_dept_flag === 'Y' || o.p_cost_center !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  p_cost_center?: string;

  @ApiPropertyOptional({
    example: 'Corporate event support',
    description: 'Parsed but not stored by Oracle (B8).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  p_comments?: string;
}

/**
 * POST /otl/timecard/submit. The server builds the JSON envelope Oracle
 * parses: `p_user_name` comes from the JWT and `p_period` (`Month YYYY`) from
 * `periodStart`, so a client `p_user_name`/`p_period` is rejected (400) like
 * any other unknown key.
 */
export class SubmitTimecardRequestDto {
  @ApiProperty({
    example: '2026-07-01',
    description: 'Period START_DATE from GET /otl/timecard/periods.',
  })
  @IsoDate()
  periodStart!: string;

  @ApiProperty({ enum: ['Y'], example: 'Y', description: 'The employee confirmed the timecard.' })
  @IsIn(['Y'])
  p_confirmation_flag!: 'Y';

  @ApiPropertyOptional({ example: 'July timecard', description: 'Becomes the timecard comment.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  p_employee_notes?: string;

  @ApiProperty({
    type: [TimecardEntryDto],
    description:
      'Every day of the month needs at least one entry (weekends and absences included, e.g. 0 hours).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(310)
  @ValidateNested({ each: true })
  @Type(() => TimecardEntryDto)
  p_entries!: TimecardEntryDto[];
}
