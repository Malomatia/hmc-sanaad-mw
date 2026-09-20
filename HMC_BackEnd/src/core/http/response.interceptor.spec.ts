import { ExecutionContext, INestApplication, ServiceUnavailableException, ValidationPipe } from '@nestjs/common';
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
import { APPROVALS_REPOSITORY, WORKLIST_REPOSITORY } from '@modules/approvals/domain/approvals.repository';
import { ApprovalsController } from '@modules/approvals/interface/approvals.controller';
import { LettersService } from '@modules/letters/application/letters.service';
import { LettersController } from '@modules/letters/interface/letters.controller';
import { ResponseInterceptor, SKIP_ENVELOPE } from './response.interceptor';

async function shape(
  data: unknown,
  queryLang?: string,
  headerLang?: string | readonly string[],
  skip = false,
) {
  const reflector = {
    getAllAndOverride: (key: string) => (key === SKIP_ENVELOPE ? skip : undefined),
  } as unknown as Reflector;
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

describe('unconfigured read localization', () => {
  it.each(['en', 'ar'])(
    'still localizes full-name twins outside the profile opt-in for %s',
    async (lang) => {
      const row = { FULL_NAME: 'Test Employee', FULL_NAME_AR: 'موظف تجريبي' };

      expect(await shape({ personal: row }, lang)).toEqual({
        result: { personal: { FULL_NAME: lang === 'ar' ? row.FULL_NAME_AR : row.FULL_NAME } },
        opstatus: 0,
        status: 'success',
        httpStatusCode: 200,
      });
    },
  );
});

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
  const requestInfo = jest.fn();
  const reassign = jest.fn();
  const decide = jest.fn();
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
        { provide: APPROVALS_REPOSITORY, useValue: { getSummary, requestInfo, decide } },
        WorklistService,
        { provide: WORKLIST_REPOSITORY, useValue: { reassign } },
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
    requestInfo.mockResolvedValue(successResult());
    reassign.mockResolvedValue(successResult());
    decide.mockResolvedValue(successResult());
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

  describe.each([
    {
      action: 'QUESTION',
      route: 'request-info',
      payload: { itemKey: 'item-1', mode: 'QUESTION', comment: 'Please clarify.' },
      handler: requestInfo,
      success: { en: 'Request for More Information Processed', ar: 'تمت معالجة طلب مزيد من المعلومات' },
      failure: { en: 'Request for More Information Not Processed', ar: 'تعذرت معالجة طلب مزيد من المعلومات' },
    },
    {
      action: 'ANSWER',
      route: 'request-info',
      payload: { itemKey: 'item-1', mode: 'ANSWER', comment: 'Here are the details.' },
      handler: requestInfo,
      success: { en: 'Answer for More Information Processed', ar: 'تمت معالجة الرد على طلب مزيد من المعلومات' },
      failure: { en: 'Answer for More Information Not Processed', ar: 'تعذرت معالجة الرد على طلب مزيد من المعلومات' },
    },
    {
      action: 'REASSIGN',
      route: 'reassign',
      payload: { assignTo: 'OTHER.USER', type: 'TRANSFER', comment: 'Please review.' },
      handler: reassign,
      success: { en: 'Re-Assign Approval Processed', ar: 'تمت معالجة إعادة إسناد الموافقة' },
      failure: { en: 'Re-Assign Approval Not Processed', ar: 'تعذرت معالجة إعادة إسناد الموافقة' },
    },
  ])('$action business messages', ({ route, payload, handler, success, failure }) => {
    it.each([
      [true, 'en', undefined, 'en'],
      [true, 'ar', undefined, 'ar'],
      [false, 'en', undefined, 'en'],
      [false, 'ar', undefined, 'ar'],
      [true, undefined, 'ar', 'ar'],
      [false, undefined, 'ar', 'ar'],
      [true, 'en', 'ar', 'en'],
      [false, 'en', 'ar', 'en'],
      [true, 'ar', 'en', 'ar'],
      [false, 'ar', 'en', 'ar'],
      [true, undefined, undefined, 'en'],
      [false, undefined, undefined, 'en'],
      [true, 'unsupported', 'ar', 'en'],
      [false, 'unsupported', 'ar', 'en'],
    ] as const)(
      'returns the exact text for success=%s query=%s header=%s',
      async (succeeded, queryLang, headerLang, expectedLang) => {
        const source = Object.freeze({
          ...(succeeded ? successResult('Procedure success') : failureResult('Procedure failure')),
          errormessageAr: 'نص الإجراء',
          result: { notificationId: '123' },
        });
        handler.mockResolvedValueOnce(source);
        const req = request(app.getHttpServer()).post(`/api/v1/approvals/123/${route}`);
        if (queryLang !== undefined) req.query({ lang: queryLang });
        if (headerLang !== undefined) req.set('lang', headerLang);

        const response = await req.send(payload).expect(200);

        expect(response.body).toEqual({
          status: source.status,
          successflag: source.successflag,
          message: (succeeded ? success : failure)[expectedLang],
          httpStatusCode: 200,
          result: source.result,
        });
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledWith(expect.objectContaining({
          ...payload,
          username: user.username,
          approvalId: '123',
          lang: expectedLang,
        }));
        expect(source.errormessage).toBe(succeeded ? 'Procedure success' : 'Procedure failure');
        expect(source.errormessageAr).toBe('نص الإجراء');
        expect(record).toHaveBeenCalledWith(
          expect.objectContaining({ responseSummary: expect.objectContaining(response.body) }),
        );
      },
    );

    it('preserves exception status rather than converting a thrown error into a business response', async () => {
      handler.mockRejectedValueOnce(new ServiceUnavailableException('Oracle unavailable'));

      await request(app.getHttpServer())
        .post(`/api/v1/approvals/123/${route}`)
        .send(payload)
        .expect(503);
    });

    it('preserves request validation and does not call the procedure for an invalid body', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/approvals/123/${route}`)
        .send({})
        .expect(400);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  it.each([undefined, null])('defaults request-info mode %s to QUESTION', async (mode) => {
    requestInfo.mockResolvedValueOnce(failureResult('Procedure failure'));

    await request(app.getHttpServer())
      .post('/api/v1/approvals/123/request-info')
      .set('lang', 'ar')
      .send({ itemKey: 'item-1', comment: 'Please clarify.', mode })
      .expect(200)
      .expect(({ body: response }) => {
        expect(response.message).toBe('تعذرت معالجة طلب مزيد من المعلومات');
      });
    expect(requestInfo).toHaveBeenCalledWith(expect.objectContaining({ mode: 'QUESTION' }));
  });

  it('retains the default DELEGATE type for reassign', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/approvals/123/reassign')
      .send({ assignTo: 'OTHER.USER' })
      .expect(200)
      .expect(({ body: response }) => expect(response.message).toBe('Re-Assign Approval Processed'));

    expect(reassign).toHaveBeenCalledWith(expect.objectContaining({ type: 'DELEGATE' }));
  });

  describe.each([
    {
      decision: 'APPROVE',
      messages: { en: 'Request Approved Successfully', ar: 'تمت الموافقة على الطلب بنجاح' },
    },
    {
      decision: 'REJECT',
      messages: { en: 'Request Rejected Successfully', ar: 'تم رفض الطلب بنجاح' },
    },
  ] as const)('$decision messages', ({ decision, messages }) => {
    const payload = { itemKey: 'item-1', decision, comment: 'Reviewed.' };

    it.each([
      ['en', undefined, 'en'],
      ['ar', undefined, 'ar'],
      [undefined, undefined, 'en'],
      [undefined, 'ar', 'ar'],
      ['en', 'ar', 'en'],
      ['ar', 'en', 'ar'],
      ['unsupported', 'ar', 'en'],
    ] as const)('localizes success for query=%s header=%s', async (queryLang, headerLang, expectedLang) => {
      const source = Object.freeze({
        ...successResult('Procedure success', { notificationId: '123' }),
        errormessageAr: 'نص الإجراء',
      });
      decide.mockResolvedValueOnce(source);
      const req = request(app.getHttpServer()).post('/api/v1/approvals/123/decision');
      if (queryLang !== undefined) req.query({ lang: queryLang });
      if (headerLang !== undefined) req.set('lang', headerLang);

      const response = await req.send(payload).expect(200);

      expect(response.body).toEqual({
        status: 'success',
        successflag: 'S',
        message: messages[expectedLang],
        httpStatusCode: 200,
        result: source.result,
      });
      expect(decide).toHaveBeenCalledTimes(1);
      expect(decide).toHaveBeenCalledWith({
        ...payload,
        itemType: 'HRSSA',
        username: user.username,
        approvalId: '123',
        lang: expectedLang,
      });
      expect(source.errormessage).toBe('Procedure success');
      expect(source.errormessageAr).toBe('نص الإجراء');
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ responseSummary: expect.objectContaining(response.body) }),
      );
    });

    it.each([
      ['en', undefined, 'en'],
      ['ar', undefined, 'ar'],
      [undefined, undefined, 'en'],
      [undefined, 'ar', 'en'],
      ['en', 'ar', 'en'],
      ['ar', 'en', 'ar'],
    ] as const)('keeps failure text and language handling for query=%s header=%s', async (queryLang, headerLang, expectedLang) => {
      const source = Object.freeze(failureResult('Procedure failure', 'تعذر تنفيذ القرار'));
      decide.mockResolvedValueOnce(source);
      const req = request(app.getHttpServer()).post('/api/v1/approvals/123/decision');
      if (queryLang !== undefined) req.query({ lang: queryLang });
      if (headerLang !== undefined) req.set('lang', headerLang);

      const response = await req.send(payload).expect(200);

      expect(response.body).toEqual({
        status: 'error',
        successflag: 'N',
        message: expectedLang === 'ar' ? source.errormessageAr : source.errormessage,
        httpStatusCode: 200,
      });
    });

    it.each([
      failureResult('Procedure failure'),
      { ...successResult('Procedure failure'), status: 'error' },
      { ...failureResult('Procedure failure'), status: 'success' },
    ])('does not label a non-success result as successful: %j', async (source) => {
      decide.mockResolvedValueOnce(source);

      await request(app.getHttpServer())
        .post('/api/v1/approvals/123/decision?lang=ar')
        .send(payload)
        .expect(200)
        .expect(({ body: response }) => expect(response).toMatchObject({
          status: source.status,
          successflag: source.successflag,
          message: 'Procedure failure',
        }));
    });

    it('preserves exceptions instead of returning a success message', async () => {
      decide.mockRejectedValueOnce(new ServiceUnavailableException('Oracle unavailable'));

      await request(app.getHttpServer())
        .post('/api/v1/approvals/123/decision')
        .send(payload)
        .expect(503);
    });
  });

  it('rejects an invalid decision without calling Oracle', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/approvals/123/decision')
      .send({ itemKey: 'item-1', decision: 'CANCEL' })
      .expect(400);

    expect(decide).not.toHaveBeenCalled();
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
