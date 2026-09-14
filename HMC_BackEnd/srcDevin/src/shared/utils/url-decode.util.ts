/**
 * Arabic values in Oracle output are URL-encoded in the mapping samples.
 * Decode them at the infrastructure mapper boundary (Anticorruption Layer)
 * so domain/DTOs never see encoded text.
 */
export function safeDecodeUri(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value);
  if (str.length === 0) return str;
  try {
    // Only attempt decode when it looks percent-encoded to avoid throwing on '%'.
    return /%[0-9a-fA-F]{2}/.test(str) ? decodeURIComponent(str) : str;
  } catch {
    return str;
  }
}

/** Decode HTML entities left in some source URLs/values (e.g. `&amp;`, `&lt;`). */
export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
