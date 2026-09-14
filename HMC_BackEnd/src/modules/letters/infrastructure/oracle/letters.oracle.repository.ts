import { Injectable } from '@nestjs/common';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { BaseOracleRepository } from '@core/database/base.repository';
import { SubmitResult } from '@shared/domain/submit-result';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { LetterRepository, LetterSubmitCommand } from '../../domain/letters.repository';

/**
 * HR_EMPLYMNT_LTR_PR — confirmed declaration (client, 2026-09-14): 28 IN
 * (p_country and the ten file/BLOB pairs DEFAULT NULL) + 3 OUT. There is NO
 * p_language; the legacy request template listed one and it raised PLS-00306.
 * The full signature is registered in OracleContractCatalog.
 */
const LETTER_SUBMIT_PARAMS = [
  'p_user_name',
  'p_letter_language',
  'p_letter_name',
  'p_country',
  'p_no_of_copies',
  'p_mobile_number',
  'p_letter_delivery_loc',
  'p_purpose_comments',
  ...BaseOracleRepository.attachmentParams(),
] as const;

/** op 17 — LetterReqSubmit (HR_EMPLYMNT_LTR_PR). */
@Injectable()
export class LettersOracleRepository extends BaseOracleRepository implements LetterRepository {
  constructor(ora: OracleService, schema: OracleSchemaService) {
    super(ora, schema);
  }

  async submit(cmd: LetterSubmitCommand): Promise<SubmitResult> {
    return this.callSubmitProc(ORACLE_OBJECTS.HR_EMPLYMNT_LTR_PR, LETTER_SUBMIT_PARAMS, {
      ...cmd.fields,
      p_user_name: cmd.username,
    });
  }
}
