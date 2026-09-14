import {
  ATTACHMENT_FIELDS,
  defineOptionalStringFields,
  RequiredString,
} from '@shared/dto/oracle-submit.dto';

/**
 * op 36 — SUPERVISOR_PR request template. `p_new_supervisor` is the Oracle
 * PERSON_ID of the proposed supervisor (from GET /employee/supervisor/views →
 * PERSON_ID) — verified live 2026-08-23: the employee-number form fails the
 * "HMC Change Supervisor" flexfield and a name string raises FLEX-DSQL
 * ORA-01722; PERSON_ID returns successflag S.
 */
export class SupervisorUpdateRequestDto {
  @RequiredString('112')
  p_new_supervisor!: string;

  @RequiredString('Team restructure')
  p_reason!: string;

  [key: string]: unknown;
}

defineOptionalStringFields(SupervisorUpdateRequestDto, ATTACHMENT_FIELDS);
