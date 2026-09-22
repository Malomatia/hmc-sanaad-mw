import { Body, Controller, Get, HttpCode, INestApplication, InternalServerErrorException, Param, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BaseOracleRepository } from '../database/base.repository';
import { OracleQueryError } from '../database/oracle.error';
import { OracleService } from '../database/oracle.service';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ResponseInterceptor } from './response.interceptor';

const RAW_ERROR = 'ORA-01403: no data found\nORA-06512: at "APPS.XXHMC_SND_TEST", line 12';
const FALLBACK = {
  en: 'Something went wrong. Please try again. If the issue persists, contact Ounak Support.',
  ar: 'حدث خطأ ما. يرجى المحاولة مرة أخرى. إذا استمرت المشكلة، يرجى التواصل مع فريق دعم عونك.',
};
const LANG_CASES = [
  ['en', undefined, 'en'],
  ['ar', undefined, 'ar'],
  [undefined, 'ar', 'ar'],
  ['en', 'ar', 'en'],
  ['ar', 'en', 'ar'],
  [undefined, undefined, 'en'],
  ['unsupported', 'ar', 'en'],
] as const;

class TestRepository extends BaseOracleRepository {
  submit(out = { p_success_flag: 'N', p_error_msg: RAW_ERROR }) {
    return this.toSubmitResult(out);
  }
}

@Controller('oracle-errors')
class TestController {
  @Post('submit')
  @HttpCode(200)
  submit() {
    return new TestRepository({} as OracleService).submit();
  }

  @Get('query')
  query() {
    throw new OracleQueryError(RAW_ERROR);
  }

  @Post('flex')
  @HttpCode(200)
  flex(@Body() out: { p_success_flag: string; p_error_msg: string }) {
    return new TestRepository({} as OracleService).submit(out);
  }

  @Get('failure/:kind')
  failure(@Param('kind') kind: string) {
    if (kind === 'application') throw new Error('private implementation detail');
    if (kind === 'http') throw new InternalServerErrorException('private implementation detail');
    if (kind === 'unknown') throw 'private implementation detail';
    if (kind === 'business') throw new OracleQueryError('ORA-20001: FLEX-VALUE DOES NOT EXIST');
    if (kind === 'unresolved') throw new OracleQueryError('ORA-01403: FLEX value not found');
    throw new OracleQueryError('ORA-00942: failed in flex validation');
  }
}

describe('Oracle error descriptions on the API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [TestController] }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe.each(LANG_CASES)('fallback for query=%s header=%s', (query, header, lang) => {
    it.each([
      ['application', 500],
      ['http', 500],
      ['unknown', 500],
      ['business', 409],
      ['unresolved', 422],
      ['database', 500],
    ] as const)('localizes %s errors without changing HTTP %s', async (kind, status) => {
      const req = request(app.getHttpServer()).get(`/oracle-errors/failure/${kind}`);
      if (query !== undefined) req.query({ lang: query });
      if (header !== undefined) req.set('lang', header);
      await req.expect(status).expect({
        success: false,
        status: 'error',
        message: FALLBACK[lang],
        httpStatusCode: status,
      });
    });

    it.each([
      { p_error_msg: 'ORA-20001: FLEX-VALUE DOES NOT EXIST', p_error_msg_ar: 'رسالة أخرى' },
      { p_message: 'FLEX-NULL', p_error_msg: '' },
      { p_error_msg: 'flexfield validation failed' },
      { p_error_msg: 'Rejected', p_error_msg_ar: encodeURIComponent('FLEX خطأ') },
    ])('localizes FLEX OUT messages: %j', async (out) => {
      const req = request(app.getHttpServer())
        .post('/oracle-errors/flex')
        .send({ p_success_flag: 'N', ...out });
      if (query !== undefined) req.query({ lang: query });
      if (header !== undefined) req.set('lang', header);
      await req.expect(200).expect({
        status: 'error',
        successflag: 'N',
        message: FALLBACK[lang],
        httpStatusCode: 200,
      });
    });
  });

  it('does not treat successful FLEX text as an error', async () => {
    await request(app.getHttpServer())
      .post('/oracle-errors/flex')
      .send({ p_success_flag: 'S', p_error_msg: 'FLEX operation completed' })
      .expect(200)
      .expect({ status: 'success', successflag: 'S', message: 'Success', httpStatusCode: 200 });
  });

  it.each(['en', 'ar'])('keeps HTTP 200 for a failed submit with lang=%s', async (lang) => {
    await request(app.getHttpServer())
      .post('/oracle-errors/submit')
      .query({ lang })
      .expect(200)
      .expect({
        status: 'error',
        successflag: 'N',
        message: 'no data found',
        httpStatusCode: 200,
      });
  });

  it.each(['en', 'ar'])('keeps HTTP 422 for a thrown no-data error with lang=%s', async (lang) => {
    await request(app.getHttpServer())
      .get('/oracle-errors/query')
      .query({ lang })
      .expect(422)
      .expect({
        success: false,
        status: 'error',
        message: 'no data found',
        httpStatusCode: 422,
      });
  });
});
