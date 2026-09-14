import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';

export type UpcomingAppointment = Record<string, unknown>;

export interface ClinicMasters {
  clinics: unknown[];
  locations: unknown[];
  services: unknown[];
}

export interface BookAppointmentCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

/**
 * Port for staff-clinic appointments (ops 41-44). Backed by Cerner (not Oracle);
 * the implementation is an anticorruption client. See Docs_Ai/Domains (Appointments).
 */
export interface AppointmentsRepository {
  getUpcoming(employeeNumber: string, lang: Lang): Promise<UpcomingAppointment[]>;
  getMasters(lang: Lang): Promise<ClinicMasters>;
  book(cmd: BookAppointmentCommand): Promise<SubmitResult>;
}

export const APPOINTMENTS_REPOSITORY = Symbol('APPOINTMENTS_REPOSITORY');
