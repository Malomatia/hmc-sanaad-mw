# Auth journey — environment variables (reworked initiate flow, 2026-09-03/04)

Env vars added (or whose default changed) with the September 2026 rework of the
mobile auth journey: `/auth/initiate` now validates the user against the
live-employee master view on the MOTC_SMS DB, creates the device registration
itself, and the OTP is stored in `HMC_RHAP_OTP_tbl` while the SMS goes out as a
row INSERTed into `MOTC_SMS_PushTable` (the gateway fires it — no SMS call
from our side). All are documented inline in `HMC_BackEnd/.env.example` and
mirrored in `docker-compose.yml`.

## New variables

| Variable | Values | Default | Purpose |
|---|---|---|---|
| `OTP_DELIVERY` | `motc` \| `http` | `motc` | How the OTP SMS is delivered when `OTP_STORE=legacy`: `motc` = the documented INSERT into `MOTC_SMS_PushTable` only (`MotcPushOtpDeliveryAdapter` — the row IS the SMS, nothing is fired from our side); `http` = the generic `SMS_API_*` HTTP adapter |
| `OTP_STATIC_VALUE` | any string (e.g. `123456`); empty = random | `` (empty) | TESTING AID: pins every generated OTP to this exact value so the journey can be exercised without reading the SMS. **Leave empty in production** |
| `OTP_CHARSET` | `numeric` \| `alphanumeric` | `numeric` | OTP alphabet: `numeric` = `OTP_LENGTH` digits (leading zeros kept); `alphanumeric` = `OTP_LENGTH` characters from A-Z/2-9 (ambiguous I/O/0/1 excluded for SMS readability) |
| `MOTC_SMS_EMPLOYEE_MASTER_VIEW` | SQL identifier | `HMC_SND_LIV_EMP_MASTER_VW` | Live-employee master view on the MOTC_SMS DB that `/auth/initiate` (with `AUTH_DIRECTORY=usersdb`) checks the username against (`UserName` column). A user absent from it is refused with "User not found." |

## Changed defaults

| Variable | Values | Old default | New default | Why |
|---|---|---|---|---|
| `OTP_STORE` | `legacy` \| `motc` | `motc` | `legacy` | OTPs are stored/validated in `HMC_RHAP_OTP_tbl` on the Users DB (the client's documented `TOP 1 ... ORDER BY SeqNo DESC` validation query); the push table is delivery only (see `OTP_DELIVERY`) |
| `MOTC_SMS_SQL_ENABLED` | `true` \| `false` | `false` | `true` | Currently **ignored** — `POST /diagnostics/motc-sms-db/sql` is temporarily ungated (client request 2026-09-03, same treatment as the Oracle console). The flag matters again only when the gates are restored |

## Recommended `.env` for testing the journey

```env
AUTH_DIRECTORY=usersdb
AUTH_DISABLED=false

OTP_STORE=legacy
OTP_DELIVERY=motc
OTP_STATIC_VALUE=123456
OTP_CHARSET=numeric
OTP_LENGTH=6

MOTC_SMS_EMPLOYEE_MASTER_VIEW=HMC_SND_LIV_EMP_MASTER_VW
```

## Production differences

```env
OTP_STATIC_VALUE=          # empty → random OTPs
```

Also restore the SQL-console gates (`MOTC_SMS_SQL_ENABLED` / `ORACLE_SQL_ENABLED`
+ the `NODE_ENV=production` checks in `diagnostics.controller.ts`) before any
production hardening — push-table rows contain live OTPs.

## Unchanged (for reference)

`OTP_LENGTH` (6), `OTP_TTL_SECONDS` (300), `OTP_MAX_ATTEMPTS` (5),
`OTP_RESEND_WINDOW_SECONDS` (60), `USERS_DB_*`, `MOTC_SMS_DB_*`,
`MOTC_SMS_APP_ID` / `MOTC_SMS_FROM_ADDRESS` / other push-table column values,
`SMS_MESSAGE_TEMPLATE` (`{otp}` placeholder — also used to extract the OTP
back out of a stored `MessageBody` when `OTP_STORE=motc`).
