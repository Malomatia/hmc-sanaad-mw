import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { DECORATORS } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { AuditContext } from './audit-event';

interface AuditableRequest {
  method: string;
  url: string;
  originalUrl?: string;
  route?: { path?: string };
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  user?: { username?: string; claims?: Record<string, unknown> };
  correlationId?: string;
}

const asString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

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
    const res = context.switchToHttp().getResponse<{ statusCode?: number }>();
    const handlerName = `${context.getClass().name}.${context.getHandler().name}`;
    const operation = Reflect.getMetadata(DECORATORS.API_OPERATION, context.getHandler()) as
      { operationId?: string } | undefined;
    const apiName = `${req.method} ${req.route?.path ?? handlerName}`;
    const body = asRecord(req.body);
    const claims = req.user?.claims ?? {};
    const correlationHeader = req.headers?.['x-correlation-id'];

    const ctx: AuditContext = {
      username: req.user?.username ?? asString(body.username),
      deviceImei:
        asString(claims.deviceImei) ??
        asString(body.imeinumber) ??
        asString(body.deviceimei) ??
        asString(body.deviceid) ??
        asString(body.imei),
      platform: asString(claims.platform) ?? asString(body.platform),
      appName: asString(claims.appName) ?? asString(body.appname) ?? asString(body.appName),
      appVersion:
        asString(claims.appVersion) ?? asString(body.version) ?? asString(body.appVersion),
      functionId: operation?.operationId ?? handlerName,
      source: req.ip,
      correlationId:
        req.correlationId ??
        (Array.isArray(correlationHeader) ? correlationHeader[0] : asString(correlationHeader)),
    };

    return next.handle().pipe(
      tap({
        next: (value) => {
          const data = asRecord(value);
          const status =
            (res.statusCode ?? 200) >= 400 ||
            ['error', 'failed', 'failure'].includes(asString(data.status)?.toLowerCase() ?? '') ||
            data.success === false ||
            (typeof data.successflag === 'string' && data.successflag.toUpperCase() !== 'S')
              ? 'error'
              : 'success';
          const username =
            ctx.functionId === 'auth_login' && status === 'success'
              ? (asString(data.employeeusername) ?? ctx.username)
              : ctx.username;
          this.audit.apiCall(apiName, { ...ctx, username, status });
        },
        error: (err: unknown) =>
          this.audit.apiCall(apiName, { ...ctx, status: 'error', errorCode: errorCode(err) }),
      }),
    );
  }
}
