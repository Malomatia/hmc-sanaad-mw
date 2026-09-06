import {
  ATTACHMENT_FIELDS,
  defineOptionalStringFields,
  RequiredString,
} from '@shared/dto/oracle-submit.dto';

/**
 * op 17 — LetterReqSubmit (HR_EMPLYMNT_LTR_PR). Rules read from the procedure
 * source on 2026-08-24 — every one of them raised ORA-01403 (masked as a
 * generic 404) when broken:
 *
 *  - `p_letter_name` + `p_letter_language` must be a VALID PAIR (line 180):
 *    the lookup is `flex_value_meaning = p_letter_name AND UPPER(description) =
 *    UPPER(p_letter_language)`, and each letter exists in exactly ONE language.
 *    Take BOTH from the same LOV row: GET /letters/lov → `name[]`, where
 *    `used_value` is the name and `description` is its language ("Bank letter
 *    with details with effective date" is English-only, "Basic Salary
 *    Certificate" is Arabic-only). Do not pair a name with `language[]`,
 *    which is just the list of the two languages — that is how a valid-looking
 *    request ends up rejected.
 *  - `p_country` must be OMITTED for every letter except the Saudi passage one:
 *    the country lookup at line 201 is guarded by
 *    `AND 'Passage to Saudi Arabia' = <letter>`, so sending a country with any
 *    other letter can never match. Hence it is optional here.
 *  - `p_mobile_number` must be an EXISTING mobile of the employee
 *    (`per_phones.phone_type = 'M'`, line 219) — take it from
 *    GET /letters/lov → `mobileNo`, not a typed-in number.
 *  - `p_letter_delivery_loc` must exist in the HMC_HR_DELIVERY_LOC value set
 *    (line 235) — GET /letters/lov → `deliveryLoc`.
 */
export class LetterApplyRequestDto {
  @RequiredString('English')
  p_letter_language!: string;

  @RequiredString('Bank letter with details with effective date')
  p_letter_name!: string;

  @RequiredString('1')
  p_no_of_copies!: string;

  @RequiredString('55723893')
  p_mobile_number!: string;

  @RequiredString('Al Wakra Hospital')
  p_letter_delivery_loc!: string;

  @RequiredString('test')
  p_purpose_comments!: string;

  [key: string]: unknown;
}

// `p_country` is deliberately left WITHOUT an example: it only applies to the
// "Passage to Saudi Arabia" letter, and copying the Swagger example with a
// country filled in is exactly what produced ORA-01403 at line 201.
defineOptionalStringFields(LetterApplyRequestDto, ['p_country', ...ATTACHMENT_FIELDS]);
