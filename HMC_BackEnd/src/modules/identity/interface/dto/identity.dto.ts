import {
  ATTACHMENT_FIELDS,
  defineOptionalStringFields,
  RequiredString,
} from '@shared/dto/oracle-submit.dto';

/**
 * op 19 — QID_UPD_PR (QID_CHG_PR request template). Example values verified
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

defineOptionalStringFields(QidUpdateRequestDto, ['p_iss_date','p_qid_job', ...ATTACHMENT_FIELDS], {
  p_qid_job: 'Analyst',
  p_iss_date: '2025-10-17',
  p_file_name1: 'qid-front.jpg',
  p_attachment1: 'dGVzdCBhdHRhY2htZW50',
});

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
