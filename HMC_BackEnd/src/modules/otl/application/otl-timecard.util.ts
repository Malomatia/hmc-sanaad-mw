/**
 * Period and date helpers for the OTL timecard. Oracle uses three period
 * formats (plan section 6): the TIME_PERIOD_V label
 * `Month dd, YYYY - Month dd, YYYY`, `Mon YYYY` in the summary/detail views and
 * `Month YYYY` in the submit JSON. The canonical identifier is the
 * TIME_PERIOD_V START_DATE/END_DATE pair; the text forms are derived from it
 * with fixed English month names, never parsed, because `run_validate` turns
 * them into dates with an implicit, NLS-dependent TO_DATE (bug B6).
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
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The element names XXHMC_SND_TIMECARD_SUBMIT_PR accepts as `p_hour_type_id`:
 * the meanings of lookup XXHMC_OTL_INT_ELEMENT_MAP (EBSDEV 2026-09-29), matched
 * case-insensitively. Code 25 (`Regular Hours_NL`) is left out: the views
 * exclude it, so a card submitted with it could not be read back.
 */
export const OTL_SUBMIT_ELEMENT_NAMES: readonly string[] = [
  'Absent Hours Deduction',
  'Accompaniment Leave',
  'Annual Leave',
  'Casual Leave',
  'Children Care Leave',
  'Compassionate Leave',
  'Regular Hours',
  'Regular OT',
  'Ramadan Regular OT',
  'Unpaid Working Hours',
  'Sick Leave',
  'Iddat Leave',
  'Leave without Pay',
  'Maternity Leave',
  'Muhram Leave',
  'Sick Leave Full Pay',
  'Sick Leave Half Pay',
  'Special Leave',
  'Examination Leave',
  'Haj Leave',
  'Marriage Leave',
  'Sick Leave No Pay',
  'Exceptional Leave',
  'Quarantine Days',
];

/** Upper bound for a start/end window on the table-function reads (two calendar months). */
export const OTL_MAX_RANGE_DAYS = 62;

/** The overtime elements summed into the OT metric. */
export const OTL_OVERTIME_ELEMENTS: readonly string[] = ['Regular OT', 'Ramadan Regular OT'];

interface IsoParts {
  year: number;
  month: number;
  day: number;
}

function parts(iso: string): IsoParts {
  const m = ISO_DATE.exec(iso);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `2026-07-01` -> `July 2026` (submit JSON `p_period`). */
export function submitPeriodLabel(iso: string): string {
  const { year, month } = parts(iso);
  return `${MONTHS[month - 1]} ${year}`;
}

/** `2026-07-01` -> `Jul 2026` (PERIOD of SUMMARY_V / SUMMARY_ELE_V / TIMECARD_DEATIS_V). */
export function summaryPeriodLabel(iso: string): string {
  const { year, month } = parts(iso);
  return `${MONTHS[month - 1].slice(0, 3)} ${year}`;
}

/** `2026-07-01`, `2026-07-31` -> `July 01, 2026 - July 31, 2026` (TIME_PERIOD_V.PERIOD). */
export function timePeriodLabel(startIso: string, endIso: string): string {
  const label = (iso: string) => {
    const { year, month, day } = parts(iso);
    return `${MONTHS[month - 1]} ${pad(day)}, ${year}`;
  };
  return `${label(startIso)} - ${label(endIso)}`;
}

/** `2026-07-09` -> `09-Jul-2026` (submit JSON `p_entry_date`, parsed by Oracle as DD-Mon-YYYY). */
export function entryDateLabel(iso: string): string {
  const { year, month, day } = parts(iso);
  return `${pad(day)}-${MONTHS[month - 1].slice(0, 3)}-${year}`;
}

/** First and last day of the calendar month `iso` falls in. */
export function monthWindow(iso: string): { from: string; to: string } {
  const { year, month } = parts(iso);
  return {
    from: `${year}-${pad(month)}-01`,
    to: `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`,
  };
}

/** Every date from `fromIso` to `toIso`, inclusive. */
export function datesBetween(fromIso: string, toIso: string): string[] {
  const from = parts(fromIso);
  const cursor = new Date(Date.UTC(from.year, from.month - 1, from.day));
  const dates: string[] = [];
  for (let iso = fromIso; iso <= toIso;) {
    dates.push(iso);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    iso = `${cursor.getUTCFullYear()}-${pad(cursor.getUTCMonth() + 1)}-${pad(cursor.getUTCDate())}`;
  }
  return dates;
}

/** Number of days from `fromIso` to `toIso`, inclusive (0 when reversed). */
export function dayCount(fromIso: string, toIso: string): number {
  const a = parts(fromIso);
  const b = parts(toIso);
  const diff = Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return diff < 0 ? 0 : diff / 86_400_000 + 1;
}

/** Friday or Saturday — the Qatar weekend, shown as locked in the grid. */
export function isWeekend(iso: string): boolean {
  const { year, month, day } = parts(iso);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return weekday === 5 || weekday === 6;
}

/**
 * `YYYY-MM-DD` of an Oracle DATE value. node-oracledb returns DATE columns as
 * JS Dates in the process's LOCAL time zone, so the local calendar components
 * are the Oracle date; `toISOString()` would shift it a day back under
 * TZ=Asia/Qatar.
 */
export function toIsoDate(value: unknown): string | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return undefined;
}
