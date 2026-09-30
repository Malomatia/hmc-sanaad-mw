import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { LangQueryDto } from '@shared/dto/lang-query.dto';
import {
  ATTACHMENT_FIELDS,
  defineOptionalStringFields,
  RequiredString,
} from '@shared/dto/oracle-submit.dto';

/**
 * op 67 — Submit_Annual_Ticket (TICKET_REQ_PR request template).
 * `p_employee` carries the Oracle PERSON_ID, not the employee number: the
 * procedure validates it against the HMC_HR_PASSAGE_TICKET_EMPLOYEE_NAME
 * flexfield value set (verified on staging 2026-08-23 — the employee-number
 * form fails the flex check and a name string raises ORA-01722).
 */
export class AnnualTicketApplyRequestDto {
  @RequiredString('Self')
  p_request_for!: string;

  @RequiredString('26023')
  p_employee!: string;

  @RequiredString('Annual Ticket')
  p_request_type!: string;

  @RequiredString('01-SEP-2025 to 31-AUG-2026')
  p_contractual_year!: string;

  @RequiredString('Doha')
  p_traveling_dest!: string;

  @RequiredString('Economy')
  p_travel_class!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(AnnualTicketApplyRequestDto, [
  'p_passenger1',
  'p_passenger2',
  'p_passenger3',
  'p_passenger4',
  'p_comments',
  ...ATTACHMENT_FIELDS,
]);

/**
 * op 66 — `GET /annual-ticket/master?lang=`. The caller comes from the JWT;
 * `person_id` is optional and only compared against the caller's own PERSON_ID.
 */
export class AnnualTicketMasterQueryDto extends LangQueryDto {
  @ApiPropertyOptional({
    example: '26023',
    description:
      'Optional and not needed: the master is always read for the JWT caller. ' +
      "Ignored unless it differs from the caller's own PERSON_ID, then 403.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  person_id?: string;
}

const AR_TWIN_NOTE =
  'The global ResponseInterceptor folds it into the base field for lang=ar and removes it from the response.';

/** A picker value: `value` goes back to Oracle, `label` is shown to the user. */
export class AnnualTicketOptionDto {
  @ApiProperty({ type: String, nullable: true, example: 'Economy', description: 'NAME_EN — send it back as is.' })
  value!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Economy', description: 'NAME_EN (Arabic for lang=ar).' })
  label!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: `NAME_AR. ${AR_TWIN_NOTE}` })
  labelAr?: string | null;
}

/** `contractualYears[]` — TICKET_MASTER rows with TAG1 `CONTRACTUAL YEAR`. */
export class AnnualTicketContractualYearDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '01-SEP-2025 to 31-AUG-2026',
    description: 'CONTRACT_YEAR — send it as `p_contractual_year` to POST /annual-ticket/apply.',
  })
  value!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '01-SEP-2025 to 31-AUG-2026',
    description: 'CONTRACT_YEAR_DEF (fallback NAME_EN); Arabic for lang=ar.',
  })
  label!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: `CONTRACT_YEAR_DEF_AR (fallback NAME_AR). ${AR_TWIN_NOTE}`,
  })
  labelAr?: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 2025, description: 'FROM_DATE (a year).' })
  fromYear!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 2026, description: 'TOO_DATE (a year).' })
  toYear!: number | null;

  @ApiProperty({ type: String, nullable: true, example: 'HMC LAW' })
  law!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 18, description: 'TOT_COUNT.' })
  totalCount!: number | null;
}

/** `passengers[]` — TICKET_MASTER rows with TAG1 `PASSENGER`, `Self` first. */
export class AnnualTicketPassengerDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '26023',
    description:
      'What Oracle expects (= CONTACT_ID): the `Self` row (= PERSON_ID) → `p_employee`, `Family` rows → `p_passenger1..4`. ' +
      'TICKET_REQ_PR validates these against id value sets (person_id / contact_id); a name is rejected (ORA-01722). Never localized.',
  })
  value!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '26023',
    description: 'CONTACT_ID (same as `value`; kept for clarity).',
  })
  contactId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Mr. Amir Sami Samir Ibrahim',
    description: 'Display name only; Arabic for lang=ar. Never send it to Oracle.',
  })
  name!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: `NAME_AR. ${AR_TWIN_NOTE}` })
  nameAr?: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Self', description: 'RECORD_TYPE: Self | Family.' })
  type!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'EMP',
    description: 'EMP (the employee), S (spouse), C (child).',
  })
  contactType!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Y', description: 'CURRENT_EMPLOYEE_FLAG.' })
  currentEmployee!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1984-05-15', description: 'YYYY-MM-DD.' })
  dateOfBirth!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'M' })
  sex!: string | null;
}

/** `other[]` — a TICKET_MASTER row whose TAG1 is none of the five known groups. */
export class AnnualTicketMasterOtherDto extends AnnualTicketOptionDto {
  @ApiProperty({ type: String, nullable: true, example: 'VISA TYPE', description: 'TAG1.' })
  tag!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'RECORD_TYPE.' })
  recordType!: string | null;
}

/**
 * op 66 — `GET /annual-ticket/master` response (caller-scoped, grouped by
 * TAG1). Each group feeds one POST /annual-ticket/apply field.
 */
export class AnnualTicketMasterResponseDto {
  @ApiProperty({
    type: String,
    enum: ['Yes', 'No'],
    nullable: true,
    example: 'Yes',
    description:
      'ANNUAL_TICKT_LOV.ANUAL_TKT_DEFAULT (Yes | No); null when the flag could not be read. ' +
      'Localized like every other twin: lang=ar answers the Arabic word, so compare it under lang=en.',
  })
  eligible!: 'Yes' | 'No' | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: `ANUAL_TKT_DEFAULT_AR. ${AR_TWIN_NOTE}`,
  })
  eligibleAr?: string | null;

  @ApiProperty({ type: [AnnualTicketContractualYearDto], description: '`value` → `p_contractual_year`.' })
  contractualYears!: AnnualTicketContractualYearDto[];

  @ApiProperty({ type: [AnnualTicketOptionDto], description: '`value` → `p_traveling_dest`.' })
  destinations!: AnnualTicketOptionDto[];

  @ApiProperty({
    type: [AnnualTicketPassengerDto],
    description: '`Self` `value` (= PERSON_ID) → `p_employee`; `Family` `value` (= CONTACT_ID) → `p_passenger1..4`.',
  })
  passengers!: AnnualTicketPassengerDto[];

  @ApiProperty({ type: [AnnualTicketOptionDto], description: '`value` → `p_request_for`.' })
  requestFor!: AnnualTicketOptionDto[];

  @ApiProperty({ type: [AnnualTicketOptionDto], description: '`value` → `p_travel_class`.' })
  ticketClasses!: AnnualTicketOptionDto[];

  @ApiProperty({
    type: String,
    example: 'Annual Ticket',
    description:
      'Constant → `p_request_type`. The only known value: the master has no source for it (AT-5 open).',
  })
  requestType!: string;

  @ApiProperty({
    type: [AnnualTicketMasterOtherDto],
    description: 'Rows whose TAG1 is none of the five known groups (normally empty).',
  })
  other!: AnnualTicketMasterOtherDto[];
}

/**
 * op 72 — `GET /annual-ticket/cancel-options?lang=`. The caller's PERSON_ID is
 * derived from the JWT (EMPLOYMENT_DETAILS_V); `person_id` stays accepted only
 * for backward compatibility.
 */
export class TicketCancelOptionsQueryDto extends LangQueryDto {
  @ApiPropertyOptional({
    example: '26023',
    description:
      "Optional and not needed: the caller's PERSON_ID is derived from the JWT. " +
      "Ignored unless it differs from the caller's own PERSON_ID, then 403.",
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  person_id?: string;
}

/** `tickets[].repaymentMethods[]` — XXHMC_SND_CANCEL_REPAYMENT_METHODS_V rows of that ticket. */
export class TicketCancelRepaymentOptionDto {
  @ApiProperty({
    example: 'Payroll Deduction',
    description: 'FLEX_VALUE — send it as `p_repayment_method` when the ticket has more than one.',
  })
  value!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Payroll Deduction',
    description: 'Display name of the method (FLEX_VALUE); Arabic for lang=ar.',
  })
  label!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: `FLEX_VALUE_AR. ${AR_TWIN_NOTE}` })
  labelAr?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Cash',
    description: 'DESCRIPTION — the taken-as (Cash | Voucher) this method applies to.',
  })
  appliesTo?: string | null;
}

/** `tickets[]` — one cancellable ticket, joined on ANALYSIS_CRITERIA_ID. */
export class TicketCancelTicketDto {
  @ApiProperty({
    example: '71794897',
    description: 'ANALYSIS_CRITERIA_ID — the only ticket value to send to POST /annual-ticket/cancel.',
  })
  analysisCriteriaId!: string;

  @ApiProperty({
    example:
      'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920',
    description:
      'ANNUAL_LEAVE_PASS_TKT_VALUE verbatim — for display only; do NOT send it back, the server resolves it.',
  })
  value!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Self and Family', description: 'Segment 0.' })
  requestFor!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'Amir', description: 'Segment 1.' })
  employeeName!: string | null;

  @ApiProperty({
    type: [String],
    example: ['Caroline', 'Jerome Amir Sami', 'Jolie Amir Sami'],
    description: 'Non-empty segments 2..5.',
  })
  passengers!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    example: '01-SEP-2025 to 31-AUG-2026',
    description: 'Segment 6 (submitted as `p_contractual_year`).',
  })
  contractualYear!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Cash',
    description: 'CANCEL_TAKENAS_V.TAKES_AS of this ticket (fallback segment 7); Arabic for lang=ar.',
  })
  takenAs!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: `TAKEN_AS_AR. ${AR_TWIN_NOTE}` })
  takenAsAr?: string | null;

  @ApiProperty({ type: String, nullable: true, example: '20920', description: 'Segment 8.' })
  amount!: string | null;

  @ApiProperty({ type: [TicketCancelRepaymentOptionDto] })
  repaymentMethods!: TicketCancelRepaymentOptionDto[];
}

/** Legacy flat `takenAs[]` item — distinct TAKES_AS values of the caller. */
export class TicketCancelTakenAsDto {
  @ApiProperty({ example: 'Cash', description: 'Cash | Voucher.' })
  TAKES_AS!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Arabic label of TAKES_AS.' })
  TAKEN_AS_AR?: string | null;
}

/** Legacy flat `repaymentMethods[]` item — distinct FLEX_VALUE values of the caller. */
export class TicketCancelRepaymentMethodDto {
  @ApiProperty({ example: 'Payroll Deduction' })
  FLEX_VALUE!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Cash' })
  DESCRIPTION?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: `Arabic twin of FLEX_VALUE. ${AR_TWIN_NOTE}` })
  FLEX_VALUE_AR?: string | null;
}

/** op 72 — `GET /annual-ticket/cancel-options` response (caller-scoped). */
export class TicketCancelOptionsResponseDto {
  @ApiProperty({
    type: [TicketCancelTicketDto],
    description: 'One entry per cancellable ticket, with its own taken-as and repayment methods.',
  })
  tickets!: TicketCancelTicketDto[];

  @ApiProperty({
    type: [TicketCancelTakenAsDto],
    description: 'Deprecated, kept for older clients: distinct values, not tied to a ticket.',
  })
  takenAs!: TicketCancelTakenAsDto[];

  @ApiProperty({
    type: [TicketCancelRepaymentMethodDto],
    description: 'Deprecated, kept for older clients: distinct values, not tied to a ticket.',
  })
  repaymentMethods!: TicketCancelRepaymentMethodDto[];
}

/**
 * op 72 — Cancel an annual ticket (CANCEL_TKT_PR).
 *
 * The client sends only the ticket id (`tickets[].analysisCriteriaId` from
 * GET /annual-ticket/cancel-options) and its own text. The server looks the
 * ticket up again in the caller's cancel options and fills `p_annual_tkt`
 * (the ANALYSIS_CRITERIA_ID — the procedure's segment1 is VARCHAR2(60) and the
 * composite reaches 109 chars), `p_contractual_year` and `p_ticket_as` itself.
 *
 * `p_annual_tkt`, `p_contractual_year` and `p_ticket_as` are deliberately NOT
 * accepted any more (400 "should not exist"): the pipe-separated composite
 * must never come from the client again — the staging F5 WAF blocked the
 * response of every request that carried it — and resolving the values
 * server-side makes a wrong Cash/Voucher ↔ repayment pairing impossible.
 */
export class AnnualTicketCancelRequestDto {
  @ApiProperty({
    example: '71794897',
    description:
      'The ticket to cancel — `tickets[].analysisCriteriaId` from GET /annual-ticket/cancel-options (digits only).',
  })
  @IsString()
  @Matches(/^\d{1,15}$/, { message: 'analysis_criteria_id must be a numeric ticket id.' })
  analysis_criteria_id!: string;

  @RequiredString('Travel plans cancelled')
  p_reason!: string;

  @ApiPropertyOptional({
    example: 'Payroll Deduction',
    description:
      "One of that ticket's `repaymentMethods[].value`. Optional when the ticket has exactly one " +
      '(it is used); 400 when it has several and none is sent, or when the value is not one of them.',
  })
  @IsOptional()
  @IsString()
  p_repayment_method?: string;

  [key: string]: unknown;
}

defineOptionalStringFields(
  AnnualTicketCancelRequestDto,
  ['p_comments', 'p_voucher_ref', ...ATTACHMENT_FIELDS],
  { p_comments: 'Cancelling the unused ticket.', p_voucher_ref: 'VCH-12345' },
);
