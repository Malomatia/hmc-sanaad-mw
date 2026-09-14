import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import configuration, { FirebaseConfig } from './configuration';

/**
 * The service account is a PRIVATE KEY, so it is never in the repository: it
 * arrives inline (containers) or as a file on the host, the same choice
 * LDAP_CA_CERT already offers.
 *
 * A missing or malformed credential must leave push DISABLED and the rest of
 * the API booting normally — a notification is an accessory, and refusing to
 * start over one would take down every endpoint.
 */
describe('Firebase service account configuration', () => {
  const KEY = {
    type: 'service_account',
    project_id: 'sanaadprd',
    client_email: 'firebase-adminsdk@sanaadprd.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\\nAAAA\\n-----END PRIVATE KEY-----\\n',
  };

  const ENV_KEYS = ['FIREBASE_SERVICE_ACCOUNT', 'FIREBASE_SERVICE_ACCOUNT_PATH'];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const firebase = (): FirebaseConfig => configuration().firebase;

  it('is disabled when nothing is configured', () => {
    expect(firebase().enabled).toBe(false);
    expect(firebase().serviceAccount).toBeUndefined();
  });

  it('reads raw JSON from the environment', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(KEY);

    const config = firebase();

    expect(config.enabled).toBe(true);
    expect(config.projectId).toBe('sanaadprd');
  });

  it('reads it base64-encoded, so it survives being a single-line variable', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = Buffer.from(JSON.stringify(KEY)).toString('base64');

    expect(firebase().projectId).toBe('sanaadprd');
  });

  it('restores the real newlines an env var cannot carry', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(KEY);

    // escaped in the variable, actual line breaks by the time the SDK sees it
    expect(firebase().serviceAccount?.private_key).toContain('\n');
    expect(firebase().serviceAccount?.private_key).not.toContain('\\n');
  });

  it('reads it from a file path', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-')), 'key.json');
    fs.writeFileSync(file, JSON.stringify(KEY));
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = file;

    expect(firebase().projectId).toBe('sanaadprd');
  });

  it('prefers the inline value when both are set', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-')), 'key.json');
    fs.writeFileSync(file, JSON.stringify({ ...KEY, project_id: 'from-file' }));
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = file;
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify(KEY);

    expect(firebase().projectId).toBe('sanaadprd');
  });

  it('stays disabled — rather than throwing — on malformed JSON', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = '{ not json';

    expect(() => firebase()).not.toThrow();
    expect(firebase().enabled).toBe(false);
  });

  it('stays disabled when the key is missing a required field', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'sanaadprd' });

    expect(firebase().enabled).toBe(false);
  });

  it('stays disabled when the file does not exist', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH = path.join(os.tmpdir(), 'no-such-key.json');

    expect(() => firebase()).not.toThrow();
    expect(firebase().enabled).toBe(false);
  });
});
