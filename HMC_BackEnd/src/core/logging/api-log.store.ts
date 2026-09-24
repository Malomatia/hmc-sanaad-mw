import { Injectable } from '@nestjs/common';
import { ApiLogEntry, ApiLogPage, ApiLogQuery } from './api-log.model';

/**
 * Bounded in-memory index of API log entries — the query engine behind the
 * `/api-logs` endpoint. The durable copy of every entry is also
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
