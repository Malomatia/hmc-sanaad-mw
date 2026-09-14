import { col, dateStr, str, strAr, pruneUndefined } from '@shared/utils/mapper.util';
import {
  AssignmentRecord,
  EmploymentDetails,
  PerformanceRecord,
  SalaryRecord,
} from '../../domain/entities/employment';

/** Oracle row → employment domain (Anticorruption Layer). */
export class EmployeeMapper {
  static toEmployment(row: Record<string, any> | undefined): EmploymentDetails | undefined {
    if (!row) return undefined;
    return pruneUndefined<EmploymentDetails>({
      ...row,
      employeeNumber: str(row, 'employee_number') ?? str(row, 'employeenumber'),
      assignmentId: str(row, 'assignment_id') ?? str(row, 'assignmentid'),
      grade: str(row, 'grade'),
      department: str(row, 'department') ?? str(row, 'organization'),
      departmentAr: strAr(row, 'department_ar') ?? strAr(row, 'organization_ar'),
      supervisorName: str(row, 'supervisor_name') ?? str(row, 'supervisorname'),
    });
  }

  /** XXHMC_SND_SALARY_V row → salary change record (all 4 columns). */
  static toSalary(row: Record<string, any>): SalaryRecord {
    return pruneUndefined<SalaryRecord>({
      username: str(row, 'user_name') ?? str(row, 'username'),
      changeDate: dateStr(row, 'change_date'),
      monthlyBasicSalary: col<number>(row, 'monthly_basic_salary') ?? undefined,
      grade: str(row, 'grade'),
    });
  }

  /** XXHMC_SND_EMPLOYMENT_V row → assignment record (all 10 columns). */
  static toAssignment(row: Record<string, any>): AssignmentRecord {
    return pruneUndefined<AssignmentRecord>({
      username: str(row, 'user_name') ?? str(row, 'username'),
      assignmentStatus: str(row, 'assignment_status'),
      assignmentStatusAr: strAr(row, 'assignment_status_ar'),
      assignmentStartDate: dateStr(row, 'assignment_start_date'),
      assignmentEndDate: dateStr(row, 'assignment_end_date'),
      department: str(row, 'department'),
      departmentAr: strAr(row, 'department_ar'),
      job: str(row, 'job'),
      jobAr: strAr(row, 'job_ar'),
      grade: str(row, 'grade'),
    });
  }

  static toPerformance(row: Record<string, any>): PerformanceRecord {
    return pruneUndefined<PerformanceRecord>({
      ...row,
      period: str(row, 'period') ?? str(row, 'appraisal_period'),
      rating: str(row, 'rating') ?? str(row, 'overall_rating'),
    });
  }
}
