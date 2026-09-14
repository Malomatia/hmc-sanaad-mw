import { applyDecorators } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';

/**
 * Documents a read endpoint's 200 response as the Sanaad success envelope
 * (`{ result, opstatus: 0, status: 'success', httpStatusCode: 200 }`) produced by
 * the ResponseInterceptor, with a real example payload.
 *
 * `example` is the inner `result` value — the raw payload the controller returns
 * — so the documented example matches exactly what a client receives over HTTP,
 * envelope included. Examples are captured from real successful calls
 * (see api_test.json), never fabricated.
 *
 * The example is set as a TOP-LEVEL `example` option (not nested under
 * `schema.example`) on purpose: routes that also carry a separate
 * `@ApiOkResponse({ type: SomeDto })` (e.g. `LovResponseDto`) end up with a
 * `.type` in the merged response metadata, which makes `@nestjs/swagger`
 * render the response via a `$ref` schema (`ResponseObjectFactory.toRefObject`)
 * — that path discards `schema.example` entirely and only keeps a top-level
 * `example`/`examples` key. Keeping it top-level here means it survives
 * whichever path Swagger takes, whether or not the route also declares `type`.
 */
export function ApiReadOkResponse(options: {
  description?: string;
  example: unknown;
}): MethodDecorator {
  const { description, example } = options;
  return applyDecorators(
    ApiOkResponse({
      description: description ?? 'Successful read (Sanaad success envelope).',
      example: {
        result: example,
        opstatus: 0,
        status: 'success',
        httpStatusCode: 200,
      },
    }),
  );
}
