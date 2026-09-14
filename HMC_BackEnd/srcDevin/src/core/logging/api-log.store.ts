import { Injectable } from '@nestjs/common';
import { ApiLogEntry, ApiLogPage, ApiLogQuery, ApiLogStatistics } from './api-log.model';

/** Default "slow request" threshold (ms) used by GET /api-logs/slow and the stats card. */
export const DEFAULT_SLOW_THRESHOLD_MS = 1000;

/**
 * Bounded in-memory index of API log entries — the query engine behind the
 * `/api-logs` endpoints and dashboard. The durable copy of every entry is also
 * appended to disk by ApiLogFileWriter; this store trades durability for fast,
 * filterable/paginated reads (an equivalent trade-off to the existing
 * OracleLogStore). Oldest entries are evicted once `capacity` is reached.
 */
@Injectable()
export class ApiLogStore {
  private readonly capacity = Math.max(200, Number(process.env.API_LOG_BUFFER ?? 5000) || 5000);
  private readonly entries: ApiLogEntry[] = [];
  private seq = 0;

  nextId(): number {
    return ++this.seq;
  }

  record(entry: ApiLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  getById(id: number): ApiLogEntry | undefined {
    return this.entries.find((e) => e.id === id);
  }

  list(query: ApiLogQuery = {}): ApiLogPage {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 500);
    const offset = Math.max(query.offset ?? 0, 0);
    const order = query.order ?? 'desc';
    const sortBy = query.sortBy ?? 'timestamp';

    let filtered = this.entries.filter((e) => this.matches(e, query));
    filtered = filtered
      .slice()
      .sort((a, b) => (a[sortBy] < b[sortBy] ? -1 : a[sortBy] > b[sortBy] ? 1 : 0));
    if (order === 'desc') filtered.reverse();

    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);
    return { total, count: items.length, limit, offset, items };
  }

  statistics(slowThresholdMs = DEFAULT_SLOW_THRESHOLD_MS): ApiLogStatistics {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayIso = startOfDay.toISOString();

    const today = this.entries.filter((e) => e.timestamp >= todayIso);
    const success = today.filter((e) => e.success).length;
    const failed = today.length - success;
    const durations = today.map((e) => e.responseTimeMs);
    const avg = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;
    const slow = today.filter((e) => e.responseTimeMs >= slowThresholdMs).length;
    const activeUsers = new Set(today.map((e) => e.username).filter(Boolean)).size;

    const perHour = new Map<string, number>();
    for (const e of today) {
      const hour = `${e.timestamp.slice(0, 13)}:00`;
      perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
    }

    const byEndpoint = new Map<string, { count: number; totalMs: number }>();
    for (const e of today) {
      const key = e.routeTemplate ?? e.endpoint;
      const agg = byEndpoint.get(key) ?? { count: 0, totalMs: 0 };
      agg.count += 1;
      agg.totalMs += e.responseTimeMs;
      byEndpoint.set(key, agg);
    }
    const topEndpoints = [...byEndpoint.entries()]
      .map(([endpoint, v]) => ({
        endpoint,
        count: v.count,
        averageResponseTimeMs: Math.round(v.totalMs / v.count),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const byCategory = new Map<string, number>();
    for (const e of today) {
      if (!e.errorCategory) continue;
      byCategory.set(e.errorCategory, (byCategory.get(e.errorCategory) ?? 0) + 1);
    }

    const byMethod = new Map<string, number>();
    for (const e of today) {
      byMethod.set(e.method, (byMethod.get(e.method) ?? 0) + 1);
    }

    return {
      totalRequestsToday: today.length,
      successfulRequests: success,
      failedRequests: failed,
      averageResponseTimeMs: avg,
      slowRequests: slow,
      activeUsers,
      requestsPerHour: [...perHour.entries()]
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => (a.hour < b.hour ? -1 : 1)),
      successVsErrors: { success, error: failed },
      responseTimeTrend: today
        .slice(-100)
        .map((e) => ({ timestamp: e.timestamp, responseTimeMs: e.responseTimeMs })),
      topEndpoints,
      errorCategories: [...byCategory.entries()].map(([category, count]) => ({ category, count })),
      requestsByMethod: [...byMethod.entries()].map(([method, count]) => ({ method, count })),
      bufferCapacity: this.capacity,
      bufferSize: this.entries.length,
    };
  }

  clear(): number {
    const n = this.entries.length;
    this.entries.length = 0;
    return n;
  }

  private matches(e: ApiLogEntry, q: ApiLogQuery): boolean {
    if (q.requestId && e.requestId !== q.requestId) return false;
    if (q.method && e.method.toUpperCase() !== q.method.toUpperCase()) return false;
    if (q.endpoint) {
      const needle = q.endpoint.toLowerCase();
      const haystack = `${e.endpoint} ${e.routeTemplate ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (q.statusCode !== undefined && e.statusCode !== q.statusCode) return false;
    if (q.success !== undefined && e.success !== q.success) return false;
    if (q.errorCategory && e.errorCategory !== q.errorCategory) return false;
    if (q.userId && e.userId !== q.userId) return false;
    if (q.username && e.username !== q.username) return false;
    if (q.minDurationMs !== undefined && e.responseTimeMs < q.minDurationMs) return false;
    if (q.since && e.timestamp < q.since) return false;
    if (q.until && e.timestamp > q.until) return false;
    return true;
  }
}
