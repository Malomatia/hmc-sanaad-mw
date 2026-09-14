import { ErrorCategory } from '../http/error-category';

/**
 * One API request/response log record. Populated entirely by ApiLogInterceptor
 * — no controller ever constructs one of these directly.
 */
export interface ApiLogEntry {
  id: number;
  requestId: string;
  timestamp: string;
  method: string;
  endpoint: string;
  /** Route pattern (e.g. `/profile`) — stable across different `enum`/ids, used for grouping in stats. */
  routeTemplate?: string;
  routeParams?: Record<string, unknown>;
  queryParams?: Record<string, unknown>;
  requestBody?: unknown;
  statusCode: number;
  responseTimeMs: number;
  success: boolean;
  userId?: string;
  username?: string;
  ip?: string;
  userAgent?: string;
  module?: string;
  action?: string;
  environment: string;
  /** Safe, size-bounded preview of what was actually returned (success only). */
  responseSummary?: unknown;
  errorCategory?: ErrorCategory;
  /** Safe, client-facing message (same one the caller received). */
  errorMessage?: string;
  // ── Internal-only detail (never returned by a client-facing endpoint elsewhere) ──
  originalErrorMessage?: string;
  stackTrace?: string;
  oraCode?: number;
  validationErrors?: unknown;
  fileName?: string;
  functionName?: string;
}

export interface ApiLogQuery {
  requestId?: string;
  method?: string;
  /** Substring match on endpoint/routeTemplate. */
  endpoint?: string;
  statusCode?: number;
  success?: boolean;
  errorCategory?: ErrorCategory;
  userId?: string;
  username?: string;
  /** Only entries with responseTimeMs >= this. */
  minDurationMs?: number;
  /** ISO timestamps, inclusive range. */
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
  sortBy?: 'timestamp' | 'responseTimeMs';
}

export interface ApiLogPage {
  total: number;
  count: number;
  limit: number;
  offset: number;
  items: ApiLogEntry[];
}

export interface ApiLogStatistics {
  totalRequestsToday: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTimeMs: number;
  slowRequests: number;
  activeUsers: number;
  requestsPerHour: { hour: string; count: number }[];
  successVsErrors: { success: number; error: number };
  responseTimeTrend: { timestamp: string; responseTimeMs: number }[];
  topEndpoints: { endpoint: string; count: number; averageResponseTimeMs: number }[];
  errorCategories: { category: string; count: number }[];
  requestsByMethod: { method: string; count: number }[];
  bufferCapacity: number;
  bufferSize: number;
}
