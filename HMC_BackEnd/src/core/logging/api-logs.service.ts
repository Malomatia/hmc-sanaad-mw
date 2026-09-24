import { Injectable } from '@nestjs/common';
import { ApiLogPage, ApiLogQuery } from './api-log.model';
import { ApiLogStore } from './api-log.store';

/** Application service for the API-logs monitoring module (Controller → Service → Store). */
@Injectable()
export class ApiLogsService {
  constructor(private readonly store: ApiLogStore) {}

  list(query: ApiLogQuery): ApiLogPage {
    return this.store.list(query);
  }
}
