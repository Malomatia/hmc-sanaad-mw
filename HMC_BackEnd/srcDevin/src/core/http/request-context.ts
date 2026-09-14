import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-request context propagated via AsyncLocalStorage (no DI plumbing). */
export interface RequestContextData {
  correlationId?: string;
  method?: string;
  path?: string;
}

/**
 * Ambient request context. Populated by CorrelationIdMiddleware at the start of
 * every request so downstream code (e.g. OracleService logging) can attach the
 * correlation id + route without threading it through every call.
 */
export class RequestContext {
  private static readonly storage = new AsyncLocalStorage<RequestContextData>();

  static run<T>(data: RequestContextData, fn: () => T): T {
    return RequestContext.storage.run(data, fn);
  }

  static get(): RequestContextData | undefined {
    return RequestContext.storage.getStore();
  }
}
