import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MssqlService } from '@core/database/mssql.service';
import { MssqlQueryError } from '@core/database/mssql.error';
import { AttestKey } from '../../domain/attestation';
import { AttestKeyStorePort, ChallengeStorePort } from '../../domain/ports/integrity.ports';

const CHALLENGE_TABLE = 'HMC_Sanad_AttestChallenge_tbl';
const KEY_TABLE = 'HMC_Sanad_AttestKey_tbl';

/** SQL Server "Invalid object name" — the table has not been created. */
const INVALID_OBJECT_NAME = 208;

/** How often one process sweeps expired challenges away, and how much of
 * the backlog a single sweep takes — a capped DELETE cannot lock the table
 * for long behind the request that triggered it. */
const PURGE_INTERVAL_MS = 15 * 60 * 1000;
const PURGE_BATCH = 5000;
/** Expired rows are kept this long, so a failure can still be investigated. */
const PURGE_GRACE_HOURS = 24;

/**
 * Shared guard for both stores: a table that does not exist yet is a
 * deployment step, and is reported once rather than on every call.
 */
abstract class GuardedStore {
  protected static readonly log = new Logger('AttestationStore');
  private static readonly warned = new Set<string>();

  constructor(protected readonly db: MssqlService) {}

  protected async guard<T>(
    table: string,
    operation: string,
    work: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await work();
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      const missing =
        (err instanceof MssqlQueryError && err.sqlErrorNumber === INVALID_OBJECT_NAME) ||
        /invalid object name/i.test(message);

      if (missing) {
        if (!GuardedStore.warned.has(table)) {
          GuardedStore.warned.add(table);
          GuardedStore.log.warn(
            `${table} does not exist yet — device attestation cannot be recorded. ` +
              'Apply tools/app-integrity-schema.sql.',
          );
        }
        return undefined;
      }
      GuardedStore.log.warn(`${table} ${operation} failed: ${message}`);
      return undefined;
    }
  }
}

/**
 * Server-issued nonces.
 *
 * Stored, not just generated: a challenge is only worth anything if the server
 * can later say "yes, I issued that, and it has not been spent". Consuming is
 * a single conditional UPDATE so two racing requests cannot both win it.
 */
@Injectable()
export class MssqlChallengeStore extends GuardedStore implements ChallengeStorePort {
  private lastPurgeAt = 0;

  constructor(
    db: MssqlService,
    private readonly ttlMs: number,
  ) {
    super(db);
  }

  async issue(deviceId: string): Promise<string> {
    await this.purgeSpent();
    const value = randomBytes(32).toString('base64');
    const result = await this.guard(CHALLENGE_TABLE, 'issue', () =>
      this.db.execute(
        `INSERT INTO ${CHALLENGE_TABLE} (Challenge, LoginID, IssuedAt, ExpiresAt)
         VALUES (@value, @deviceId, GETDATE(), DATEADD(millisecond, @ttl, GETDATE()))`,
        { value, deviceId, ttl: this.ttlMs },
      ),
    );
    if ((result?.rowsAffected ?? 0) < 1) {
      throw new ServiceUnavailableException('An attestation challenge could not be issued.');
    }
    return value;
  }

  async consume(value: string, deviceId?: string): Promise<boolean> {
    // One statement: marking it used IS the check, so a challenge cannot be
    // spent twice by two requests arriving together. The device predicate is
    // part of the same statement for the same reason.
    const result = await this.guard(CHALLENGE_TABLE, 'consume', () =>
      this.db.execute(
        `UPDATE ${CHALLENGE_TABLE}
            SET UsedAt = GETDATE()
          WHERE Challenge = @value AND UsedAt IS NULL AND ExpiresAt > GETDATE()` +
          (deviceId === undefined ? '' : ' AND LoginID = @deviceId'),
        deviceId === undefined ? { value } : { value, deviceId },
      ),
    );
    return (result?.rowsAffected ?? 0) > 0;
  }

  /**
   * Delete challenges that can never be spent again.
   *
   * `consume` filters on `ExpiresAt`, so a stale row is harmless — but every
   * launch of every install issues one and nothing ever removed them, so the
   * table grows without bound and the index with it. Rows are kept for a
   * grace period after expiry so a support question can still be answered.
   *
   * Run from `issue` rather than a scheduler: the project has no job runner,
   * and this is the only write path frequent enough to matter. It is rate
   * limited to once an interval per process and failures are swallowed by
   * `guard`, so housekeeping cannot fail a registration.
   */
  private async purgeSpent(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = now;

    await this.guard(CHALLENGE_TABLE, 'purge', () =>
      this.db.execute(
        `DELETE TOP (@batch) FROM ${CHALLENGE_TABLE}
          WHERE ExpiresAt < DATEADD(hour, -@graceHours, GETDATE())`,
        { batch: PURGE_BATCH, graceHours: PURGE_GRACE_HOURS },
      ),
    );
  }
}

/**
 * Attested iOS keys.
 *
 * These must survive a restart — an in-memory map would make every iOS user
 * re-attest after each deployment, which is the flaw in the reference sample
 * this replaces.
 */
@Injectable()
export class MssqlAttestKeyStore extends GuardedStore implements AttestKeyStorePort {
  async save(key: AttestKey): Promise<void> {
    await this.guard(KEY_TABLE, 'save', () =>
      this.db.execute(
        `MERGE ${KEY_TABLE} AS target
          USING (SELECT @keyId AS KeyID) AS source ON target.KeyID = source.KeyID
         WHEN MATCHED THEN
              UPDATE SET LoginID = @username, PublicKey = @publicKey,
                         SignCount = @signCount, UpdatedAt = GETDATE()
         WHEN NOT MATCHED THEN
              INSERT (KeyID, LoginID, PublicKey, SignCount, CreatedAt, UpdatedAt)
              VALUES (@keyId, @username, @publicKey, @signCount, GETDATE(), GETDATE());`,
        {
          keyId: key.keyId,
          username: key.username,
          publicKey: key.publicKey,
          signCount: key.signCount,
        },
      ),
    );
  }

  async find(keyId: string): Promise<AttestKey | undefined> {
    const rows = await this.guard(KEY_TABLE, 'find', () =>
      this.db.query<Record<string, unknown>>(
        `SELECT KeyID, LoginID, PublicKey, SignCount FROM ${KEY_TABLE} WHERE KeyID = @keyId`,
        { keyId },
      ),
    );
    const row = rows?.[0];
    if (!row) return undefined;
    return {
      keyId: String(row.KeyID),
      username: String(row.LoginID),
      publicKey: String(row.PublicKey),
      signCount: Number(row.SignCount ?? 0),
    };
  }

  /**
   * The counter only ever goes UP.
   *
   * Two assertions arriving together both read the old value, and an
   * unconditional write lets the lower of the two land last — which restores
   * a counter an attacker can then replay against. `SignCount < @signCount`
   * makes the comparison part of the write, so the loser of the race is a
   * no-op rather than a regression.
   */
  async updateSignCount(keyId: string, signCount: number): Promise<void> {
    await this.guard(KEY_TABLE, 'updateSignCount', () =>
      this.db.execute(
        `UPDATE ${KEY_TABLE} SET SignCount = @signCount, UpdatedAt = GETDATE()
          WHERE KeyID = @keyId AND SignCount < @signCount`,
        { keyId, signCount },
      ),
    );
  }

  async bind(keyId: string, username: string): Promise<void> {
    await this.guard(KEY_TABLE, 'bind', () =>
      this.db.execute(
        `UPDATE ${KEY_TABLE} SET LoginID = @username, UpdatedAt = GETDATE()
          WHERE KeyID = @keyId`,
        { keyId, username },
      ),
    );
  }
}
