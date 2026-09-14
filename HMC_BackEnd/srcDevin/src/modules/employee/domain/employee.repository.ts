import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';
import {
  EmploymentDetails,
  EmploymentInfo,
  PerformanceRecord,
  SupervisorView,
} from './entities/employment';

/** Port: employment reads (ops 3, 7, 8). op 3 is keyed by username; op 8 by employee number. */
export interface EmploymentRepository {
  getEmployment(username: string, lang: Lang): Promise<EmploymentInfo>;
  getBasic(employeeNumber: string, lang: Lang): Promise<EmploymentDetails | undefined>;
  getPerformance(username: string, lang: Lang): Promise<PerformanceRecord[]>;
}
export const EMPLOYMENT_REPOSITORY = Symbol('EMPLOYMENT_REPOSITORY');

export interface SupervisorUpdateCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

/** Port: supervisor view/update (ops 35, 36) — SUPERVISOR role. */
export interface SupervisorRepository {
  getSupervisorViews(
    username: string,
    lang: Lang,
    searchKeyWord?: string,
  ): Promise<SupervisorView[]>;
  updateSupervisor(cmd: SupervisorUpdateCommand): Promise<SubmitResult>;
}
export const SUPERVISOR_REPOSITORY = Symbol('SUPERVISOR_REPOSITORY');
