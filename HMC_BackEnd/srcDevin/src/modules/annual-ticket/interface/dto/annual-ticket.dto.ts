import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
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

/** op 72 — `GET /annual-ticket/cancel-options?person_id=&lang=`. */
export class TicketCancelOptionsQueryDto extends LangQueryDto {
  @ApiProperty({
    example: '26023',
    description:
      'Oracle PERSON_ID — the three cancellation views are person-scoped (they expose PERSON_ID, not a username column).',
  })
  @IsString()
  @IsNotEmpty()
  person_id!: string;
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
