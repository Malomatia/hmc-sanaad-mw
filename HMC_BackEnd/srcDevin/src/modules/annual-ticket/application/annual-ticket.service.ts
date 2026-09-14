import { Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
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

  /** op 72 — inputs of the cancellation form (tickets + taken-as + repayment). */
  cancelOptions(personId: string): Promise<TicketCancelOptions> {
    return this.repo.cancelOptions(personId);
  }

  /** op 72 — submit the cancellation (CANCEL_TKT_PR). */
  cancel(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.cancel({ username: user.username, lang, fields });
  }
}
