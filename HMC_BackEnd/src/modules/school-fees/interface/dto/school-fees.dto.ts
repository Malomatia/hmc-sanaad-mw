import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { LovUserQueryDto, ProfileQueryDto } from '@shared/dto/common-query.dto';
import {
  ATTACHMENT_FIELDS,
  defineOptionalStringFields,
  RequiredString,
} from '@shared/dto/oracle-submit.dto';

export class SchoolChildrenQueryDto extends ProfileQueryDto {
  @ApiProperty({ example: '20200202', description: 'Academic year start date token (yyyymmdd).' })
  @Matches(/^\d{8}$/, { message: 'acadyrstrtdt must be yyyymmdd.' })
  acadyrstrtdt!: string;
}

export class SchoolLovQueryDto extends LovUserQueryDto {
  @ApiPropertyOptional({ example: 'Doha' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 100, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 100;
}

export class SchoolChildrenV2QueryDto extends OmitType(SchoolChildrenQueryDto, ['enum'] as const) {}

export class SchoolLovV2QueryDto extends OmitType(SchoolLovQueryDto, ['username'] as const) {}

/**
 * op 39 — SCHOOL_FEE_PR. Verified end-to-end on 2026-08-24 (successflag Y).
 *
 * `p_child_name` is NOT the child's name: the procedure resolves the child with
 *   SELECT child_id INTO … FROM TABLE(xxhmc_snd_child_dets_view(<acd_st_dt>, <user>))
 *    WHERE dob = p_child_name                                   (source line 197)
 * so it must be the composite value the view returns in its `DOB` column —
 * `Name||Gender||DD-MON-YY` — taken from GET /school-fees/children called with
 * the SAME `acadyrstrtdt` as `p_acd_st_dt`. Sending the plain name raised
 * ORA-01403 (surfaced as 404).
 *
 * `p_school_name` must match XXHMC_SND_SCHOOL_NAME_LOV.name for the caller
 * (source line 205), `p_request_type` comes from the op 53 LOV (e.g. `Cash`),
 * `p_term` from the op 38 LOV (`Term1`, no space).
 */
export class SchoolFeeApplyRequestDto {
  @RequiredString('2025-2026')
  p_academic_year!: string;

  @RequiredString('20250901')
  p_acd_st_dt!: string;

  @RequiredString('20260630')
  p_acd_end_dt!: string;

  /** Composite `Name||Gender||DD-MON-YY` from GET /school-fees/children (`DOB` column). */
  @RequiredString('Jerome Amir Sami Samir Ibrahim||Male||23-SEP-10')
  p_child_name!: string;

  @RequiredString('20100923')
  p_child_date_birth!: string;

  @RequiredString('Al Arqam Academy')
  p_school_name!: string;

  @RequiredString('Primary')
  p_educational_stage!: string;

  @RequiredString('Cash')
  p_request_type!: string;

  @RequiredString('Term1')
  p_term!: string;

  @RequiredString('1000')
  p_amount!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(
  SchoolFeeApplyRequestDto,
  [
    'p_passport_number',
    'p_rp_number',
    'p_receipt_number',
    'p_spouse_working',
    'p_comments',
    ...ATTACHMENT_FIELDS,
  ],
  {
    p_passport_number: 'A38697134',
    p_rp_number: '31081804108',
    p_receipt_number: '123',
    p_spouse_working: 'No',
    p_comments: 'test',
    p_file_name1: 'receipt.pdf',
    p_attachment1: 'dGVzdCBhdHRhY2htZW50',
  },
);
