import { Injectable } from '@nestjs/common';

export type OracleCallOp = 'query' | 'call' | 'callCursor';
export type OracleCallStatus = 'success' | 'error';

/** One structured record of an Oracle call (start + outcome merged). */
export interface OracleLogEntry {
  id: number;
  timestamp: string;
  op: OracleCallOp;
  object: string;
  status: OracleCallStatus;
  durationMs: number;
  rowCount?: number;
  outKeys?: string[];
  oraCode?: number;
  error?: string;
  correlationId?: string;
  method?: string;
  path?: string;
  binds: Record<string, string>;
  sql?: string;
  /**
   * The SQL with its bind values substituted in — string values single-quoted,
   * NULLs and OUT markers preserved — i.e. the statement as Oracle effectively
   * receives it. Built from the sanitized binds, so redacted/OUT values stay
   * redacted. A diagnostic aid, not the literal wire text.
   */
  finalSql?: string;
  /**
   * What Oracle returned (rows or OUT-bind values), stored AS-IS — no
   * redaction, truncation or row caps (only non-serializable driver objects
   * like ResultSets/LOBs are tagged, and BLOB Buffers described by size).
   */
  response?: unknown;
}

/** Filter/pagination options for `list`. */
export interface OracleLogQuery {
  status?: OracleCallStatus;
  object?: string;
  op?: OracleCallOp;
  correlationId?: string;
  oraCode?: number;
  /** Matches the enum/username value across binds, path (`?enum=`) and SQL. */
  enum?: string;
  /** Only entries newer than this ISO timestamp. */
  since?: string;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

export interface OracleLogPage {
  total: number;
  count: number;
  limit: number;
  offset: number;
  items: OracleLogEntry[];
}

export interface OracleLogStats {
  total: number;
  success: number;
  error: number;
  capacity: number;
  avgDurationMs: number | null;
  byObject: { object: string; count: number; errors: number }[];
  oldest: string | null;
  newest: string | null;
}

/**
 * Bounded in-memory ring buffer of Oracle call records, populated by
 * OracleService and served by the diagnostics API. Capacity-limited so it never
 * grows unbounded; oldest records are evicted first. Not persisted across
 * restarts (diagnostic aid, not an audit log).
 */
@Injectable()
export class OracleLogStore {
  /** Max retained records (override via ORACLE_LOG_BUFFER env). */
  private readonly capacity = Math.max(
    50,
    Number(process.env.ORACLE_LOG_BUFFER ?? 1000) || 1000,
  );
  private readonly entries: OracleLogEntry[] = [];

  record(entry: OracleLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  list(query: OracleLogQuery = {}): OracleLogPage {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 1000);
    const offset = Math.max(query.offset ?? 0, 0);
    const order = query.order ?? 'desc';

    let filtered = this.entries.filter((e) => {
      if (query.status && e.status !== query.status) return false;
      if (query.op && e.op !== query.op) return false;
      if (query.correlationId && e.correlationId !== query.correlationId) return false;
      if (query.oraCode !== undefined && e.oraCode !== query.oraCode) return false;
      if (query.object && !e.object.toUpperCase().includes(query.object.toUpperCase())) return false;
      if (query.since && e.timestamp < query.since) return false;
      if (query.enum && !OracleLogStore.matchesEnum(e, query.enum)) return false;
      return true;
    });

    if (order === 'desc') filtered = filtered.slice().reverse();
    const total = filtered.length;
    const items = filtered.slice(offset, offset + limit);
    return { total, count: items.length, limit, offset, items };
  }

  stats(): OracleLogStats {
    const total = this.entries.length;
    const success = this.entries.filter((e) => e.status === 'success').length;
    const durations = this.entries.map((e) => e.durationMs).filter((d) => Number.isFinite(d));
    const avg = durations.length
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;

    const byObjectMap = new Map<string, { count: number; errors: number }>();
    for (const e of this.entries) {
      const agg = byObjectMap.get(e.object) ?? { count: 0, errors: 0 };
      agg.count += 1;
      if (e.status === 'error') agg.errors += 1;
      byObjectMap.set(e.object, agg);
    }
    const byObject = [...byObjectMap.entries()]
      .map(([object, v]) => ({ object, ...v }))
      .sort((a, b) => b.count - a.count);

    return {
      total,
      success,
      error: total - success,
      capacity: this.capacity,
      avgDurationMs: avg,
      byObject,
      oldest: this.entries[0]?.timestamp ?? null,
      newest: this.entries[total - 1]?.timestamp ?? null,
    };
  }

  clear(): number {
    const n = this.entries.length;
    this.entries.length = 0;
    return n;
  }

  /**
   * Whether the enum/username `value` appears in an entry — matched across the
   * bind values, the request path (`?enum=`/`?username=`) and the SQL literal,
   * so it works whether the value was bound or inlined. Case-insensitive.
   */
  private static matchesEnum(entry: OracleLogEntry, value: string): boolean {
    const needle = value.toLowerCase();
    const bindHit = Object.values(entry.binds).some((v) => v.toLowerCase().includes(needle));
    const pathHit = (entry.path ?? '').toLowerCase().includes(needle);
    const sqlHit = (entry.sql ?? '').toLowerCase().includes(needle);
    const finalSqlHit = (entry.finalSql ?? '').toLowerCase().includes(needle);
    return bindHit || pathHit || sqlHit || finalSqlHit;
  }
}
