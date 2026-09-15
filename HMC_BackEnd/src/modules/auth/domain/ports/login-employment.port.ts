import { EmployeeIdentity } from '../auth-identity';

export interface LoginEmploymentDetails {
  organizationName?: string;
  organizationNameAr?: string;
  jobTitle?: string;
  jobTitleAr?: string;
}

export interface LoginEmploymentPort {
  resolve(identity: EmployeeIdentity): Promise<LoginEmploymentDetails>;
}

export const LOGIN_EMPLOYMENT_PORT = Symbol('LOGIN_EMPLOYMENT_PORT');
