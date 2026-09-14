import { Injectable } from '@nestjs/common';
import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';
import { parseOracleDate } from '@shared/utils/date.util';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { USERNAME_KEY_CANDIDATES } from '@shared/constants/oracle-columns';
import {
  CompanyIdCommand,
  IdCardRepository,
  QidDetail,
  QidRepository,
  QidUpdateCommand,
} from '../../domain/identity.repository';

/** QID_CHG_PR — 21 IN (two DATEs, eight BLOB slots) + 3 OUT. */
const QID_CHG_PARAMS = [
  'p_user_name',
  'p_qid_number',
  'p_iss_date',
  'p_exp_date',
  'p_qid_job',
  ...BaseOracleRepository.attachmentParams(8),
] as const;

/** COID_REQ_PR input params (Sanaad spec — RequestCompanyID body). */
const COID_REQ_PARAMS = [
  'p_user_name',
  'p_reason',
  'p_charge_for_new_id',
  'p_delivery_loc',
  'p_working_location',
  'p_comments',
  ...BaseOracleRepository.attachmentParams(),
] as const;

/** op 18 — QID details (QID_DET_V read). op 19 — QID_CHG_PR confirmed update. */
@Injectable()
export class QidOracleRepository extends BaseOracleRepository implements QidRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async getQid(username: string, _lang: Lang): Promise<QidDetail | undefined> {
    // QID_DET_V is keyed by the caller's login; resolve the real column name from
    // the data dictionary (hard-coded `username` raised ORA-00904).
    const rows = await this.readByResolvedKey(
      ORACLE_OBJECTS.QID_DET_V,
      username,
      USERNAME_KEY_CANDIDATES,
    );
    return rows[0];
  }

  async updateQid(cmd: QidUpdateCommand): Promise<SubmitResult> {
    return this.callDocumentedSubmitProc(
      ORACLE_OBJECTS.QID_CHG_PR,
      QID_CHG_PARAMS,
      {
        ...cmd.fields,
        p_user_name: cmd.username,
        p_iss_date: {
          type: oracledb.DB_TYPE_DATE,
          val: parseOracleDate(cmd.fields.p_iss_date),
        },
        p_exp_date: {
          type: oracledb.DB_TYPE_DATE,
          val: parseOracleDate(cmd.fields.p_exp_date),
        },
      },
      this.stringOutBinds(['p_success_flag', 'p_error_msg', 'p_error_msg_ar']),
    );
  }
}

/** op 54 — RequestCompanyID (COID_REQ_PR, confirmed 26 IN + 3 OUT). */
@Injectable()
export class IdCardOracleRepository extends BaseOracleRepository implements IdCardRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async requestCompanyId(cmd: CompanyIdCommand): Promise<SubmitResult> {
    return this.callDocumentedSubmitProc(
      ORACLE_OBJECTS.COID_REQ_PR,
      COID_REQ_PARAMS,
      { ...cmd.fields, p_user_name: cmd.username },
      this.stringOutBinds(['p_success_flag', 'p_error_msg', 'p_error_msg_ar']),
    );
  }
}
