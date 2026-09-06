import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseConfig } from '../config/configuration';
import { FIREBASE_APP, resolveFirebaseApp } from './firebase-app';

/**
 * Provides the shared Firebase Admin app.
 *
 * Global because its two consumers sit at opposite ends of the application —
 * the App Check guard in the core request pipeline and the push sender in a
 * feature module — and threading an import through both would say nothing
 * useful about either.
 */
@Global()
@Module({
  providers: [
    {
      provide: FIREBASE_APP,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const firebase = config.getOrThrow<FirebaseConfig>('firebase');
        const app = resolveFirebaseApp(firebase);
        if (app) {
          new Logger('FirebaseModule').log(`Firebase ready (project ${firebase.projectId}).`);
        }
        return app;
      },
    },
  ],
  exports: [FIREBASE_APP],
})
export class FirebaseModule {}
