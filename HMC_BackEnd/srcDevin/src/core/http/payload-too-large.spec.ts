import { HttpException, HttpStatus } from '@nestjs/common';
import { classifyException } from './exception-classifier';
import { ErrorCategory } from './error-category';

/**
 * Attachments travel as base64 inside the JSON body, so an oversized upload is
 * a routine client mistake. body-parser rejects it with an http-errors object,
 * which is a plain Error rather than an HttpException — so it fell through to
 * APPLICATION_ERROR and answered 500 "Internal server error". A 2 MB file
 * therefore looked like a server fault instead of "compress the file", which
 * is exactly how it was reported. These cases pin the 413.
 */
describe('oversized request body', () => {
  /** What body-parser actually throws (http-errors PayloadTooLargeError). */
  function bodyParserError(): Error {
    const err = new Error('request entity too large') as Error & {
      type: string;
      status: number;
      statusCode: number;
      expected: number;
      length: number;
      limit: number;
    };
    err.type = 'entity.too.large';
    err.status = 413;
    err.statusCode = 413;
    err.expected = 2_796_202;
    err.length = 2_796_202;
    err.limit = 102_400;
    return err;
  }

  it('answers 413, not 500', () => {
    const classified = classifyException(bodyParserError());

    expect(classified.httpStatus).toBe(413);
    expect(classified.category).toBe(ErrorCategory.PAYLOAD_TOO_LARGE);
  });

  it('is logged as a client fault, so it does not page anyone', () => {
    expect(classifyException(bodyParserError()).serverSide).toBe(false);
  });

  it('tells the caller what to do about it', () => {
    const { message } = classifyException(bodyParserError());

    // actionable, and no internal detail (limits/paths/SQL) leaked
    expect(message).toMatch(/too large/i);
    expect(message).toMatch(/compress/i);
    expect(message).not.toMatch(/102400|entity\.too\.large|node_modules/);
  });

  it('recognises the error by status alone, if `type` ever changes', () => {
    const err = new Error('too big') as Error & { status: number };
    err.status = 413;

    expect(classifyException(err).httpStatus).toBe(413);
  });

  it('leaves ordinary bugs on 500', () => {
    const classified = classifyException(new Error('null is not a function'));

    expect(classified.httpStatus).toBe(500);
    expect(classified.category).toBe(ErrorCategory.APPLICATION_ERROR);
  });

  it('still lets a real HttpException decide its own status', () => {
    const classified = classifyException(
      new HttpException('nope', HttpStatus.FORBIDDEN),
    );

    expect(classified.httpStatus).toBe(403);
  });
});
