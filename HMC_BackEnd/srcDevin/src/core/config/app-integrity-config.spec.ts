import * as fs from 'node:fs';
import * as path from 'node:path';
import configuration, { AppIntegrityConfig } from './configuration';

/**
 * Two layers supply defaults for these variables: `docker-compose.yml` via
 * `${VAR:-default}`, and this file when the variable is absent entirely. When
 * they disagree, attestation works under compose and silently does not
 * anywhere else — Kubernetes, systemd, a bare `node dist/main.js` — because
 * `ios.enabled` needs a bundle id and an empty one reads as "not configured".
 *
 * These cases pin the safe defaults and assert the two layers still agree.
 */
describe('device attestation configuration', () => {
  const KEYS = [
    'APP_INTEGRITY_MODE',
    'APPLE_TEAM_ID',
    'APPLE_BUNDLE_ID',
    'APPLE_APP_ATTEST_ALLOW_DEVELOPMENT',
    'ANDROID_PACKAGE_NAME',
    'PLAY_INTEGRITY_SERVICE_ACCOUNT',
    'PLAY_INTEGRITY_SERVICE_ACCOUNT_PATH',
    'APP_INTEGRITY_CHALLENGE_TTL_MS',
  ];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const cfg = (): AppIntegrityConfig => configuration().appIntegrity;

  describe('defaults', () => {
    it('is off, so a deployment that sets nothing checks nothing', () => {
      expect(cfg().mode).toBe('off');
    });

    it('refuses development attestations, which is what separates a real device from a debug build', () => {
      expect(cfg().ios.allowDevelopment).toBe(false);
    });

    it('carries the app identity rather than an empty string', () => {
      // An empty bundle id would disable iOS attestation without saying so.
      expect(cfg().ios.bundleId).toBe('com.hmc.sanaad');
      expect(cfg().android.packageName).toBe('com.hmc.sanaad');
    });

    it('reports each platform as unconfigured until its credential arrives', () => {
      expect(cfg().ios.enabled).toBe(false); // no team id
      expect(cfg().android.enabled).toBe(false); // no service account
    });

    it('gives a challenge five minutes', () => {
      expect(cfg().challengeTtlMs).toBe(300000);
    });
  });

  describe('mode parsing', () => {
    it.each(['observe', 'enforce', 'OBSERVE'])('accepts %s', (mode) => {
      process.env.APP_INTEGRITY_MODE = mode;

      expect(cfg().mode).toBe(mode.toLowerCase());
    });

    it('falls back to off on a typo rather than enforcing by accident', () => {
      process.env.APP_INTEGRITY_MODE = 'enfoce';

      expect(cfg().mode).toBe('off');
    });
  });

  it('enables iOS once a team id is supplied — no Apple secret is involved', () => {
    process.env.APPLE_TEAM_ID = 'ABCDE12345';

    expect(cfg().ios.enabled).toBe(true);
  });

  /**
   * The reason this file exists. If compose and the code ever default the same
   * variable differently, one of the two deployment paths breaks quietly.
   */
  it('agrees with the defaults in docker-compose.yml', () => {
    const compose = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'docker-compose.yml'),
      'utf8',
    );
    const defaultOf = (key: string): string | undefined =>
      new RegExp(`${key}: "\\$\\{${key}:-([^}]*)\\}"`).exec(compose)?.[1];

    expect(defaultOf('APPLE_BUNDLE_ID')).toBe(cfg().ios.bundleId);
    expect(defaultOf('ANDROID_PACKAGE_NAME')).toBe(cfg().android.packageName);
    expect(defaultOf('APP_INTEGRITY_MODE')).toBe(cfg().mode);
    expect(defaultOf('APPLE_APP_ATTEST_ALLOW_DEVELOPMENT')).toBe(
      String(cfg().ios.allowDevelopment),
    );
    expect(defaultOf('APP_INTEGRITY_CHALLENGE_TTL_MS')).toBe(String(cfg().challengeTtlMs));
  });
});
