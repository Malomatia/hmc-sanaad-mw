import { Injectable } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import {
  AddressCommand,
  AddressRepository,
  DeletePhoneCommand,
  PhoneRepository,
  UpsertPhoneCommand,
} from '../../domain/contact.repository';

/**
 * PHONE_PKG.ADD_OR_UPDATE_PHONE input params. Everything except `p_user_name`
 * is declared as `ETSND_VARCHAR` — `TABLE OF NVARCHAR2(4000) INDEX BY
 * PLS_INTEGER` — so the four value params are COLLECTIONS, one element per
 * phone, index-aligned across the four arrays.
 */
const UPSERT_PHONE_PARAMS = [
  'p_user_name',
  'p_phone_id',
  'p_object_version_number',
  'p_phone_type',
  'p_phone_number',
] as const;

/**
 * The package publishes `str_to_type(VARCHAR2) RETURN ETSND_VARCHAR`, which
 * splits a COMMA-separated string into that collection (verified on staging:
 * `str_to_type('a,b').COUNT = 2`). Letting it build the arrays keeps plain
 * string binds on our side and is what makes the call work at all.
 */
const PHONE_ARRAY_PARAMS = [
  'p_phone_id',
  'p_object_version_number',
  'p_phone_type',
  'p_phone_number',
] as const;
const STR_TO_TYPE = 'XXHMC_SND_PHONE_PKG.str_to_type';

/** DEL_PHONE_NUMBER_PR — confirmed declaration 2026-09-14: 4 IN + 3 OUT, no p_language. */
const DELETE_PHONE_PARAMS = [
  'p_user_name',
  'p_phone_id',
  'p_phone_type',
  'p_phone_number',
] as const;

/** CREATE_ADDRESS_PR — confirmed 2026-09-14: p_effective_date is DATE, no p_language. */
const CREATE_ADDRESS_PARAMS = [
  'p_user_name',
  'p_effective_date',
  'p_main_address',
  'p_primary_flag',
  'p_country',
  'p_address_type',
  'p_address_line1',
  'p_address_line2',
  'p_address_line3',
  'p_town_or_city',
  'p_region1',
  'p_region2',
  'p_region3',
  'p_po_box',
] as const;

/**
 * UPD_ADDRESS_PR — confirmed 2026-09-14: the region formals are spelled
 * P_REGION_1/2/3 (underscored, unlike CREATE_ADDRESS_PR's P_REGION1/2/3),
 * p_effective_date is DATE and there is no p_language. The request body keeps
 * accepting `p_region1..3`; `regionAliases` mirrors them onto the formal names.
 */
const UPDATE_ADDRESS_PARAMS = [
  'p_user_name',
  'p_effective_date',
  'p_address_id',
  'p_address_line1',
  'p_address_line2',
  'p_address_line3',
  'p_city',
  'p_region_1',
  'p_region_2',
  'p_region_3',
  'p_po_box',
  'p_address_type',
  'p_country',
] as const;

/**
 * op 28 — UPDATE_PHONE_NUMBER via PHONE_PKG.ADD_OR_UPDATE_PHONE. op 32 —
 * delete via DEL_PHONE_NUMBER_PR.
 *
 * The whole batch goes in ONE call: the package takes four index-aligned
 * `ETSND_VARCHAR` collections, built from comma-separated strings by its own
 * `str_to_type` (see PHONE_ARRAY_PARAMS). Submitting phones one-by-one with
 * scalar binds is what produced "Phone type doesnot exist" for every value —
 * the collection arrived empty, so the package found no type to validate.
 *
 * `p_phone_id` is REQUIRED per phone: despite the name, the procedure only
 * updates existing rows. It resolves each id first and answers "Phone ID
 * doesnot exist" for a placeholder (0) or ORA-01403 for an empty element, and
 * `str_to_type` drops empty tokens, so a "new phone" slot cannot even be
 * expressed. Creating a phone needs a different Oracle entry point (raised with
 * the DB team).
 */
@Injectable()
export class PhoneOracleRepository extends BaseOracleRepository implements PhoneRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async upsert(cmd: UpsertPhoneCommand): Promise<SubmitResult> {
    if (!cmd.phones.length) {
      return { status: 'success', successflag: 'S', errormessage: 'Success' };
    }
    // Fail fast with a clear message instead of the procedure's raw ORA-01403.
    const missingId = cmd.phones.findIndex((p) => !p.phoneId);
    if (missingId >= 0) {
      return {
        status: 'error',
        successflag: 'N',
        errormessage:
          `phones[${missingId}].phoneId is required — ADD_OR_UPDATE_PHONE only updates ` +
          'existing phones. Read the current ids from GET /profile (phones) first.',
      };
    }

    const join = (pick: (p: (typeof cmd.phones)[number]) => string | undefined) =>
      cmd.phones.map((p) => pick(p) ?? '').join(',');

    return this.callSubmitProc(
      ORACLE_OBJECTS.PHONE_PKG_ADD_OR_UPDATE,
      UPSERT_PHONE_PARAMS,
      {
        p_user_name: cmd.username,
        p_phone_id: join((p) => p.phoneId),
        // The procedure re-reads the row's real version; any element keeps the
        // arrays index-aligned.
        p_object_version_number: join((p) => p.objectVersionNumber ?? '1'),
        p_phone_type: join((p) => p.phoneType),
        p_phone_number: join((p) => p.phoneNumber),
      },
      undefined,
      { wrap: Object.fromEntries(PHONE_ARRAY_PARAMS.map((p) => [p, STR_TO_TYPE])) },
    );
  }

  async delete(cmd: DeletePhoneCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.DEL_PHONE_NUMBER_PR, DELETE_PHONE_PARAMS, {
      p_user_name: cmd.username,
      p_phone_id: cmd.phoneId,
      p_phone_type: cmd.phoneType,
      p_phone_number: cmd.phoneNumber,
    });
  }
}

/** op 29 (CREATE_ADDRESS_PR) / op 25 (UPD_ADDRESS_PR). */
@Injectable()
export class AddressOracleRepository extends BaseOracleRepository implements AddressRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async create(cmd: AddressCommand): Promise<SubmitResult> {
    return this.callSubmitProc(
      ORACLE_OBJECTS.CREATE_ADDRESS_PR,
      CREATE_ADDRESS_PARAMS,
      this.values(cmd),
    );
  }

  async update(cmd: AddressCommand): Promise<SubmitResult> {
    return this.callSubmitProc(
      ORACLE_OBJECTS.UPD_ADDRESS_PR,
      UPDATE_ADDRESS_PARAMS,
      this.values(cmd),
    );
  }

  /**
   * Merge the posted p_* body with the enforced user. Neither address procedure
   * declares p_language. Region values are mirrored under both spellings so the
   * same request body works for CREATE (p_region1) and UPDATE (p_region_1).
   */
  private values(cmd: AddressCommand): Record<string, unknown> {
    const values: Record<string, unknown> = { ...cmd.fields, p_user_name: cmd.username };
    for (const n of [1, 2, 3]) {
      const value = values[`p_region${n}`] ?? values[`p_region_${n}`];
      if (value !== undefined) {
        values[`p_region${n}`] = value;
        values[`p_region_${n}`] = value;
      }
    }
    return values;
  }
}
