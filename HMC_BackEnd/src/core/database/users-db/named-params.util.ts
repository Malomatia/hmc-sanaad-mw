/**
 * Rewrites the `@name` binds every Users-DB statement is written with into
 * the positional `?` placeholders MySQL takes, returning the values in order.
 *
 * Only names present in `params` are rewritten, so `@@VERSION` or a user
 * variable the caller did not bind is left alone, and a name used twice binds
 * twice. Quoted strings/identifiers and comments are copied verbatim — an `@`
 * inside them is text, not a bind. `undefined` binds as NULL, as it does with
 * the `mssql` driver.
 */
export function toPositional(
  statement: string,
  params: Record<string, unknown>,
): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  let sql = '';
  let i = 0;
  const n = statement.length;

  while (i < n) {
    const ch = statement[i];
    const next = statement[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      // Quoted run; backslash escapes and doubled quotes stay inside it.
      let j = i + 1;
      while (j < n) {
        if (statement[j] === '\\' && ch !== '`') j += 2;
        else if (statement[j] === ch && statement[j + 1] === ch) j += 2;
        else if (statement[j] === ch) break;
        else j++;
      }
      sql += statement.slice(i, j + 1);
      i = j + 1;
    } else if ((ch === '-' && next === '-') || ch === '#') {
      const end = statement.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      sql += statement.slice(i, stop);
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = statement.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      sql += statement.slice(i, stop);
      i = stop;
    } else if (ch === '@' && next !== '@' && statement[i - 1] !== '@') {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(statement.slice(i + 1))?.[0];
      if (name && Object.prototype.hasOwnProperty.call(params, name)) {
        const value = params[name];
        values.push(value === undefined ? null : value);
        sql += '?';
        i += name.length + 1;
      } else {
        sql += ch;
        i++;
      }
    } else {
      sql += ch;
      i++;
    }
  }
  return { sql, values };
}
