import {
  mysqlExact as exact,
  UsersDbExecutor,
  UsersDbService,
} from '../database/users-db/users-db.service';

/**
 * MySQL versions of AuthStateService's statements (USERS_DB_DRIVER=mysql).
 *
 * SQL Server runs each unit as ONE `BEGIN TRY … COMMIT` batch. MySQL cannot:
 * its prepared statements are single-statement and multi-statement queries
 * stay disabled on purpose, so each unit here is a transaction of separate
 * statements on one connection. The guarantees carry over one for one:
 *
 *  - `SELECT … FOR UPDATE` takes the locks `WITH (UPDLOCK, HOLDLOCK)` took, so
 *    two racing requests cannot both spend the same grant or refresh nonce;
 *  - `mysqlExact` gives the case-sensitive match of
 *    `COLLATE Latin1_General_100_BIN2`;
 *  - every function returns the row shape the SQL Server batch SELECTs, so
 *    AuthStateService handles both results the same way.
 */

const CHALLENGES = 'HMC_Sanad_AttestChallenge_tbl';
const DEVICES = 'HMC_Sanad_DeviceRegn_tbl';

/** Spend a single-use nonce: unused, unexpired and issued to this user. */
const claim = (bind: string) =>
  `UPDATE ${CHALLENGES} SET UsedAt = NOW()
    WHERE ${exact('Challenge', bind)} AND LoginID = @username
      AND UsedAt IS NULL AND ExpiresAt > NOW()`;

const insertNonces = (...binds: string[]) =>
  `INSERT INTO ${CHALLENGES} (Challenge, LoginID, IssuedAt, ExpiresAt, UsedAt)
   VALUES ${binds
     .map((bind) => `(${bind}, @username, NOW(), DATE_ADD(NOW(), INTERVAL @ttl SECOND), NULL)`)
     .join(',\n          ')}`;

/** After an MPIN change: end every session, access, refresh and grant nonce of the user. */
const REVOKE_AUTH_NONCES = `UPDATE ${CHALLENGES} SET UsedAt = NOW()
    WHERE LoginID = @username AND UsedAt IS NULL
      AND (CAST(Challenge AS BINARY) LIKE 'hF.%'
        OR CAST(Challenge AS BINARY) LIKE 'hA.%'
        OR CAST(Challenge AS BINARY) LIKE 'hR.%'
        OR CAST(Challenge AS BINARY) LIKE 'hG.%')`;

/** Lock the user's registration row; true when exactly one matches. */
async function lockDevice(
  tx: UsersDbExecutor,
  params: Record<string, unknown>,
  condition = '',
): Promise<boolean> {
  const rows = await tx.query<{ Matches: number }>(
    `SELECT COUNT(*) AS Matches FROM ${DEVICES}
      WHERE LoginID = @username AND ${exact('IMEINumber', '@imei')}${condition}
      FOR UPDATE`,
    params,
  );
  return Number(rows[0]?.Matches) === 1;
}

// Type aliases, not interfaces: only aliases are assignable to the
// `Record<string, unknown>` bind maps the executor takes.
type UserDevice = {
  username: string;
  imei: string;
};

type SessionKeys = UserDevice & {
  ttl: number;
  familyTokenKey: string;
  accessTokenKey: string;
  refreshTokenKey: string;
};

export const mysqlAuthState = {
  limit(
    db: UsersDbService,
    params: {
      username: string;
      maximum: number;
      seconds: number;
      bucketTokenPrefix: string;
      rateTokenKey: string;
    },
  ): Promise<{ Allowed: number; RetryAfterSeconds: number }[]> {
    return db.transaction(async (tx) => {
      const [bucket] = await tx.query<{ Attempts: number; RetryAfter: number | null }>(
        `SELECT COUNT(*) AS Attempts, TIMESTAMPDIFF(SECOND, NOW(), MIN(ExpiresAt)) AS RetryAfter
           FROM ${CHALLENGES}
          WHERE LoginID = @username
            AND Challenge LIKE @bucketTokenPrefix ESCAPE '~'
            AND CAST(Challenge AS BINARY) LIKE @bucketTokenPrefix ESCAPE '~'
            AND ExpiresAt > NOW()
          FOR UPDATE`,
        params,
      );
      let allowed = 0;
      if (Number(bucket?.Attempts ?? 0) < params.maximum) {
        await tx.execute(
          `INSERT INTO ${CHALLENGES} (Challenge, LoginID, IssuedAt, ExpiresAt, UsedAt)
           VALUES (@rateTokenKey, @username, NOW(), DATE_ADD(NOW(), INTERVAL @seconds SECOND), NULL)`,
          params,
        );
        allowed = 1;
      }
      const retry = bucket?.RetryAfter;
      return [
        { Allowed: allowed, RetryAfterSeconds: retry == null ? params.seconds : Number(retry) },
      ];
    });
  },

  async issueEnrollment(
    db: UsersDbService,
    params: { grantTokenKey: string; username: string; ttl: number },
  ): Promise<void> {
    await db.execute(
      `INSERT INTO ${CHALLENGES} (Challenge, LoginID, IssuedAt, ExpiresAt, UsedAt)
       VALUES (@grantTokenKey, @username, NOW(), DATE_ADD(NOW(), INTERVAL @ttl SECOND), NULL)`,
      params,
    );
  },

  enroll(
    db: UsersDbService,
    params: UserDevice & { grantTokenKey: string; mpin: string },
  ): Promise<{ Updated: number }[]> {
    return db.transaction(async (tx) => {
      if (!(await lockDevice(tx, params))) return [{ Updated: 0 }];
      if ((await tx.execute(claim('@grantTokenKey'), params)).rowsAffected !== 1) {
        return [{ Updated: 0 }];
      }
      const updated = await tx.execute(
        `UPDATE ${DEVICES}
            SET MPIN = @mpin, Status = 'Active', DateFirstRegistered = NOW()
          WHERE LoginID = @username AND ${exact('IMEINumber', '@imei')}
            AND MPIN IS NULL AND Status = 'Inactive'`,
        params,
      );
      return [{ Updated: updated.rowsAffected === 1 ? 1 : 0 }];
    });
  },

  resetMpin(
    db: UsersDbService,
    params: UserDevice & { mpin: string; grantTokenKey?: string },
  ): Promise<{ Updated: number }[]> {
    return db.transaction(async (tx) => {
      if (!(await lockDevice(tx, params))) return [{ Updated: 0 }];
      // With a grant (forgot → validate OTP → reset) it is spent first; the
      // OTP-verified path arrives without one.
      if (
        params.grantTokenKey !== undefined &&
        (await tx.execute(claim('@grantTokenKey'), params)).rowsAffected !== 1
      ) {
        return [{ Updated: 0 }];
      }
      const updated = await tx.execute(
        `UPDATE ${DEVICES} SET MPIN = @mpin
          WHERE LoginID = @username AND ${exact('IMEINumber', '@imei')}
            AND Status = 'Active' AND MPIN IS NOT NULL`,
        params,
      );
      if (updated.rowsAffected !== 1) return [{ Updated: 0 }];
      await tx.execute(REVOKE_AUTH_NONCES, params);
      return [{ Updated: 1 }];
    });
  },

  createSession(
    db: UsersDbService,
    params: SessionKeys & { mpin: string },
  ): Promise<{ Created: number }[]> {
    return db.transaction(async (tx) => {
      if (!(await lockDevice(tx, params, " AND MPIN = @mpin AND Status = 'Active'"))) {
        return [{ Created: 0 }];
      }
      await tx.execute(
        insertNonces('@familyTokenKey', '@accessTokenKey', '@refreshTokenKey'),
        params,
      );
      return [{ Created: 1 }];
    });
  },

  sessionActive(
    db: UsersDbService,
    params: UserDevice & { familyTokenKey: string; accessTokenKey: string | null },
  ): Promise<{ Active: number }[]> {
    return db.query<{ Active: number }>(
      `SELECT 1 AS Active FROM ${CHALLENGES} F
        WHERE ${exact('F.Challenge', '@familyTokenKey')} AND F.LoginID = @username
          AND F.UsedAt IS NULL AND F.ExpiresAt > NOW()
          AND (@accessTokenKey IS NULL OR EXISTS (
            SELECT 1 FROM ${CHALLENGES} A
             WHERE ${exact('A.Challenge', '@accessTokenKey')} AND A.LoginID = @username
               AND A.UsedAt IS NULL AND A.ExpiresAt > NOW()))
          AND EXISTS (SELECT 1 FROM ${DEVICES} D
                       WHERE D.LoginID = @username AND ${exact('D.IMEINumber', '@imei')}
                         AND D.Status = 'Active')`,
      params,
    );
  },

  rotateSession(
    db: UsersDbService,
    params: SessionKeys & { previousRefreshTokenKey: string; previousAccessTokenKey: string },
  ): Promise<{ Rotated: number }[]> {
    return db.transaction(async (tx) => {
      let rotated = 0;
      if (await lockDevice(tx, params, " AND Status = 'Active'")) {
        const family = await tx.query(
          `SELECT 1 AS Live FROM ${CHALLENGES}
            WHERE ${exact('Challenge', '@familyTokenKey')} AND LoginID = @username
              AND UsedAt IS NULL AND ExpiresAt > NOW()
            FOR UPDATE`,
          params,
        );
        if (
          family.length > 0 &&
          (await tx.execute(claim('@previousRefreshTokenKey'), params)).rowsAffected === 1
        ) {
          await tx.execute(
            `UPDATE ${CHALLENGES} SET UsedAt = NOW()
              WHERE ${exact('Challenge', '@previousAccessTokenKey')} AND LoginID = @username
                AND UsedAt IS NULL`,
            params,
          );
          await tx.execute(insertNonces('@accessTokenKey', '@refreshTokenKey'), params);
          await tx.execute(
            `UPDATE ${CHALLENGES} SET ExpiresAt = DATE_ADD(NOW(), INTERVAL @ttl SECOND)
              WHERE ${exact('Challenge', '@familyTokenKey')} AND LoginID = @username`,
            params,
          );
          rotated = 1;
        }
      }
      // A refresh that does not rotate (replayed, expired, unknown) ends the
      // whole session family — committed, not rolled back.
      if (!rotated) {
        await tx.execute(
          `UPDATE ${CHALLENGES} SET UsedAt = NOW()
            WHERE ${exact('Challenge', '@familyTokenKey')} AND LoginID = @username
              AND UsedAt IS NULL`,
          params,
        );
      }
      return [{ Rotated: rotated }];
    });
  },

  async revokeSession(
    db: UsersDbService,
    params: { familyTokenKey: string; username: string },
  ): Promise<void> {
    await db.execute(
      `UPDATE ${CHALLENGES} SET UsedAt = NOW()
        WHERE ${exact('Challenge', '@familyTokenKey')} AND LoginID = @username AND UsedAt IS NULL`,
      params,
    );
  },
};
