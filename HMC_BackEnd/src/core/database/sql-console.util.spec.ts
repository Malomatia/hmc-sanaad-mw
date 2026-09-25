import { BadRequestException } from '@nestjs/common';
import {
  assertMysqlReadOnlySelect,
  assertOracleReadOnlySelect,
  assertReadOnlySelect,
} from './sql-console.util';

describe('assertReadOnlySelect', () => {
  const ok = (sql: string) => expect(assertReadOnlySelect(sql)).toBe(sql.trim());
  const rejected = (sql: string) =>
    expect(() => assertReadOnlySelect(sql)).toThrow(BadRequestException);

  it('accepts a plain SELECT', () => {
    ok('SELECT TOP 10 * FROM HMC_Sanad_DeviceRegn_tbl WHERE LoginID = @login');
  });

  it('accepts a CTE (WITH … SELECT)', () => {
    ok('WITH latest AS (SELECT MAX(SeqNo) AS s FROM HMC_RHAP_OTP_tbl) SELECT * FROM latest');
  });

  it('accepts a trailing semicolon and surrounding whitespace', () => {
    ok('  SELECT 1 AS ok;  ');
  });

  it('ignores DML keywords inside string literals', () => {
    ok("SELECT * FROM t WHERE remark = 'please delete this' AND x = 'drop it'");
  });

  it('ignores DML keywords inside quoted identifiers', () => {
    ok('SELECT [update], "delete" FROM t');
  });

  it('ignores DML keywords inside comments', () => {
    ok('SELECT 1 -- update nothing\n/* delete /* nested */ still comment */ FROM t');
  });

  it('rejects empty input', () => rejected('   '));

  it('rejects non-SELECT statements', () => {
    rejected('UPDATE t SET a = 1');
    rejected('DELETE FROM t');
    rejected('INSERT INTO t VALUES (1)');
    rejected('TRUNCATE TABLE t');
    rejected('DROP TABLE t');
    rejected('EXEC sp_who');
  });

  it('rejects multiple statements', () => {
    rejected('SELECT 1; SELECT 2');
    rejected('SELECT 1; DELETE FROM t');
  });

  it('rejects DML hidden after a line comment newline', () => {
    rejected('SELECT 1 -- comment\n; DROP TABLE t');
  });

  it('rejects SELECT INTO (writes a table)', () => {
    rejected('SELECT * INTO t2 FROM t1');
  });

  it('rejects system procedures and remote-access functions', () => {
    rejected("SELECT * FROM OPENROWSET('SQLNCLI', 'x', 'SELECT 1')");
    rejected('SELECT 1 WHERE 1 = xp_cmdshell');
  });

  it('rejects WAITFOR (DoS vector)', () => {
    rejected("SELECT 1; WAITFOR DELAY '00:10:00'");
    rejected("WAITFOR DELAY '00:10:00'");
  });

  it('does not false-positive on column names containing keywords', () => {
    ok('SELECT updated_at, created_by, execution_count FROM t');
  });

  it('rejects unterminated literals and comments', () => {
    rejected("SELECT 'unterminated");
    rejected('SELECT 1 /* unterminated');
    rejected('SELECT [unterminated FROM t');
  });
});

describe('assertOracleReadOnlySelect', () => {
  const ok = (sql: string) => expect(assertOracleReadOnlySelect(sql)).toBe(sql.trim());
  const rejected = (sql: string) =>
    expect(() => assertOracleReadOnlySelect(sql)).toThrow(BadRequestException);

  it('accepts a SELECT with Oracle named binds', () => {
    ok('SELECT * FROM XXHMC_SND_LEAVE_CANCEL_V WHERE PERSON_ID = :pid');
  });

  it('rejects FOR UPDATE (row locks are not read-only)', () => {
    rejected('SELECT * FROM XXHMC_SND_ABSENCE_V WHERE user_name = :u FOR UPDATE');
    rejected('SELECT * FROM XXHMC_SND_ABSENCE_V for   update NOWAIT');
  });

  it("does not false-positive on 'for update' inside a string literal", () => {
    ok("SELECT * FROM XXHMC_SND_ABSENCE_V WHERE note = 'pending for update'");
  });

  it('still rejects DML like the shared check', () => {
    rejected('DELETE FROM XXHMC_SND_ABSENCE_V');
    rejected('SELECT * FROM t; DROP TABLE t');
  });
});

describe('assertMysqlReadOnlySelect', () => {
  const ok = (sql: string) => expect(assertMysqlReadOnlySelect(sql)).toBe(sql.trim());
  const rejected = (sql: string) =>
    expect(() => assertMysqlReadOnlySelect(sql)).toThrow(BadRequestException);

  it('accepts a plain SELECT with @ binds and LIMIT', () => {
    ok('SELECT * FROM HMC_RHAP_OTP_tbl WHERE LoginID = @u ORDER BY SeqNo DESC LIMIT 5');
  });

  it('rejects a backslash escape that would end a string where T-SQL lexing does not', () => {
    rejected("SELECT '\\'' INTO OUTFILE '/tmp/x' -- '");
  });

  it('rejects executable /*! */ comments, which MySQL runs', () => {
    rejected("SELECT 1 /*! INTO OUTFILE '/tmp/x' */");
  });

  it.each([
    'SELECT * FROM t FOR UPDATE',
    'SELECT * FROM t FOR SHARE',
    'SELECT * FROM t LOCK IN SHARE MODE',
    'SELECT SLEEP(100)',
    'SELECT BENCHMARK(1000000, MD5(1))',
    "SELECT LOAD_FILE('/etc/passwd')",
    "SELECT GET_LOCK('x', 10)",
  ])('rejects %s', (sql) => rejected(sql));

  it("does not false-positive on 'sleep(' inside a string literal", () => {
    ok("SELECT * FROM t WHERE note = 'sleep(5)'");
  });

  it('still rejects DML and INTO like the shared check', () => {
    rejected('DELETE FROM HMC_Sanad_DeviceToken_tbl');
    rejected("SELECT * FROM t INTO OUTFILE '/tmp/x'");
  });
});
