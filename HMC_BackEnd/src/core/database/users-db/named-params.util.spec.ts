import { toPositional } from './named-params.util';

describe('toPositional (@name → ? for MySQL)', () => {
  it('rewrites binds in order and repeats a name used twice', () => {
    expect(
      toPositional('SELECT 1 FROM t WHERE a = @a AND b = @b OR a2 = @a', { a: 1, b: 'x' }),
    ).toEqual({ sql: 'SELECT 1 FROM t WHERE a = ? AND b = ? OR a2 = ?', values: [1, 'x', 1] });
  });

  it('leaves text inside quotes and comments alone', () => {
    const sql = `SELECT '@a', "@a", \`@a\`, 'it''s @a', 'x\\'@a' -- @a\n/* @a */ # @a\nFROM t WHERE c = @a`;
    const out = toPositional(sql, { a: 7 });
    expect(out.values).toEqual([7]);
    expect(out.sql.endsWith('WHERE c = ?')).toBe(true);
    expect(out.sql).toContain("'@a'");
    expect(out.sql).toContain('/* @a */');
  });

  it('keeps unbound names, system variables and lookalike prefixes untouched', () => {
    expect(toPositional('SELECT @@version, @unbound, @ab FROM t WHERE x = @a', { a: 1 })).toEqual({
      sql: 'SELECT @@version, @unbound, @ab FROM t WHERE x = ?',
      values: [1],
    });
  });

  it('binds undefined as NULL, like the mssql driver', () => {
    expect(toPositional('UPDATE t SET a = @a', { a: undefined }).values).toEqual([null]);
  });

  it('passes a statement without binds through unchanged', () => {
    expect(toPositional('SELECT 1 AS ok', {})).toEqual({ sql: 'SELECT 1 AS ok', values: [] });
  });
});
