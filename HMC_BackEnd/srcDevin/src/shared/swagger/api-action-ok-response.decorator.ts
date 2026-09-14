import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

/**
 * Documents a submit/action endpoint's 200 response as the Sanaad action
 * envelope (`{ status, successflag, message, errormessage, httpStatusCode }`)
 * produced by `toSubmitResult`/`ResponseInterceptor`, with a real example
 * captured from a successful call (see api_test_work.json). Mirrors
 * `ApiReadOkResponse`, which documents the read envelope instead.
 *
 * `example` is a TOP-LEVEL option, not nested under `schema.example` — see
 * `ApiReadOkResponse` for why: a route that also has `@ApiOkResponse({ type:
 * SubmitResultDto })` gets its response rendered via a `$ref` schema, which
 * discards a nested `schema.example` but keeps a top-level `example`.
 */
export function ApiActionOkResponse(options: {
  description?: string;
  example: unknown;
}): MethodDecorator {
  const { description, example } = options;
  return applyDecorators(
    ApiOkResponse({
      description: description ?? 'Submit result (Sanaad action envelope).',
      example,
    }),
  );
}
