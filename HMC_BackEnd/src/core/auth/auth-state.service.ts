import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { MssqlService } from '../database/mssql.service';

export const ENROLLMENT_TTL_SECONDS = 300;

export interface SessionState {
  sid: string;
  username: string;
  deviceImei: string;
  accessId: string;
  refreshId: string;
  expiresAt: Date;
}

@Injectable()
export class AuthStateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthStateService.name);
  private cleanupTimer?: NodeJS.Timeout;
  private cleaning = false;

  constructor(private readonly db: MssqlService) {}

  onModuleInit(): void {
    if (!this.db.isConfigured()) return;
    this.cleanupTimer = setInterval(() => {
      void this.pruneExpired().catch(() =>
        this.logger.warn('Expired authentication state cleanup failed.'),
      );
    }, 300_000);
    this.cleanupTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async pruneExpired(): Promise<void> {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      await this.db.execute(
        `DELETE TOP (500) FROM HMC_Sanad_AuthChallenge_tbl WHERE ExpiresAt < SYSUTCDATETIME();
         DELETE TOP (500) FROM HMC_Sanad_EnrollmentGrant_tbl WHERE ExpiresAt < SYSUTCDATETIME();
         DELETE TOP (500) FROM HMC_Sanad_AuthSession_tbl WHERE ExpiresAt < SYSUTCDATETIME();
         DELETE TOP (500) FROM HMC_Sanad_AuthLimit_tbl WHERE ExpiresAt < SYSUTCDATETIME();`,
      );
    } finally {
      this.cleaning = false;
    }
  }

  async limit(scope: string, identity: string, maximum: number, seconds: number): Promise<void> {
    const scopeHash = this.hash(`${scope}\0${identity}`);
    const rows = await this.db.query<{ Allowed: number; RetryAfterSeconds: number }>(
      `SET XACT_ABORT ON;
       BEGIN TRANSACTION;
       BEGIN TRY
         DECLARE @now datetime2(3) = SYSUTCDATETIME();
         IF NOT EXISTS (SELECT 1 FROM HMC_Sanad_AuthLimit_tbl WITH (UPDLOCK, HOLDLOCK)
                         WHERE ScopeHash = @scopeHash)
           INSERT INTO HMC_Sanad_AuthLimit_tbl (ScopeHash, Attempts, ExpiresAt)
           VALUES (@scopeHash, 0, DATEADD(SECOND, @seconds, @now));
         UPDATE HMC_Sanad_AuthLimit_tbl
            SET Attempts = CASE WHEN ExpiresAt <= @now THEN 1 ELSE Attempts + 1 END,
                ExpiresAt = CASE WHEN ExpiresAt <= @now THEN DATEADD(SECOND, @seconds, @now) ELSE ExpiresAt END
          OUTPUT CASE WHEN INSERTED.Attempts <= @maximum THEN 1 ELSE 0 END AS Allowed,
                 DATEDIFF(SECOND, @now, INSERTED.ExpiresAt) AS RetryAfterSeconds
          WHERE ScopeHash = @scopeHash;
         COMMIT;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK;
         THROW;
       END CATCH;`,
      { scopeHash, maximum, seconds },
    );
    if (rows[0]?.Allowed !== 1) {
      throw new HttpException(
        {
          message: 'Too many attempts. Please try again later.',
          retryAfterSeconds: Math.max(1, rows[0]?.RetryAfterSeconds ?? seconds),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async issueEnrollment(username: string, imei: string): Promise<string> {
    const enrollmenttoken = randomBytes(32).toString('base64url');
    await this.db.execute(
      `INSERT INTO HMC_Sanad_EnrollmentGrant_tbl (TokenHash, LoginID, DeviceIMEI, ExpiresAt)
       VALUES (@tokenHash, @username, @imei, DATEADD(SECOND, @ttl, SYSUTCDATETIME()))`,
      {
        tokenHash: this.hash(enrollmenttoken),
        username: username.trim().toUpperCase(),
        imei,
        ttl: ENROLLMENT_TTL_SECONDS,
      },
    );
    return enrollmenttoken;
  }

  async enroll(
    username: string,
    imei: string,
    mpin: string,
    enrollmenttoken: string,
  ): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(enrollmenttoken ?? '')) return false;
    const rows = await this.db.query<{ Updated: number }>(
      `SET XACT_ABORT ON;
       BEGIN TRANSACTION;
       BEGIN TRY
         DECLARE @claimed int = 0, @updated int = 0;
         UPDATE HMC_Sanad_EnrollmentGrant_tbl WITH (UPDLOCK)
            SET ConsumedAt = SYSUTCDATETIME()
          WHERE TokenHash = @tokenHash AND LoginID = @username AND DeviceIMEI = @imei
            AND ConsumedAt IS NULL AND ExpiresAt > SYSUTCDATETIME();
         SET @claimed = @@ROWCOUNT;
         IF @claimed = 1
         BEGIN
           IF (SELECT COUNT(*) FROM HMC_Sanad_DeviceRegn_tbl WITH (UPDLOCK, HOLDLOCK)
                WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei) = 1
           BEGIN
             UPDATE HMC_Sanad_DeviceRegn_tbl
                SET MPIN = @mpin, Status = 'Active', DateFirstRegistered = GETDATE()
              WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei AND MPIN IS NULL
                AND Status = 'Inactive';
             SET @updated = @@ROWCOUNT;
           END;
         END;
         COMMIT;
         SELECT @updated AS Updated;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK;
         THROW;
       END CATCH;`,
      {
        tokenHash: this.hash(enrollmenttoken),
        username: username.trim().toUpperCase(),
        imei,
        mpin,
      },
    );
    return rows[0]?.Updated === 1;
  }

  async resetMpin(username: string, imei: string, mpin: string): Promise<boolean> {
    const rows = await this.db.query<{ Updated: number }>(
      `SET XACT_ABORT ON;
       BEGIN TRANSACTION;
       BEGIN TRY
         DECLARE @updated int = 0;
         IF (SELECT COUNT(*) FROM HMC_Sanad_DeviceRegn_tbl WITH (UPDLOCK, HOLDLOCK)
              WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei) = 1
         BEGIN
           UPDATE HMC_Sanad_DeviceRegn_tbl SET MPIN = @mpin
            WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei AND Status = 'Active' AND MPIN IS NOT NULL;
           SET @updated = @@ROWCOUNT;
         END;
         IF @updated = 1
         BEGIN
           UPDATE HMC_Sanad_AuthSession_tbl SET RevokedAt = SYSUTCDATETIME()
            WHERE LoginID = @username AND RevokedAt IS NULL;
           UPDATE HMC_Sanad_EnrollmentGrant_tbl SET ConsumedAt = SYSUTCDATETIME()
            WHERE LoginID = @username AND ConsumedAt IS NULL;
         END;
         COMMIT;
         SELECT @updated AS Updated;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK;
         THROW;
       END CATCH;`,
      { username: username.trim().toUpperCase(), imei, mpin },
    );
    return rows[0]?.Updated === 1;
  }

  newSession(username: string, deviceImei: string, expiresAt: Date): SessionState {
    return {
      sid: randomUUID(),
      username,
      deviceImei,
      accessId: randomUUID(),
      refreshId: randomUUID(),
      expiresAt,
    };
  }

  async createSession(session: SessionState, mpin: string): Promise<void> {
    const result = await this.db.execute(
      `INSERT INTO HMC_Sanad_AuthSession_tbl (SessionId, LoginID, DeviceIMEI, AccessId, RefreshId, ExpiresAt)
       SELECT @sid, @username, @imei, @accessId, @refreshId, @expiresAt
        WHERE EXISTS (SELECT 1 FROM HMC_Sanad_DeviceRegn_tbl WITH (UPDLOCK, HOLDLOCK)
                       WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei AND MPIN = @mpin AND Status = 'Active')`,
      { ...this.sessionParams(session), mpin },
    );
    if (result.rowsAffected !== 1) throw new UnauthorizedException('Invalid credentials.');
  }

  async sessionActive(
    sid: string,
    username: string,
    imei: string,
    accessId?: string,
  ): Promise<boolean> {
    const rows = await this.db.query<{ Active: number }>(
      `SELECT 1 AS Active FROM HMC_Sanad_AuthSession_tbl S
        WHERE S.SessionId = @sid AND S.LoginID = @username AND S.DeviceIMEI = @imei
          AND S.RevokedAt IS NULL AND S.ExpiresAt > SYSUTCDATETIME()
          AND (@accessId IS NULL OR S.AccessId = @accessId)
          AND EXISTS (SELECT 1 FROM HMC_Sanad_DeviceRegn_tbl D
                       WHERE D.LoginID COLLATE DATABASE_DEFAULT = S.LoginID AND D.IMEINumber COLLATE Latin1_General_100_BIN2 = S.DeviceIMEI AND D.Status = 'Active')`,
      { sid, username: username.trim().toUpperCase(), imei, accessId: accessId ?? null },
    );
    return rows.length === 1;
  }

  async rotateSession(session: SessionState, previousRefreshId: string): Promise<void> {
    const result = await this.db.execute(
      `UPDATE HMC_Sanad_AuthSession_tbl
          SET AccessId = @accessId, RefreshId = @refreshId, ExpiresAt = @expiresAt
        WHERE SessionId = @sid AND LoginID = @username AND DeviceIMEI = @imei
          AND RefreshId = @previousRefreshId AND RevokedAt IS NULL AND ExpiresAt > SYSUTCDATETIME()
          AND EXISTS (SELECT 1 FROM HMC_Sanad_DeviceRegn_tbl D
                       WHERE D.LoginID = @username AND D.IMEINumber COLLATE Latin1_General_100_BIN2 = @imei AND D.Status = 'Active')`,
      { ...this.sessionParams(session), previousRefreshId },
    );
    if (result.rowsAffected !== 1) {
      await this.revokeSession(session.sid, session.username);
      throw new UnauthorizedException('This session is no longer valid. Please log in again.');
    }
  }

  async revokeSession(sid: string, username: string): Promise<void> {
    await this.db.execute(
      `UPDATE HMC_Sanad_AuthSession_tbl SET RevokedAt = SYSUTCDATETIME()
        WHERE SessionId = @sid AND LoginID = @username AND RevokedAt IS NULL`,
      { sid, username: username.trim().toUpperCase() },
    );
  }

  private sessionParams(session: SessionState) {
    return {
      sid: session.sid,
      username: session.username.trim().toUpperCase(),
      imei: session.deviceImei,
      accessId: session.accessId,
      refreshId: session.refreshId,
      expiresAt: session.expiresAt,
    };
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
