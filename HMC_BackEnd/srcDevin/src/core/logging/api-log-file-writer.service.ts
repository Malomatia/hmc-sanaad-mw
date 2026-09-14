import { Injectable, Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ApiLogEntry } from './api-log.model';

/**
 * Durable persistence for API log entries: one JSON line per request, appended
 * to a file rotated daily (`api-YYYY-MM-DD.log`). This is the source of truth
 * that survives restarts and can be shipped to a log aggregator / grepped
 * directly; ApiLogStore is the fast in-memory index used to serve the
 * `/api-logs` query API.
 *
 * Directory: `API_LOG_DIR` env (default `logs/api`, relative to process cwd).
 * Disable entirely with `API_LOG_TO_FILE=false` (e.g. read-only containers).
 */
@Injectable()
export class ApiLogFileWriter {
  private readonly logger = new Logger(ApiLogFileWriter.name);
  private readonly enabled = process.env.API_LOG_TO_FILE !== 'false';
  private readonly dir = process.env.API_LOG_DIR || join(process.cwd(), 'logs', 'api');
  private dirReady: Promise<void> | undefined;

  /** Fire-and-forget: never lets a logging failure affect the request. */
  write(entry: ApiLogEntry): void {
    if (!this.enabled) return;
    this.append(entry).catch((err) => {
      this.logger.error(`Failed to write API log entry #${entry.id}: ${(err as Error).message}`);
    });
  }

  private async append(entry: ApiLogEntry): Promise<void> {
    await this.ensureDir();
    const file = join(this.dir, `api-${entry.timestamp.slice(0, 10)}.log`);
    await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  private ensureDir(): Promise<void> {
    if (!this.dirReady) {
      this.dirReady = mkdir(this.dir, { recursive: true }).then(() => undefined);
    }
    return this.dirReady;
  }
}
