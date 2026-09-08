import { Injectable } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { Lang, toOracleLanguage } from '@shared/domain/lang';
import { str } from '@shared/utils/mapper.util';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { USERNAME_KEY_CANDIDATES } from '@shared/constants/oracle-columns';
import { EmployeeProfile } from '../../domain/entities/employee-profile';
import { ProfileRepository, UpdatePersonalCommand } from '../../domain/profile.repository';
import { ProfileMapper } from './profile.mapper';

/** UPD_PERSONAL_INFO_PR input params (Sanaad spec — PersonalDetsUpdate body). */
const UPD_PERSONAL_PARAMS = [
  'p_user_name',
  'p_effective_date',
  'p_first_name',
  'p_middle_name',
  'p_last_name',
  'p_marital_status',
  'p_name_in_arabic',
  'p_title',
  'p_relationship',
  'p_place_of_issue',
  'p_country_of_issue',
  'p_visa_type',
  'p_visa_number',
  'p_visa_validity',
  'p_type_of_sponsership',
  ...BaseOracleRepository.attachmentParams(),
] as const;

/**
 * op 2 assembles the profile from views (parallelized). op 48
 * (UPD_PERSONAL_INFO_PR) submits the personal-details change.
 * See Docs_Ai/Repository Pattern/README.md.
 */
@Injectable()
export class ProfileOracleRepository extends BaseOracleRepository implements ProfileRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async getProfile(username: string, lang: Lang): Promise<EmployeeProfile> {
    // These views are keyed by the caller's login, but the actual column name
    // differs per object (hard-coded `username` raised ORA-00904). Resolve it
    // from the data dictionary (USER_NAME → USERNAME) and bind the value.
    const [personalRows, phoneRows, addressRows, insideAddressRows, dependentRows] =
      await Promise.all([
        this.readByResolvedKey(ORACLE_OBJECTS.PERSONAL_DETAILS_V, username, USERNAME_KEY_CANDIDATES),
        this.readByResolvedKey(ORACLE_OBJECTS.EMP_PHONE_V, username, USERNAME_KEY_CANDIDATES),
        this.readByResolvedKey(ORACLE_OBJECTS.EMP_OUT_ADDRESS_V, username, USERNAME_KEY_CANDIDATES, {
          where: 'ADDRESS_TYPE IN (:addressType0, :addressType1)',
          binds: { addressType0: 'Recruiting', addressType1: 'Primary Home Country Address' },
          maxRows: 1,
        }),
        this.readByResolvedKey(ORACLE_OBJECTS.EMP_IN_ADDRESS_V, username, USERNAME_KEY_CANDIDATES),
        this.readByResolvedKey(ORACLE_OBJECTS.EMP_CONTACT_V, username, USERNAME_KEY_CANDIDATES),
      ]);

    // Dependent phones/addresses hang off the EMP_CONTACT_V dependents, not the
    // caller's username: DEP_PHONE_V is keyed by the dependents' DEPENDENT_ID,
    // DEP_ADDRESS_V by their ADDRESS_ID.
    const [dependentPhoneRows, dependentAddressRows] = await Promise.all([
      this.readByResolvedKeyIn(
        ORACLE_OBJECTS.DEP_PHONE_V,
        dependentRows.map((r) => str(r, 'dependent_id')),
        ['dependent_id'],
      ),
      this.readByResolvedKeyIn(
        ORACLE_OBJECTS.DEP_ADDRESS_V,
        dependentRows.map((r) => str(r, 'address_id')),
        ['address_id'],
      ),
    ]);

    return ProfileMapper.toProfile(
      {
        personalRows,
        phoneRows,
        addressRows,
        insideAddressRows,
        dependentPhoneRows,
        dependentAddressRows,
        dependentRows,
      },
      lang,
    );
  }

  async updatePersonal(cmd: UpdatePersonalCommand): Promise<SubmitResult> {
    const values = {
      ...cmd.fields,
      p_language: toOracleLanguage(cmd.lang),
      p_user_name: cmd.username,
    };
    return this.callSubmitProc(ORACLE_OBJECTS.UPD_PERSONAL_INFO_PR, UPD_PERSONAL_PARAMS, values);
  }
}
