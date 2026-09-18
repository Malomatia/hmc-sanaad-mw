import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { MssqlService } from '../database/mssql.service';
import { AuthConfig } from '../config/configuration';

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
export class AuthStateService {
  private readonly secret: string;

  constructor(
    private readonly db: MssqlService,
    config: ConfigService,
  ) {
    this.secret = config.getOrThrow<AuthConfig>('auth').jwtSecret;
  }

  async limit(scope: string, identity: string, maximum: number, seconds: number): Promise<void> {
    const username = identity.trim().toUpperCase();
    const prefix = `hB.${this.mac(['budget', scope, username]).slice(0, 20)}`;
    const rows = await this.db.query<{ Allowed: number; RetryAfterSeconds: number }>(
      `SET XACT_ABORT ON;
       BEGIN TRANSACTION;
       BEGIN TRY
         DECLARE @now datetime2 = GETDATE(), @attempts int, @retry int, @allowed int = 0;
         SELECT @attempts = COUNT(*), @retry = DATEDIFF(SECOND, @now, MIN(ExpiresAt))
           FROM HMC_Sanad_AttestChallenge_tbl WITH (UPDLOCK, HOLDLOCK)
          WHERE LoginID = @username
            AND Challenge LIKE @bucketTokenPrefix ESCAPE '~'
            AND Challenge COLLATE Latin1_General_100_BIN2 LIKE @bucketTokenPrefix ESCAPE '~'
            AND ExpiresAt > @now;
         IF @attempts < @maximum
         BEGIN
           INSERT INTO HMC_Sanad_AttestChallenge_tbl (Challenge, LoginID, IssuedAt, ExpiresAt, UsedAt)
           VALUES (@rateTokenKey, @username, @now, DATEADD(SECOND, @seconds, @now), NULL);
           SET @allowed = 1;
         END;
         COMMIT;
         SELECT @allowed AS Allowed, ISNULL(@retry, @seconds) AS RetryAfterSeconds;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK;
         THROW;
       END CATCH;`,
      {
        username,
        maximum,
        seconds,
        bucketTokenPrefix: `${prefix.replace(/_/g, '~_')}%`,
        rateTokenKey: prefix + randomBytes(15).toString('base64url'),
      },
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
      `INSERT INTO HMC_Sanad_AttestChallenge_tbl (Challenge, LoginID, IssuedAt, ExpiresAt, UsedAt)
       VALUES (@grantTokenKey, @username, GETDATE(), DATEADD(SECOND, @ttl, GETDATE()), NULL)`,
      {
        grantTokenKey: this.nonce('G', username, imei, enrollmenttoken),
        username: username.trim().toUpperCase(),
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
         DECLARE @updated int = 0, @claimed int = 0;
         IF (SELECT COUNT(*) FROM HMC_Sanad_DeviceRegn_tbl WITH (UPDLOCK, HOLDLOCK)
              WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei) = 1
         BEGIN
           UPDATE HMC_Sanad_AttestChallenge_tbl SET UsedAt = GETDATE()
            WHERE Challenge COLLATE Latin1_General_100_BIN2 = @grantTokenKey AND LoginID = @username
              AND UsedAt IS NULL AND ExpiresAt > GETDATE();
           SET @claimed = @@ROWCOUNT;
           IF @claimed = 1
           BEGIN
             UPDATE HMC_Sanad_DeviceRegn_tbl
                SET MPIN = @mpin, Status = 'Active', DateFirstRegistered = GETDATE()
              WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei
                AND MPIN IS NULL AND Status = 'Inactive';
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
        grantTokenKey: this.nonce('G', username, imei, enrollmenttoken),
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
            WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei
              AND Status = 'Active' AND MPIN IS NOT NULL;
           SET @updated = @@ROWCOUNT;
         END;
         IF @updated = 1
           UPDATE HMC_Sanad_AttestChallenge_tbl SET UsedAt = GETDATE()
            WHERE LoginID = @username AND UsedAt IS NULL
              AND (Challenge COLLATE Latin1_General_100_BIN2 LIKE 'hF.%'
                OR Challenge COLLATE Latin1_General_100_BIN2 LIKE 'hA.%'
                OR Challenge COLLATE Latin1_General_100_BIN2 LIKE 'hR.%'
                OR Challenge COLLATE Latin1_General_100_BIN2 LIKE 'hG.%');
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
    const refreshId = randomUUID();
    return {
      sid: randomUUID(),
      username,
      deviceImei,
      refreshId,
      expiresAt,
      accessId: this.accessIdFor(refreshId),
    };
  }

  async createSession(session: SessionState, mpin: string): Promise<void> {
    const rows = await this.db.query<{ Created: number }>(
      `SET XACT_ABORT ON;
       BEGIN TRANSACTION;
       BEGIN TRY
         DECLARE @created int = 0, @now datetime2 = GETDATE();
         IF (SELECT COUNT(*) FROM HMC_Sanad_DeviceRegn_tbl WITH (UPDLOCK, HOLDLOCK)
              WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei
                AND MPIN = @mpin AND Status = 'Active') = 1
         BEGIN
           INSERT INTO HMC_Sanad_AttestChallenge_tbl (Challenge, LoginID, IssuedAt, ExpiresAt, UsedAt)
           VALUES (@familyTokenKey, @username, @now, DATEADD(SECOND, @ttl, @now), NULL),
                  (@accessTokenKey, @username, @now, DATEADD(SECOND, @ttl, @now), NULL),
                  (@refreshTokenKey, @username, @now, DATEADD(SECOND, @ttl, @now), NULL);
           SET @created = 1;
         END;
         COMMIT;
         SELECT @created AS Created;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK;
         THROW;
       END CATCH;`,
      { ...this.sessionParams(session), mpin },
    );
    if (rows[0]?.Created !== 1) throw new UnauthorizedException('Invalid credentials.');
  }

  async sessionActive(
    sid: string,
    username: string,
    imei: string,
    accessId?: string,
  ): Promise<boolean> {
    const rows = await this.db.query<{ Active: number }>(
      `SELECT 1 AS Active FROM HMC_Sanad_AttestChallenge_tbl F
        WHERE F.Challenge = @familyTokenKey AND F.Challenge COLLATE Latin1_General_100_BIN2 = @familyTokenKey AND F.LoginID = @username
          AND F.UsedAt IS NULL AND F.ExpiresAt > GETDATE()
          AND (@accessTokenKey IS NULL OR EXISTS (
            SELECT 1 FROM HMC_Sanad_AttestChallenge_tbl A
             WHERE A.Challenge = @accessTokenKey AND A.Challenge COLLATE Latin1_General_100_BIN2 = @accessTokenKey AND A.LoginID = @username
               AND A.UsedAt IS NULL AND A.ExpiresAt > GETDATE()))
          AND EXISTS (SELECT 1 FROM HMC_Sanad_DeviceRegn_tbl D
                       WHERE D.LoginID = @username AND D.IMEINumber COLLATE Latin1_General_100_BIN2 = @imei
                         AND D.Status = 'Active')`,
      {
        familyTokenKey: this.nonce('F', username, imei, sid),
        username: username.trim().toUpperCase(),
        imei,
        accessTokenKey: accessId ? this.nonce('A', username, imei, sid, accessId) : null,
      },
    );
    return rows.length === 1;
  }

  async rotateSession(session: SessionState, previousRefreshId: string): Promise<void> {
    const rows = await this.db.query<{ Rotated: number }>(
      `SET XACT_ABORT ON;
       BEGIN TRANSACTION;
       BEGIN TRY
         DECLARE @rotated int = 0, @claimed int = 0, @now datetime2 = GETDATE();
         IF (SELECT COUNT(*) FROM HMC_Sanad_DeviceRegn_tbl WITH (UPDLOCK, HOLDLOCK)
              WHERE LoginID = @username AND IMEINumber COLLATE Latin1_General_100_BIN2 = @imei
                AND Status = 'Active') = 1
           IF EXISTS (SELECT 1 FROM HMC_Sanad_AttestChallenge_tbl WITH (UPDLOCK, HOLDLOCK)
                       WHERE Challenge COLLATE Latin1_General_100_BIN2 = @familyTokenKey AND LoginID = @username
                         AND UsedAt IS NULL AND ExpiresAt > @now)
           BEGIN
             UPDATE HMC_Sanad_AttestChallenge_tbl SET UsedAt = @now
              WHERE Challenge COLLATE Latin1_General_100_BIN2 = @previousRefreshTokenKey AND LoginID = @username
                AND UsedAt IS NULL AND ExpiresAt > @now;
             SET @claimed = @@ROWCOUNT;
             IF @claimed = 1
             BEGIN
               UPDATE HMC_Sanad_AttestChallenge_tbl SET UsedAt = @now
                WHERE Challenge COLLATE Latin1_General_100_BIN2 = @previousAccessTokenKey AND LoginID = @username AND UsedAt IS NULL;
               INSERT INTO HMC_Sanad_AttestChallenge_tbl (Challenge, LoginID, IssuedAt, ExpiresAt, UsedAt)
               VALUES (@accessTokenKey, @username, @now, DATEADD(SECOND, @ttl, @now), NULL),
                      (@refreshTokenKey, @username, @now, DATEADD(SECOND, @ttl, @now), NULL);
               UPDATE HMC_Sanad_AttestChallenge_tbl SET ExpiresAt = DATEADD(SECOND, @ttl, @now)
                WHERE Challenge COLLATE Latin1_General_100_BIN2 = @familyTokenKey AND LoginID = @username;
               SET @rotated = 1;
             END;
           END;
         IF @rotated = 0
           UPDATE HMC_Sanad_AttestChallenge_tbl SET UsedAt = @now
            WHERE Challenge COLLATE Latin1_General_100_BIN2 = @familyTokenKey AND LoginID = @username AND UsedAt IS NULL;
         COMMIT;
         SELECT @rotated AS Rotated;
       END TRY
       BEGIN CATCH
         IF @@TRANCOUNT > 0 ROLLBACK;
         THROW;
       END CATCH;`,
      {
        ...this.sessionParams(session),
        previousRefreshTokenKey: this.nonce(
          'R',
          session.username,
          session.deviceImei,
          session.sid,
          previousRefreshId,
        ),
        previousAccessTokenKey: this.nonce(
          'A',
          session.username,
          session.deviceImei,
          session.sid,
          this.accessIdFor(previousRefreshId),
        ),
      },
    );
    if (rows[0]?.Rotated !== 1)
      throw new UnauthorizedException('This session is no longer valid. Please log in again.');
  }

  async revokeSession(sid: string, username: string, imei: string): Promise<void> {
    await this.db.execute(
      `UPDATE HMC_Sanad_AttestChallenge_tbl SET UsedAt = GETDATE()
        WHERE Challenge COLLATE Latin1_General_100_BIN2 = @familyTokenKey AND LoginID = @username AND UsedAt IS NULL`,
      {
        familyTokenKey: this.nonce('F', username, imei, sid),
        username: username.trim().toUpperCase(),
      },
    );
  }

  private sessionParams(session: SessionState) {
    const ttl = Math.ceil((session.expiresAt.getTime() - Date.now()) / 1000);
    if (!Number.isSafeInteger(ttl) || ttl <= 0 || ttl > 2147483647)
      throw new UnauthorizedException('Invalid session expiry.');
    return {
      username: session.username.trim().toUpperCase(),
      imei: session.deviceImei,
      ttl,
      familyTokenKey: this.nonce('F', session.username, session.deviceImei, session.sid),
      accessTokenKey: this.nonce(
        'A',
        session.username,
        session.deviceImei,
        session.sid,
        session.accessId,
      ),
      refreshTokenKey: this.nonce(
        'R',
        session.username,
        session.deviceImei,
        session.sid,
        session.refreshId,
      ),
    };
  }

  private nonce(kind: string, username: string, imei: string, ...identifiers: string[]): string {
    return `h${kind}.${this.mac([kind, username.trim().toUpperCase(), imei, ...identifiers]).slice(0, 40)}`;
  }

  private accessIdFor(refreshId: string): string {
    return this.mac(['access-id', refreshId]);
  }

  private mac(parts: string[]): string {
    return createHmac('sha256', this.secret)
      .update('hmc-auth-state-v1\0')
      .update(JSON.stringify(parts))
      .digest('base64url');
  }
}
