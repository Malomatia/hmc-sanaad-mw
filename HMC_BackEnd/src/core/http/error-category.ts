/**
 * Error taxonomy for the centralized exception handler. Each category maps to a
 * safe, client-facing message and a default HTTP status. Technical detail
 * (ORA codes, SQL, schema, stack traces, internal messages) is NEVER put in the
 * `message` — it is only logged server-side by the global filter.
 */
export enum ErrorCategory {
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
  NOT_FOUND = 'NOT_FOUND',
  /**
   * A submitted value did not resolve inside the procedure (ORA-01403 from a
   * SELECT INTO). Separate from NOT_FOUND because the resource exists — the
   * INPUT is what could not be matched, and calling that "not found" sent
   * people looking for a missing endpoint instead of a wrong field value.
   */
  UNRESOLVED_VALUE = 'UNRESOLVED_VALUE',
  BUSINESS_RULE_ERROR = 'BUSINESS_RULE_ERROR',
  DATABASE_ERROR = 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  TIMEOUT = 'TIMEOUT',
  /**
   * Request body over the configured limit (BODY_LIMIT). Its own category
   * because it used to land in APPLICATION_ERROR → 500, which read as a server
   * bug: an oversized attachment is the client's to fix, and saying so is what
   * makes it fixable.
   */
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  APPLICATION_ERROR = 'APPLICATION_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  /**
   * Internal-only: a resolvable Oracle column/view mismatch. Always caught and
   * degraded to a partial-but-successful response (see readByResolvedKey /
   * AllExceptionsFilter) — never actually sent to a client as an error.
   */
  SCHEMA_MISMATCH = 'SCHEMA_MISMATCH',
}

/** Safe, high-level message shown to clients per category (English). */
export const CATEGORY_MESSAGE: Readonly<Record<ErrorCategory, string>> = Object.freeze({
  [ErrorCategory.VALIDATION_ERROR]: 'Validation failed.',
  [ErrorCategory.AUTHENTICATION_ERROR]: 'Authentication failed.',
  [ErrorCategory.AUTHORIZATION_ERROR]: 'You do not have permission to perform this action.',
  [ErrorCategory.NOT_FOUND]: 'The requested resource was not found.',
  [ErrorCategory.UNRESOLVED_VALUE]:
    'One of the submitted values was not recognised. Check each value against its ' +
    'lookup (LOV) endpoint — the letter name and language must be a valid pair, and ' +
    'the phone number and delivery location must be ones already on record.',
  [ErrorCategory.BUSINESS_RULE_ERROR]: 'The requested operation cannot be completed.',
  [ErrorCategory.DATABASE_ERROR]:
    'A database operation could not be completed. Please contact support if the problem persists.',
  [ErrorCategory.EXTERNAL_SERVICE_ERROR]: 'An external service is currently unavailable.',
  [ErrorCategory.TIMEOUT]: 'The request took too long to process. Please try again.',
  [ErrorCategory.PAYLOAD_TOO_LARGE]:
    'The request is too large. Attachments are sent as base64, which makes them about a third ' +
    'bigger than the file — compress the file and try again.',
  [ErrorCategory.APPLICATION_ERROR]: 'An unexpected application error occurred.',
  [ErrorCategory.UNKNOWN_ERROR]: 'An unexpected error occurred.',
  [ErrorCategory.SCHEMA_MISMATCH]: 'Success.',
});

/** Same safe messages, Arabic — selected by request `lang` alongside `CATEGORY_MESSAGE`. */
export const CATEGORY_MESSAGE_AR: Readonly<Record<ErrorCategory, string>> = Object.freeze({
  [ErrorCategory.VALIDATION_ERROR]: 'فشل التحقق من صحة البيانات.',
  [ErrorCategory.AUTHENTICATION_ERROR]: 'فشلت عملية المصادقة.',
  [ErrorCategory.AUTHORIZATION_ERROR]: 'ليس لديك صلاحية لتنفيذ هذا الإجراء.',
  [ErrorCategory.NOT_FOUND]: 'المورد المطلوب غير موجود.',
  [ErrorCategory.UNRESOLVED_VALUE]:
    'إحدى القيم المُرسلة غير معروفة. يرجى التحقق من كل قيمة مقابل قائمة الاختيار الخاصة بها — ' +
    'اسم الخطاب ولغته يجب أن يكونا زوجًا صحيحًا، ورقم الهاتف وموقع التسليم يجب أن يكونا مسجَّلين مسبقًا.',
  [ErrorCategory.BUSINESS_RULE_ERROR]: 'تعذر إتمام العملية المطلوبة.',
  [ErrorCategory.DATABASE_ERROR]:
    'تعذر إتمام عملية قاعدة البيانات. يرجى التواصل مع الدعم الفني إذا استمرت المشكلة.',
  [ErrorCategory.EXTERNAL_SERVICE_ERROR]: 'الخدمة الخارجية غير متاحة حاليًا.',
  [ErrorCategory.TIMEOUT]: 'استغرق الطلب وقتًا طويلاً. يرجى المحاولة مرة أخرى.',
  [ErrorCategory.PAYLOAD_TOO_LARGE]:
    'حجم الطلب كبير جدًا. المرفقات تُرسل بترميز base64 مما يزيد حجمها بنحو الثلث — ' +
    'يرجى ضغط الملف وإعادة المحاولة.',
  [ErrorCategory.APPLICATION_ERROR]: 'حدث خطأ غير متوقع في التطبيق.',
  [ErrorCategory.UNKNOWN_ERROR]: 'حدث خطأ غير متوقع.',
  [ErrorCategory.SCHEMA_MISMATCH]: 'تم بنجاح.',
});

/** Default HTTP status per category (a concrete HttpException status wins over this). */
export const CATEGORY_STATUS: Readonly<Record<ErrorCategory, number>> = Object.freeze({
  [ErrorCategory.VALIDATION_ERROR]: 400,
  [ErrorCategory.AUTHENTICATION_ERROR]: 401,
  [ErrorCategory.AUTHORIZATION_ERROR]: 403,
  [ErrorCategory.NOT_FOUND]: 404,
  // 422: the request is well-formed but a value in it could not be resolved.
  [ErrorCategory.UNRESOLVED_VALUE]: 422,
  [ErrorCategory.BUSINESS_RULE_ERROR]: 409,
  [ErrorCategory.DATABASE_ERROR]: 500,
  [ErrorCategory.EXTERNAL_SERVICE_ERROR]: 503,
  [ErrorCategory.TIMEOUT]: 408,
  [ErrorCategory.PAYLOAD_TOO_LARGE]: 413,
  [ErrorCategory.APPLICATION_ERROR]: 500,
  [ErrorCategory.UNKNOWN_ERROR]: 500,
  // Not used for an error response — AllExceptionsFilter special-cases this
  // category and responds 200 (see the SchemaColumnNotFoundException branch).
  [ErrorCategory.SCHEMA_MISMATCH]: 200,
});

/**
 * Markers of technical/internal detail that must never reach a client: Oracle /
 * PL/SQL codes, SQL statements, schema object names, connection strings, file
 * paths and stack frames.
 *
 * SQL keywords are matched as STATEMENT SHAPES, not bare words: procs return
 * legitimate business prose like "Please select the correct Contractual Year"
 * or "does not fall between … to …", and matching `\bSELECT\b`/`\bFROM\b`
 * alone suppressed exactly the validation messages the client needs (op 10
 * answered the generic database-error text for a plain date-range rejection).
 */
const SENSITIVE_PATTERN =
  /(ORA-\d{3,5}|PLS-\d{3,5}|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b|\bUPDATE\s+[A-Za-z0-9_$#."]+\s+SET\b|\bBEGIN\b[\s\S]{0,500}?\bEND\s*;|XXHMC_[A-Z0-9_.]+|connectString|:\d+\/[A-Za-z0-9_]+|[A-Za-z]:\\|\/(?:home|Users|var|opt|app)\/|node_modules|\.(?:ts|js):\d+|\n\s*at\s)/i;

/**
 * A leaked query, recognised by its SQL-cased form only: `select`/`from` are
 * ordinary English words ("select a date from the calendar"), so lowercase
 * prose must not trip the filter while an uppercase `SELECT … FROM` still does.
 */
const SQL_QUERY_PATTERN = /\bSELECT\b[\s\S]{0,500}?\bFROM\b/;

/** True when `text` contains internal detail that must not be exposed to clients. */
export function looksSensitive(text?: string | null): boolean {
  return !!text && (SENSITIVE_PATTERN.test(text) || SQL_QUERY_PATTERN.test(text));
}

/**
 * The human text of a `RAISE_APPLICATION_ERROR` (ORA-20xxx) message — the DB
 * team authors these as user-facing validation text, so it is returned to the
 * client when it carries no technical detail of its own. Strips the ORA-20xxx
 * prefix and everything from the first follow-up ORA/PLS frame (ORA-06512 "at
 * line …" etc.). Undefined when nothing safe remains.
 */
export function extractBusinessRaiseText(message?: string | null): string | undefined {
  if (!message) return undefined;
  const match = /ORA-20\d{3}:\s*([\s\S]*?)(?=\s*(?:ORA|PLS)-\d{3,5}|$)/.exec(message);
  const text = match?.[1]?.trim();
  return text && !looksSensitive(text) ? text : undefined;
}
