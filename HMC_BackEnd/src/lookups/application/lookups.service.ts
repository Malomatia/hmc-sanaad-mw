import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import {
  isCernerMasterLookup,
  MASTER_LOOKUP_OBJECT,
  resolveLovObject,
} from '@shared/constants/lov-names';
import { LOV_REPOSITORY, LovReadOptions, LovRepository } from '../domain/lov.repository';

/**
 * Shared-kernel lookup service (ops 15, 26 + generic `/data/lovlookup` &
 * `/data/masterlookup`). Feature modules call `getByObject(...)` with an
 * ORACLE_OBJECTS entry for their domain-branded LOV routes — LOV reads are NOT
 * reimplemented per feature. See Docs_Ai/Services/README.md.
 */
@Injectable()
export class LookupsService {
  constructor(@Inject(LOV_REPOSITORY) private readonly lov: LovRepository) {}

  /** Read a LOV directly by resolved Oracle object (used by feature modules). */
  getByObject(
    object: string,
    lang: Lang,
    username?: string,
    options?: LovReadOptions,
  ): Promise<LovItem[]> {
    return this.lov.readLov(object, lang, username, options);
  }

  /** Generic `/lookups/lov?lovname=` — resolves via the LOV_OBJECT registry. */
  getLov(lovname: string, lang: Lang, username?: string, personId?: string): Promise<LovItem[]> {
    const object = resolveLovObject(lovname);
    if (!object) throw new BadRequestException(`Unknown LOV name: ${lovname}`);
    return this.lov.readLov(object, lang, username, personId ? { personId } : undefined);
  }

  /** Generic `/lookups/master?lookupname=` — Cerner masters are served elsewhere. */
  getMaster(lookupname: string, lang: Lang): Promise<LovItem[]> {
    if (isCernerMasterLookup(lookupname)) {
      throw new BadRequestException(
        `'${lookupname}' is a Cerner master lookup served by the appointments module.`,
      );
    }
    const object = MASTER_LOOKUP_OBJECT[lookupname];
    if (!object) throw new BadRequestException(`Unknown master lookup: ${lookupname}`);
    return this.lov.readLov(object, lang);
  }

  /** op 15 — Yes/No LOV. */
  yesNo(lang: Lang): Promise<LovItem[]> {
    return this.getByObject(ORACLE_OBJECTS.YES_NO_LOV, lang);
  }

  /** op 26 — RFMI user LOV. */
  rfmiUser(lang: Lang): Promise<LovItem[]> {
    return this.getByObject(ORACLE_OBJECTS.RFMI_USER_LOV, lang);
  }
}
