/**
 * Result of an Oracle transactional call (`_PR` / `_PKG`).
 * Oracle procedures return a success flag `S`/`N` plus a message.
 * Framework-free — safe to import from the domain layer.
 */
export type SuccessFlag = 'S' | 'N';

export interface SubmitResult {
  successflag: SuccessFlag;
  status: 'success' | 'error';
  errormessage: string;
  errormessageAr?: string;
  result?: Record<string, unknown>;
}

export function successResult(
  message = 'Success',
  result?: Record<string, unknown>,
): SubmitResult {
  return { successflag: 'S', status: 'success', errormessage: message, result };
}

export function failureResult(message: string, messageAr?: string): SubmitResult {
  return {
    successflag: 'N',
    status: 'error',
    errormessage: message,
    errormessageAr: messageAr,
  };
}

export function isSubmitResult(value: unknown): value is SubmitResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'successflag' in value &&
    (value as SubmitResult).successflag !== undefined
  );
}
