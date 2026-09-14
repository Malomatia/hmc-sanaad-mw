import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';

/** One phone entry for the PHONE_PKG JSON-array param. */
export interface PhoneInput {
  phoneId?: string;
  objectVersionNumber?: string;
  phoneType: string;
  phoneNumber: string;
}

export interface UpsertPhoneCommand {
  username: string;
  lang: Lang;
  phones: PhoneInput[];
}

/**
 * DEL_PHONE_NUMBER_PR identifies the row by id but also takes the type and
 * number it is expected to hold (documented params P_PHONE_ID, P_PHONE_TYPE,
 * P_PHONE_NUMBER).
 */
export interface DeletePhoneCommand {
  username: string;
  lang: Lang;
  phoneId: string;
  phoneType?: string;
  phoneNumber?: string;
}

/** Port: phone upsert (28) + delete (32). Phone-type LOV (27) via Lookups. */
export interface PhoneRepository {
  upsert(cmd: UpsertPhoneCommand): Promise<SubmitResult>;
  delete(cmd: DeletePhoneCommand): Promise<SubmitResult>;
}
export const PHONE_REPOSITORY = Symbol('PHONE_REPOSITORY');

export interface AddressCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

/** Port: address create (29) + update (25). Country LOV (30) via Lookups. */
export interface AddressRepository {
  create(cmd: AddressCommand): Promise<SubmitResult>;
  update(cmd: AddressCommand): Promise<SubmitResult>;
}
export const ADDRESS_REPOSITORY = Symbol('ADDRESS_REPOSITORY');
