import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';

export type QidDetail = Record<string, unknown>;

export interface QidUpdateCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

export interface CompanyIdCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

/** Port: QID details (18) + update (19). */
export interface QidRepository {
  getQid(username: string, lang: Lang): Promise<QidDetail | undefined>;
  updateQid(cmd: QidUpdateCommand): Promise<SubmitResult>;
}
export const QID_REPOSITORY = Symbol('QID_REPOSITORY');

/** Port: company/staff ID card request (54). LOVs (53b, 59, 60) via Lookups. */
export interface IdCardRepository {
  requestCompanyId(cmd: CompanyIdCommand): Promise<SubmitResult>;
}
export const ID_CARD_REPOSITORY = Symbol('ID_CARD_REPOSITORY');
