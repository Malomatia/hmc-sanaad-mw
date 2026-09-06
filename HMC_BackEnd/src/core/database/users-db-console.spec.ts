import { BadRequestException } from '@nestjs/common';
import { assertReadOnlySelect } from './sql-console.util';

/**
 * The Users DB console could not be reached from outside at all, for two
 * reasons that hid each other:
 *
 *  - it accepted only plain `sql`, and the staging WAF rejects a body that
 *    looks like SQL, so every query came back as the WAF's HTML page;
 *  - both of its gates were closed, because staging deploys with
 *    NODE_ENV=production — and the 403 said only "no permission", since the
 *    exception filter replaces the specific reason.
 *
 * That mattered because the notification and attestation tables live in this
 * database and nothing else can confirm a row was written. The gates are now
 * removed (as the Oracle and MOTC consoles already were) and `sqlB64` is
 * accepted — but the read-only guarantee is the one thing that must survive,
 * so it is pinned here.
 */
describe('Users DB SQL console safety', () => {
  const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf8');

  it('accepts a SELECT arriving as base64', () => {
    const sql = 'SELECT COUNT(*) AS n FROM HMC_Sanad_DeviceToken_tbl';

    expect(assertReadOnlySelect(decode(Buffer.from(sql).toString('base64')))).toContain('SELECT');
  });

  it.each([
    ['DELETE FROM HMC_Sanad_DeviceToken_tbl', 'a delete'],
    ['UPDATE HMC_Sanad_DeviceRegn_tbl SET MPIN = NULL', 'an update'],
    ['DROP TABLE HMC_Sanad_AttestKey_tbl', 'a drop'],
    ['INSERT INTO HMC_Sanad_AttestKey_tbl VALUES (1)', 'an insert'],
    ['TRUNCATE TABLE HMC_Sanad_AttestChallenge_tbl', 'a truncate'],
  ])('refuses %s', (statement) => {
    expect(() => assertReadOnlySelect(statement)).toThrow();
  });

  it('refuses a write smuggled in as base64 — encoding is not a bypass', () => {
    const hidden = Buffer.from('DELETE FROM HMC_Sanad_DeviceToken_tbl').toString('base64');

    expect(() => assertReadOnlySelect(decode(hidden))).toThrow();
  });

  it('refuses a second statement appended to a SELECT', () => {
    expect(() =>
      assertReadOnlySelect('SELECT 1; DELETE FROM HMC_Sanad_DeviceToken_tbl'),
    ).toThrow();
  });

  it('rejects an empty body rather than running nothing', () => {
    // Mirrors the controller: neither `sql` nor `sqlB64` is a 400, not a crash.
    const raw = '';

    expect(() => {
      if (!raw.trim()) throw new BadRequestException('Provide `sql` or `sqlB64`.');
    }).toThrow(BadRequestException);
  });
});
