import { Lang } from '@shared/domain/lang';
import { SubmitResult } from '@shared/domain/submit-result';

export interface LetterSubmitCommand {
  username: string;
  lang: Lang;
  fields: Record<string, unknown>;
}

/** Port: submit employment-letter request (op 17). LOVs (op 16) via Lookups. */
export interface LetterRepository {
  submit(cmd: LetterSubmitCommand): Promise<SubmitResult>;
}

export const LETTER_REPOSITORY = Symbol('LETTER_REPOSITORY');
