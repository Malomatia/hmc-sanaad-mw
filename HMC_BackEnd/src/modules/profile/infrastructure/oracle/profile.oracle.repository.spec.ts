import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ResponseInterceptor } from '@core/http/response.interceptor';
import { LookupsService } from '@lookups/application/lookups.service';
import { WorklistService } from '@modules/approvals/application/approvals.service';
import { ProfileService } from '../../application/profile.service';
import { PROFILE_REPOSITORY } from '../../domain/profile.repository';
import { ProfileController } from '../../interface/profile.controller';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { SchemaColumnNotFoundException } from '@core/database/schema-column-not-found.error';
import { ORACLE_OBJECTS } from '@shared/constants/oracle-objects';
import { USERNAME_KEY_CANDIDATES } from '@shared/constants/oracle-columns';
import { ProfileOracleRepository } from './profile.oracle.repository';

const OUTSIDE = ORACLE_OBJECTS.EMP_OUT_ADDRESS_V;
const INSIDE_ROWS = [
  { ADDRESS_ID: '101', ADDRESS_TYPE: 'Primary Local Address' },
  { ADDRESS_ID: '102', ADDRESS_TYPE: 'HMC Accommodation Address' },
];

function make(keyColumn = 'USER_NAME') {
  const query = jest.fn().mockImplementation(async (sql: string) => {
    if (sql.includes(OUTSIDE)) return [{ ADDRESS_ID: '201', ADDRESS_TYPE: 'Recruiting' }];
    if (sql.includes(ORACLE_OBJECTS.EMP_IN_ADDRESS_V)) return INSIDE_ROWS;
    return [];
  });
  const resolveKeyColumn = jest.fn().mockResolvedValue(keyColumn);
  const repository = new ProfileOracleRepository(
    { query } as unknown as OracleService,
    { resolveKeyColumn } as unknown as OracleSchemaService,
  );
  return { repository, query, resolveKeyColumn };
}

describe('Profile bilingual full names over HTTP', () => {
  let app: INestApplication;
  const englishName = 'Test Employee';
  const arabicName = 'موظف تجريبي';
  const personal = Object.freeze({
    USER_NAME: 'TESTUSER',
    FULL_NAME: englishName,
    FULL_NAME_AR: encodeURIComponent(arabicName),
    GENDER: 'Male',
    GENDER_AR: encodeURIComponent('ذكر'),
  });
  let personalRows: Record<string, unknown>[];

  beforeAll(async () => {
    const { repository, query } = make();
    query.mockImplementation(async (sql: string) => {
      if (sql.includes(ORACLE_OBJECTS.PERSONAL_DETAILS_V)) return personalRows;
      if (sql.includes(ORACLE_OBJECTS.EMP_PHONE_V)) {
        return [{ PHONE_TYPE: 'Home', PHONE_TYPE_AR: 'المنزل' }];
      }
      return [];
    });
    const moduleRef = await Test.createTestingModule({
      controllers: [ProfileController],
      providers: [
        ProfileService,
        { provide: PROFILE_REPOSITORY, useValue: repository },
        { provide: LookupsService, useValue: {} },
        {
          provide: WorklistService,
          useValue: {
            worklist: jest.fn().mockResolvedValue([{ FULL_NAME: englishName, FULL_NAME_AR: arabicName }]),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
  });

  beforeEach(() => {
    personalRows = [personal];
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each(['en', 'ar', undefined] as const)(
    'returns FULL_NAME and FULL_NAME_AR together with lang=%s',
    async (lang) => {
      const req = request(app.getHttpServer()).get('/api/v1/profile').query({ username: 'TESTUSER' });
      if (lang !== undefined) req.query({ lang });
      const response = await req.expect(200);

      expect(response.body).toMatchObject({
        opstatus: 0,
        status: 'success',
        httpStatusCode: 200,
        result: {
          personal: {
            username: 'TESTUSER',
            FULL_NAME: englishName,
            FULL_NAME_AR: arabicName,
            fullName: lang === 'ar' ? arabicName : englishName,
            gender: lang === 'ar' ? 'ذكر' : 'Male',
          },
          phones: [{ phoneType: lang === 'ar' ? 'المنزل' : 'Home' }],
        },
      });
      expect(response.body.result.personal).not.toHaveProperty('fullNameAr');
      expect(response.body.result.personal).not.toHaveProperty('genderAr');
      expect(response.body.result.phones[0]).not.toHaveProperty('phoneTypeAr');
      expect(personal.FULL_NAME_AR).toBe(encodeURIComponent(arabicName));
    },
  );

  it('keeps both names with an Arabic header and no query language', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profile')
      .query({ username: 'TESTUSER' })
      .set('lang', 'ar')
      .expect(200);

    expect(response.body.result.personal).toMatchObject({
      FULL_NAME: englishName,
      FULL_NAME_AR: arabicName,
    });
  });

  it('does not change localization on the other profile routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/profile/notifications?username=TESTUSER&lang=ar')
      .expect(200);

    expect(response.body.result).toEqual([{ FULL_NAME: arabicName }]);
  });

  it('preserves empty-profile behavior when no personal row exists', async () => {
    personalRows = [];
    const response = await request(app.getHttpServer())
      .get('/api/v1/profile?username=TESTUSER&lang=ar')
      .expect(200);

    expect(response.body.result.personal).toEqual({});
  });

  it('does not invent an Arabic name when the source value is null', async () => {
    personalRows = [{ ...personal, FULL_NAME_AR: null }];
    const response = await request(app.getHttpServer())
      .get('/api/v1/profile?username=TESTUSER&lang=ar')
      .expect(200);

    expect(response.body.result.personal).toMatchObject({ FULL_NAME: englishName });
    expect(response.body.result.personal).not.toHaveProperty('FULL_NAME_AR');
  });
});

describe('Profile outside address selection', () => {
  it.each(['USER_NAME', 'USERNAME'])(
    'filters address types and limits the scoped Oracle query to one row using %s',
    async (keyColumn) => {
      const { repository, query, resolveKeyColumn } = make(keyColumn);
      const profile = await repository.getProfile('aibrahim39', 'en');

      expect(resolveKeyColumn).toHaveBeenCalledWith(OUTSIDE, USERNAME_KEY_CANDIDATES);
      expect(query).toHaveBeenCalledWith(
        `SELECT * FROM ${OUTSIDE} WHERE ${keyColumn} IN (:k0) ` +
          'AND (ADDRESS_TYPE IN (:addressType0, :addressType1)) AND ROWNUM <= :maxRows',
        {
          k0: 'AIBRAHIM39',
          addressType0: 'Recruiting',
          addressType1: 'Primary Home Country Address',
          maxRows: 1,
        },
      );
      expect(profile.outsideAddresses).toEqual([{ addressId: '201', addressType: 'Recruiting' }]);
    },
  );

  it('does not filter or limit the other profile reads', async () => {
    const { repository, query } = make();
    const profile = await repository.getProfile('aibrahim39', 'ar');
    const otherCalls = query.mock.calls.filter(([sql]) => !sql.includes(OUTSIDE));

    expect(otherCalls).toHaveLength(4);
    for (const [sql, binds] of otherCalls) {
      expect(sql).not.toMatch(/ADDRESS_TYPE IN|ROWNUM/);
      expect(binds).toEqual({ k0: 'AIBRAHIM39' });
    }
    expect(profile.insideAddresses).toHaveLength(2);
  });

  it('keeps an empty address array when Oracle finds no matching row', async () => {
    const { repository, query } = make();
    query.mockResolvedValue([]);
    expect((await repository.getProfile('AIBRAHIM39', 'en')).outsideAddresses).toEqual([]);
  });

  it('preserves partial-profile behavior if the outside-address scope column is unavailable', async () => {
    const { repository, query, resolveKeyColumn } = make();
    resolveKeyColumn.mockImplementation(async (object: string) => {
      if (object === OUTSIDE) {
        throw new SchemaColumnNotFoundException(OUTSIDE, USERNAME_KEY_CANDIDATES, ['ADDRESS_TYPE']);
      }
      return 'USER_NAME';
    });

    const profile = await repository.getProfile('AIBRAHIM39', 'en');

    expect(profile.outsideAddresses).toEqual([]);
    expect(profile.insideAddresses).toHaveLength(2);
    expect(query.mock.calls.every(([sql]) => !sql.includes(OUTSIDE))).toBe(true);
  });

  it('does not swallow unrelated Oracle failures', async () => {
    const { repository, query } = make();
    const failure = new Error('Oracle query failed');
    query.mockRejectedValue(failure);
    await expect(repository.getProfile('AIBRAHIM39', 'en')).rejects.toBe(failure);
  });
});
