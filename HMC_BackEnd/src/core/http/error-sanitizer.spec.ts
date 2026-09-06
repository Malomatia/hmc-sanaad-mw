import { OracleQueryError } from '../database/oracle.error';
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
