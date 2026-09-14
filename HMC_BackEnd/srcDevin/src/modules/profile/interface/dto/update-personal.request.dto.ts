import {
  ATTACHMENT_FIELDS,
  defineOptionalStringFields,
  RequiredString,
} from '@shared/dto/oracle-submit.dto';

/** op 48 — PersonalDetsUpdate (UPD_PERSONAL_INFO_PR request template). */
export class UpdatePersonalRequestDto {
  @RequiredString('01-Jan-2026')
  p_effective_date!: string;

  @RequiredString('Amir')
  p_first_name!: string;

  @RequiredString('Ibrahim')
  p_last_name!: string;

  @RequiredString('Married')
  p_marital_status!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(UpdatePersonalRequestDto, [
  'p_middle_name',
  'p_name_in_arabic',
  'p_title',
  'p_relationship',
  'p_place_of_issue',
  'p_country_of_issue',
  'p_visa_type',
  'p_visa_number',
  'p_visa_validity',
  'p_type_of_sponsership',
  ...ATTACHMENT_FIELDS,
]);
