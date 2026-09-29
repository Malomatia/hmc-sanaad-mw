import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { ERROR_MESSAGES } from '@shared/constants/error-codes';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LookupsService } from '@lookups/application/lookups.service';
import {
  TICKET_REPOSITORY,
  TicketCancelOptions,
  TicketRepository,
} from '../domain/annual-ticket.repository';

/** Annual-ticket service (ops 66, 67, 72). */
@Injectable()
export class AnnualTicketService {
  private readonly logger = new Logger(AnnualTicketService.name);

  constructor(
    @Inject(TICKET_REPOSITORY) private readonly repo: TicketRepository,
    private readonly lookups: LookupsService,
  ) {}

  /**
   * op 66 — annual-ticket master values. The legacy service reads
   * `ANNUAL_TICKT_LOV` scoped to the caller (`lovlookup?lovname=ANNUAL_TICKT_LOV`),
   * which returns the employee's entitlement rows. Reading the unfiltered
   * TICKET_MASTER table instead exceeded the request timeout (HTTP 408).
   */
  master(lang: Lang, username: string): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.ANNUAL_TICKT_LOV, lang, username);
  }

  apply(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.apply({ username: user.username, lang, fields });
  }

  /**
   * op 72 — inputs of the cancellation form (tickets + taken-as + repayment),
   * always for the JWT caller. The three views are PERSON_ID-scoped with no
   * USER_NAME column, so the caller's PERSON_ID is resolved server-side from
   * EMPLOYMENT_DETAILS_V; a client `person_id` is only compared against it
   * (a different one is refused with 403) and never used to query.
   */
  async cancelOptions(
    user: AuthenticatedUser,
    query: { person_id?: string } = {},
  ): Promise<TicketCancelOptions> {
    const personId = await this.repo.resolvePersonId(user.username);
    if (!personId) {
      this.logger.warn(
        `No PERSON_ID in EMPLOYMENT_DETAILS_V for ${user.username}; returning empty cancel options.`,
      );
      return { tickets: [], takenAs: [], repaymentMethods: [] };
    }
    const requested = query.person_id?.trim();
    if (requested && !AnnualTicketService.samePersonId(requested, personId)) {
      throw new ForbiddenException(ERROR_MESSAGES.FORBIDDEN);
    }
    return this.repo.cancelOptions(personId);
  }

  /** op 72 — submit the cancellation (CANCEL_TKT_PR). */
  cancel(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.cancel({ username: user.username, lang, fields });
  }

  /** Numeric comparison, so `026023` still matches `26023`; anything non-numeric never matches. */
  private static samePersonId(requested: string, resolved: string): boolean {
    return /^\d+$/.test(requested) && Number(requested) === Number(resolved);
  }
}
