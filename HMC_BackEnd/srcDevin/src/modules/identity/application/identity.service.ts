import { Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LookupsService } from '@lookups/application/lookups.service';
import {
  ID_CARD_REPOSITORY,
  IdCardRepository,
  QID_REPOSITORY,
  QidDetail,
  QidRepository,
} from '../domain/identity.repository';

/** QID details + update (ops 18, 19). */
@Injectable()
export class QidService {
  constructor(@Inject(QID_REPOSITORY) private readonly repo: QidRepository) {}

  getQid(username: string, lang: Lang): Promise<QidDetail | undefined> {
    return this.repo.getQid(username, lang);
  }

  updateQid(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.updateQid({ username: user.username, lang, fields });
  }
}

/** ID card request + related LOVs (ops 54, 53b, 59, 60). */
@Injectable()
export class IdCardService {
  constructor(
    @Inject(ID_CARD_REPOSITORY) private readonly repo: IdCardRepository,
    private readonly lookups: LookupsService,
  ) {}

  requestCompanyId(
    fields: Record<string, unknown>,
    user: AuthenticatedUser,
    lang: Lang,
  ): Promise<SubmitResult> {
    return this.repo.requestCompanyId({ username: user.username, lang, fields });
  }

  workLocationLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.SIT_WORK_LOC_V, lang);
  }

  deliveryLocationLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.SIT_DELEV_LOC_V, lang);
  }

  reasonLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.SIT_REASON_V, lang);
  }
}
