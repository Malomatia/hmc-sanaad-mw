/*
 * Device attestation storage (Apple App Attest + Google Play Integrity).
 *
 * Referenced by the runtime warning the stores emit when a table is missing
 * ("Apply tools/app-integrity-schema.sql"): until it is applied, attestation
 * cannot be recorded and every verification refuses — nothing crashes.
 *
 * Run against the Users/Sanaad SQL Server database (USERS_DB_*). Idempotent.
 *
 * Android needs no tables: its token is self-contained.
 */

IF OBJECT_ID('HMC_Sanad_AttestChallenge_tbl', 'U') IS NULL
BEGIN
    CREATE TABLE HMC_Sanad_AttestChallenge_tbl (
        ChallengeID INT IDENTITY(1,1) NOT NULL,
        Challenge   NVARCHAR(200)     NOT NULL,
        -- The DEVICE that asked for the nonce. Attestation happens before
        -- login, so there is no user yet; consuming checks this column so a
        -- challenge issued to one device cannot be spent by another.
        LoginID     NVARCHAR(100)     NULL,
        IssuedAt    DATETIME          NOT NULL CONSTRAINT DF_HMC_Sanad_AttestChallenge_IssuedAt DEFAULT GETDATE(),
        ExpiresAt   DATETIME          NOT NULL,
        -- Single use: a challenge that could be spent twice would let one
        -- captured proof be replayed indefinitely.
        UsedAt      DATETIME          NULL,

        CONSTRAINT PK_HMC_Sanad_AttestChallenge PRIMARY KEY (ChallengeID),
        CONSTRAINT UQ_HMC_Sanad_AttestChallenge UNIQUE (Challenge)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE name = 'IX_HMC_Sanad_AttestChallenge_Expiry'
       AND object_id = OBJECT_ID('HMC_Sanad_AttestChallenge_tbl')
)
BEGIN
    -- Both the expiry predicate in `consume` and the periodic purge read it.
    CREATE INDEX IX_HMC_Sanad_AttestChallenge_Expiry
        ON HMC_Sanad_AttestChallenge_tbl (ExpiresAt);
END;
GO

IF OBJECT_ID('HMC_Sanad_AttestKey_tbl', 'U') IS NULL
BEGIN
    -- INCLUDE THIS TABLE IN BACKUPS. iOS attests once per installation and
    -- signs every later request with that key; losing it makes every iPhone
    -- user register again.
    CREATE TABLE HMC_Sanad_AttestKey_tbl (
        AttestKeyID INT IDENTITY(1,1) NOT NULL,
        KeyID       NVARCHAR(200)     NOT NULL,
        -- The owner: 'device:<deviceId>' until the first authenticated
        -- assertion claims the key for a login.
        LoginID     NVARCHAR(100)     NOT NULL,
        PublicKey   NVARCHAR(1000)    NOT NULL,
        -- Replay protection: App Attest increments it on every assertion, and
        -- the server only ever writes a HIGHER value.
        SignCount   BIGINT            NOT NULL CONSTRAINT DF_HMC_Sanad_AttestKey_SignCount DEFAULT 0,
        CreatedAt   DATETIME          NOT NULL CONSTRAINT DF_HMC_Sanad_AttestKey_CreatedAt DEFAULT GETDATE(),
        UpdatedAt   DATETIME          NOT NULL CONSTRAINT DF_HMC_Sanad_AttestKey_UpdatedAt DEFAULT GETDATE(),

        CONSTRAINT PK_HMC_Sanad_AttestKey PRIMARY KEY (AttestKeyID),
        CONSTRAINT UQ_HMC_Sanad_AttestKey_KeyID UNIQUE (KeyID)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
     WHERE name = 'IX_HMC_Sanad_AttestKey_LoginID'
       AND object_id = OBJECT_ID('HMC_Sanad_AttestKey_tbl')
)
BEGIN
    CREATE INDEX IX_HMC_Sanad_AttestKey_LoginID ON HMC_Sanad_AttestKey_tbl (LoginID);
END;
GO
