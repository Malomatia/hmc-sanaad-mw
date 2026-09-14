import { BadRequestException } from '@nestjs/common';

/**
 * Guard for the ad-hoc Users-DB SQL console (POST /diagnostics/users-db/sql):
 * accepts exactly one read-only SELECT (or WITH … SELECT) statement and
 * rejects everything else BEFORE it reaches the driver.
 *
 * The check runs on a sanitized copy of the text where string literals
 * ('…'), quoted identifiers ([…] / "…") and comments (-- / nested block
 * comments) are blanked out, so a literal like 'delete me' never false-
 * positives and DML can never hide inside a comment or bracketed name.
 */

/** Statements/keywords that make a query non-read-only or multi-effect. */
const FORBIDDEN_KEYWORDS =
  /\b(insert|update|delete|merge|exec|execute|drop|alter|create|truncate|grant|revoke|deny|backup|restore|shutdown|kill|reconfigure|waitfor|openrowset|openquery|opendatasource|dbcc|bulk|into)\b|\b(?:xp|sp)_\w+/i;

/** Blank string literals, quoted identifiers and comments (keeps length/newlines out; content replaced by spaces). */
export function sanitizeSqlForInspection(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "'") {
      // string literal — '' is an escaped quote inside it
      i++;
      while (i < n && !(text[i] === "'" && text[i + 1] !== "'")) i += text[i] === "'" ? 2 : 1;
      if (i >= n) throw new BadRequestException('Unterminated string literal.');
      i++;
      out += ' ';
    } else if (ch === '[' || ch === '"') {
      const close = ch === '[' ? ']' : '"';
      const end = text.indexOf(close, i + 1);
      if (end === -1) throw new BadRequestException(`Unterminated ${ch}identifier quote.`);
      i = end + 1;
      out += ' ';
    } else if (ch === '-' && next === '-') {
      while (i < n && text[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      // T-SQL block comments nest
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === '/' && text[i + 1] === '*') {
          depth++;
          i += 2;
        } else if (text[i] === '*' && text[i + 1] === '/') {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth > 0) throw new BadRequestException('Unterminated block comment.');
      out += ' ';
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/**
 * Oracle flavor of `assertReadOnlySelect` (POST /diagnostics/oracle/sql):
 * same single-SELECT/CTE rule plus Oracle-specific rejections — `FOR UPDATE`
 * takes row locks (not read-only) and doesn't exist in T-SQL, so the shared
 * denylist doesn't cover it.
 */
export function assertOracleReadOnlySelect(text: string): string {
  const original = assertReadOnlySelect(text);
  const sanitized = sanitizeSqlForInspection(original);
  if (/\bfor\s+update\b/i.test(sanitized)) {
    throw new BadRequestException(
      'FOR UPDATE takes row locks — the console is read-only SELECT.',
    );
  }
  return original;
}

/**
 * Throws BadRequestException unless `text` is a single read-only SELECT/CTE.
 * Returns the original text (trimmed) for execution when it passes.
 */
export function assertReadOnlySelect(text: string): string {
  const original = text.trim();
  if (!original) throw new BadRequestException('sql must not be empty.');

  const sanitized = sanitizeSqlForInspection(original)
    .trim()
    .replace(/;+\s*$/, '');
  if (sanitized.includes(';')) {
    throw new BadRequestException('Only a single statement is allowed.');
  }
  if (!/^(select|with)\b/i.test(sanitized)) {
    throw new BadRequestException('Only SELECT (or WITH … SELECT) statements are allowed.');
  }
  const forbidden = FORBIDDEN_KEYWORDS.exec(sanitized);
  if (forbidden) {
    throw new BadRequestException(
      `Statement contains the forbidden keyword "${forbidden[0].toUpperCase()}" — the console is read-only SELECT.`,
    );
  }
  return original;
}
