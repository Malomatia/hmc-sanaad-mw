import { Controller, Get, HttpCode, INestApplication, Post } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BaseOracleRepository } from '../database/base.repository';
import { OracleQueryError } from '../database/oracle.error';
import { OracleService } from '../database/oracle.service';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ResponseInterceptor } from './response.interceptor';

const RAW_ERROR = 'ORA-01403: no data found\nORA-06512: at "APPS.XXHMC_SND_TEST", line 12';

class TestRepository extends BaseOracleRepository {
  submit() {
    return this.toSubmitResult({ p_success_flag: 'N', p_error_msg: RAW_ERROR });
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
}

describe('Oracle error descriptions on the API', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ controllers: [TestController] }).compile();
    app = module.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor(new Reflector()));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
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
