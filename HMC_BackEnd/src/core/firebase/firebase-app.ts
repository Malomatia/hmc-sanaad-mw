import { Logger } from '@nestjs/common';
import { App, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FirebaseConfig } from '../config/configuration';

/** Injection token for the shared Firebase app — `undefined` when unconfigured. */
export const FIREBASE_APP = Symbol('FIREBASE_APP');

/** One named app for the whole process. */
const APP_NAME = 'sanaad';

/**
 * The Firebase Admin app, shared by everything that needs the credential:
 * FCM sending and App Check verification are two features of the same service
 * account, and initialising it twice would mean two SDK apps, two token
 * caches and two sets of credentials to reason about.
 *
 * Named rather than default because the SDK keeps a global registry and a bare
 * `initializeApp()` throws on the second call — which is what happens as soon
 * as Jest re-imports the module.
 *
 * Returns `undefined` when no credential is configured. Callers degrade; they
 * do not fail. An environment without a Firebase key must still run the API.
 */
export function resolveFirebaseApp(config: FirebaseConfig): App | undefined {
  if (!config.serviceAccount) return undefined;

  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;

  try {
    return initializeApp(
      {
        credential: cert({
          projectId: config.serviceAccount.project_id,
          clientEmail: config.serviceAccount.client_email,
          privateKey: config.serviceAccount.private_key,
        }),
      },
      APP_NAME,
    );
  } catch (err) {
    // A malformed key is a deployment fault, not a reason to refuse to boot.
    new Logger('FirebaseApp').error(
      `Firebase credential was rejected: ${(err as Error).message}. ` +
        'Push notifications and App Check are disabled.',
    );
    return undefined;
  }
}
