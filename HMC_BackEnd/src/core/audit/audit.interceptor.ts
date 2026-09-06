import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AuditContext } from './audit-event';

interface AuditableRequest {
  method: string;
  url: string;
  originalUrl?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  user?: { username?: string };
  correlationId?: string;
}

const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

const errorCode = (err: unknown): string | undefined => {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; code?: string; name?: string };
    return e.code ?? (e.status != null ? String(e.status) : e.name);
  }
  return undefined;
};

/**
 * Level-1 API-call audit for every request (auth + business), emitted from the
 * backend only. Captures success/failure without altering the response.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuditableRequest>();
    const apiName = `${req.method} ${req.originalUrl ?? req.url}`;
    const body = req.body ?? {};
    const correlationHeader = req.headers?.['x-correlation-id'];

    const ctx: AuditContext = {
      username: req.user?.username ?? asString(body.username),
      deviceImei: asString(body.imeinumber) ?? asString(body.deviceimei) ?? asString(body.deviceid),
      platform: asString(body.platform),
      appVersion: asString(body.version) ?? asString(body.appVersion),
      source: req.ip,
      correlationId:
        req.correlationId ??
        (Array.isArray(correlationHeader) ? correlationHeader[0] : asString(correlationHeader)),
    };

    return next.handle().pipe(
      tap({
        next: () => this.audit.apiCall(apiName, { ...ctx, status: 'success' }),
        error: (err: unknown) =>
          this.audit.apiCall(apiName, { ...ctx, status: 'error', errorCode: errorCode(err) }),
      }),
    );
  }
}
