/* ---------------------------------------------------------------------------
   Sanaad device attestation — Apple App Attest + Google Play Integrity
   Target: the Sanaad SQL Server (same database as HMC_Sanad_DeviceRegn_tbl)

   Two tables, both only used by iOS. Android needs no storage: its integrity
   token is self-contained and verified against Google on each call.

   Idempotent — safe to run on a database that already has the tables
   (staging has had both since 2026-09-02; verified 2026-09-24 with exactly
   these columns and indexes).

   The API tolerates these not existing: attestation is off by default, and
   when enabled a missing table is reported once in the log and treated as
   "cannot verify" rather than crashing anything. Challenge issuance answers
   HTTP 503 until the challenge table exists.

   Grant the application login SELECT, INSERT, UPDATE on both tables.
   --------------------------------------------------------------------------- */

/* --------------------------------------------------------------------------
   1. Server-issued challenges (POST /app-integrity/challenge -> consumed by
      POST /app-integrity/ios/register or by the X-Integrity-Challenge header
      of a protected request).

   A challenge is only worth something if the server can later say "I issued
   that, and it has not been spent". Both facts have to be stored — a nonce
   that is generated and forgotten gives an attacker unlimited replays of one
   captured attestation.

   LoginID holds the DEVICE ID the challenge was issued to (the `deviceId`
   the app sends), not a user: the app fetches its challenge on launch, before
   anyone has logged in. Registration spends the challenge with
   `AND LoginID = @deviceId`, so a nonce fetched by one device cannot be spent
   by another. The client decided against a separate DeviceID column; do not
   add one.
   -------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'HMC_Sanad_AttestChallenge_tbl')
BEGIN
    CREATE TABLE HMC_Sanad_AttestChallenge_tbl (
        ChallengeID INT IDENTITY(1,1)  NOT NULL,
        /* Base64 of 32 random bytes (44 chars); sized with room to spare. */
        Challenge   NVARCHAR(200)      NOT NULL,
        /* The requesting device's id (see above). NULL only for rows issued
           before 2026-09-19, when the route still took the caller's login. */
        LoginID     NVARCHAR(100)      NULL,
        IssuedAt    DATETIME           NOT NULL CONSTRAINT DF_AttestChallenge_IssuedAt DEFAULT (GETDATE()),
        /* IssuedAt + APP_INTEGRITY_CHALLENGE_TTL_MS (default 5 minutes). */
        ExpiresAt   DATETIME           NOT NULL,
        /* NULL until spent — single-use is enforced by updating this column
           conditionally, so two racing requests cannot both claim it. */
        UsedAt      DATETIME           NULL,

        CONSTRAINT PK_HMC_Sanad_AttestChallenge PRIMARY KEY (ChallengeID),
        CONSTRAINT UQ_HMC_Sanad_AttestChallenge UNIQUE (Challenge)
    );

    CREATE INDEX IX_HMC_Sanad_AttestChallenge_Expiry
        ON HMC_Sanad_AttestChallenge_tbl (ExpiresAt);
END
GO

/* --------------------------------------------------------------------------
   2. Attested iOS keys (written by POST /app-integrity/ios/register, read on
      every protected request that carries X-iOS-Assertion / X-iOS-Key-Id).

   iOS attests ONCE per installation, then signs every later request with the
   same Secure Enclave key. The public key must therefore outlive the process:
   if this table is lost, every iOS user has to attest again. INCLUDE IT IN
   BACKUPS.

   LoginID starts as 'device:<deviceId>' — the key was registered on launch,
   before login, so there is no user yet ('device:' is the "unbound" marker;
   ':' cannot occur in an AD login and employee numbers are digits). The first
   assertion made with a valid signature AND a session claims the key for that
   user, and from then on it answers for that user only.

   SignCount is App Attest's replay protection — it increases with each
   assertion, and a value that does not advance means the request is a replay.
   -------------------------------------------------------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'HMC_Sanad_AttestKey_tbl')
BEGIN
    CREATE TABLE HMC_Sanad_AttestKey_tbl (
        AttestKeyID INT IDENTITY(1,1) NOT NULL,
        /* DCAppAttestService.generateKey() result: base64 SHA-256 (44 chars). */
        KeyID       NVARCHAR(200)     NOT NULL,
        /* 'device:<deviceId>' until claimed, then the owner's login (see above). */
        LoginID     NVARCHAR(100)     NOT NULL,
        /* Base64 P-256 public key extracted from the attestation certificate. */
        PublicKey   NVARCHAR(1000)    NOT NULL,
        SignCount   BIGINT            NOT NULL CONSTRAINT DF_AttestKey_SignCount DEFAULT (0),
        CreatedAt   DATETIME          NOT NULL CONSTRAINT DF_AttestKey_CreatedAt DEFAULT (GETDATE()),
        UpdatedAt   DATETIME          NOT NULL CONSTRAINT DF_AttestKey_UpdatedAt DEFAULT (GETDATE()),

        CONSTRAINT PK_HMC_Sanad_AttestKey PRIMARY KEY (AttestKeyID),
        CONSTRAINT UQ_HMC_Sanad_AttestKey_KeyID UNIQUE (KeyID)
    );

    CREATE INDEX IX_HMC_Sanad_AttestKey_LoginID
        ON HMC_Sanad_AttestKey_tbl (LoginID);
END
GO

/* --------------------------------------------------------------------------
   Housekeeping (optional): spent and expired challenges are dead weight.
   A nightly job keeping a day of history is plenty. On 2026-09-24 staging
   held 2,202 challenge rows of which 1,410 were never consumed — the normal
   residue of apps that fetch a nonce and then fail or skip registration.

       DELETE FROM HMC_Sanad_AttestChallenge_tbl
        WHERE ExpiresAt < DATEADD(day, -1, GETDATE());
   -------------------------------------------------------------------------- */
