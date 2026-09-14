import { Injectable, NotFoundException } from '@nestjs/common';
import { ApiLogEntry, ApiLogPage, ApiLogQuery, ApiLogStatistics } from './api-log.model';
import { ApiLogStore, DEFAULT_SLOW_THRESHOLD_MS } from './api-log.store';

/** Application service for the API-logs monitoring module (Controller → Service → Store). */
@Injectable()
export class ApiLogsService {
  constructor(private readonly store: ApiLogStore) {}

  list(query: ApiLogQuery): ApiLogPage {
    return this.store.list(query);
  }

  getById(id: number): ApiLogEntry {
    const entry = this.store.getById(id);
    if (!entry) throw new NotFoundException(`API log entry ${id} was not found.`);
    return entry;
  }

  errors(query: ApiLogQuery): ApiLogPage {
    return this.store.list({ ...query, success: false });
  }

  success(query: ApiLogQuery): ApiLogPage {
    return this.store.list({ ...query, success: true });
  }

  slow(query: ApiLogQuery & { minDurationMs?: number }): ApiLogPage {
    return this.store.list({
      ...query,
      minDurationMs: query.minDurationMs ?? DEFAULT_SLOW_THRESHOLD_MS,
    });
  }

  statistics(slowThresholdMs?: number): ApiLogStatistics {
    return this.store.statistics(slowThresholdMs);
  }

  clear(): { cleared: number } {
    return { cleared: this.store.clear() };
  }
}
