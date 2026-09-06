import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';

/**
 * Port for reading list-of-values / master-lookup reference data from any
 * allow-listed Oracle `_LOV`/`_V` object. Implemented by the infrastructure
 * adapter and bound via the LOV_REPOSITORY token.
 */
export interface LovReadOptions {
  search?: string;
  offset?: number;
  limit?: number;
  dataType?: string;
  /**
   * Filter on the LOV's leave-type column: equality on a dedicated
   * `LEAVE_TYPE`/`ABSENCE_TYPE` column (ABSENCE_REASON_V), contains-match on
   * the `NAME` fallback (LEAVE_CANCEL_V / LEAVE_AMEND_V hold display strings
   * there). Ignored when the object has no such column.
   */
  leaveType?: string;
  /**
   * Additional identifier forms of the SAME caller (employee number /
   * PERSON_ID / username), matched together with `username` via
   * `key IN (...)` against whichever scoping column the view exposes. The
   * same person is keyed differently per view (LEAVE_CANCEL_V/AMEND_V use
   * PERSON_ID, others USER_NAME), so matching every supplied form spares the
   * client from guessing which one a given view wants.
   */
  scopeAlternatives?: readonly (string | undefined)[];
  /**
   * Explicit equality filter on the view's PERSON_ID column
   * (`WHERE PERSON_ID = :personId`) — e.g. CONTRACT_YEARS_V. Ignored when the
   * view has no PERSON_ID column, like the other optional filters.
   */
  personId?: string;
}

export interface LovRepository {
  readLov(
    object: string,
    lang: Lang,
    username?: string,
    options?: LovReadOptions,
  ): Promise<LovItem[]>;
}

export const LOV_REPOSITORY = Symbol('LOV_REPOSITORY');
