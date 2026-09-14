/**
 * Oracle error handling policy. Business logic lives in Oracle; some errors
 * surface as raw `ORA-#####` / `PLS-#####`. The OracleExceptionFilter maps them
 * to the Sanaad error envelope with an appropriate HTTP status.
 *
 * Source: Docs_Ai/Architecture/README.md section 6 + Docs_Ai/Database/README.md.
 */

/** `ORA-01403: no data found` → treated as empty result, not an error. */
export const ORA_NO_DATA_FOUND = 1403;
/** "table or view does not exist" — a name we hold does not exist in Oracle. */
export const ORA_OBJECT_NOT_FOUND = 942;

/** Map of well-known ORA codes → HTTP status. Extend as codes are captured. */
export const ORA_HTTP_STATUS: Readonly<Record<number, number>> = Object.freeze({
  1403: 404, // no data found
  1: 409, // unique constraint violated
  1400: 400, // cannot insert NULL
  2291: 409, // integrity constraint (parent key not found)
  20001: 400, // common custom application error range start
});

/** Extract the numeric ORA/PLS code from an Oracle error message. */
export function extractOraCode(message: string | undefined): number | undefined {
  if (!message) return undefined;
  const match = /(?:ORA|PLS)-(\d{2,5})/i.exec(message);
  return match ? Number(match[1]) : undefined;
}

export function isNoDataFound(message: string | undefined): boolean {
  return extractOraCode(message) === ORA_NO_DATA_FOUND;
}

export const ERROR_MESSAGES = {
  UNAUTHENTICATED: 'Missing or invalid authentication token.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  ORACLE_UNAVAILABLE: 'The data service is currently unavailable.',
  CERNER_UNAVAILABLE: 'The appointments service is currently unavailable.',
  VALIDATION_FAILED: 'Request validation failed.',
  NOT_IMPLEMENTED: 'This operation is not yet implemented (Oracle bind signature pending).',
  UNEXPECTED: 'An unexpected error occurred.',
} as const;
