import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Role } from '@core/auth/auth-user.interface';
import { JwtAuthGuard } from '@core/auth/jwt-auth.guard';
import { JwtStrategy } from '@core/auth/jwt.strategy';
import { AuthStateService } from '@core/auth/auth-state.service';
import { TokenRevocationService } from '@core/auth/token-revocation.service';
import { ResponseInterceptor } from '@core/http/response.interceptor';
import { LookupsService } from '@lookups/application/lookups.service';
import { LeaveService } from '../../application/leave.service';
import { LEAVE_REPOSITORY } from '../../domain/leave.repository';
import { LeaveController } from '../../interface/leave.controller';
import request from 'supertest';
import * as oracledb from 'oracledb';
import { OracleService } from '@core/database/oracle.service';
import { OracleSchemaService } from '@core/database/oracle-schema.service';
import { EFFECTIVE_DATE_ALL } from '@shared/utils/date.util';
import { LeaveOracleRepository } from './leave.oracle.repository';

/**
 * op 56 binds `p_leave_details` into a VARCHAR2(60) inside
 * RET_FRM_LEAV_PR, while its own LOV (op 55) returns a ~75-character display
 * string — passing that through raised ORA-06502. The repository compacts the
 * value; these tests pin that behaviour, including the cases it must NOT touch.
 */
describe('LeaveOracleRepository — return-from-leave value compaction', () => {
  function make() {
    const call = jest.fn().mockResolvedValue({
      p_success_flag: 'Y',
      p_error_msg: null,
      p_error_msg_ar: null,
    });
    const ora = { call } as unknown as OracleService;
    // A minimal explicit test contract exposes the values under test without
    // discovery or a fallback; it is not a production procedure definition.
    const schema = {
      resolveParams: jest.fn().mockResolvedValue([
        { name: 'p_user_name', direction: 'IN', dataType: 'VARCHAR2', defaulted: false },
        { name: 'p_leave_details', direction: 'IN', dataType: 'VARCHAR2', defaulted: false },
        { name: 'p_success_flag', direction: 'OUT', dataType: 'VARCHAR2', defaulted: false },
      ]),
    } as unknown as OracleSchemaService;
    return { repository: new LeaveOracleRepository(ora, schema), call };
  }

  const submit = async (details: string) => {
    const { repository, call } = make();
    await repository.returnFromLeave({
      username: 'AIBRAHIM39',
      lang: 'en',
      fields: { p_leave_details: details, p_return_date: '20-Apr-2026' },
    });
    return call.mock.calls[0][1].p_leave_details;
  };

  it('strips the LOV labels so the value fits the procedure buffer', async () => {
    const lovValue = 'Casual Leave|Leave Start Date : 19-APR-2026 and Leave End Date : 19-APR-2026';
    expect(lovValue.length).toBeGreaterThan(60);

    const bound = await submit(lovValue);

    expect(bound).toBe('Casual Leave|19-APR-2026|19-APR-2026');
    expect(bound.length).toBeLessThanOrEqual(60);
  });

  it('leaves an already-compact value untouched', async () => {
    const compact = 'Casual Leave|19-APR-2026|19-APR-2026';
    expect(await submit(compact)).toBe(compact);
  });

  it('does not rewrite a value it cannot parse', async () => {
    expect(await submit('Casual Leave')).toBe('Casual Leave');
    expect(await submit('Casual Leave|no dates here')).toBe('Casual Leave|no dates here');
  });
});

/**
 * None of the leave procedures declares `p_language` (checked against
 * ALL_ARGUMENTS for CANCEL, AMEND, RET_FRM_LEAV, LEAV_OF_ABSEN_NEW and
 * LEAVE_BALANCE, and confirmed by the DB team). Sending it produced a bind the
 * database threw away and a parameter list that misdescribed the contract.
 */
describe('LeaveOracleRepository — the leave procedures take no p_language', () => {
  function make() {
    const call = jest.fn().mockResolvedValue({ p_success_flag: 'Y', p_error_msg: null });
    const ora = { call } as unknown as OracleService;
    const schema = {
      resolveParams: jest.fn().mockResolvedValue([
        { name: 'p_user_name', direction: 'IN', dataType: 'VARCHAR2', defaulted: false },
        { name: 'p_success_flag', direction: 'OUT', dataType: 'VARCHAR2', defaulted: false },
      ]),
    } as unknown as OracleSchemaService;
    return { repository: new LeaveOracleRepository(ora, schema), call };
  }

  const cmd = (fields: Record<string, unknown>) => ({
    username: 'AIBRAHIM39',
    lang: 'ar' as const,
    fields,
  });

  it('cancel binds the caller and the leave, and never p_language', async () => {
    const { repository, call } = make();

    await repository.cancel(
      cmd({
        p_leave_type: 'Casual Leave',
        p_leave_to_cancel: 'Casual Leave|19-APR-2026|19-APR-2026',
        p_reason_for_cancel: 'Plans changed',
      }),
    );

    const binds = call.mock.calls[0][1];
    expect(binds).toMatchObject({
      p_user_name: 'AIBRAHIM39',
      p_leave_type: 'Casual Leave',
      p_leave_to_cancel: 'Casual Leave|19-APR-2026|19-APR-2026',
    });
    expect(binds).not.toHaveProperty('p_language');
  });

  it('amend does the same', async () => {
    const { repository, call } = make();

    await repository.amend(
      cmd({
        p_leave_type: 'Annual Leave',
        p_leave_to_amend: 'Annual Leave|12-MAR-2026|12-MAR-2026',
        p_new_end_date: '13-MAR-2026',
      }),
    );

    expect(call.mock.calls[0][1]).not.toHaveProperty('p_language');
    expect(call.mock.calls[0][1].p_user_name).toBe('AIBRAHIM39');
  });

  it('the caller always wins over a p_user_name posted in the body', async () => {
    const { repository, call } = make();

    await repository.cancel(
      cmd({ p_user_name: 'SOMEONE-ELSE', p_leave_type: 'Casual Leave', p_leave_to_cancel: 'x' }),
    );

    expect(call.mock.calls[0][1].p_user_name).toBe('AIBRAHIM39');
  });
});

/**
 * op 9 binds `p_user_name` to the identifier EXACTLY as it came from the
 * request (client request 2026-08-30) — no PERSON_ID resolution round-trip.
 */
describe('LeaveOracleRepository — getBalance confirmed Oracle call', () => {
  function make() {
    const query = jest.fn();
    const callCursor = jest.fn().mockResolvedValue([{ LEAVE_TYPE: 'Annual', BALANCE: 10 }]);
    const ora = { query, callCursor } as unknown as OracleService;
    const resolveParams = jest.fn().mockResolvedValue([]);
    const schema = { resolveParams } as unknown as OracleSchemaService;
    return { repository: new LeaveOracleRepository(ora, schema), query, callCursor, resolveParams };
  }

  const QUERY = { username: 'AIBRAHIM39', lang: 'en' as const, effectiveDate: '20260913' };

  it.each(['en', 'ar'] as const)('uses the exact six-parameter signature for lang=%s', async (lang) => {
    const { repository, callCursor } = make();

    const rows = await repository.getBalance({ ...QUERY, username: 'JCHANDY', lang });

    expect(callCursor).toHaveBeenCalledTimes(1);
    const [sql, binds, cursorName] = callCursor.mock.calls[0];
    expect(sql.replace(/\s+/g, ' ')).toBe(
      'BEGIN APPS.XXHMC_SND_LEAVE_BALANCE_PR( p_user_name => :p_user_name, ' +
        'p_effective_date => :p_effective_date, p_get_balances => :p_get_balances, ' +
        'p_success_flag => :p_success_flag, p_error_msg => :p_error_msg, ' +
        'p_error_msg_ar => :p_error_msg_ar); END;',
    );
    expect(Object.keys(binds)).toEqual([
      'p_user_name',
      'p_effective_date',
      'p_get_balances',
      'p_success_flag',
      'p_error_msg',
      'p_error_msg_ar',
    ]);
    expect(binds).toMatchObject({
      p_user_name: 'JCHANDY',
      p_effective_date: {
        type: oracledb.DB_TYPE_DATE,
        val: new Date('2026-09-13T00:00:00.000Z'),
      },
      p_get_balances: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
    });
    for (const name of ['p_success_flag', 'p_error_msg', 'p_error_msg_ar']) {
      expect(binds[name]).toMatchObject({ dir: oracledb.BIND_OUT, type: oracledb.STRING });
      expect(binds[name].maxSize).toBeGreaterThanOrEqual(200);
    }
    expect(cursorName).toBe('p_get_balances');
    expect(rows).toEqual([{ LEAVE_TYPE: 'Annual', BALANCE: 10 }]);
  });

  it.each(['unavailable', 'stale'])('does not rely on %s schema metadata', async (state) => {
    const { repository, callCursor, resolveParams } = make();
    if (state === 'unavailable') {
      resolveParams.mockRejectedValue(new Error('Metadata unavailable'));
    } else {
      resolveParams.mockResolvedValue([
        { name: 'p_language', direction: 'IN', dataType: 'VARCHAR2', defaulted: false },
      ]);
    }

    await repository.getBalance(QUERY);

    expect(resolveParams).not.toHaveBeenCalled();
    expect(callCursor.mock.calls[0][1]).not.toHaveProperty('p_language');
    expect(callCursor.mock.calls[0][2]).toBe('p_get_balances');
  });

  it.each([
    ['20260913', '2026-09-13'],
    ['20260908', '2026-09-08'],
    ['2026-09-13', '2026-09-13'],
    ['13-Sep-2026', '2026-09-13'],
    [EFFECTIVE_DATE_ALL, '1900-01-01'],
  ])('binds effective date %s as a native Oracle DATE', async (effectiveDate, isoDate) => {
    const { repository, callCursor } = make();

    await repository.getBalance({ ...QUERY, effectiveDate });

    expect(callCursor.mock.calls[0][1].p_effective_date).toEqual({
      type: oracledb.DB_TYPE_DATE,
      val: new Date(`${isoDate}T00:00:00.000Z`),
    });
  });

  it('binds ?username= to p_user_name untouched, with no extra reads', async () => {
    const { repository, query, callCursor } = make();

    const rows = await repository.getBalance(QUERY);

    expect(rows).toHaveLength(1);
    expect(query).not.toHaveBeenCalled();
    expect(callCursor.mock.calls[0][1]).toMatchObject({ p_user_name: 'AIBRAHIM39' });
  });

  it('preserves trimming and uppercasing of Oracle usernames', async () => {
    const { repository, callCursor } = make();

    await repository.getBalance({ ...QUERY, username: ' vPavithran ' });

    expect(callCursor.mock.calls[0][1].p_user_name).toBe('VPAVITHRAN');
  });

  it('binds the legacy ?person_id= the same way when username is absent', async () => {
    const { repository, callCursor } = make();

    await repository.getBalance({ ...QUERY, username: undefined, personId: '852709' });

    expect(callCursor.mock.calls[0][1]).toMatchObject({ p_user_name: '852709' });
  });

  it('username wins when both identifiers are sent', async () => {
    const { repository, callCursor } = make();

    await repository.getBalance({ ...QUERY, personId: '852709' });

    expect(callCursor.mock.calls[0][1]).toMatchObject({ p_user_name: 'AIBRAHIM39' });
  });

  it('400s when neither username nor person_id is supplied', async () => {
    const { repository, callCursor } = make();

    await expect(
      repository.getBalance({ lang: 'en', effectiveDate: 'ALL' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(callCursor).not.toHaveBeenCalled();
  });

  it('keeps an empty cursor result as an empty array', async () => {
    const { repository, callCursor } = make();
    callCursor.mockResolvedValue([]);

    await expect(repository.getBalance(QUERY)).resolves.toEqual([]);
  });

  it('propagates an Oracle failure without retrying another signature', async () => {
    const { repository, callCursor } = make();
    const error = new Error('ORA-06550: PLS-00306');
    callCursor.mockRejectedValue(error);

    await expect(repository.getBalance(QUERY)).rejects.toBe(error);
    expect(callCursor).toHaveBeenCalledTimes(1);
  });
});

describe('LeaveOracleRepository.calculate error messages', () => {
  it.each([
    ['ORA-01403: no data found\nORA-06512: at line 4', 'no data found'],
    ['ORA-20001: Leave overlaps an existing request', 'Leave overlaps an existing request'],
    ['ORA-00942: SELECT secret FROM accounts', 'The database request failed.'],
    ['Invalid leave dates', 'Invalid leave dates'],
    [null, null],
    [undefined, undefined],
  ])('cleans Oracle errors without changing empty messages: %s', async (raw, expected) => {
    const ora = {
      call: jest.fn().mockResolvedValue({ p_success_flag: 'N', p_error_msg: raw }),
    } as unknown as OracleService;
    const repository = new LeaveOracleRepository(ora, {} as OracleSchemaService);

    const result = await repository.calculate({
      username: 'TESTUSER',
      lang: 'en',
      absenceType: 'Annual',
      startDate: '20260901',
      endDate: '20260902',
    });

    expect(result.errorMessage).toBe(expected);
    expect(result.successFlag).toBe('N');
  });
});

describe('POST /leave/calculate-duration', () => {
  const path = '/api/v1/leave/calculate-duration';
  const body = { Start_date: '2026-09-16', end_date: '2026-09-18', absence_type: 'Casual Leave' };
  const secret = 'leave-duration-test-secret-not-for-production';
  const call = jest.fn();
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [LeaveController],
      providers: [
        LeaveService,
        JwtAuthGuard,
        JwtStrategy,
        TokenRevocationService,
        { provide: AuthStateService, useValue: { sessionActive: jest.fn().mockResolvedValue(true) } },
        {
          provide: ConfigService,
          useValue: {
            get: (_key: string, fallback: unknown) => fallback,
            getOrThrow: () => ({ jwtSecret: secret, jwtIssuer: 'sanaad', jwtAudience: 'sanaad-b2e' }),
          },
        },
        { provide: LookupsService, useValue: {} },
        {
          provide: LEAVE_REPOSITORY,
          useValue: new LeaveOracleRepository(
            { call } as unknown as OracleService,
            {} as OracleSchemaService,
          ),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalGuards(app.get(JwtAuthGuard));
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    await app.init();
    token = new JwtService({ secret, signOptions: { expiresIn: '1h', issuer: 'sanaad', audience: 'sanaad-b2e', algorithm: 'HS256' } }).sign({
      sub: '123456', sid: 'test-session', jti: 'test-access', deviceImei: 'test-device', typ: 'access',
      username: 'TESTUSER',
      employeeNumber: '123456',
      roles: [Role.EMPLOYEE],
    });
  });

  beforeEach(() => {
    call.mockReset().mockResolvedValue({
      p_duration: 3,
      p_success_flag: 'S',
      p_error_msg: null,
      p_error_msg_ar: null,
    });
  });

  afterAll(async () => app?.close());

  it.each([
    ['2026-09-16', '2026-09-18'],
    ['16-Sep-2026', '18-SEP-2026'],
  ])('binds %s and %s as DATEs and uses the authenticated login', async (start, end) => {
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .query({ username: 'SOMEONE_ELSE', user_name: 'ANOTHER_USER' })
      .send({ ...body, Start_date: start, end_date: end })
      .expect(200)
      .expect({
        result: { duration: 3, successFlag: 'S', errorMessage: null },
        opstatus: 0,
        status: 'success',
        httpStatusCode: 200,
      });

    expect(call).toHaveBeenCalledTimes(1);
    const [sql, binds] = call.mock.calls[0];
    expect(sql.replace(/\s+/g, ' ')).toBe(
      'BEGIN XXHMC_SND_CALC_LEAV_DUR_PR( p_user_name => :p_user_name, ' +
        'p_absence_type => :p_absence_type, p_start_date => :p_start_date, ' +
        'p_end_date => :p_end_date, p_duration => :p_duration, ' +
        'p_success_flag => :p_success_flag, p_error_msg => :p_error_msg, ' +
        'p_error_msg_ar => :p_error_msg_ar); END;',
    );
    expect(binds).toEqual({
      p_user_name: 'TESTUSER',
      p_absence_type: 'Casual Leave',
      p_start_date: { type: oracledb.DB_TYPE_DATE, val: new Date('2026-09-16T00:00:00.000Z') },
      p_end_date: { type: oracledb.DB_TYPE_DATE, val: new Date('2026-09-18T00:00:00.000Z') },
      p_duration: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      p_success_flag: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 10 },
      p_error_msg: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
      p_error_msg_ar: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 4000 },
    });
  });

  it.each([0, 0.5, 3, null])('preserves the Oracle duration %s', async (duration) => {
    call.mockResolvedValue({ p_duration: duration, p_success_flag: 'S', p_error_msg: null });
    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...body, end_date: body.Start_date })
      .expect(200);
    expect(response.body.result.duration).toBe(duration);
  });

  it('preserves a business failure without inventing a zero duration', async () => {
    call.mockResolvedValue({
      p_duration: null,
      p_success_flag: 'N',
      p_error_msg: 'ORA-20001: Invalid absence type',
    });
    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(200);
    expect(response.body.result).toEqual({
      duration: null,
      successFlag: 'N',
      errorMessage: 'Invalid absence type',
    });
  });

  it.each([
    {},
    { ...body, Start_date: undefined },
    { ...body, end_date: null },
    { ...body, absence_type: undefined },
    { ...body, absence_type: '' },
    { ...body, absence_type: '   ' },
    { ...body, absence_type: 123 },
    { ...body, Start_date: 'invalid' },
    { ...body, Start_date: '2026-02-30' },
    { ...body, Start_date: '31-Apr-2026' },
    { ...body, end_date: '18-XYZ-2026' },
    { ...body, end_date: '2026-09-15' },
    { ...body, username: 'SOMEONE_ELSE' },
    { ...body, user_name: 'SOMEONE_ELSE' },
    { ...body, p_user_name: 'SOMEONE_ELSE' },
  ])('rejects invalid inputs before Oracle: %j', async (invalidBody) => {
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(invalidBody)
      .expect(400);
    expect(call).not.toHaveBeenCalled();
  });

  it.each([undefined, 'invalid'])('requires a valid bearer token (%s)', async (bearer) => {
    const req = request(app.getHttpServer()).post(path);
    if (bearer) req.set('Authorization', `Bearer ${bearer}`);
    await req.send(body).expect(401);
    expect(call).not.toHaveBeenCalled();
  });

  it('retains the existing calculate API input and days response', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/leave/calculate')
      .set('Authorization', `Bearer ${token}`)
      .send({ absenceType: body.absence_type, startDate: '16-Sep-2026', endDate: '18-Sep-2026' })
      .expect(200);
    expect(response.body.result).toEqual({ days: 3, successFlag: 'S', errorMessage: null });
    expect(response.body.result).not.toHaveProperty('duration');
  });
});
