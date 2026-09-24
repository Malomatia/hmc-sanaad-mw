/* ---------------------------------------------------------------------------
   Sanaad push notifications — FCM registration tokens
   Target: the Sanaad SQL Server (the same database as HMC_Sanad_DeviceRegn_tbl)

   A separate table rather than a column on HMC_Sanad_DeviceRegn_tbl:

     - that row is the MPIN / device-trust record and outlives a notification
       registration, which is cleared on logout;
     - a user legitimately has more than one device (phone and tablet), and a
       single column would silently drop the notification for whichever device
       registered first.

   Keyed by (LoginID, IMEINumber) — the same pair as the device-binding table.
   The token is the volatile part: FCM reissues it on reinstall, on data clear
   and periodically on its own, so re-registering a device REPLACES its token
   instead of leaving a dead one behind.

   Idempotent — safe to re-run. Staging has had the table since 2026-09-02
   (58 registrations on 2026-09-24) but was created from an earlier revision
   of this script: the DROP INDEX at the bottom still needs to run there.

   The API tolerates this table not existing yet: registrations are discarded
   with a single warning and nothing else breaks.

   Grant the application login SELECT, INSERT, UPDATE, DELETE.
   --------------------------------------------------------------------------- */

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'HMC_Sanad_DeviceToken_tbl')
BEGIN
    CREATE TABLE HMC_Sanad_DeviceToken_tbl (
        DeviceTokenID    INT IDENTITY(1,1) NOT NULL,
        LoginID          NVARCHAR(100)  NOT NULL,
        IMEINumber       NVARCHAR(200)  NOT NULL,
        /* FCM tokens have no documented maximum and have grown over time;
           sized generously so a longer one is never silently truncated. */
        DeviceTokenValue NVARCHAR(4000) NOT NULL,
        Platform         NVARCHAR(20)   NULL,   -- 'android' | 'ios'
        AppVersion       NVARCHAR(50)   NULL,
        UpdatedAt        DATETIME       NOT NULL CONSTRAINT DF_DeviceToken_UpdatedAt DEFAULT (GETDATE()),

        CONSTRAINT PK_HMC_Sanad_DeviceToken PRIMARY KEY (DeviceTokenID),
        /* One registration per device — what makes re-registering a replace. */
        CONSTRAINT UQ_HMC_Sanad_DeviceToken_Device UNIQUE (LoginID, IMEINumber)
    );

    /* Sending reads every token of one user; this is that lookup. */
    CREATE INDEX IX_HMC_Sanad_DeviceToken_LoginID
        ON HMC_Sanad_DeviceToken_tbl (LoginID);

    /* No index on DeviceTokenValue, deliberately.

       An earlier version had one, and SQL Server warned:

         "The maximum key length for a nonclustered index is 1700 bytes. The
          index has maximum length of 8000 bytes. For some combination of
          large values, the insert/update operation will fail."

       NVARCHAR(4000) is 8000 bytes, so that was not a cosmetic warning — a
       long token could have failed to insert. It is not needed either: when
       FCM reports a dead token the API already knows which device it belongs
       to, and deletes by (LoginID, IMEINumber) using the unique constraint
       above. Nothing ever searches by token value. */
END
GO

/* --------------------------------------------------------------------------
   If the earlier version of this script was already applied (it was, on
   staging), drop that index.
   -------------------------------------------------------------------------- */
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_HMC_Sanad_DeviceToken_Value')
    DROP INDEX IX_HMC_Sanad_DeviceToken_Value ON HMC_Sanad_DeviceToken_tbl;
GO
