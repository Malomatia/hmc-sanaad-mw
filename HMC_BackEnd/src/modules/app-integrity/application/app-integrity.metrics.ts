import { Injectable } from '@nestjs/common';
import { IntegrityPlatform } from '../domain/attestation';

/** Platform of a request that carried no usable attestation headers at all. */
export type ObservedPlatform = IntegrityPlatform | 'none';

export interface IntegrityCounters {
  /** Requests the guard actually judged (skipped routes are not counted). */
  observed: number;
  /** Verified successfully. */
  passed: number;
  /** Failed verification: refused in `enforce`, allowed in `observe`. */
  failed: number;
}

export interface IntegrityMetricsSnapshot extends IntegrityCounters {
  since: string;
  byPlatform: Record<ObservedPlatform, IntegrityCounters>;
  /** Failure counts per normalised reason, highest first. */
  byReason: Array<{ platform: ObservedPlatform; reason: string; count: number }>;
  lastFailure?: { at: string; platform: ObservedPlatform; reason: string; route: string };
}

/**
 * Counters behind the `observe` rollout.
 *
 * A warning per rejected request answers "did this one fail"; it does not
 * answer "what fraction of Android traffic would enforcement refuse, and for
 * which verdict", which is the number the mode switch actually depends on.
 * Log aggregation could produce it, but the deployment has none, so the
 * counts are kept here and read from `GET /app-integrity/metrics`.
 *
 * In-process and reset by a restart — deliberately: this measures a rollout
 * over hours, not a billing record, and a table would put a write on every
 * request the guard sees.
 */
@Injectable()
export class AppIntegrityMetrics {
  /** Cap on distinct reasons kept, so a reason carrying a variable part
   * (a Google error message) cannot grow the map without bound. */
  private static readonly MAX_REASONS = 200;

  private started = new Date();
  private totals: IntegrityCounters = { observed: 0, passed: 0, failed: 0 };
  private platforms = new Map<ObservedPlatform, IntegrityCounters>();
  private reasons = new Map<string, number>();
  private last?: { at: string; platform: ObservedPlatform; reason: string; route: string };

  record(input: {
    platform: ObservedPlatform;
    ok: boolean;
    reason?: string;
    route?: string;
  }): void {
    this.totals.observed += 1;
    const platform = this.counters(input.platform);
    platform.observed += 1;

    if (input.ok) {
      this.totals.passed += 1;
      platform.passed += 1;
      return;
    }

    this.totals.failed += 1;
    platform.failed += 1;

    const reason = AppIntegrityMetrics.normalise(input.reason);
    const key = `${input.platform}|${reason}`;
    if (this.reasons.has(key) || this.reasons.size < AppIntegrityMetrics.MAX_REASONS) {
      this.reasons.set(key, (this.reasons.get(key) ?? 0) + 1);
    }
    this.last = {
      at: new Date().toISOString(),
      platform: input.platform,
      reason,
      route: input.route ?? '',
    };
  }

  snapshot(): IntegrityMetricsSnapshot {
    const byPlatform = {} as Record<ObservedPlatform, IntegrityCounters>;
    for (const platform of ['ios', 'android', 'none'] as ObservedPlatform[]) {
      byPlatform[platform] = { ...this.counters(platform) };
    }
    return {
      ...this.totals,
      since: this.started.toISOString(),
      byPlatform,
      byReason: [...this.reasons.entries()]
        .map(([key, count]) => {
          const [platform, reason] = key.split('|');
          return { platform: platform as ObservedPlatform, reason, count };
        })
        .sort((a, b) => b.count - a.count),
      ...(this.last ? { lastFailure: this.last } : {}),
    };
  }

  reset(): void {
    this.started = new Date();
    this.totals = { observed: 0, passed: 0, failed: 0 };
    this.platforms.clear();
    this.reasons.clear();
    this.last = undefined;
  }

  private counters(platform: ObservedPlatform): IntegrityCounters {
    let counters = this.platforms.get(platform);
    if (!counters) {
      counters = { observed: 0, passed: 0, failed: 0 };
      this.platforms.set(platform, counters);
    }
    return counters;
  }

  /**
   * Group reasons that differ only in their variable part, so
   * "app verdict UNRECOGNIZED_VERSION" for a thousand devices is one row
   * rather than one row per device. Also caps the length: a library error
   * message can be a paragraph.
   */
  private static normalise(reason?: string): string {
    if (!reason) return 'unspecified';
    return reason
      .replace(/\b[0-9a-f]{16,}\b/gi, '<id>')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
  }
}
