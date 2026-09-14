/**
 * Sanaad date helpers. The Oracle layer uses display strings like `18-Jun-2019`
 * and `January 2024`, plus tokens like `19000101` / `20200202`.
 */

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `19000101` (yyyymmdd token) — used as an "all dates" effective-date default. */
export const EFFECTIVE_DATE_ALL = '19000101';

/** Validate a `yyyymmdd` token like `20200202`. */
export function isDateToken(value: string): boolean {
  return /^\d{8}$/.test(value);
}

/** Validate a `"Month YYYY"` pay period like `January 2024`. */
export function isPayPeriod(value: string): boolean {
  const [month, year] = value.split(' ');
  return MONTHS.includes(month) && /^\d{4}$/.test(year ?? '');
}

/** Parse a `dd-Mon-yyyy` display date (e.g. `18-Jun-2019`) to a Date, or undefined. */
export function parseDisplayDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

const MONTH_ABBR: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

function toUtcDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Parse a formal `DATE`/`TIMESTAMP` Oracle bind value from any of the request
 * string shapes seen across the API (`YYYYMMDD`, `YYYY-MM-DD`, `DD-MON-YYYY`,
 * `YYYY-MON-DD`, ...) into a real JS `Date`. Binding the raw string instead
 * leaves node-oracledb to send it as VARCHAR2 and Oracle to parse it against
 * the session's NLS_DATE_FORMAT, which raised `ORA-01861` (`literal does not
 * match format string`) for formats the session didn't expect. Binding a real
 * `Date` bypasses NLS parsing entirely. Returns `null` for missing/blank/
 * unparseable input (never bind a placeholder like a Swagger-example
 * `"string"` — that produced `ORA-01858`, not a usable date).
 */
export function parseOracleDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (!s) return null;

  // YYYYMMDD
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return toUtcDate(+m[1], +m[2], +m[3]);

  // YYYY-MM-DD
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return toUtcDate(+m[1], +m[2], +m[3]);

  // DD-MON-YYYY / DD-MON-YY / DD-Mon-YYYY (month as a 3-letter name)
  m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(s);
  if (m) {
    const month = MONTH_ABBR[m[2].toUpperCase()];
    if (month) {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return toUtcDate(year, month, Number(m[1]));
    }
  }

  // YYYY-MON-DD (e.g. '2025-OCT-17', seen in the identity module DTOs)
  m = /^(\d{4})-([A-Za-z]{3})-(\d{1,2})$/.exec(s);
  if (m) {
    const month = MONTH_ABBR[m[2].toUpperCase()];
    if (month) return toUtcDate(Number(m[1]), month, Number(m[3]));
  }

  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}
