import { Injectable } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { SubmitResult } from '@shared/domain/submit-result';
import { toOracleLanguage } from '@shared/domain/lang';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { LetterRepository, LetterSubmitCommand } from '../../domain/letters.repository';

/** HR_EMPLYMNT_LTR_PR input params (Sanaad spec — LetterReqSubmit body). */
const LETTER_SUBMIT_PARAMS = [
  'p_user_name',
  'p_letter_language',
  'p_letter_name',
  'p_country',
  'p_no_of_copies',
  'p_mobile_number',
  'p_letter_delivery_loc',
  'p_purpose_comments',
  'p_language',
] as const;

/** op 17 — LetterReqSubmit (HR_EMPLYMNT_LTR_PR). */
@Injectable()
export class LettersOracleRepository extends BaseOracleRepository implements LetterRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async submit(cmd: LetterSubmitCommand): Promise<SubmitResult> {
    const values = { ...cmd.fields, p_language: toOracleLanguage(cmd.lang), p_user_name: cmd.username };
    return this.callSubmitProc(ORACLE_OBJECTS.HR_EMPLYMNT_LTR_PR, LETTER_SUBMIT_PARAMS, values);
  }
}
