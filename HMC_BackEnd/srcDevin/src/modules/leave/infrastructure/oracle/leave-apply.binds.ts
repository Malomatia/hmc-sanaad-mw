import * as oracledb from 'oracledb';
import { parseOracleDate } from '@shared/utils/date.util';
import { toBlobBuffer } from '@shared/utils/blob.util';
import { LeaveApplyCommand } from '../../domain/leave.repository';

/**
 * Single source of truth for the LEAV_OF_ABSEN_NEW_PR bind list. Confirmed
 * directly by the Oracle team against the live signature:
 *
 *   xxhmc_snd_leav_of_absen_new_pr(p_user_name, p_absence_type,
 *     p_absence_reason, p_start_date DATE, p_end_date DATE,
 *     p_adv_leave_salary, p_travel_days, p_leave_inc_bonus, p_annual_tkt,
 *     p_contractual_year, p_remarks, p_relationship_bereaved,
 *     p_bereavement_date DATE, p_leave_classification, p_exam_date DATE,
 *     p_examination_centre, p_marriage_date DATE, p_delivery_date DATE,
 *     p_number_of_children, p_doctor_comments, p_med_commt_decision,
 *     p_hc_number, p_order_id, p_order_date, p_encounter_id, p_visit_date,
 *     p_discharge_date, p_medical_service, p_facility,
 *     p_special_instructions, p_work_related_injury, p_unfit_number_of_days,
 *     p_practitioner_name, p_practitionr_corp_number,
 *     p_electronicaly_signed_on, p_deliver_date, p_primary_diagnosis,
 *     p_spouse_name, p_spouse_id, p_file_name1..10/p_attachment1..10[BLOB],
 *     p_leave_days OUT NUMBER, p_success_flag OUT VARCHAR2,
 *     p_error_msg OUT VARCHAR2, p_error_msg_ar OUT VARCHAR2)
 *
 * `p_travel_days`/`p_spouse_name`/`p_spouse_id` were missing entirely and the
 * OUT contract was `p_status`/`p_message`/`p_success_flag` — both raised
 * `PLS-00306: wrong number or types of arguments`. `p_start_date`/`p_end_date`/
 * `p_bereavement_date`/`p_exam_date`/`p_marriage_date`/`p_delivery_date` are
 * DATE formals (the rest of the date-like params stay VARCHAR2, per the
 * confirmed signature) — bound as real `Date`s via `parseOracleDate` so
 * node-oracledb binds them natively instead of going through NLS_DATE_FORMAT
 * string parsing (ORA-01861/ORA-01858).
 *
 * Core fields come from the typed command; the remaining documented params
 * are passed through `cmd.extra` by their documented `p_*` key.
 * See Docs_Ai/Repository Pattern/README.md Pattern C.
 */
export class LeaveApplyBinds {
  /** DATE formals — bound as real `Date`s, never raw strings. */
  private static readonly DATE_PARAMS: ReadonlySet<string> = new Set([
    'p_start_date',
    'p_end_date',
    'p_bereavement_date',
    'p_exam_date',
    'p_marriage_date',
    'p_delivery_date',
  ]);

  /** BLOB formals (`p_attachment1..10`) — bound as `Buffer`, never base64 text. */
  private static readonly BLOB_PARAMS: ReadonlySet<string> = new Set(
    Array.from({ length: 10 }, (_, i) => `p_attachment${i + 1}`),
  );

  /** Ordered IN parameter names exactly as confirmed by the Oracle team. */
  static readonly params: readonly string[] = [
    'p_user_name',
    'p_absence_type',
    'p_absence_reason',
    'p_start_date',
    'p_end_date',
    'p_adv_leave_salary',
    'p_travel_days',
    'p_leave_inc_bonus',
    'p_annual_tkt',
    'p_contractual_year',
    'p_remarks',
    'p_relationship_bereaved',
    'p_bereavement_date',
    'p_leave_classification',
    'p_exam_date',
    'p_examination_centre',
    'p_marriage_date',
    'p_delivery_date',
    'p_number_of_children',
    'p_doctor_comments',
    'p_med_commt_decision',
    'p_hc_number',
    'p_order_id',
    'p_order_date',
    'p_encounter_id',
    'p_visit_date',
    'p_discharge_date',
    'p_medical_service',
    'p_facility',
    'p_special_instructions',
    'p_work_related_injury',
    'p_unfit_number_of_days',
    'p_practitioner_name',
    'p_practitionr_corp_number',
    'p_electronicaly_signed_on',
    'p_deliver_date',
    'p_primary_diagnosis',
    'p_spouse_name',
    'p_spouse_id',
    ...LeaveApplyBinds.attachmentParams(),
  ];

  /** Named-argument list used inside the anonymous PL/SQL block. */
  static readonly signature = [
    ...LeaveApplyBinds.params.map((p) => `${p} => :${p}`),
    'p_leave_days => :p_leave_days',
    'p_success_flag => :p_success_flag',
    'p_error_msg => :p_error_msg',
    'p_error_msg_ar => :p_error_msg_ar',
  ].join(',\n          ');

  static from(cmd: LeaveApplyCommand): oracledb.BindParameters {
    const core: Record<string, unknown> = {
      p_user_name: cmd.username,
      p_absence_type: cmd.absenceType,
      p_absence_reason: cmd.absenceReason ?? null,
      p_start_date: cmd.startDate,
      p_end_date: cmd.endDate,
    };
    const extra = cmd.extra ?? {};
    const binds: oracledb.BindParameters = {
      p_leave_days: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      p_success_flag: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 10 },
      p_error_msg: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
      p_error_msg_ar: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
    };
    for (const name of LeaveApplyBinds.params) {
      const value = name in core ? core[name] : extra[name];
      if (LeaveApplyBinds.DATE_PARAMS.has(name)) {
        (binds as Record<string, unknown>)[name] = {
          type: oracledb.DB_TYPE_DATE,
          val: parseOracleDate(value ?? null),
        };
        continue;
      }
      if (LeaveApplyBinds.BLOB_PARAMS.has(name)) {
        (binds as Record<string, unknown>)[name] = {
          type: oracledb.DB_TYPE_BLOB,
          val: toBlobBuffer(value ?? null),
        };
        continue;
      }
      (binds as Record<string, unknown>)[name] = value ?? null;
    }
    return binds;
  }

  /** p_file_name1..10 / p_attachment1..10 (20 attachment slots). */
  private static attachmentParams(): string[] {
    const slots: string[] = [];
    for (let i = 1; i <= 10; i++) {
      slots.push(`p_file_name${i}`, `p_attachment${i}`);
    }
    return slots;
  }
}
