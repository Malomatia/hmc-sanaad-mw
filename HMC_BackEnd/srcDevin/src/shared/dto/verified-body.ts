import { ApiBody } from '@nestjs/swagger';

/**
 * Attach a ready-to-run request-body example to a submit endpoint.
 *
 * Why this exists: Swagger UI builds its "Try it out" body from the schema, so
 * any property without an `example` shows up as the literal `"string"`. Copying
 * that generated body sends nonsense to Oracle — and several of these
 * procedures answer a bare `ORA-01403` when one field is wrong, which is the
 * single most expensive class of confusion in this integration.
 *
 * `VerifiedBody(Dto, payload)` keeps the DTO as the schema (so validation docs
 * stay in one place) and adds a NAMED example holding exactly the payload that
 * was executed against staging. Swagger UI preselects it, so "Try it out" runs
 * a request that is known to work.
 *
 * Pass `note` when the example needs a caveat (a value that must be replaced,
 * or a still-blocked endpoint).
 */
export function VerifiedBody(
  type: new (...args: never[]) => unknown,
  example: Record<string, unknown>,
  note = 'Verified against staging — safe to run as-is (replace ids/dates with your own data).',
): MethodDecorator {
  return ApiBody({
    type,
    examples: {
      verified: { summary: note, value: example },
    },
  });
}

/** Base64 of a tiny text file — a valid, harmless attachment for examples. */
export const SAMPLE_ATTACHMENT = 'dGVzdCBhdHRhY2htZW50';
