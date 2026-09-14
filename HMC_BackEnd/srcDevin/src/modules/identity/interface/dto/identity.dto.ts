import { IsEmpty, IsOptional } from 'class-validator';
import {
  ATTACHMENT_FIELDS,
  defineOptionalStringFields,
  RequiredString,
} from '@shared/dto/oracle-submit.dto';

/**
 * op 19 — QID_UPD_PR (eight-attachment QID_CHG_PR contract). Values verified
 * live on staging 2026-08-23 (successflag S) — dates in `yyyy-MM-dd` work.
 */
export class QidUpdateRequestDto {
  @RequiredString('28481809470')
  p_qid_number!: string;

  p_iss_date?: string;

  @RequiredString('2029-10-16')
  p_exp_date!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(
  QidUpdateRequestDto,
  ['p_iss_date', 'p_qid_job', ...ATTACHMENT_FIELDS.slice(0, 8 * 2)],
  {
    p_qid_job: 'Analyst',
    p_iss_date: '2025-10-17',
    p_file_name1: 'qid-front.jpg',
    p_attachment1: 'dGVzdCBhdHRhY2htZW50',
  },
);

for (const field of ATTACHMENT_FIELDS.slice(8 * 2)) {
  IsOptional()(QidUpdateRequestDto.prototype, field);
  IsEmpty({ message: 'QID update supports attachment slots 1 through 8 only.' })(
    QidUpdateRequestDto.prototype,
    field,
  );
}

/** op 54 — RequestCompanyID (COID_REQ_PR request template). */
export class CompanyIdApplyRequestDto {
  @RequiredString('Damaged')
  p_reason!: string;

  @RequiredString('No')
  p_charge_for_new_id!: string;

  @RequiredString('Al Wakra Hospital')
  p_delivery_loc!: string;

  @RequiredString('Others')
  p_working_location!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(CompanyIdApplyRequestDto, ['p_comments', ...ATTACHMENT_FIELDS], {
  p_comments: 'test',
});
