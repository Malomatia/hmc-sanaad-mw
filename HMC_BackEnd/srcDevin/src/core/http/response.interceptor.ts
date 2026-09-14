import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { isSubmitResult } from '@shared/domain/submit-result';
import { toLang } from '@shared/domain/lang';
import { localizeArTwins } from '@shared/utils/localize.util';
import { SanaadEnvelope } from '@shared/interfaces/sanaad-response.interface';

const SUCCESS_MESSAGES = { en: 'Success', ar: 'تم الأرسال' } as const;

/** Routes decorated with @SkipEnvelope() return their payload unwrapped (e.g. binary payslip). */
export const SKIP_ENVELOPE = 'skipEnvelope';
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE, true);

/**
 * Standardizes success responses into the Sanaad envelope. Action results
 * (SubmitResult from `_PR`/`_PKG`) get the action envelope; everything else the
 * read envelope. See Docs_Ai/Architecture/README.md section 4.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor<unknown, SanaadEnvelope | unknown> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<SanaadEnvelope | unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ENVELOPE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const http = context.switchToHttp();
    const res = http.getResponse<{ statusCode?: number }>();
    const req = http.getRequest<{
      query?: { lang?: string };
      headers?: Record<string, string | string[] | undefined>;
    }>();

    return next.handle().pipe(
      map((data): SanaadEnvelope | unknown => {
        if (skip) return data;
        const httpStatusCode = res?.statusCode ?? 200;
        const lang = toLang(req?.query?.lang);

        if (isSubmitResult(data)) {
          // `lang` (default `en`) picks a single `message` — the client never
          // sees errormessage/errormessageAr, only the one that matches its
          // request language; falls back to the English text if the Arabic
          // one isn't set.
          const header = req?.headers?.lang;
          const successLang = toLang(req?.query?.lang ?? (Array.isArray(header) ? header[0] : header));
          const message =
            data.status === 'success' && data.successflag === 'S'
              ? SUCCESS_MESSAGES[successLang]
              : lang === 'ar'
                ? (data.errormessageAr ?? data.errormessage)
                : data.errormessage;
          return {
            status: data.status,
            successflag: data.successflag,
            message,
            httpStatusCode,
            result: localizeArTwins(data.result, lang),
          };
        }

        // Same rule for every English/Arabic column twin in read payloads
        // (PHONE_TYPE/PHONE_TYPE_AR, meaning/meaningAr, VALUE/VALUEAR, ...):
        // the base field carries the value for the requested language and the
        // Arabic twin is dropped. See localizeArTwins.
        return {
          result: localizeArTwins(data, lang),
          opstatus: 0 as const,
          status: 'success' as const,
          httpStatusCode,
        };
      }),
    );
  }
}
