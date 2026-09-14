import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { RequestContext } from './request-context';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Attaches a correlation id to each request (reused from header if present). */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request & { correlationId?: string }, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_ID_HEADER];
    const correlationId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    req.correlationId = correlationId;
    res.setHeader(CORRELATION_ID_HEADER, correlationId);
    // Propagate to ambient context so non-request-scoped services (OracleService
    // call logging) can tag records with the correlation id + route.
    RequestContext.run({ correlationId, method: req.method, path: req.originalUrl }, () => next());
  }
}
