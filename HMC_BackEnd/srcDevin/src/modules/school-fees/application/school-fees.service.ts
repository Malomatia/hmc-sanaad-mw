import { Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LookupsService } from '@lookups/application/lookups.service';
import { LovReadOptions } from '@lookups/domain/lov.repository';
import {
  ChildDetail,
  SCHOOL_FEE_REPOSITORY,
  SchoolFeeRepository,
} from '../domain/school-fees.repository';

/** School-fees service (ops 37, 38, 39, 40, 50, 52, 53). */
@Injectable()
export class SchoolFeeService {
  constructor(
    @Inject(SCHOOL_FEE_REPOSITORY) private readonly repo: SchoolFeeRepository,
    private readonly lookups: LookupsService,
  ) {}

  apply(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.apply({ username: user.username, lang, fields });
  }

  children(employeeNumber: string, academicYearStartDate: string, lang: Lang): Promise<ChildDetail[]> {
    return this.repo.getChildren({ employeeNumber, academicYearStartDate, lang });
  }

  schoolsLov(
    lang: Lang,
    username: string,
    options?: LovReadOptions,
  ): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.SCHOOL_NAME_LOV, lang, username, options);
  }
  termsLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.SCHOOL_TERM_LOV, lang);
  }
  eduStageLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.EDU_STAGE_LOV, lang);
  }
  academicYearLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.ACAD_YR_STRT_END_LOV, lang);
  }
  requestTypeLov(lang: Lang, username: string): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.REQUEST_TYPE_LOV, lang, username);
  }
}
