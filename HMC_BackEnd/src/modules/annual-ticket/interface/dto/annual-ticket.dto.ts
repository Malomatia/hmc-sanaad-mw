import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
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

/** `tickets[]` row — XXHMC_SND_CANCEL_TICKETS_V. */
export class TicketCancelTicketDto {
  @ApiProperty({ example: 26023, description: 'Oracle PERSON_ID of the caller.' })
  PERSON_ID!: number;

  @ApiProperty({ type: Number, description: 'ANALYSIS_CRITERIA_ID of the ticket record.' })
  ANALYSIS_CRITERIA_ID!: number;

  @ApiProperty({
    example:
      'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920',
    description:
      'Composite ticket value — send it verbatim as `p_annual_tkt` to POST /annual-ticket/cancel.',
  })
  ANNUAL_LEAVE_PASS_TKT_VALUE!: string;
}

/** `takenAs[]` row — XXHMC_SND_CANCEL_TAKENAS_V. */
export class TicketCancelTakenAsDto {
  @ApiProperty({ example: 26023, description: 'Oracle PERSON_ID of the caller.' })
  PERSON_ID!: number;

  @ApiProperty({ type: Number, description: 'ANALYSIS_CRITERIA_ID of the ticket record.' })
  ANALYSIS_CRITERIA_ID!: number;

  @ApiProperty({ example: 'Cash', description: 'Cash | Voucher — send as `p_ticket_as`.' })
  TAKES_AS!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Arabic label of TAKES_AS.' })
  TAKEN_AS_AR?: string | null;
}

/** `repaymentMethods[]` row — XXHMC_SND_CANCEL_REPAYMENT_METHODS_V. */
export class TicketCancelRepaymentMethodDto {
  @ApiProperty({ example: 26023, description: 'Oracle PERSON_ID of the caller.' })
  PERSON_ID!: number;

  @ApiProperty({ type: Number, description: 'ANALYSIS_CRITERIA_ID of the ticket record.' })
  ANALYSIS_CRITERIA_ID!: number;

  @ApiProperty({
    example: 'Payroll Deduction',
    description:
      'Send as `p_repayment_method` (Cash → Payroll Deduction, Voucher → Cancel Voucher).',
  })
  FLEX_VALUE!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  DESCRIPTION?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Arabic twin of FLEX_VALUE. The global ResponseInterceptor folds it into FLEX_VALUE for lang=ar ' +
      'and removes it from the response.',
  })
  FLEX_VALUE_AR?: string | null;
}

/** op 72 — `GET /annual-ticket/cancel-options` response (caller-scoped). */
export class TicketCancelOptionsResponseDto {
  @ApiProperty({ type: [TicketCancelTicketDto] })
  tickets!: TicketCancelTicketDto[];

  @ApiProperty({ type: [TicketCancelTakenAsDto] })
  takenAs!: TicketCancelTakenAsDto[];

  @ApiProperty({ type: [TicketCancelRepaymentMethodDto] })
  repaymentMethods!: TicketCancelRepaymentMethodDto[];
}

/**
 * op 72 — Cancel an annual ticket (CANCEL_TKT_PR).
 *
 * Every list value comes from `GET /annual-ticket/cancel-options`:
 *  - `p_annual_tkt` = the `ANNUAL_LEAVE_PASS_TKT_VALUE` of the ticket to cancel.
 *    It is a COMPOSITE string, e.g.
 *    `Self and Family |Prashanth |Achintya |Sathwika |Samanyu | |11-NOV-2024 to 10-NOV-2025 |Voucher |30000`
 *    — send it exactly as the view returned it.
 *  - `p_ticket_as` = `takenAs[].TAKES_AS` (`Cash` | `Voucher`).
 *  - `p_repayment_method` = `repaymentMethods[].FLEX_VALUE` (e.g. `Payroll Deduction`).
 *  - `p_contractual_year` = the full period text, as in op 67
 *    (`01-SEP-2025 to 31-AUG-2026`).
 *
 * The procedure writes them to the `HMC_HR_ANNUAL_PASSAGE_CANCEL` flexfield,
 * whose segments are `VARCHAR2(60)` each.
 */
export class AnnualTicketCancelRequestDto {
  @RequiredString(
    'Self and Family |Amir |Caroline |Jerome Amir Sami |Jolie Amir Sami | |01-SEP-2025 to 31-AUG-2026 |Cash |20920',
    'The ticket to cancel — ANNUAL_LEAVE_PASS_TKT_VALUE from GET /annual-ticket/cancel-options, sent verbatim.',
  )
  p_annual_tkt!: string;

  @RequiredString('01-SEP-2025 to 31-AUG-2026')
  p_contractual_year!: string;

  @RequiredString('Travel plans cancelled')
  p_reason!: string;

  @RequiredString('Cash', 'From cancel-options → takenAs[].TAKES_AS (Cash | Voucher).')
  p_ticket_as!: string;

  @RequiredString(
    'Payroll Deduction',
    'From cancel-options → repaymentMethods[].FLEX_VALUE. It pairs with p_ticket_as: ' +
      'Cash → "Payroll Deduction", Voucher → "Cancel Voucher".',
  )
  p_repayment_method!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(
  AnnualTicketCancelRequestDto,
  ['p_comments', 'p_voucher_ref', ...ATTACHMENT_FIELDS],
  { p_comments: 'Cancelling the unused ticket.', p_voucher_ref: 'VCH-12345' },
);
