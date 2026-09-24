import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import configuration from '../config/configuration';
import { OracleService } from '../database/oracle.service';
import { MssqlService } from '../database/mssql.service';
import { MotcSmsDbService } from '../database/motc-sms-db.service';
import { EmailService } from '../email/email.service';
import { FIREBASE_APP } from '../firebase/firebase-app';

jest.mock('node-app-attest', () => ({ verifyAttestation: jest.fn(), verifyAssertion: jest.fn() }));

const REMOVED = [
  ['get', '/diagnostics/oracle-views'],
  ['get', '/diagnostics/oracle-object'],
  ['post', '/diagnostics/oracle/sql'],
  ['post', '/diagnostics/users-db/sql'],
  ['post', '/diagnostics/motc-sms-db/sql'],
  ['post', '/diagnostics/email/test'],
  ['get', '/diagnostics/oracle-logs'],
  ['get', '/diagnostics/oracle-logs/view'],
  ['get', '/diagnostics/oracle-logs/stats'],
  ['delete', '/diagnostics/oracle-logs'],
  ['get', '/api-logs'],
  ['get', '/api-logs/view'],
  ['get', '/api-logs/statistics'],
  ['get', '/api-logs/errors'],
  ['get', '/api-logs/success'],
  ['get', '/api-logs/slow'],
  ['get', '/api-logs/1'],
  ['delete', '/api-logs'],
  ['get', '/dev-console'],
  ['get', '/dev-console/settings'],
  ['get', '/dev-console/objects'],
  ['get', '/dev-console/describe'],
  ['get', '/dev-console/source'],
  ['post', '/dev-console/mode'],
  ['post', '/dev-console/execute'],
  ['post', '/dev-console/explain'],
  ['post', '/dev-console/api-call'],
  ['get', '/health/db'],
  ['get', '/health/users-db'],
  ['get', '/health/motc-sms-db'],
  ['post', '/notifications/device-token/test'],
] as const;

describe('pentest application HTTP surface', () => {
  let app: INestApplication;
  const query = jest.fn();
  const execute = jest.fn();
  const send = jest.fn();

  beforeAll(async () => {
    const defaults = configuration();
    const config = new ConfigService({
      ...defaults,
      app: { ...defaults.app, nodeEnv: 'test' },
      auth: { ...defaults.auth, disabled: false, jwtSecret: 'pentest-surface-test-secret-only' },
      ldap: { ...defaults.ldap, enabled: false },
      firebase: { ...defaults.firebase, enabled: false, serviceAccount: undefined },
      appIntegrity: {
        ...defaults.appIntegrity,
        mode: 'off',
        ios: { ...defaults.appIntegrity.ios, enabled: false },
        android: { ...defaults.appIntegrity.android, enabled: false },
      },
    });
    const db = { query, execute, isConfigured: () => false, isEnabled: () => false };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(OracleService)
      .useValue(db)
      .overrideProvider(MssqlService)
      .useValue(db)
      .overrideProvider(MotcSmsDbService)
      .useValue(db)
      .overrideProvider(EmailService)
      .useValue({ send, isConfigured: false })
      .overrideProvider(FIREBASE_APP)
      .useValue(undefined)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app?.close());

  it('keeps basic liveness without database or credential details', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(response.body).toEqual({
      status: 'ok',
      uptime: expect.any(Number),
      timestamp: expect.any(String),
    });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(REMOVED)(
    '%s %s is absent rather than hidden behind authentication',
    async (method, route) => {
      await request(app.getHttpServer())[method](`/api/v1${route}`).expect(404);
      expect(query).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('retains authentication on business routes', async () => {
    await request(app.getHttpServer()).get('/api/v1/lookups/lov').expect(401);
    expect(query).not.toHaveBeenCalled();
  });

  it('excludes removed endpoints from generated Swagger without disabling business documentation', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().addBearerAuth().build(),
    );
    expect(document.paths['/api/v1/auth/login']).toBeDefined();
    for (const [, route] of REMOVED) expect(document.paths[`/api/v1${route}`]).toBeUndefined();
  });
});
