import { safeDecodeUri } from './url-decode.util';

/**
 * Small helpers used by infrastructure mappers to translate Oracle rows
 * (case-insensitive keys, encoded Arabic) into clean domain objects.
 */

/** Read a column from an Oracle row regardless of key casing. */
export function col<T = unknown>(row: Record<string, any>, name: string): T | undefined {
  if (row == null) return undefined;
  if (name in row) return row[name] as T;
  const upper = name.toUpperCase();
  if (upper in row) return row[upper] as T;
  const lower = name.toLowerCase();
  if (lower in row) return row[lower] as T;
  const found = Object.keys(row).find((k) => k.toLowerCase() === lower);
  return found ? (row[found] as T) : undefined;
}

/** Read a string column, coercing null/undefined to undefined. */
export function str(row: Record<string, any>, name: string): string | undefined {
  const value = col(row, name);
  return value === null || value === undefined ? undefined : String(value);
}

const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Read a date column as the Sanaad display form `DD-Mon-YYYY` (e.g. `18-Jun-2019`).
 * Oracle DATE columns arrive from node-oracledb as JS Dates; VARCHAR2 view
 * columns already carry the display form and pass through unchanged.
 */
export function dateStr(row: Record<string, any>, name: string): string | undefined {
  const value = col(row, name);
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) {
    const day = String(value.getDate()).padStart(2, '0');
    return `${day}-${MONTH_ABBR[value.getMonth()]}-${value.getFullYear()}`;
  }
  return String(value);
}

/** Read + URL-decode an Arabic column. */
export function strAr(row: Record<string, any>, name: string): string | undefined {
  return safeDecodeUri(col(row, name));
}

/** Remove keys whose value is undefined (keeps the envelope tidy). */
export function pruneUndefined<T extends Record<string, any>>(obj: T): T {
  Object.keys(obj).forEach((k) => obj[k] === undefined && delete obj[k]);
  return obj;
}
