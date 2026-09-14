import { Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import {
  EmploymentDetails,
  EmploymentInfo,
  PerformanceRecord,
  SupervisorView,
} from '../domain/entities/employment';
import {
  EMPLOYMENT_REPOSITORY,
  EmploymentRepository,
  SUPERVISOR_REPOSITORY,
  SupervisorRepository,
} from '../domain/employee.repository';

/** Employment reads (ops 3, 7, 8). */
@Injectable()
export class EmployeeService {
  constructor(
    @Inject(EMPLOYMENT_REPOSITORY) private readonly repo: EmploymentRepository,
  ) {}

  employment(username: string, lang: Lang): Promise<EmploymentInfo> {
    return this.repo.getEmployment(username, lang);
  }

  basic(employeeNumber: string, lang: Lang): Promise<EmploymentDetails | undefined> {
    return this.repo.getBasic(employeeNumber, lang);
  }

  performance(username: string, lang: Lang): Promise<PerformanceRecord[]> {
    return this.repo.getPerformance(username, lang);
  }
}

/** Supervisor view/update (ops 35, 36). */
@Injectable()
export class SupervisorService {
  constructor(
    @Inject(SUPERVISOR_REPOSITORY) private readonly repo: SupervisorRepository,
  ) {}

  views(username: string, lang: Lang, searchKeyWord?: string): Promise<SupervisorView[]> {
    return this.repo.getSupervisorViews(username, lang, searchKeyWord);
  }

  update(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.updateSupervisor({ username: user.username, lang, fields });
  }
}
