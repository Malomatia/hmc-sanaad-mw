SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF OBJECT_ID(N'dbo.HMC_Sanad_AuthChallenge_tbl', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.HMC_Sanad_AuthChallenge_tbl (
    RequestId varchar(43) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
    LoginID nvarchar(256) NOT NULL,
    DeviceIMEI nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
    Purpose varchar(20) NOT NULL CHECK (Purpose IN ('ONBOARDING', 'FORGOT_MPIN')),
    OtpHash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    Attempts int NOT NULL DEFAULT 0,
    ExpiresAt datetime2(3) NOT NULL,
    CreatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
    DeliveredAt datetime2(3) NULL,
    ConsumedAt datetime2(3) NULL
  );
  CREATE INDEX IX_AuthChallenge_Expiry ON dbo.HMC_Sanad_AuthChallenge_tbl (ExpiresAt);
  CREATE INDEX IX_AuthChallenge_UserPurpose ON dbo.HMC_Sanad_AuthChallenge_tbl (LoginID, Purpose);
END;

IF OBJECT_ID(N'dbo.HMC_Sanad_EnrollmentGrant_tbl', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.HMC_Sanad_EnrollmentGrant_tbl (
    TokenHash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
    LoginID nvarchar(256) NOT NULL,
    DeviceIMEI nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
    ExpiresAt datetime2(3) NOT NULL,
    ConsumedAt datetime2(3) NULL
  );
  CREATE INDEX IX_EnrollmentGrant_User ON dbo.HMC_Sanad_EnrollmentGrant_tbl (LoginID);
  CREATE INDEX IX_EnrollmentGrant_Expiry ON dbo.HMC_Sanad_EnrollmentGrant_tbl (ExpiresAt);
END;

IF OBJECT_ID(N'dbo.HMC_Sanad_AuthSession_tbl', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.HMC_Sanad_AuthSession_tbl (
    SessionId varchar(36) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
    LoginID nvarchar(256) NOT NULL,
    DeviceIMEI nvarchar(256) COLLATE Latin1_General_100_BIN2 NOT NULL,
    AccessId varchar(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
    RefreshId varchar(36) COLLATE Latin1_General_100_BIN2 NOT NULL,
    ExpiresAt datetime2(3) NOT NULL,
    RevokedAt datetime2(3) NULL
  );
  CREATE INDEX IX_AuthSession_User ON dbo.HMC_Sanad_AuthSession_tbl (LoginID);
  CREATE INDEX IX_AuthSession_Expiry ON dbo.HMC_Sanad_AuthSession_tbl (ExpiresAt);
END;

IF OBJECT_ID(N'dbo.HMC_Sanad_AuthLimit_tbl', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.HMC_Sanad_AuthLimit_tbl (
    ScopeHash char(64) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
    Attempts bigint NOT NULL,
    ExpiresAt datetime2(3) NOT NULL
  );
  CREATE INDEX IX_AuthLimit_Expiry ON dbo.HMC_Sanad_AuthLimit_tbl (ExpiresAt);
END;

COMMIT;
