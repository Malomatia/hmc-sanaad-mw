/**
 * Shared sanitization for anything that might end up in the API log: request
 * bodies, headers, response previews. Two independent concerns:
 *  - `maskSensitive`  → replace known-sensitive field VALUES with '******'.
 *  - `truncatePreview` → bound the overall size (deep, arrays capped) so a huge
 *    payload never balloons the log store / log file.
 */

/** Field names whose values must never be persisted verbatim. */
const SENSITIVE_KEY_PATTERN =
  /(password|confirmpassword|token|accesstoken|refreshtoken|authorization|api[-_]?key|secret|clientsecret|creditcard|cvv|otp|mpin)/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Deep-mask sensitive field values by key name. Non-destructive (returns a copy). */
export function maskSensitive<T>(value: T): T {
  return maskInternal(value) as T;
}

function maskInternal(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(maskInternal);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? '******' : maskInternal(v);
    }
    return out;
  }
  return value;
}

const DEFAULT_MAX_STRING = 500;
const DEFAULT_MAX_ARRAY = 20;

/**
 * Bound the size of an already-masked value: long strings truncated, arrays
 * capped with a "N more" marker. Keeps individual log entries small regardless
 * of how large a request/response payload actually was.
 */
export function truncatePreview(
  value: unknown,
  maxString = DEFAULT_MAX_STRING,
  maxArray = DEFAULT_MAX_ARRAY,
): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > maxString ? `${value.slice(0, maxString)}…` : value;
  }
  if (Array.isArray(value)) {
    const shown = value.slice(0, maxArray).map((v) => truncatePreview(v, maxString, maxArray));
    const omitted = value.length - shown.length;
    return omitted > 0 ? [...shown, `…(${omitted} more item(s) not shown)`] : shown;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncatePreview(v, maxString, maxArray);
    }
    return out;
  }
  return value;
}

/** mask + truncate in one call — the shape most call sites want. */
export function safePreview(value: unknown): unknown {
  if (value === undefined) return undefined;
  return truncatePreview(maskSensitive(value));
}

/** Best-effort {file, function} of the topmost application frame of a stack trace. */
export function topStackFrame(stack?: string): { file?: string; functionName?: string } {
  if (!stack) return {};
  const line = stack
    .split('\n')
    .slice(1)
    .find((l) => l.trim().startsWith('at '));
  if (!line) return {};
  // "at ClassName.method (C:\path\file.ts:12:34)" or "at C:\path\file.ts:12:34"
  const match = /at\s+(?:([\w.$<>]+)\s+\()?([^()]+):\d+:\d+\)?/.exec(line.trim());
  if (!match) return {};
  return { functionName: match[1], file: match[2] };
}
