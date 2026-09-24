import { Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LookupsService } from '@lookups/application/lookups.service';
import {
  ADDRESS_REPOSITORY,
  AddressRepository,
  PHONE_REPOSITORY,
  PhoneInput,
  PhoneRepository,
} from '../domain/contact.repository';

/** Phone ops (27, 28, 32). */
@Injectable()
export class PhoneService {
  constructor(
    @Inject(PHONE_REPOSITORY) private readonly repo: PhoneRepository,
    private readonly lookups: LookupsService,
  ) {}

  phoneTypeLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.PHONE_TYPE_V, lang);
  }

  upsert(phones: PhoneInput[], user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.upsert({ username: user.username, lang, phones });
  }

  delete(
    phone: { phoneId: string; phoneType?: string; phoneNumber?: string },
    user: AuthenticatedUser,
    lang: Lang,
  ): Promise<SubmitResult> {
    return this.repo.delete({ username: user.username, lang, ...phone });
  }
}

/** Address ops (25, 29, 30). */
@Injectable()
export class AddressService {
  constructor(
    @Inject(ADDRESS_REPOSITORY) private readonly repo: AddressRepository,
    private readonly lookups: LookupsService,
  ) {}

  countryLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.COUNTRY_LOV, lang);
  }

  create(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.create({ username: user.username, lang, fields });
  }

  update(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.update({ username: user.username, lang, fields });
  }
}
