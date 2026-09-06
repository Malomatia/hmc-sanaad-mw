import { AppIntegrityController } from './app-integrity.controller';
import { AppIntegrityService } from '../application/app-integrity.service';

/**
 * A development aid, not the enforcement path — the guard checks the header on
 * the real request, and calling this first would make every action two round
 * trips.
 *
 * It exists because attestation ships in `off` mode: an app can send a
 * completely invalid token and nothing will say so until the day enforcement
 * is switched on and everything fails at once. So unlike the guard, this one
 * REPORTS why, which is the entire reason to have it.
 */
describe('POST /app-integrity/android/verify', () => {
  function make(verdict: Record<string, unknown>) {
    const service = {
      verifyAndroidToken: jest.fn().mockResolvedValue(verdict),
    } as unknown as jest.Mocked<AppIntegrityService>;
    return { controller: new AppIntegrityController(service), service };
  }

  const VERDICTS = {
    appRecognitionVerdict: 'PLAY_RECOGNIZED',
    deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'],
    appLicensingVerdict: 'LICENSED',
    packageName: 'com.hmc.sanaad',
  };

  it('reports a good token with the verdicts behind it', async () => {
    const { controller } = make({ ok: true, platform: 'android', details: VERDICTS });

    await expect(controller.verifyAndroid({ integrityToken: 'tok' })).resolves.toEqual({
      verified: true,
      verdicts: VERDICTS,
    });
  });

  it('says WHY a token failed — the point of the endpoint', async () => {
    const { controller } = make({
      ok: false,
      platform: 'android',
      reason: 'app verdict UNRECOGNIZED_VERSION',
      details: { ...VERDICTS, appRecognitionVerdict: 'UNRECOGNIZED_VERSION' },
    });

    const result = await controller.verifyAndroid({ integrityToken: 'tok' });

    expect(result).toMatchObject({
      verified: false,
      reason: 'app verdict UNRECOGNIZED_VERSION',
    });
  });

  it('passes the request hash through, so that half can be checked too', async () => {
    const { controller, service } = make({ ok: true, platform: 'android' });

    await controller.verifyAndroid({ integrityToken: 'tok', requestHash: 'abc123' });

    expect(service.verifyAndroidToken).toHaveBeenCalledWith('tok', 'abc123');
  });

  it('omits absent fields instead of returning nulls', async () => {
    const { controller } = make({ ok: true, platform: 'android' });

    await expect(controller.verifyAndroid({ integrityToken: 'tok' })).resolves.toEqual({
      verified: true,
    });
  });

  it('reports that the platform is unconfigured rather than pretending it passed', async () => {
    const { controller } = make({
      ok: false,
      platform: 'android',
      reason: 'Play Integrity is not configured',
    });

    await expect(controller.verifyAndroid({ integrityToken: 'tok' })).resolves.toMatchObject({
      verified: false,
      reason: 'Play Integrity is not configured',
    });
  });
});
