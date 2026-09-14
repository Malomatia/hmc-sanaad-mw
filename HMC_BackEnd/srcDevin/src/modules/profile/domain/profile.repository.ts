import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';
import { EmployeeProfile } from './entities/employee-profile';

export interface UpdatePersonalCommand {
  username: string;
  lang: Lang;
  /** Best-effort passthrough until UPD_PERSONAL_INFO_PR binds are captured. */
  fields: Record<string, unknown>;
}

/** Port: profile reads (op 2) + personal update (op 48). Marital LOV (63) via Lookups. */
export interface ProfileRepository {
  getProfile(username: string, lang: Lang): Promise<EmployeeProfile>;
  updatePersonal(cmd: UpdatePersonalCommand): Promise<SubmitResult>;
}

export const PROFILE_REPOSITORY = Symbol('PROFILE_REPOSITORY');
