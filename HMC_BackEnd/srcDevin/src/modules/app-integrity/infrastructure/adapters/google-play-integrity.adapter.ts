import { Injectable, Logger } from '@nestjs/common';
import { google, playintegrity_v1 } from 'googleapis';
import { AppIntegrityConfig, FirebaseServiceAccount } from '@core/config/configuration';
import { IntegrityVerdict } from '../../domain/attestation';
import { AndroidIntegrityPort } from '../../domain/ports/integrity.ports';

/** Verdicts Google returns that mean the app and device are trustworthy. */
const GENUINE_APP = 'PLAY_RECOGNIZED';
const TRUSTED_DEVICE = new Set(['MEETS_DEVICE_INTEGRITY', 'MEETS_STRONG_INTEGRITY']);
const LICENSED = 'LICENSED';

/**
 * Google Play Integrity.
 *
 * The API is `decodeIntegrityToken`, and it needs a service account holding
 * the `playintegrity` scope — NOT the Firebase credential. Decoding is a
 * separate Google API with its own authorization, and reusing the Firebase key
 * fails with a permission error rather than anything descriptive.
 */
@Injectable()
export class GooglePlayIntegrityAdapter implements AndroidIntegrityPort {
  private static readonly log = new Logger(GooglePlayIntegrityAdapter.name);
  private readonly api: playintegrity_v1.Playintegrity;

  constructor(
    private readonly packageName: string,
    serviceAccount: FirebaseServiceAccount,
  ) {
    this.api = google.playintegrity({
      version: 'v1',
      auth: new google.auth.GoogleAuth({
        credentials: {
          client_email: serviceAccount.client_email,
          private_key: serviceAccount.private_key,
        },
        scopes: ['https://www.googleapis.com/auth/playintegrity'],
      }),
    });
  }

  readonly enabled = true;

  async verifyToken(token: string, requestHash?: string): Promise<IntegrityVerdict> {
    try {
      // `v1.decodeIntegrityToken`, not a top-level method — the shape most
      // examples show does not exist on the client.
      const response = await this.api.v1.decodeIntegrityToken({
        packageName: this.packageName,
        requestBody: { integrityToken: token },
      });
      const payload = response.data.tokenPayloadExternal ?? {};
      const app = payload.appIntegrity ?? {};
      const device = payload.deviceIntegrity ?? {};
      const account = payload.accountDetails ?? {};
      const request = payload.requestDetails ?? {};

      const details = {
        appRecognitionVerdict: app.appRecognitionVerdict,
        deviceRecognitionVerdict: device.deviceRecognitionVerdict,
        appLicensingVerdict: account.appLicensingVerdict,
        packageName: app.packageName,
      };

      // The package must match: a token minted for another app is still a
      // valid Google token.
      if (app.packageName && app.packageName !== this.packageName) {
        return this.fail(`token belongs to ${app.packageName}`, details);
      }
      if (app.appRecognitionVerdict !== GENUINE_APP) {
        return this.fail(`app verdict ${app.appRecognitionVerdict}`, details);
      }
      const deviceVerdicts: string[] = device.deviceRecognitionVerdict ?? [];
      if (!deviceVerdicts.some((v: string) => TRUSTED_DEVICE.has(v))) {
        return this.fail(`device verdict ${deviceVerdicts.join(',') || 'none'}`, details);
      }
      if (account.appLicensingVerdict !== LICENSED) {
        return this.fail(`licensing verdict ${account.appLicensingVerdict}`, details);
      }

      // Binding the token to THIS request. Without it a genuine token can be
      // lifted onto any other call, which is most of what Play Integrity buys
      // over a plain "is the app real" check.
      if (requestHash && request.requestHash !== requestHash) {
        return this.fail('requestHash does not match the request body', details);
      }

      return { ok: true, platform: 'android', details };
    } catch (err) {
      return this.fail((err as Error).message);
    }
  }

  private fail(reason: string, details?: Record<string, unknown>): IntegrityVerdict {
    return { ok: false, platform: 'android', reason, details };
  }
}

/** Bound when Play Integrity is unconfigured; refuses rather than pretends. */
@Injectable()
export class DisabledAndroidIntegrity implements AndroidIntegrityPort {
  readonly enabled = false;
  async verifyToken(): Promise<IntegrityVerdict> {
    return { ok: false, platform: 'android', reason: 'Play Integrity is not configured' };
  }
}
