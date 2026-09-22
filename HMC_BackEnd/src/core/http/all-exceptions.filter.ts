import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Response } from 'express';
import { SanaadErrorEnvelope } from '@shared/interfaces/sanaad-response.interface';
import { toLang } from '@shared/domain/lang';
import { OracleQueryError } from '../database/oracle.error';
import { classifyException } from './exception-classifier';
import {
  CATEGORY_MESSAGE,
  CATEGORY_MESSAGE_AR,
  ErrorCategory,
  GENERIC_ERROR_MESSAGE,
} from './error-category';

interface RequestLike {
  url?: string;
  method?: string;
  correlationId?: string;
  user?: { username?: string; employeeNumber?: string };
  query?: { lang?: string };
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Global exception filter — the single place errors become HTTP responses.
 *
 * It classifies EVERY thrown value (Oracle errors, Nest HttpExceptions, plain
 * bugs) into a safe category + message and returns a consistent envelope. No
 * technical detail (ORA codes, SQL, schema, stack traces, internal messages)
 * ever reaches the client; the full exception is logged server-side instead.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestLike>();

    const classified = classifyException(exception);
    this.logInternal(exception, classified, req);

    // Safety net for a schema mismatch that escaped uncaught (see
    // SchemaColumnNotFoundException): never surface it as a failure — respond
    // like a normal (if incomplete) success instead of an error envelope.
    if (classified.category === ErrorCategory.SCHEMA_MISMATCH) {
      res.status(200).json({ result: {}, opstatus: 0, status: 'success', httpStatusCode: 200 });
      return;
    }

    // `message` picks the language-appropriate safe text (default `en`) —
    // the response body carries only this one resolved message, plus
    // success/status/httpStatusCode; everything else (category, correlation
    // id, timestamp, path) stays server-side only, in logInternal above.
    const header = req?.headers?.lang;
    const lang = toLang(req?.query?.lang ?? (Array.isArray(header) ? header[0] : header));
    const message =
      classified.message === GENERIC_ERROR_MESSAGE.en
        ? GENERIC_ERROR_MESSAGE[lang]
        : lang === 'ar' && classified.message === CATEGORY_MESSAGE[classified.category]
          ? CATEGORY_MESSAGE_AR[classified.category]
          : classified.message;

    const body: SanaadErrorEnvelope = {
      success: false,
      message,
      status: 'error',
      httpStatusCode: classified.httpStatus,
      ...(classified.errors ? { errors: classified.errors } : {}),
    };

    res.status(classified.httpStatus).json(body);
  }

  /**
   * Log the COMPLETE exception for developers: original message, stack, ORA
   * code, request URL/method, authenticated user, correlation id (timestamp is
   * added by the logger). 5xx → error (with stack); 4xx → warn.
   */
  private logInternal(
    exception: unknown,
    classified: ReturnType<typeof classifyException>,
    req: RequestLike,
  ): void {
    const detail = {
      category: classified.category,
      httpStatus: classified.httpStatus,
      method: req?.method,
      url: req?.url,
      user: req?.user?.username ?? req?.user?.employeeNumber ?? 'anonymous',
      correlationId: req?.correlationId ?? '-',
      oraCode: exception instanceof OracleQueryError ? exception.oraCode : undefined,
      originalMessage: exception instanceof Error ? exception.message : String(exception),
    };
    const line =
      `${classified.category} ${classified.httpStatus} ${detail.method ?? ''} ${detail.url ?? ''} ` +
      `user=${detail.user} cid=${detail.correlationId}` +
      `${detail.oraCode ? ` ORA-${detail.oraCode}` : ''} :: ${detail.originalMessage}`;

    if (classified.serverSide) {
      this.logger.error(line, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(line);
    }
  }
}
