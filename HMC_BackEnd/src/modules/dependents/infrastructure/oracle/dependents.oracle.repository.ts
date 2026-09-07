import { Injectable } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { SubmitResult } from '@shared/domain/submit-result';
import { toOracleLanguage } from '@shared/domain/lang';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import {
  DeleteDependentCommand,
  DependentCommand,
  DependentRepository,
  PassportCommand,
  PassportRepository,
} from '../../domain/dependents.repository';
import {
  ADD_DEPENDENT_PARAMS,
  PASSPORT_DETAIL_PARAMS,
  REMOVE_DEPENDENT_PARAMS,
  UPDATE_DEPENDENT_PARAMS,
} from './dependents.binds';

/**
 * Dependent lifecycle procedures. Add and update are members of
 * ADD_DEPENDENT_PKG and are therefore called as `PACKAGE.PROCEDURE`; the address
 * of a new dependent is part of the same call (the package composes
 * CREATE_ADDRESS_PR internally), which is why the parameter list carries the
 * address fields.
 */
@Injectable()
export class DependentOracleRepository extends BaseOracleRepository implements DependentRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async add(cmd: DependentCommand): Promise<SubmitResult> {
    return this.callSubmitProc(
      ORACLE_OBJECTS.DEPENDENT_PKG_ADD,
      ADD_DEPENDENT_PARAMS,
      this.values(cmd),
    );
  }

  async update(cmd: DependentCommand): Promise<SubmitResult> {
    return this.callSubmitProc(
      ORACLE_OBJECTS.DEPENDENT_PKG_UPDATE,
      UPDATE_DEPENDENT_PARAMS,
      this.values(cmd),
    );
  }

  async delete(cmd: DeleteDependentCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.REMOVE_DEPENDENT_PR, REMOVE_DEPENDENT_PARAMS, {
      ...this.withAliases(cmd.fields),
      p_user_name: cmd.username,
      p_dependent_id: cmd.dependentId,
      p_language: toOracleLanguage(cmd.lang),
    });
  }

  /** Merge the posted p_* body with the enforced user + resolved language. */
  private values(cmd: DependentCommand): Record<string, unknown> {
    const today = new Date();
    return {
      ...this.withAliases(cmd.fields),
      p_effective_date: [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join(''),
      p_language: toOracleLanguage(cmd.lang),
      p_user_name: cmd.username,
    };
  }

  private withAliases(fields: Record<string, unknown>): Record<string, unknown> {
    const values = { ...fields };
    const pairs = [
      ['p_relationship', 'p_relation_ship'],
      ['p_relationship_start_date', 'p_relation_ship_start_date'],
      ['p_relationship_end_date', 'p_relation_ship_end_date'],
      ['p_gender', 'p_gendar'],
      ['p_visa_validity', 'p_visa_validy'],
      ['p_date_of_issue_qid', 'p_date_of_issuue_qid'],
      ['p_type_of_sponsorship', 'p_type_of_sponsership'],
    ] as const;
    for (const [canonical, legacy] of pairs) {
      const value = values[canonical] ?? values[legacy];
      if (value !== undefined) {
        values[canonical] = value;
        values[legacy] = value;
      }
    }
    return values;
  }
}

/** op 34 — Passport detail request (PASS_DTL_PR). */
@Injectable()
export class PassportOracleRepository extends BaseOracleRepository implements PassportRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async apply(cmd: PassportCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.PASS_DTL_PR, PASSPORT_DETAIL_PARAMS, {
      ...cmd.fields,
      p_language: toOracleLanguage(cmd.lang),
      p_user_name: cmd.username,
    });
  }
}
