import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Role } from '@core/auth/auth-user.interface';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';
import { JwtStrategy } from '@core/auth/jwt.strategy';
import { RolesGuard } from '@core/auth/roles.guard';
import { TokenRevocationService } from '@core/auth/token-revocation.service';
import { ResponseInterceptor } from '@core/http/response.interceptor';
import { ApprovalsService, WorklistService } from '../application/approvals.service';
import { APPROVALS_REPOSITORY } from '../domain/approvals.repository';
import { ApprovalsController } from './approvals.controller';

const SECRET = 'pending-count-test-secret-not-for-production';
const PENDING_REQ = 'XXHMC_SND_PNDNG_UPD_PERSON_V';
const ROW = { COUNT_DATA: 7, REQUESTOR_USER_NAME: 'AIBRAHIM39', PENDING_REQ };
const PATH = '/api/v1/approvals/pending-count';

describe.each(['production', 'development'])('pending counts in %s', (nodeEnv) => {
  let app: INestApplication;
  let token: string;
  const getPendingCounts = jest.fn();

  beforeAll(async () => {
    const config = {
      get: (_key: string, fallback: unknown) => fallback,
      getOrThrow: (key: string) => (key === 'app' ? { nodeEnv } : { jwtSecret: SECRET }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ApprovalsController],
      providers: [
        ApprovalsService,
        JwtAuthGuard,
        JwtStrategy,
        RolesGuard,
        TokenRevocationService,
        { provide: ConfigService, useValue: config },
        { provide: APPROVALS_REPOSITORY, useValue: { getPendingCounts } },
        { provide: WorklistService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalGuards(app.get(JwtAuthGuard), app.get(RolesGuard));
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
    token = new JwtService({ secret: SECRET }).sign({
      username: 'AIBRAHIM39',
      employeeNumber: '037400',
      roles: [Role.EMPLOYEE],
    });
  });

  beforeEach(() => getPendingCounts.mockReset().mockResolvedValue([ROW]));

  afterAll(async () => {
    await app?.close();
  });

  it.each(['en', 'ar'])(
    'returns the table fields for an ordinary employee with lang=%s',
    async (lang) => {
      await request(app.getHttpServer())
        .get(PATH)
        .set('Authorization', `Bearer ${token}`)
        .query({ username: 'AIBRAHIM39', pendreq: PENDING_REQ, lang })
        .expect(200)
        .expect({ result: { items: [ROW] }, opstatus: 0, status: 'success', httpStatusCode: 200 });

      expect(getPendingCounts).toHaveBeenCalledWith('AIBRAHIM39', PENDING_REQ);
      expect(getPendingCounts).toHaveBeenCalledTimes(1);
    },
  );

  it('defaults to the authenticated username when username is omitted', async () => {
    await request(app.getHttpServer())
      .get(PATH)
      .set('Authorization', `Bearer ${token}`)
      .query({ pendreq: PENDING_REQ })
      .expect(200);

    expect(getPendingCounts).toHaveBeenCalledWith('AIBRAHIM39', PENDING_REQ);
  });

  it('only honors a different query username outside production', async () => {
    await request(app.getHttpServer())
      .get(PATH)
      .set('Authorization', `Bearer ${token}`)
      .query({ username: 'OTHER_USER', pendreq: PENDING_REQ })
      .expect(200);

    expect(getPendingCounts).toHaveBeenCalledWith(
      nodeEnv === 'production' ? 'AIBRAHIM39' : 'OTHER_USER',
      PENDING_REQ,
    );
  });

  it('requires a valid bearer token', async () => {
    await request(app.getHttpServer()).get(PATH).query({ pendreq: PENDING_REQ }).expect(401);
    await request(app.getHttpServer())
      .get(PATH)
      .set('Authorization', 'Bearer invalid')
      .query({ pendreq: PENDING_REQ })
      .expect(401);

    expect(getPendingCounts).not.toHaveBeenCalled();
  });

  it.each([{}, { pendreq: '' }, { pendreq: '   ' }, { pendreq: ['one', 'two'] }])(
    'rejects missing, blank, or repeated pendreq: %j',
    async (query) => {
      await request(app.getHttpServer())
        .get(PATH)
        .set('Authorization', `Bearer ${token}`)
        .query(query)
        .expect(400);

      expect(getPendingCounts).not.toHaveBeenCalled();
    },
  );

  it('rejects unsupported query fields', async () => {
    await request(app.getHttpServer())
      .get(PATH)
      .set('Authorization', `Bearer ${token}`)
      .query({ pendreq: PENDING_REQ, table: 'OTHER_TABLE' })
      .expect(400);

    expect(getPendingCounts).not.toHaveBeenCalled();
  });

  it('trims the query filters before reading', async () => {
    await request(app.getHttpServer())
      .get(PATH)
      .set('Authorization', `Bearer ${token}`)
      .query({ username: ' AIBRAHIM39 ', pendreq: ` ${PENDING_REQ} ` })
      .expect(200);

    expect(getPendingCounts).toHaveBeenCalledWith('AIBRAHIM39', PENDING_REQ);
  });

  it('returns an empty items array when no row matches', async () => {
    getPendingCounts.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get(PATH)
      .set('Authorization', `Bearer ${token}`)
      .query({ pendreq: PENDING_REQ })
      .expect(200)
      .expect({ result: { items: [] }, opstatus: 0, status: 'success', httpStatusCode: 200 });
  });
});
