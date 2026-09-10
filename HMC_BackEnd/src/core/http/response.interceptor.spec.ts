import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { firstValueFrom, of } from 'rxjs';
import request from 'supertest';
import { AuthenticatedUser, Role } from '../auth/auth-user.interface';
import { ApiLogInterceptor } from '../logging/api-log.interceptor';
import { ApiLogStore } from '../logging/api-log.store';
import { ApiLogFileWriter } from '../logging/api-log-file-writer.service';
import { failureResult, successResult } from '@shared/domain/submit-result';
import {
  ApprovalsService,
  WorklistService,
} from '@modules/approvals/application/approvals.service';
import { APPROVALS_REPOSITORY } from '@modules/approvals/domain/approvals.repository';
import { ApprovalsController } from '@modules/approvals/interface/approvals.controller';
import { LettersService } from '@modules/letters/application/letters.service';
import { LettersController } from '@modules/letters/interface/letters.controller';
import { ResponseInterceptor } from './response.interceptor';

async function shape(
  data: unknown,
  queryLang?: string,
  headerLang?: string | readonly string[],
  skip = false,
) {
  const reflector = { getAllAndOverride: () => skip } as unknown as Reflector;
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ query: { lang: queryLang }, headers: { lang: headerLang } }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
  return firstValueFrom(
    new ResponseInterceptor(reflector).intercept(context, { handle: () => of(data) }),
  );
}

describe('successful submit messages', () => {
  it.each([
    ['ar', undefined, 'تم الأرسال'],
    ['en', undefined, 'Success'],
    [undefined, undefined, 'Success'],
    [undefined, 'ar', 'تم الأرسال'],
    [undefined, ['ar', 'en'], 'تم الأرسال'],
    ['en', 'ar', 'Success'],
    ['ar', 'en', 'تم الأرسال'],
    ['unsupported', 'ar', 'Success'],
  ] as const)('selects message for query=%s header=%s', async (query, header, message) => {
    const headers = Array.isArray(header) ? [...header] : header;
    expect(await shape(successResult(), query, headers)).toMatchObject({
      status: 'success',
      successflag: 'S',
      message,
      httpStatusCode: 200,
    });
  });

  it('standardizes custom successful procedure text without mutating the source or result', async () => {
    const source = Object.freeze({
      ...successResult('Custom success from Oracle', { requestId: '123' }),
      errormessageAr: 'رسالة خاصة من قاعدة البيانات',
    });
    expect(await shape(source, 'ar')).toEqual({
      status: 'success',
      successflag: 'S',
      message: 'تم الأرسال',
      httpStatusCode: 200,
      result: { requestId: '123' },
    });
    expect(await shape(source, 'en')).toMatchObject({ message: 'Success' });
    expect(source.errormessage).toBe('Custom success from Oracle');
    expect(source.errormessageAr).toBe('رسالة خاصة من قاعدة البيانات');
  });

  it('keeps failure messages, including their existing language fallback', async () => {
    expect(await shape(failureResult('Rejected', 'مرفوض'), 'ar')).toMatchObject({
      status: 'error',
      successflag: 'N',
      message: 'مرفوض',
      httpStatusCode: 200,
    });
    expect(await shape(failureResult('Rejected'), 'ar')).toMatchObject({ message: 'Rejected' });
    expect(await shape(failureResult('Rejected', 'مرفوض'), undefined, 'ar')).toMatchObject({
      message: 'Rejected',
    });
    expect(
      await shape({ ...successResult('Keep inconsistent error'), status: 'error' }, 'ar'),
    ).toMatchObject({ status: 'error', message: 'Keep inconsistent error' });
  });

  it('leaves skipped auth/OTP responses and non-submit messages unchanged', async () => {
    const auth = { status: 'success', message: 'Logged out successfully.' };
    expect(await shape(auth, 'ar', undefined, true)).toBe(auth);
    expect(await shape({ message: 'A business read message' }, 'ar')).toMatchObject({
      result: { message: 'A business read message' },
    });
  });
});

describe('letters and approvals HTTP responses', () => {
  let app: INestApplication;
  const submit = jest.fn();
  const getSummary = jest.fn();
  const record = jest.fn();
  const writer = { write: jest.fn() };
  const user: AuthenticatedUser = {
    username: 'AIBRAHIM39',
    employeeNumber: '037400',
    roles: [Role.EMPLOYEE],
  };
  const body = {
    p_letter_language: 'English',
    p_letter_name: 'Bank letter with details with effective date',
    p_no_of_copies: '1',
    p_mobile_number: '55723893',
    p_letter_delivery_loc: 'Al Wakra Hospital',
    p_purpose_comments: 'test',
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LettersController, ApprovalsController],
      providers: [
        ApprovalsService,
        { provide: APPROVALS_REPOSITORY, useValue: { getSummary } },
        { provide: WorklistService, useValue: {} },
        { provide: LettersService, useValue: { submit } },
        { provide: ConfigService, useValue: new ConfigService({ app: { nodeEnv: 'production' } }) },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.setGlobalPrefix('api/v1');
    app.use((req: { user?: AuthenticatedUser }, _res: unknown, next: () => void) => {
      req.user = user;
      next();
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalInterceptors(
      new ApiLogInterceptor(
        { nextId: () => 1, record } as unknown as ApiLogStore,
        writer as unknown as ApiLogFileWriter,
      ),
      new ResponseInterceptor(new Reflector()),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    submit.mockResolvedValue(successResult());
    getSummary.mockResolvedValue({
      approvals: [{ SUBJECT: '  Leave   request for 037400    - Employee  ' }],
      pendingQid: [],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([
    ['ar', 'تم الأرسال'],
    ['en', 'Success'],
  ])('localizes letters success and responseSummary for lang=%s', async (lang, message) => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/letters/apply?lang=${lang}`)
      .send(body)
      .expect(200);
    expect(response.body).toEqual({
      status: 'success',
      successflag: 'S',
      message,
      httpStatusCode: 200,
    });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining(body), user, lang);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ responseSummary: expect.objectContaining(response.body) }),
    );
    expect(writer.write).toHaveBeenCalledTimes(1);
  });

  it('supports the lang header and keeps query precedence for a successful submit', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/letters/apply')
      .set('lang', 'ar')
      .send(body)
      .expect(200)
      .expect(({ body: response }) => expect(response.message).toBe('تم الأرسال'));
    await request(app.getHttpServer())
      .post('/api/v1/letters/apply?lang=en')
      .set('lang', 'ar')
      .send(body)
      .expect(200)
      .expect(({ body: response }) => expect(response.message).toBe('Success'));
  });

  it('normalizes SUBJECT on the requested approvals endpoint without changing its caller filter', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/approvals?enum=037400&lang=en')
      .expect(200);
    expect(response.body).toEqual({
      result: { approvals: [{ SUBJECT: 'Leave request for 037400 - Employee' }], pendingQid: [] },
      opstatus: 0,
      status: 'success',
      httpStatusCode: 200,
    });
    expect(getSummary).toHaveBeenCalledWith(['AIBRAHIM39', '037400'], 'en');
  });
});
