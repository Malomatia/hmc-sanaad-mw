import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';

export type ChildDetail = Record<string, unknown>;

export interface SchoolFeeApplyCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

export interface ChildrenQuery {
  employeeNumber: string;
  academicYearStartDate: string;
  lang: Lang;
}

/** Port: school-fee request (39) + children read (52). LOVs via Lookups. */
export interface SchoolFeeRepository {
  apply(cmd: SchoolFeeApplyCommand): Promise<SubmitResult>;
  getChildren(query: ChildrenQuery): Promise<ChildDetail[]>;
}

export const SCHOOL_FEE_REPOSITORY = Symbol('SCHOOL_FEE_REPOSITORY');
