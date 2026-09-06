# Push notifications & device attestation

Two features added to the Sanaad backend. This is the whole contract: what each
team has to do, every endpoint with its real responses, and what happens before
any of it is switched on.

**Nothing here is active yet.** Both features ship dormant, and the API behaves
exactly as it did before until the credentials and tables below are in place.

---

## Contents

1. [What was built](#what-was-built)
2. [Safe to deploy today](#safe-to-deploy-today)
3. [Database team](#database-team)
4. [DevOps](#devops)
5. [Keys — held and missing](#keys--held-and-missing)
6. [Mobile — notifications](#mobile--notifications)
7. [Mobile — device attestation](#mobile--device-attestation)
8. [Every endpoint](#every-endpoint)
9. [How verification is split](#how-verification-is-split)
10. [Rollout order](#rollout-order)

---

## What was built

**Push notifications (FCM).** Device tokens are stored per device, and a
notification goes out when a request is submitted, approved or rejected.

**Device attestation.** Apple App Attest and Google Play Integrity, verified
against Apple and Google directly. Firebase App Check was built first and then
removed on the client's decision — do not reintroduce it alongside this.

The gateway performs a cheap first-pass check; the backend performs the
cryptographic one. Neither replaces authentication: the JWT says WHO is
calling, attestation says WHAT is.

---

## Safe to deploy today

Verified on both services running together with no credentials, no tables and
every mode off:

| Request | Result |
|---|---|
| `GET /health` | 200 |
| `GET /health/backend` | 200 |
| `POST /notifications/device-token` | 200 |
| `DELETE /notifications/device-token` | 200 |
| `GET /app-integrity/challenge` | 200 |
| `POST /app-integrity/android/verify` | 200 `{"verified":false,"reason":"Play Integrity is not configured"}` |
| `POST /leave/apply` with an invalid body | 400 — unchanged |
| `GET /lookups/lov` with Oracle down | 503 — unchanged |

Two warnings appear at startup and nothing else changes:

```
WARN [NotificationsModule] FIREBASE_SERVICE_ACCOUNT is not set — push
notifications are disabled. Registrations are still stored.
```

Device registrations are accepted and stored even before the key arrives, so
tokens are already in place the moment it does.

---

## Database team

Three tables on the **Sanaad SQL Server** — the same database as
`HMC_Sanad_DeviceRegn_tbl`. Scripts: `tools/notifications-schema.sql` and
`tools/app-integrity-schema.sql`.

### 1. `HMC_Sanad_DeviceToken_tbl` — notifications

```sql
CREATE TABLE HMC_Sanad_DeviceToken_tbl (
    DeviceTokenID    INT IDENTITY(1,1) NOT NULL,
    LoginID          NVARCHAR(100)  NOT NULL,
    IMEINumber       NVARCHAR(200)  NOT NULL,
    DeviceTokenValue NVARCHAR(4000) NOT NULL,
    Platform         NVARCHAR(20)   NULL,
    AppVersion       NVARCHAR(50)   NULL,
    UpdatedAt        DATETIME       NOT NULL DEFAULT GETDATE(),

    CONSTRAINT PK_HMC_Sanad_DeviceToken PRIMARY KEY (DeviceTokenID),
    CONSTRAINT UQ_HMC_Sanad_DeviceToken_Device UNIQUE (LoginID, IMEINumber)
);

CREATE INDEX IX_HMC_Sanad_DeviceToken_LoginID ON HMC_Sanad_DeviceToken_tbl (LoginID);
CREATE INDEX IX_HMC_Sanad_DeviceToken_Value   ON HMC_Sanad_DeviceToken_tbl (DeviceTokenValue);
```

One row per device; a user may legitimately have several (phone and tablet).
The UNIQUE constraint is load-bearing — Firebase reissues a token after a
reinstall, and it is what makes the app replace the old one instead of
accumulating dead tokens.

### 2. `HMC_Sanad_AttestChallenge_tbl` — attestation (iOS)

```sql
CREATE TABLE HMC_Sanad_AttestChallenge_tbl (
    ChallengeID INT IDENTITY(1,1) NOT NULL,
    Challenge   NVARCHAR(200)     NOT NULL,
    LoginID     NVARCHAR(100)     NULL,
    IssuedAt    DATETIME          NOT NULL DEFAULT GETDATE(),
    ExpiresAt   DATETIME          NOT NULL,
    UsedAt      DATETIME          NULL,

    CONSTRAINT PK_HMC_Sanad_AttestChallenge PRIMARY KEY (ChallengeID),
    CONSTRAINT UQ_HMC_Sanad_AttestChallenge UNIQUE (Challenge)
);

CREATE INDEX IX_HMC_Sanad_AttestChallenge_Expiry ON HMC_Sanad_AttestChallenge_tbl (ExpiresAt);
```

`UsedAt` enforces single use. A challenge that could be reused would let one
captured proof be replayed indefinitely.

### 3. `HMC_Sanad_AttestKey_tbl` — attestation (iOS)

```sql
CREATE TABLE HMC_Sanad_AttestKey_tbl (
    AttestKeyID INT IDENTITY(1,1) NOT NULL,
    KeyID       NVARCHAR(200)     NOT NULL,
    LoginID     NVARCHAR(100)     NOT NULL,
    PublicKey   NVARCHAR(1000)    NOT NULL,
    SignCount   BIGINT            NOT NULL DEFAULT 0,
    CreatedAt   DATETIME          NOT NULL DEFAULT GETDATE(),
    UpdatedAt   DATETIME          NOT NULL DEFAULT GETDATE(),

    CONSTRAINT PK_HMC_Sanad_AttestKey PRIMARY KEY (AttestKeyID),
    CONSTRAINT UQ_HMC_Sanad_AttestKey_KeyID UNIQUE (KeyID)
);

CREATE INDEX IX_HMC_Sanad_AttestKey_LoginID ON HMC_Sanad_AttestKey_tbl (LoginID);
```

**Include this one in backups.** iOS registers once and then signs every later
request with that key; if the table is lost, every iPhone user must register
again. `SignCount` is replay protection — it increases with each request.

Android needs no tables: its token is self-contained and verified with Google
on each call.

**Grant the application user `SELECT, INSERT, UPDATE, DELETE` on all three.**

---

## DevOps

### Set now — HMC_BackEnd

```bash
FIREBASE_SERVICE_ACCOUNT=$(base64 -w0 sanaadprd-firebase-adminsdk-3e184542bb.json)
```

or

```bash
FIREBASE_SERVICE_ACCOUNT_PATH=/etc/sanaad/firebase-service-account.json
```

One of the two. Everything else — project id, client email, private key — is
read from the file. Nothing is needed on the gateway for notifications.

The file is a **secret**: out of images, logs and tickets; `chmod 600`, or the
secret store.

> ⚠️ The key belongs to the **production** Firebase project `sanaadprd`. On
> staging it would send test notifications to real employees' phones. Use a
> separate Firebase project for staging, or leave staging without a key.

Confirm with the startup log:

```
Push notifications enabled.
```

### Set later — attestation

Both default to `off`; nothing to do today.

```bash
# HMC_BackEnd
APP_INTEGRITY_MODE=off
APPLE_TEAM_ID=<from Apple Developer>
APPLE_BUNDLE_ID=com.hmc.sanaad
ANDROID_PACKAGE_NAME=com.hmc.sanaad
PLAY_INTEGRITY_SERVICE_ACCOUNT=$FIREBASE_SERVICE_ACCOUNT   # same key works

# HMC_Gateway
GATEWAY_INTEGRITY_MODE=off
```

The two modes are independent — either service can run ahead of the other.

---

## Keys — held and missing

| Item | Status |
|---|---|
| Firebase service account | ✅ held — serves notifications **and** Play Integrity |
| Google Cloud project number `92441560390` | ✅ held (used by the app, not the API) |
| Package `com.hmc.sanaad` | ✅ held |
| Apple App Attest key | ✅ **not needed** — verification is local against a public root CA |
| `APPLE_TEAM_ID` | ⏳ missing — an identifier, not a secret |
| APNs `.p8`, uploaded to Firebase | ⏳ missing — **blocks iOS notifications** |

### Two console actions, no new credential

The existing Firebase service account was tested against the Play Integrity API
and **can mint a token for the `playintegrity` scope**. The only obstacle is
that the API is not switched on:

```
HTTP 403 — Google Play Integrity API has not been used in project
92441560390 before or it is disabled.
```

1. Enable the Play Integrity API on project `92441560390`
   <https://console.developers.google.com/apis/api/playintegrity.googleapis.com/overview?project=92441560390>
2. Link the Cloud project in **Google Play Console → App integrity**

No separate service account is required.

---

## Mobile — notifications

### 1. Firebase setup

**Android:** `google-services.json` in `android/app/`.

**iOS:** `GoogleService-Info.plist` in the Xcode project, the **Push
Notifications** capability enabled, and the **APNs `.p8` key uploaded to the
Firebase Console**. Without that last one iOS delivery fails *silently* while
Android works — the most common cause of lost time on this kind of work.

### 2. Register the token on every app launch

Not only at first install. Firebase reissues the token after a reinstall, a
data clear, and periodically on its own; registering once means notifications
quietly stop months later. Also subscribe to `onTokenRefresh` and send the new
value immediately.

On iOS call `requestPermission()` first, and send the **FCM** token from
`getToken()` — not the raw APNs token.

### 3. Unregister on logout

Otherwise the previous user's notifications keep arriving on a handset they no
longer hold.

### 4. What arrives

| Trigger | Recipient | Title |
|---|---|---|
| A request is submitted | the approver | `New request awaiting your approval` |
| It is approved | the requester | `Request approved` |
| It is rejected | the requester | `Request rejected` |

Nobody is notified about their own action, and nothing is sent when a submit
comes back with `successflag: "N"` — that is a rejection, not a new request.

Payload:

```json
{
  "notification": {
    "title": "Request approved",
    "body": "Leave Request has been approved."
  },
  "data": {
    "notificationId": "123859449",
    "requestType": "Leave Request",
    "event": "APPROVE"
  }
}
```

`event` is `APPROVAL_REQUIRED`, `APPROVE` or `REJECT`. Keys are **omitted when
unknown** rather than sent as `"undefined"`, so check for presence before
reading — `requestType` in particular may be absent.

Open the request with `GET /approvals/{notificationId}/details`.

> **The approver notification is best-effort.** Oracle's workflow creates the
> approval record asynchronously, so occasionally the notification for a
> brand-new submission does not go out. The approver still sees it in their
> worklist — please do not treat a missing one as a bug. Approve and reject
> notifications are reliable; they fire at the moment of the decision.

---

## Mobile — device attestation

Not enforced yet. Build it now so it can be switched on without another app
release.

### Android — Play Integrity

No registration step; every call carries a fresh token.

**Once at startup:**

```dart
await AppAttest.preparePlayIntegrityTokenProvider(
  cloudProjectNumber: 92441560390,
);
```

**Before each request:**

```dart
final bodyString  = jsonEncode(requestBody);
final requestHash = sha256.convert(utf8.encode(bodyString)).toString();
final token = await AppAttest.requestStandardPlayIntegrityToken(
  requestHash: requestHash,
);

headers['X-Integrity-Token']        = token;
headers['X-Integrity-Request-Hash'] = requestHash;
```

⚠️ **Hash exactly the bytes you transmit.** The server recomputes the hash from
the body it received and compares. Any difference in key order or whitespace
between what you hash and what you send will be rejected.

### iOS — App Attest

**Once per installation:**

```dart
final keyId = await AppAttest.generateKey();      // keep in secure storage

final challenge = (await api.get('/app-integrity/challenge')).data['challenge'];
final attestation = await AppAttest.attestKey(
  keyId,
  base64Encode(sha256.convert(utf8.encode(challenge)).bytes),
);

await api.post('/app-integrity/ios/register', data: {
  'keyId': keyId, 'attestation': attestation, 'challenge': challenge,
});
```

**Before each request afterwards:**

```dart
final challenge = (await api.get('/app-integrity/challenge')).data['challenge'];
final assertion = await AppAttest.generateAssertion(
  keyId,
  base64Encode(sha256.convert(utf8.encode(challenge)).bytes),
);

headers['X-iOS-Assertion']       = assertion;
headers['X-iOS-Key-Id']          = keyId;
headers['X-Integrity-Challenge'] = challenge;
```

A challenge is single-use — fetch a new one every time. Losing `keyId` means
registering again.

### Why iOS registers and Android does not

Registration exists to store something. iOS generates a key pair in the Secure
Enclave and the server must learn the **public key** to verify later
signatures. Android has no key pair at all — Google signs each verdict itself,
so there is nothing to keep. An `android/register` route would verify a token
and then have nothing to save.

### Exempt routes

```
/health   /healthcheck   /diagnostics   /dev-console   /app-integrity/*
```

Everything else, including login, is covered once enforcement is on.

---

## Every endpoint

### Register a device for notifications

```http
POST /api/v1/notifications/device-token
Authorization: Bearer <token>
Content-Type: application/json

{
  "token": "fH7kQ2...:APA91bH...",
  "imei": "a5b3d106-8d16-482f-bd4e-8c080a5da203",
  "platform": "android",
  "appVersion": "1.0.0"
}
```
```json
{
  "result": { "message": "Device registered for notifications." },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```

### Unregister a device

```http
DELETE /api/v1/notifications/device-token
Authorization: Bearer <token>
Content-Type: application/json

{ "imei": "a5b3d106-8d16-482f-bd4e-8c080a5da203" }
```
```json
{
  "result": { "message": "Device unregistered." },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```

### Issue an attestation challenge

```http
GET /api/v1/app-integrity/challenge
Authorization: Bearer <token>
```
```json
{
  "result": { "challenge": "AAZxbHy1Kz8ozDwx5e4sxx65ZYovhjfSFUIRisZz1JM=" },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```

Single use, valid for 5 minutes.

### Register an App Attest key (iOS, once per install)

```http
POST /api/v1/app-integrity/ios/register
Authorization: Bearer <token>
Content-Type: application/json

{
  "keyId": "<from generateKey()>",
  "attestation": "<base64 attestation object>",
  "challenge": "AAZxbHy1Kz8ozDwx5e4sxx65ZYovhjfSFUIRisZz1JM="
}
```

Accepted:
```json
{
  "result": { "message": "Device attested." },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```

Refused — the reason is deliberately withheld here and written to the server
log, so a probing client is not told which check to defeat next:
```json
{
  "result": { "message": "Attestation could not be verified.", "verified": false },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```

Check `verified`; its **absence** means success.

### Check a Play Integrity token (Android, development aid)

```http
POST /api/v1/app-integrity/android/verify
Authorization: Bearer <token>
Content-Type: application/json

{
  "integrityToken": "<from requestStandardPlayIntegrityToken()>",
  "requestHash": "<sha256 hex of your request body>"
}
```
```json
{
  "result": {
    "verified": true,
    "verdicts": {
      "appRecognitionVerdict": "PLAY_RECOGNIZED",
      "deviceRecognitionVerdict": ["MEETS_DEVICE_INTEGRITY"],
      "appLicensingVerdict": "LICENSED",
      "packageName": "com.hmc.sanaad"
    }
  },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```
```json
{
  "result": {
    "verified": false,
    "reason": "app verdict UNRECOGNIZED_VERSION",
    "verdicts": {
      "appRecognitionVerdict": "UNRECOGNIZED_VERSION",
      "deviceRecognitionVerdict": ["MEETS_BASIC_INTEGRITY"],
      "appLicensingVerdict": "LICENSED"
    }
  },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```

Before the Play Integrity API is enabled:
```json
{
  "result": { "verified": false, "reason": "Play Integrity is not configured" },
  "opstatus": 0,
  "status": "success",
  "httpStatusCode": 200
}
```

**This is a development aid, not the enforcement path.** In production the
token rides as a header on the real request; calling this first would make
every action two round trips. Unlike the guard it reports *why*, which is the
point of having it — the guard stays silent so a probing client learns nothing.

Verdict values worth recognising:

| Value | Meaning |
|---|---|
| `PLAY_RECOGNIZED` | genuine build from Play |
| `UNRECOGNIZED_VERSION` | modified APK, or not from Play |
| `MEETS_DEVICE_INTEGRITY` | trustworthy device |
| `MEETS_STRONG_INTEGRITY` | trustworthy + verified boot |
| `MEETS_BASIC_INTEGRITY` **alone** | rooted or emulated |
| `LICENSED` | installed from a Play account |

### A protected request — iOS

```http
POST /api/v1/leave/apply?lang=en
Authorization: Bearer <token>
X-iOS-Assertion: <base64 assertion>
X-iOS-Key-Id: <keyId>
X-Integrity-Challenge: <fresh challenge>
Content-Type: application/json

{ ...normal body... }
```

### A protected request — Android

```http
POST /api/v1/leave/apply?lang=en
Authorization: Bearer <token>
X-Integrity-Token: <Play Integrity token>
X-Integrity-Request-Hash: <sha256 hex of the exact body sent>
Content-Type: application/json

{ ...normal body... }
```

Both pass through untouched while attestation is off. Once enforced, a missing
or invalid proof gives:

```json
{
  "status": "error",
  "message": "This request did not come from a verified app.",
  "httpStatusCode": 401
}
```

### Validation errors

Missing a required field:
```json
{
  "success": false,
  "message": "Validation failed.",
  "status": "error",
  "httpStatusCode": 400,
  "errors": { "details": ["token should not be empty"] }
}
```

Sending `username` in the body — never do this; the user comes from the token:
```json
{
  "success": false,
  "message": "Validation failed.",
  "status": "error",
  "httpStatusCode": 400,
  "errors": { "details": ["property username should not exist"] }
}
```

---

## How verification is split

The gateway holds no database and no platform credentials, by design — it is a
security layer, not a second service. So it checks only what needs neither, and
the cryptography stays where the state is. This is defence in depth; nothing
was moved out of the backend.

| | Gateway | Backend |
|---|---|---|
| Database | none | three tables |
| Platform credentials | none | Firebase / Play Integrity |
| External calls | none | Google |
| Headers present | ✅ | ✅ |
| Header shape plausible | ✅ | — |
| Request hash matches the body | ✅ | ✅ |
| Apple certificate chain | — | ✅ |
| Google verdicts | — | ✅ |
| Challenge unspent | — | ✅ |
| Signature counter advanced | — | ✅ |
| Cost | microseconds | a network call |

The hash comparison is the one with real teeth at the edge: it costs nothing
and it catches a genuine token lifted onto a different request, which is most
of what Play Integrity offers over a plain "is the app real" test.

---

## Rollout order

```
1. Deploy                                  — nothing changes, features dormant
2. Create the three tables                 — registrations start persisting
3. Set FIREBASE_SERVICE_ACCOUNT            — notifications begin working
4. Enable Play Integrity API + link Play Console
5. Set APPLE_TEAM_ID, APPLE_BUNDLE_ID, ANDROID_PACKAGE_NAME
6. APP_INTEGRITY_MODE=observe               — one release cycle, read the logs
   GATEWAY_INTEGRITY_MODE=observe
7. APP_INTEGRITY_MODE=enforce               — only once the numbers are acceptable
   GATEWAY_INTEGRITY_MODE=enforce
```

**Do not skip step 6.** Enforcement rejects real devices — phones without Play
Services, rooted handsets, sideloaded builds, simulators. Observe mode reports
exactly what *would* have been refused while letting everything through, which
is the only way to know the cost before paying it.

---

## Notes for whoever maintains this

- **There is no Apple endpoint that validates an attestation.** The widely
  copied `validate_device_token` call belongs to DeviceCheck — a different,
  older feature — and neither accepts an attestation object nor returns a
  public key. Verification is local, against Apple's App Attest root CA.
- The Play Integrity method is `playintegrity.v1.decodeIntegrityToken`. A
  top-level `decodePlayIntegrity` does not exist on the client.
- The gateway's `FORWARD_REQUEST_HEADERS` is an allow-list. The attestation
  headers are on it deliberately; removing them would leave the backend's
  verification permanently blind, since the gateway is the only way in.
- The gateway forwards the **raw request bytes**, captured through the
  body-parser `verify` hook. Forwarding the parsed object instead lets axios
  re-serialize it, and a re-encoded body hashes differently from what the
  client sent — every honest request would fail the comparison.
