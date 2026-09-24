# Device attestation — security review

Review of `HMC_BackEnd/src/modules/app-integrity/` and the gateway first pass in
`HMC_Gateway/src/core/integrity/`, covering challenge lifecycle, iOS assertion
replay defence, pre-attestation route abuse, Android request binding,
observability, configuration robustness and test coverage.

Scope note: Firebase App Check is not reintroduced anywhere in this review —
Apple and Google are verified directly, as the client decided.

Findings are marked **fixed in this change** or **recommendation**. Severity is
about the exposure once `APP_INTEGRITY_MODE=enforce` is switched on; in `off`
and `observe` nothing here can reject a real user.

---

## Summary

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | Android token could be replayed onto another request by omitting `x-integrity-request-hash` | High | Fixed |
| 2 | Request hash computed over a re-serialized body, not the received bytes | High | Fixed |
| 3 | iOS sign counter could be moved BACKWARDS by a concurrent/stale assertion | Medium | Fixed |
| 4 | Spent and expired challenge rows accumulate forever | Low | Fixed |
| 5 | Observe-mode rollout data existed only as log lines | Medium | Fixed |
| 6 | A non-numeric `APP_INTEGRITY_CHALLENGE_TTL_MS` expired every challenge instantly | Medium | Fixed |
| 7 | The attestation DDL was only embedded in prose | Low | Fixed |
| 8 | Challenge is bound to the caller — verified, no change needed | — | Verified |
| 9 | Pre-attestation routes are throttled at the gateway only | Medium | Recommendation |
| 10 | Disabled adapters cannot silently pass, mode parsing is fail-closed | — | Verified |

---

## 1. Android request-hash enforcement (High, fixed)

`AppIntegrityGuard.verify` only compared the hash when the client sent
`x-integrity-request-hash`. A genuine Play Integrity token harvested from any
call could therefore be replayed onto a different call — a different endpoint,
a different body — simply by leaving the header off. Binding the token to the
request is most of what Play Integrity buys over "is this app real", so the
omission removed the control rather than weakening it.

Both layers now refuse a missing hash when the mode is `enforce` and the new
`APP_INTEGRITY_REQUIRE_REQUEST_HASH` / `GATEWAY_INTEGRITY_REQUIRE_REQUEST_HASH`
flag is on (the default):

- backend: `app-integrity.guard.ts`
- gateway: `integrity-precheck.guard.ts`

`observe` stays permissive on purpose — an older client that does not send the
header must be counted, not blocked, and the counters in §5 are what tells you
whether any such client is still out there. The flag exists as the escape hatch
for exactly that situation: setting it to `false` restores the previous
opt-in behaviour without leaving `enforce`.

A malformed value (anything that is not a 64-character SHA-256 hex digest) is
rejected in every mode that verifies, since it can only be a broken client.

## 2. Hash the bytes that arrived, not a re-serialization (High, fixed)

The guard hashed `req.body` — the object Express had already parsed — so the
digest depended on how Node re-serialized it, not on what the client signed.
Key order and whitespace survive `JSON.parse`/`JSON.stringify` only by
coincidence, and any client that hashes its own payload text (all of them) would
mismatch on a body the parser normalized.

`HMC_BackEnd/src/main.ts` now keeps the raw buffer via the body-parser `verify`
hook, `AppIntegrityService.hashBody` hashes a `Buffer` directly, and the guard
prefers `req.rawBody` over `req.body`. The gateway already captured raw bytes
and forwards them, so the two layers now hash the same input.

## 3. iOS assertion counter persistence (Medium, fixed)

`verifyIosAssertion` did already call `AttestKeyStorePort.updateSignCount` after
a successful assertion, so the replay defence in `apple-app-attest.adapter.ts`
was not inert. The gap was atomicity: the UPDATE wrote the counter
unconditionally, so two assertions racing (or one arriving late) could store a
LOWER value than one already persisted and re-open the window for the
assertions in between.

The statement is now conditional, which makes the counter monotonic without a
transaction or a lock:

```sql
UPDATE HMC_Sanad_AttestKey_tbl
SET SignCount = @signCount, UpdatedAt = GETDATE()
WHERE KeyID = @keyId AND SignCount < @signCount
```

## 4. Challenge lifecycle and storage hygiene (Low, fixed)

Two separate questions here.

**Binding (verified, no change).** `ChallengeStorePort.consume(value, deviceId?)`
takes the owner, `registerIosKey` passes it, and the MSSQL statement adds
`AND LoginID = @deviceId` when it is present — a challenge issued to one
installation cannot be consumed by another. The store's `consume` is a single
conditional `UPDATE` on `UsedAt IS NULL`, so two concurrent uses of one
challenge cannot both win: the loser updates zero rows and is refused. The
column is `LoginID` and pre-login registration puts the device marker in it,
which is why the port names the argument `deviceId` rather than `username`.

**Cleanup (fixed).** Expired rows were filtered on read but never deleted, so
the table grew for the lifetime of the deployment. `issue()` now purges
long-dead rows opportunistically: at most once every 15 minutes per process,
capped at 5,000 rows per pass, and only rows expired more than 24 hours ago
(the grace period keeps a failed registration diagnosable). The purge runs
through the same error guard as everything else in the repository, so a failed
cleanup can never stop a challenge being issued. No scheduler, no new
dependency — attestation traffic is itself the trigger.

## 5. Observability for the rollout (Medium, fixed)

`observe` mode existed to produce the numbers you need before switching to
`enforce`, but it only produced `log.warn` lines, which cannot be counted per
platform or per reason without log-aggregation work nobody had scoped.

`AppIntegrityMetrics` (new, `application/app-integrity.metrics.ts`) records
every verdict the guard reaches: totals, per-platform totals (`ios`, `android`,
and `none` for a call that claimed no platform at all — counting those as iOS
failures would have made the rollout numbers meaningless), normalized failure
reasons with a bounded key count, and the last failure with route and
timestamp.

Read it at `GET /app-integrity/metrics`. It is in-process and resets on
restart, deliberately: this is rollout instrumentation with a known end date,
not a metrics backend. It sits behind `DiagnosticsEnabledGuard` — the same kill
switch as the Oracle diagnostics routes — and is hidden from Swagger, so it is
404 unless diagnostics are deliberately enabled.

Suggested reading before flipping to `enforce`: `failed` near zero over a full
release cycle, and no meaningful count under `byPlatform.none` or under a
`request hash header is missing` reason — either of those means a live client
would break.

## 6. Configuration robustness (Medium, fixed / verified)

`APP_INTEGRITY_CHALLENGE_TTL_MS` was read with `Number(...)`, so a typo, an
empty string or a negative value produced `NaN` or a past instant and every
challenge expired the moment it was issued — which reads as "attestation is
broken", not "the variable has a typo". It now falls back to five minutes
unless the value is a finite positive number.

Verified unchanged and correct: an unrecognised `APP_INTEGRITY_MODE` /
`GATEWAY_INTEGRITY_MODE` normalizes to `off` in both projects, and a disabled
adapter returns a FAILED verdict rather than an absent one, so
`enforce` with a missing credential refuses requests instead of passing them.
That is the right direction for a security control, and the boot log states
which platform is unconfigured.

## 7. Schema (Low, fixed)

`tools/app-integrity-schema.sql` was referenced but did not exist; the DDL
lived in `Docs_Ai/API/mobile-notifications-and-attestation.md` and only the
device-id migration was scripted. `HMC_BackEnd/tools/app-integrity-schema.sql`
now creates both tables and their indexes idempotently, matching the names the
adapters actually query.

## 8. Rate limiting on pre-attestation routes (Medium, recommendation)

`/app-integrity/challenge`, `/ios/register` and `/android/verify` are
`@SkipIntegrity()` by necessity — they are how a device becomes attestable — so
they are the only unauthenticated attestation surface.

The gateway already throttles all three per IP
(`HMC_Gateway/src/modules/auth/app-integrity.controller.ts`): 60/min for
challenge issuance, 20/min for the two that do real cryptographic or
Google-API work. Nothing to add there.

The backend itself has no throttling of any kind. That is acceptable while it
is reachable only through the gateway, and it is the assumption the whole
deployment already makes. **Recommendation:** confirm at the network layer that
the backend port is not routable from outside, and treat "expose the backend
directly" as a change that requires adding `@nestjs/throttler` to it first.
Deliberately not implemented here — it is a new dependency and a
global-guard change for a risk the current topology does not have.

## 9. Test coverage

Coverage existed for the service orchestration (including a
counter-not-advancing replay), the controller endpoints, the challenge store
and mode handling; the two platform adapters had no spec of their own, so a
wrong-package Play Integrity token was never exercised. Added with this change:

- `google-play-integrity.adapter.spec.ts` (new) — a token minted for another
  package, a sideloaded build, an untrusted device, a request hash lifted onto
  a different body, a Google-side error surfacing as a failed verdict rather
  than a throw, and the disabled stub failing closed.
- `mssql-integrity-store.repository.spec.ts` — the purge is capped and
  respects the grace period, does not repeat within the interval, and a purge
  failure does not stop challenge issuance; the sign-count UPDATE is
  conditional.
- `app-integrity.guard.spec.ts` — enforce rejects a missing hash, observe does
  not; raw bytes are hashed even when the parsed object's key order differs
  from the wire order; the metrics counters land under the right platform and
  reason.
- `integrity-precheck.guard.spec.ts` (gateway) — the same three cases at the
  first-pass layer, including the opt-out flag.
- `app-integrity-config.spec.ts` — request-hash default, explicit opt-out, and
  the TTL fallback for invalid, zero and negative values.

Still uncovered, and worth adding when App Attest fixtures are available: the
`apple-app-attest.adapter.ts` CBOR and certificate-chain paths, which currently
have no direct test.

## 10. Not done, on purpose

- **Firebase App Check** — removed by client decision, not reintroduced.
- **An Apple endpoint for attestation** — there is none; `validate_device_token`
  is DeviceCheck. Verification stays local.
- **A persistent metrics backend** — see §5.
- **Backend throttling** — see §8.
