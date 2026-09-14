/**
 * Sanaad response envelopes. Success is standardized by the ResponseInterceptor;
 * failures by the exception filters. See Docs_Ai/Architecture/README.md section 4.
 */

export interface SanaadSuccessEnvelope<T = unknown> {
  result: T;
  opstatus: 0;
  status: 'success';
  httpStatusCode: number;
}

/**
 * Envelope for action/submit operations backed by Oracle `_PR`/`_PKG`.
 * `message` is `errormessage` (English) or `errormessageAr` (Arabic)
 * depending on the request's `lang` (`en`/`ar`, default `en`) — the client
 * only ever sees the one that matches its language, not both.
 */
export interface SanaadActionEnvelope<T = unknown> {
  status: 'success' | 'error';
  successflag: 'S' | 'N';
  message: string;
  httpStatusCode: number;
  result?: T;
}

/**
 * Error envelope produced by the global exception filter — kept minimal and
 * consistent across every API: `success`/`status` for a quick check,
 * `message` already resolved to the request's `lang` (default `en`), and
 * `httpStatusCode` mirroring the actual HTTP status. `errors` is the only
 * optional addition, present for validation failures (400) to describe which
 * fields were invalid. No technical detail (ORA codes, SQL, stack traces,
 * correlation id, timestamp, path, category) is put in the body — that detail
 * is only ever logged server-side (see AllExceptionsFilter.logInternal).
 */
export interface SanaadErrorEnvelope {
  success: false;
  message: string;
  status: 'error';
  httpStatusCode: number;
  errors?: Record<string, unknown>;
}

export type SanaadEnvelope<T = unknown> =
  | SanaadSuccessEnvelope<T>
  | SanaadActionEnvelope<T>
  | SanaadErrorEnvelope;
