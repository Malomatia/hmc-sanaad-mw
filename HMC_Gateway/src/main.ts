import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { AppConfig } from '@core/config/configuration';

/**
 * Max request body. MUST stay >= HMC_BackEnd's own limit: the gateway parses
 * the body before proxying, so the smaller of the two is what actually
 * applies — leaving this at Express's 100kb default would refuse an
 * attachment-carrying submit here, before the backend ever saw it.
 */
const BODY_LIMIT = '25mb';

/** Express request carrying the untouched body bytes (see `verify` below). */
type RawBodyRequest = { rawBody?: Buffer };

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const appCfg = config.getOrThrow<AppConfig>('app');

  // Attachments reach the submits as base64 inside the JSON body (~4/3 of the
  // file size, and op 65 accepts ten), which the 100kb default cannot hold.
  //
  // `verify` keeps the RAW bytes alongside the parsed object. Play Integrity
  // binds a token to a SHA-256 the client computed over exactly what it sent,
  // so hashing a re-serialized body would compare two different strings and
  // reject every honest request. It also lets the proxy forward the original
  // bytes rather than axios's re-encoding of them.
  app.useBodyParser('json', {
    limit: BODY_LIMIT,
    verify: (req: RawBodyRequest, _res: unknown, buf: Buffer) => {
      if (buf?.length) req.rawBody = Buffer.from(buf);
    },
  });
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

  // OpenAPI / Swagger UI at /docs — covers only the gateway's own explicit
  // routes (auth journey passthrough + health); proxied business routes are
  // documented by HMC_BackEnd's own Swagger instead.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('HMC Sanaad Gateway API')
    .setDescription(
      'Public gateway in front of HMC_BackEnd: forwards the mobile auth journey and proxies ' +
        'every other authenticated request. See HMC_BackEnd Swagger for proxied route shapes.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  await app.listen(appCfg.port);
  Logger.log(
    `Gateway listening on http://localhost:${appCfg.port}/${appCfg.apiPrefix} (Swagger: /docs)`,
    'Bootstrap',
  );
}

void bootstrap();
