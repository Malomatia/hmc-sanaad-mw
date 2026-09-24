import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

interface RequestLike {
  url?: string;
  method?: string;
  correlationId?: string;
  query?: { lang?: string };
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Global exception filter for gateway-originated errors (auth failures,
 * throttling, and — most importantly — proxy failures when HMC_BackEnd is
 * unreachable/times out). Returns a deliberately minimal envelope; the
 * gateway is not the source of truth for HMC_BackEnd's full SanaadEnvelope
 * error shape, so it does not attempt to reproduce it here. Responses that
 * originate FROM the backend are streamed through by ProxyService untouched
 * and never reach this filter.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<RequestLike>();

    const httpStatus = this.resolveStatus(exception);
    const header = req?.headers?.lang;
    const lang = req?.query?.lang ?? (Array.isArray(header) ? header[0] : header);
    const message =
      httpStatus === HttpStatus.INTERNAL_SERVER_ERROR
        ? lang === 'ar'
          ? 'حدث خطأ ما. يرجى المحاولة مرة أخرى. إذا استمرت المشكلة، يرجى التواصل مع فريق دعم عونك.'
          : 'Something went wrong. Please try again. If the issue persists, contact Ounak Support.'
        : this.resolveMessage(exception, httpStatus);

    const line = `${httpStatus} ${req?.method ?? ''} ${req?.url ?? ''} cid=${req?.correlationId ?? '-'} :: ${message}`;
    if (httpStatus >= 500) {
      this.logger.error(line, exception instanceof Error ? exception.stack : undefined);
    } else {
      this.logger.warn(line);
    }

    res.status(httpStatus).json({
      status: 'error',
      message,
      httpStatusCode: httpStatus,
    });
  }

  /**
   * body-parser rejects an over-limit body with an http-errors object, which
   * is a plain Error rather than an HttpException — so it used to fall to 500
   * "Internal server error". Since submits carry base64 attachments, that is a
   * routine client mistake and 500 sends the caller looking for a server bug.
   * Matched structurally (`type`/`status`) so it survives a body-parser bump.
   */
  private isPayloadTooLarge(exception: unknown): boolean {
    const err = exception as { type?: unknown; status?: unknown; statusCode?: unknown };
    return err?.type === 'entity.too.large' || err?.status === 413 || err?.statusCode === 413;
  }

  private resolveStatus(exception: unknown): number {
    if (exception instanceof HttpException) return exception.getStatus();
    if (this.isPayloadTooLarge(exception)) return HttpStatus.PAYLOAD_TOO_LARGE;
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveMessage(exception: unknown, httpStatus: number): string {
    if (httpStatus === HttpStatus.PAYLOAD_TOO_LARGE) {
      return (
        'The request is too large. Attachments are sent as base64, which makes them about a ' +
        'third bigger than the file — compress the file and try again.'
      );
    }
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const msg = (response as { message: unknown }).message;
        return Array.isArray(msg) ? msg.join('; ') : String(msg);
      }
      return exception.message;
    }
    return exception instanceof Error ? exception.message : 'Unknown error';
  }
}
