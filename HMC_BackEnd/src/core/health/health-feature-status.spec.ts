import { ConfigService } from '@nestjs/config';
import type { App } from 'firebase-admin/app';
import { HealthController } from './health.controller';
import { OracleService } from '../database/oracle.service';
import { MssqlService } from '../database/mssql.service';
import { MotcSmsDbService } from '../database/motc-sms-db.service';
import { AppIntegrityConfig } from '../config/configuration';

/**
 * Push and attestation both degrade silently on purpose: an unconfigured
 * credential binds a no-op sender or a refusing stub rather than stopping the
 * boot. That is right for availability and useless for operations - a
 * deployment that can send and one that cannot answered identically from
 * outside, and the only tell was a line in the boot log.
 *
 * Three separate attempts to answer "is FIREBASE_SERVICE_ACCOUNT set?" failed
 * before this went in. /health now says so.
 */
describe('/health reporting the feature credentials', () => {
  const db = (ok: boolean) =>
    ({
      isEnabled: () => ok,
      isConfigured: () => ok,
      ping: async () => ok,
    }) as unknown as OracleService & MssqlService & MotcSmsDbService;

  function make(firebase: App | undefined, integrity: Partial<AppIntegrityConfig> = {}) {
    const config = {
      get: () => ({
        mode: 'off',
        ios: { enabled: false },
        android: { enabled: false },
        ...integrity,
      }),
    } as unknown as ConfigService;
    return new HealthController(db(true), db(true), db(true), config, firebase);
  }

  const APP = { options: { projectId: 'sanaadprd' } } as App;

  it('reports push as enabled, with the project it will send from', async () => {
    const body = await make(APP).check();

    expect(body.push).toEqual({ enabled: true, projectId: 'sanaadprd', status: 'ok' });
  });

  it('reports push as disabled when no credential was resolved', async () => {
    const body = await make(undefined).check();

    expect(body.push).toEqual({ enabled: false, projectId: null, status: 'disabled' });
  });

  it('reports the attestation mode and each platform separately', async () => {
    const body = await make(APP, {
      mode: 'observe',
      ios: { enabled: true } as AppIntegrityConfig['ios'],
      android: { enabled: false } as AppIntegrityConfig['android'],
    }).check();

    expect(body.appIntegrity).toEqual({ mode: 'observe', ios: 'ok', android: 'disabled' });
  });

  it('defaults attestation to off when nothing is configured at all', async () => {
    const controller = new HealthController(
      db(true),
      db(true),
      db(true),
      { get: () => undefined } as unknown as ConfigService,
      undefined,
    );

    expect((await controller.check()).appIntegrity).toEqual({
      mode: 'off',
      ios: 'disabled',
      android: 'disabled',
    });
  });

  it('still reports the databases, so nothing was traded away for this', async () => {
    const body = await make(APP).check();

    expect(body.oracle.status).toBe('ok');
    expect(body.usersDb.status).toBe('ok');
    expect(body.motcSmsDb.status).toBe('ok');
  });
});
