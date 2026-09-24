import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * The gateway parses the body before proxying, so an oversized submit is
 * rejected HERE — the backend never sees it. body-parser throws an http-errors
 * object rather than an HttpException, so it used to answer 500 "Internal
 * server error" for what is really "your attachment is too big", sending the
 * caller after a server bug. These cases pin the 413 and its message.
 */
describe('gateway: oversized request body', () => {
  function host(queryLang?: string, headerLang?: string): { host: ArgumentsHost; sent: () => { status: number; body: unknown } } {
    let status = 0;
    let body: unknown;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    };
    const req = { method: 'POST', url: '/api/v1/dependents', query: { lang: queryLang }, headers: { lang: headerLang } };
    return {
      host: {
        switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
      } as unknown as ArgumentsHost,
      sent: () => ({ status, body: body as Record<string, unknown> }),
    };
  }

  /** What body-parser actually throws. */
  function bodyParserError(): Error {
    const err = new Error('request entity too large') as Error & {
      type: string;
      status: number;
    };
    err.type = 'entity.too.large';
    err.status = 413;
    return err;
  }

  it('answers 413 with an actionable message, not 500', () => {
    const { host: h, sent } = host();

    new AllExceptionsFilter().catch(bodyParserError(), h);

    const { status, body } = sent();
    expect(status).toBe(HttpStatus.PAYLOAD_TOO_LARGE);
    expect((body as { message: string }).message).toMatch(/too large/i);
    expect((body as { message: string }).message).toMatch(/compress/i);
  });

  it.each([
    ['ar', undefined, true],
    [undefined, 'ar', true],
    ['en', 'ar', false],
    ['ar', 'en', true],
    ['unsupported', 'ar', false],
    [undefined, undefined, false],
  ] as const)('localizes generic failures for query=%s header=%s', (query, header, arabic) => {
    for (const error of [new Error('private detail'), new HttpException('private detail', 500), 'unknown']) {
      const { host: h, sent } = host(query, header);
      new AllExceptionsFilter().catch(error, h);
      expect(sent()).toEqual({
        status: 500,
        body: {
          status: 'error',
          message: arabic
            ? 'حدث خطأ ما. يرجى المحاولة مرة أخرى. إذا استمرت المشكلة، يرجى التواصل مع فريق دعم عونك.'
            : 'Something went wrong. Please try again. If the issue persists, contact Ounak Support.',
          httpStatusCode: 500,
        },
      });
    }
  });

  it('leaves other failures on 500', () => {
    const { host: h, sent } = host();

    new AllExceptionsFilter().catch(new Error('backend unreachable'), h);

    expect(sent().status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('still honours an explicit HttpException status', () => {
    const { host: h, sent } = host();

    new AllExceptionsFilter().catch(new HttpException('nope', HttpStatus.UNAUTHORIZED), h);

    expect(sent().status).toBe(HttpStatus.UNAUTHORIZED);
  });
});
