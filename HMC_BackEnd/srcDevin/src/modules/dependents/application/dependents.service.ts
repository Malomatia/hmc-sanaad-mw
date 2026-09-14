import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Lang } from '@shared/domain/lang';
import { LovItem } from '@shared/domain/lov-item';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { AuthenticatedUser } from '@core/auth/auth-user.interface';
import { LookupsService } from '@lookups/application/lookups.service';
import {
  DEPENDENT_REPOSITORY,
  DependentRepository,
  PASSPORT_REPOSITORY,
  PassportRepository,
} from '../domain/dependents.repository';

/** Dependent add/update/delete + LOV (ops 65, 24, 31, 64). */
@Injectable()
export class DependentService {
  constructor(
    @Inject(DEPENDENT_REPOSITORY) private readonly repo: DependentRepository,
    private readonly lookups: LookupsService,
  ) {}

  add(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    DependentService.assertPhoneArrays(fields);
    return this.repo.add({ username: user.username, lang, fields });
  }

  update(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    DependentService.assertPhoneArrays(fields);
    DependentService.assertPhoneArrays(fields, '1');
    return this.repo.update({ username: user.username, lang, fields });
  }

  /**
   * The phone fields are PL/SQL associative arrays paired by index in
   * ADD_DEPENDENT_PR / UPDATE_DEPENDENT_PR (p_phone_id[i] is the phone that
   * p_phone_type[i] / p_phone_number[i] describe; `suffix` '1' checks the
   * second phone group of the update). A length mismatch would silently
   * mis-pair inside Oracle, so fail fast: a type without its number (or vice
   * versa) is rejected, and every phone array that IS sent must have the same
   * number of items.
   */
  private static assertPhoneArrays(fields: Record<string, unknown>, suffix = ''): void {
    const keys = [`p_phone_type${suffix}`, `p_phone_number${suffix}`, `p_phone_id${suffix}`];
    const present = keys.filter((key) => fields[key] != null);
    if (!present.length) return;
    const hasType = fields[keys[0]] != null;
    const hasNumber = fields[keys[1]] != null;
    if (hasType !== hasNumber) {
      throw new BadRequestException(
        `${keys[0]} and ${keys[1]} must be sent together (paired by index).`,
      );
    }
    const lengths = present.map((key) =>
      Array.isArray(fields[key]) ? (fields[key] as unknown[]).length : -1,
    );
    if (new Set(lengths).size > 1) {
      throw new BadRequestException(
        `${present.join(', ')} must contain the same number of items (paired by index).`,
      );
    }
  }

  delete(
    dependentId: string,
    fields: Record<string, unknown>,
    user: AuthenticatedUser,
    lang: Lang,
  ): Promise<SubmitResult> {
    return this.repo.delete({ username: user.username, lang, dependentId, fields });
  }

  dependentLov(lang: Lang, dataType?: string): Promise<LovItem[]> {
    return this.lookups.getByObject(
      ORACLE_OBJECTS.DEP_LOOKUP_LOV,
      lang,
      undefined,
      dataType ? { dataType } : undefined,
    );
  }
}

/** Passport types/apply/issue-place (ops 33, 34, 49). */
@Injectable()
export class PassportService {
  constructor(
    @Inject(PASSPORT_REPOSITORY) private readonly repo: PassportRepository,
    private readonly lookups: LookupsService,
  ) {}

  types(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.PASSPORT_TYPE, lang);
  }

  apply(fields: Record<string, unknown>, user: AuthenticatedUser, lang: Lang): Promise<SubmitResult> {
    return this.repo.apply({ username: user.username, lang, fields });
  }

  issuePlaceLov(lang: Lang): Promise<LovItem[]> {
    return this.lookups.getByObject(ORACLE_OBJECTS.DEP_PLACE_LOV, lang);
  }
}
