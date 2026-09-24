import { FirebaseServiceAccount } from '@core/config/configuration';

const decodeIntegrityToken = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    playintegrity: () => ({ v1: { decodeIntegrityToken } }),
    auth: { GoogleAuth: class {} },
  },
}));

import {
  DisabledAndroidIntegrity,
  GooglePlayIntegrityAdapter,
} from './google-play-integrity.adapter';

const PACKAGE = 'qa.gov.hmc.sanaad';

const account = {
  client_email: 'play@example.iam.gserviceaccount.com',
  private_key: 'key',
} as FirebaseServiceAccount;

const payload = (over: Record<string, unknown> = {}) => ({
  data: {
    tokenPayloadExternal: {
      appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: PACKAGE },
      deviceIntegrity: { deviceRecognitionVerdict: ['MEETS_DEVICE_INTEGRITY'] },
      accountDetails: { appLicensingVerdict: 'LICENSED' },
      requestDetails: { requestHash: 'a'.repeat(64) },
      ...over,
    },
  },
});

describe('GooglePlayIntegrityAdapter', () => {
  const adapter = new GooglePlayIntegrityAdapter(PACKAGE, account);

  beforeEach(() => decodeIntegrityToken.mockReset());

  it('accepts a token whose verdicts and request hash all match', async () => {
    decodeIntegrityToken.mockResolvedValue(payload());

    await expect(adapter.verifyToken('tok', 'a'.repeat(64))).resolves.toMatchObject({
      ok: true,
      platform: 'android',
    });
  });

  it('refuses a token minted for another app — it is still a valid Google token', async () => {
    decodeIntegrityToken.mockResolvedValue(
      payload({
        appIntegrity: { appRecognitionVerdict: 'PLAY_RECOGNIZED', packageName: 'com.attacker.app' },
      }),
    );

    await expect(adapter.verifyToken('tok')).resolves.toMatchObject({
      ok: false,
      reason: 'token belongs to com.attacker.app',
    });
  });

  it('refuses a sideloaded build and an untrusted device', async () => {
    decodeIntegrityToken.mockResolvedValue(
      payload({
        appIntegrity: { appRecognitionVerdict: 'UNRECOGNIZED_VERSION', packageName: PACKAGE },
      }),
    );
    await expect(adapter.verifyToken('tok')).resolves.toMatchObject({
      ok: false,
      reason: 'app verdict UNRECOGNIZED_VERSION',
    });

    decodeIntegrityToken.mockResolvedValue(payload({ deviceIntegrity: {} }));
    await expect(adapter.verifyToken('tok')).resolves.toMatchObject({
      ok: false,
      reason: 'device verdict none',
    });
  });

  it('refuses a token lifted onto a different body', async () => {
    decodeIntegrityToken.mockResolvedValue(payload());

    await expect(adapter.verifyToken('tok', 'b'.repeat(64))).resolves.toMatchObject({
      ok: false,
      reason: 'requestHash does not match the request body',
    });
  });

  it('reports a Google-side failure as a failed verdict, not a thrown error', async () => {
    decodeIntegrityToken.mockRejectedValue(new Error('permission denied'));

    await expect(adapter.verifyToken('tok')).resolves.toMatchObject({
      ok: false,
      reason: 'permission denied',
    });
  });
});

describe('DisabledAndroidIntegrity', () => {
  it('fails closed instead of pretending the platform passed', async () => {
    const stub = new DisabledAndroidIntegrity();

    expect(stub.enabled).toBe(false);
    await expect(stub.verifyToken()).resolves.toEqual({
      ok: false,
      platform: 'android',
      reason: 'Play Integrity is not configured',
    });
  });
});
