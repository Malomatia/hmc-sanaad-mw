import { OracleQueryError, OracleUnavailableException } from '../database/oracle.error';
import { classifyException } from './exception-classifier';
import { ErrorCategory, extractBusinessRaiseText, looksSensitive } from './error-category';

/**
 * The leak filter must tell SQL apart from English: matching bare
 * `\bSELECT\b`/`\bFROM\b` suppressed real Oracle validation prose ("Please
 * select the correct Contractual Year") behind the generic database-error
 * message on every submit endpoint (reported on op 10 /leave/apply,
 * 2026-09-02).
 */
describe('looksSensitive', () => {
  it.each([
    ' 01-OCT-26 does not fall between   01-SEP-2025 to 31-AUG-2026. Please select the correct Contractual Year',
    'Please select a date from the calendar and update your request',
    'You cannot delete this dependent before the end date',
    'Leave must begin after the joining date',
  ])('lets business prose through: %s', (text) => {
    expect(looksSensitive(text)).toBe(false);
  });

  it.each([
    'ORA-00942: table or view does not exist',
    'PLS-00306: wrong number or types of arguments',
    'SELECT NVL(days, 0) FROM absence_table WHERE id = :1',
    'INSERT INTO absence_table VALUES (:1)',
    'DELETE FROM absence_table WHERE id = :1',
    'UPDATE absence_table SET days = 0',
    'BEGIN XYZ_PKG.run(:p); END;',
    'error in XXHMC_SND_LEAV_OF_ABSEN_NEW_PR',
    'at Object.<anonymous> (/app/dist/main.js:1:1)\n    at process',
  ])('still flags technical detail: %s', (text) => {
    expect(looksSensitive(text)).toBe(true);
  });
});

describe('extractBusinessRaiseText', () => {
  it('strips the ORA-20xxx prefix and trailing ORA-06512 frames', () => {
    expect(
      extractBusinessRaiseText(
        'ORA-20001: Leave dates overlap an existing request ORA-06512: at "APPS.XXHMC_SND_LEAV_PKG", line 12',
      ),
    ).toBe('Leave dates overlap an existing request');
  });

  it('returns undefined when the raise text is itself technical', () => {
    expect(
      extractBusinessRaiseText('ORA-20001: failure in XXHMC_SND_LEAV_PKG ORA-06512: at line 12'),
    ).toBeUndefined();
  });

  it('returns undefined for non-20xxx messages', () => {
    expect(extractBusinessRaiseText('ORA-00942: table or view does not exist')).toBeUndefined();
  });
});

describe('classifyException — readable Oracle errors', () => {
  it.each<[string, string, number]>([
    ['ORA-01403: no data found', 'no data found', 422],
    ['ORA-00942: table or view does not exist', 'table or view does not exist', 500],
    ['ora-01403: no data found\r\nORA-06512: at "APPS.PKG", line 4', 'no data found', 422],
    ['ORA-00001: unique constraint violated', 'unique constraint violated', 409],
    [
      'ORA-06550: line 1, column 7:\nPLS-00306: wrong number or types of arguments',
      'wrong number or types of arguments',
      500,
    ],
    [
      'ORA-20001: Please select a date from the calendar and update your request',
      'Please select a date from the calendar and update your request',
      409,
    ],
    [
      'ORA-06502: numeric or value error: character string buffer too small\nORA-06512: at line 4',
      'numeric or value error: character string buffer too small',
      500,
    ],
    [
      'ORA-01403: no data found\nHelp: https://docs.oracle.com/error-help/db/ora-01403/',
      'no data found',
      422,
    ],
    ['ORA-06512: at "APPS.PKG", line 4\nORA-01403: no data found', 'no data found', 500],
    ['ORA-01403: no data found\n    at execute (/app/dist/main.js:1:1)', 'no data found', 422],
  ])('extracts a description from %s', (raw, message, status) => {
    const classified = classifyException(new OracleQueryError(raw));
    expect(classified.message).toBe(message);
    expect(classified.httpStatus).toBe(status);
  });

  it.each([
    'ORA-00942: SELECT password FROM users',
    'ORA-00942: select password from users',
    'ORA-00942: failed: select password from users',
    'ORA-00942: password=private-value',
    'ORA-00942: error in XXHMC_SND_TEST',
    'ORA-01400: cannot insert NULL into ("APPS"."EMP"."NAME")',
    'ORA-06512: at "APPS.PKG", line 4',
    'ORA-00942:',
  ])('keeps internal details out of the API: %s', (raw) => {
    expect(classifyException(new OracleQueryError(raw)).message).toBe('The database request failed.');
  });

  it('uses the new fallback when no Oracle description exists', () => {
    expect(classifyException(new OracleUnavailableException()).message).toBe('The database request failed.');
  });
});

describe('classifyException — thrown ORA-20xxx business raises', () => {
  it('surfaces the raise text as the business-rule message', () => {
    const classified = classifyException(
      new OracleQueryError('ORA-20105: You have already applied for this leave ORA-06512: at line 4'),
    );
    expect(classified.category).toBe(ErrorCategory.BUSINESS_RULE_ERROR);
    expect(classified.httpStatus).toBe(409);
    expect(classified.message).toBe('You have already applied for this leave');
  });

  it('keeps the generic message when the raise text is technical', () => {
    const classified = classifyException(
      new OracleQueryError('ORA-20105: SELECT NVL(x,0) FROM t failed ORA-06512: at line 4'),
    );
    expect(classified.category).toBe(ErrorCategory.BUSINESS_RULE_ERROR);
    expect(classified.message).toBe('The requested operation cannot be completed.');
  });
});
