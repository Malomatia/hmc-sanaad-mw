import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AppConfig, DiagnosticsConfig } from '@core/config/configuration';

/**
 * Max request body. Sized for a submit carrying several base64 attachments
 * (op 65 accepts ten) — see the note in bootstrap().
 */
const BODY_LIMIT = '25mb';

/**
 * With DIAGNOSTICS_ENABLED=false the diagnostics/logs/DB-test routes return
 * 404 (DiagnosticsEnabledGuard), so drop them from the OpenAPI document too —
 * Swagger must not advertise endpoints that do not exist.
 */
function stripDiagnosticsPaths(document: OpenAPIObject, apiPrefix: string): void {
  const base = `/${apiPrefix}`.replace(/\/+$/, '');
  const gatedPrefixes = [`${base}/diagnostics`, `${base}/api-logs`];
  const gatedExact = new Set([
    `${base}/health/db`,
    `${base}/health/users-db`,
    `${base}/health/motc-sms-db`,
  ]);
  for (const path of Object.keys(document.paths)) {
    if (gatedExact.has(path) || gatedPrefixes.some((p) => path === p || path.startsWith(`${p}/`))) {
      delete document.paths[path];
    }
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const appCfg = config.getOrThrow<AppConfig>('app');

  /**
   * Request body limit.
   *
   * Attachments are base64 inside the JSON body — op 65 takes up to ten — and
   * base64 inflates a file by ~4/3. Express defaults to 100kb, so anything
   * over ~73kb of file was rejected, and body-parser's error surfaced as a
   * bare 500 "Internal server error" rather than 413, which made it look like
   * a server bug instead of an oversized upload.
   *
   * Oracle is fine with large files: every P_ATTACHMENT* parameter is a BLOB,
   * not a VARCHAR2, so there is no 32k ceiling to run into.
   *
   * Fixed here rather than env-driven: it is a property of the payload shape,
   * not of the environment, and every deployment needs the same value.
   */
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });

  // Security & performance hardening
  app.use(helmet());
  app.use(compression());
  app.enableCors({
    origin: appCfg.corsOrigins.includes('*') ? true : appCfg.corsOrigins,
    credentials: true,
  });

  // All routes under /{prefix} (e.g. /api/v1)
  app.setGlobalPrefix(appCfg.apiPrefix);
  app.enableShutdownHooks();

  // OpenAPI / Swagger UI at /docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('HMC Sanaad B2E API')
    .setDescription(
      'NestJS backend re-exposing the 71 Sanaad operations over Oracle XXHMC_SND_* (14 modules).',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  if (!config.getOrThrow<DiagnosticsConfig>('diagnostics').enabled) {
    stripDiagnosticsPaths(document, appCfg.apiPrefix);
  }
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(appCfg.port);
  Logger.log(
    `Sanaad backend listening on http://localhost:${appCfg.port}/${appCfg.apiPrefix} (Swagger: /docs)`,
    'Bootstrap',
  );
}

void bootstrap();
