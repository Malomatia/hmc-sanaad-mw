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

  function make(
    firebase: App | undefined,
    integrity: Partial<AppIntegrityConfig> = {},
    supplied: { credentialProvided: boolean; credentialLength: number } = {
      credentialProvided: false,
      credentialLength: 0,
    },
  ) {
    const config = {
      get: (key: string) =>
        key === 'firebase'
          ? supplied
          : { mode: 'off', ios: { enabled: false }, android: { enabled: false }, ...integrity },
    } as unknown as ConfigService;
    return new HealthController(db(true), db(true), db(true), config, firebase);
  }

  const APP = { options: { projectId: 'sanaadprd' } } as App;

  it('reports push as enabled, with the project it will send from', async () => {
    const body = await make(APP, {}, { credentialProvided: true, credentialLength: 3156 }).check();

    expect(body.push).toMatchObject({ enabled: true, projectId: 'sanaadprd', status: 'ok' });
  });

  it('reports disabled when nothing was supplied at all', async () => {
    const body = await make(undefined).check();

    expect(body.push).toMatchObject({
      enabled: false,
      credentialProvided: false,
      status: 'disabled',
    });
  });

  it('reports REJECTED when a credential was supplied and could not be used', async () => {
    // The state that wastes a day: DevOps did set it, and it arrived
    // truncated or quoted. `disabled` would send everyone hunting the wrong
    // problem, so the length of what actually arrived comes back too.
    const body = await make(undefined, {}, {
      credentialProvided: true,
      credentialLength: 1200,
    }).check();

    expect(body.push).toMatchObject({
      enabled: false,
      credentialProvided: true,
      credentialLength: 1200,
      status: 'rejected',
    });
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

  it('probes configured Oracle even when startup did not create its pool', async () => {
    const oracle = db(false) as OracleService;
    oracle.isConfigured = () => true;
    oracle.ping = jest.fn().mockResolvedValue(true);
    const controller = new HealthController(oracle, db(false), db(false), {
      get: () => undefined,
    } as unknown as ConfigService);

    expect((await controller.check()).oracle).toEqual({
      enabled: true,
      reachable: true,
      status: 'ok',
    });
    expect(oracle.ping).toHaveBeenCalledTimes(1);
  });

  it('still reports the databases, so nothing was traded away for this', async () => {
    const body = await make(APP).check();

    expect(body.oracle.status).toBe('ok');
    expect(body.usersDb.status).toBe('ok');
    expect(body.motcSmsDb.status).toBe('ok');
  });
});
