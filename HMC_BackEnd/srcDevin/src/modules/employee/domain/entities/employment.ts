/** Employment domain entities (framework-free). See Docs_Ai/Domains (Employee). */
export interface EmploymentDetails {
  employeeNumber?: string;
  assignmentId?: string;
  grade?: string;
  department?: string;
  departmentAr?: string;
  supervisorName?: string;
  [extra: string]: unknown;
}

/** One row of XXHMC_SND_SALARY_V — salary change history (all 4 view columns). */
export interface SalaryRecord {
  username?: string;
  changeDate?: string;
  monthlyBasicSalary?: number;
  grade?: string;
}

/** One row of XXHMC_SND_EMPLOYMENT_V — assignment history (all 10 view columns). */
export interface AssignmentRecord {
  username?: string;
  assignmentStatus?: string;
  assignmentStatusAr?: string;
  assignmentStartDate?: string;
  assignmentEndDate?: string;
  department?: string;
  departmentAr?: string;
  job?: string;
  jobAr?: string;
  grade?: string;
}

/**
 * op 3 — GET /employee/employment aggregate: the EMPLOYMENT_DETAILS_V record
 * plus the SALARY_V and EMPLOYMENT_V histories, all keyed by USER_NAME.
 */
export interface EmploymentInfo {
  details?: EmploymentDetails;
  salary: SalaryRecord[];
  assignments: AssignmentRecord[];
}

export interface PerformanceRecord {
  period?: string;
  rating?: string;
  [extra: string]: unknown;
}

export interface SupervisorView {
  [field: string]: unknown;
}
