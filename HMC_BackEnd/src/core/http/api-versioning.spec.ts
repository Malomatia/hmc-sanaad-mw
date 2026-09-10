import { Controller, Get, INestApplication, Version } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiOperation, DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { apiVersionPrefix, configureApiVersioning, removeDiagnosticsFromDocument } from './api-versioning';
import type { OpenAPIObject } from '@nestjs/swagger';

@Controller('example')
class VersionFixture {
  @Get()
  @ApiOperation({ operationId: 'example_read' })
  legacy() {
    return { version: 1 };
  }

  @Get()
  @Version('2')
  @ApiOperation({ operationId: 'example_read_v2' })
  current() {
    return { version: 2 };
  }

  @Get('legacy-only')
  legacyOnly() {
    return { version: 1 };
  }
}

describe('compatible URI versioning', () => {
  let app: INestApplication;
  afterEach(async () => {
    await app?.close();
  });

  it.each([
    ['api/v1', 'api/v1', 'api/v2'],
    ['/custom/mobile/v1/', 'custom/mobile/v1', 'custom/mobile/v2'],
    ['legacy/api', 'legacy/api', 'legacy/api/v2'],
    ['v1', 'v1', 'v2'],
  ])('preserves %s and adds explicit v2 routes', async (prefix, v1, v2) => {
    const module = await Test.createTestingModule({ controllers: [VersionFixture] }).compile();
    app = module.createNestApplication();
    configureApiVersioning(app, prefix);
    await app.init();
    expect(apiVersionPrefix(prefix, '1')).toBe(v1);
    expect(apiVersionPrefix(prefix, '2')).toBe(v2);
    await request(app.getHttpServer()).get(`/${v1}/example`).expect(200, { version: 1 });
    await request(app.getHttpServer()).get(`/${v2}/example`).expect(200, { version: 2 });
    await request(app.getHttpServer()).get(`/${v1}/example/legacy-only`).expect(200);
    await request(app.getHttpServer()).get(`/${v2}/example/legacy-only`).expect(404);
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().build());
    expect(doc.paths[`/${v1}/example`].get?.operationId).toBe('example_read');
    expect(doc.paths[`/${v2}/example`].get?.operationId).toBe('example_read_v2');
  });
});

describe('versioned diagnostics visibility', () => {
  it.each(['api/v1', 'custom/mobile/v1', 'legacy/mobile'])('hides diagnostics in both versions of %s', (prefix) => {
    const bases = ['1', '2'].map((version) => `/${apiVersionPrefix(prefix, version as '1' | '2')}`);
    const hidden = bases.flatMap((base) => [
      `${base}/diagnostics/oracle-views`, `${base}/diagnostics/email/test`,
      `${base}/api-logs`, `${base}/api-logs/statistics`,
      `${base}/health/db`, `${base}/health/users-db`, `${base}/health/motc-sms-db`,
    ]);
    const kept = bases.flatMap((base) => [`${base}/health`, `${base}/health/ready`, `${base}/profile`]);
    const document: OpenAPIObject = {
      openapi: '3.0.0', info: { title: 'test', version: '2.0.0' },
      paths: Object.fromEntries([...hidden, ...kept].map((path) => [path, {}])),
    };
    removeDiagnosticsFromDocument(document, prefix);
    expect(Object.keys(document.paths)).toEqual(kept);
  });
});
