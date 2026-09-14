import { Lang } from '@shared/domain/lang';
import { safeDecodeUri } from './url-decode.util';

/**
 * Collapses English/Arabic column twins into a single localized field.
 *
 * Oracle views expose bilingual pairs under several spellings — `MEANING` /
 * `MEANING_AR`, `meaningAr`, `VALUEAR` — and every read endpoint accepts
 * `lang=en|ar`. Instead of returning both values, the response carries only
 * the base field: for `lang=ar` it holds the Arabic value (URL-decoded, with
 * the English text as fallback when the Arabic twin is empty — same rule the
 * ResponseInterceptor already applies to SubmitResult messages), and the `*Ar`
 * twin is removed for both languages.
 *
 * A key is only treated as an Arabic twin when the matching base key exists in
 * the same object (case-insensitive), so words that merely end in "ar"
 * (`calendar`, `YEAR`) are never collapsed.
 *
 * Exception: base keys in PRESERVED_TWIN_BASES are never collapsed — the
 * response carries BOTH the base and the `*Ar` twin regardless of `lang`
 * (client request: address types in /profile must always ship both).
 */

/** Base keys (lowercased) whose Arabic twins are kept as-is for every lang. */
const PRESERVED_TWIN_BASES = new Set(['addresstype', 'address_type']);
export function localizeArTwins<T>(value: T, lang: Lang): T {
  if (Array.isArray(value)) return value.map((v) => localizeArTwins(v, lang)) as unknown as T;
  if (!isPlainObject(value)) return value;

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  const arKeyByBase = new Map<string, string>();
  for (const key of keys) {
    const base = baseKeyFor(key, keys);
    if (base !== undefined && !PRESERVED_TWIN_BASES.has(base.toLowerCase())) {
      arKeyByBase.set(base, key);
    }
  }
  const arKeys = new Set(arKeyByBase.values());

  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (arKeys.has(key)) continue;
    let val = obj[key];
    const arKey = arKeyByBase.get(key);
    if (lang === 'ar' && arKey !== undefined) {
      const arVal = obj[arKey];
      if (arVal !== null && arVal !== undefined && arVal !== '') {
        val = safeDecodeUri(arVal) ?? arVal;
      }
    }
    out[key] = localizeArTwins(val, lang);
  }
  return out as T;
}

/** The base (English) key an Arabic-twin key shadows, or undefined. */
function baseKeyFor(key: string, keys: string[]): string | undefined {
  let stem: string | undefined;
  if (/._ar$/i.test(key))
    stem = key.slice(0, -3); // MEANING_AR / meaning_ar
  else if (/[a-z0-9]Ar$/.test(key))
    stem = key.slice(0, -2); // meaningAr
  else if (/[A-Z0-9]AR$/.test(key)) stem = key.slice(0, -2); // VALUEAR / DATAAR
  if (stem === undefined || stem === '') return undefined;
  const lower = stem.toLowerCase();
  return keys.find((k) => k !== key && k.toLowerCase() === lower);
}

/** Recurse only into plain data objects — never Dates, Buffers or class instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}
