import { HttpException, HttpStatus } from '@nestjs/common';
import { OracleQueryError, OracleUnavailableException } from '../database/oracle.error';
import { MssqlQueryError, MssqlUnavailableException } from '../database/mssql.error';
import { SchemaColumnNotFoundException } from '../database/schema-column-not-found.error';
import { ORA_NO_DATA_FOUND } from '@shared/constants/error-codes';
import {
  CATEGORY_MESSAGE,
  CATEGORY_STATUS,
  ErrorCategory,
  extractBusinessRaiseText,
} from './error-category';

/** Result of classifying any thrown value into a safe, client-facing shape. */
export interface ClassifiedError {
  category: ErrorCategory;
  httpStatus: number;
  /** Safe message (already stripped of technical detail). */
  message: string;
  /** Field-level detail for validation failures only (describes client input). */
  errors?: Record<string, unknown>;
  /** True → a server fault (log with stack at error level); false → client fault (warn). */
  serverSide: boolean;
}

/**
 * body-parser / http-errors marks an over-limit body with `type`
 * 'entity.too.large' and status 413. Matched structurally (not by class) so it
 * holds whichever body-parser version Express pulls in.
 */
function isPayloadTooLarge(exception: unknown): boolean {
  const err = exception as { type?: unknown; status?: unknown; statusCode?: unknown };
  return (
    err?.type === 'entity.too.large' || err?.status === 413 || err?.statusCode === 413
  );
}

function of(category: ErrorCategory, overrides: Partial<ClassifiedError> = {}): ClassifiedError {
  const httpStatus = overrides.httpStatus ?? CATEGORY_STATUS[category];
  return {
    category,
    httpStatus,
    message: overrides.message ?? CATEGORY_MESSAGE[category],
    errors: overrides.errors,
    serverSide: overrides.serverSide ?? httpStatus >= 500,
  };
}

/**
 * Map any thrown value to a category + safe message + HTTP status. The mapping
 * is by TYPE (and, for Oracle, by ORA code), so services/controllers can throw
 * ordinary exceptions and never need to sanitize messages themselves.
 */
export function classifyException(exception: unknown): ClassifiedError {
  // Safety net: a resolvable Oracle schema mismatch should never have escaped
  // uncaught this far (readByResolvedKey is meant to catch it locally and
  // degrade gracefully) — but if some future call site forgets to, still
  // honor "never hard-fail for a missing optional column": AllExceptionsFilter
  // special-cases this category to respond 200 instead of an error status.
  if (exception instanceof SchemaColumnNotFoundException) {
    return of(ErrorCategory.SCHEMA_MISMATCH, { httpStatus: 200, serverSide: false });
  }
  // The Oracle pool being unavailable is a database problem, not a call to a
  // genuinely external service (Cerner, LDAP) — check before the generic
  // ServiceUnavailableException → EXTERNAL_SERVICE_ERROR mapping below.
  if (exception instanceof OracleUnavailableException) {
    return of(ErrorCategory.DATABASE_ERROR, { httpStatus: exception.getStatus() });
  }
  if (exception instanceof OracleQueryError) return classifyOracle(exception);
  // Users DB (SQL Server) failures are database problems too — same treatment.
  if (exception instanceof MssqlUnavailableException) {
    return of(ErrorCategory.DATABASE_ERROR, { httpStatus: exception.getStatus() });
  }
  if (exception instanceof MssqlQueryError) return of(ErrorCategory.DATABASE_ERROR);
  if (exception instanceof HttpException) return classifyHttp(exception);
  // body-parser rejects an oversized body with an http-errors instance, which
  // is a plain Error (not an HttpException) — so it used to fall through to
  // APPLICATION_ERROR and answer 500 "Internal server error". That reads as a
  // server bug for what is really "your attachment is too big", and it is the
  // reason an oversized upload was so hard to diagnose. Answer 413 instead.
  if (isPayloadTooLarge(exception)) {
    return of(ErrorCategory.PAYLOAD_TOO_LARGE, { serverSide: false });
  }
  // A thrown Error that isn't an HttpException is an application bug.
  if (exception instanceof Error) return of(ErrorCategory.APPLICATION_ERROR);
  // Something non-Error was thrown (string, object, …).
  return of(ErrorCategory.UNKNOWN_ERROR);
}

/** Oracle/PL-SQL errors: map a few well-known codes, everything else is a generic DB error. */
function classifyOracle(ex: OracleQueryError): ClassifiedError {
  const code = ex.oraCode;
  // ORA-01403 only escapes from a SELECT INTO inside a procedure, i.e. one of
  // the values we submitted did not resolve — the endpoint and the record are
  // both fine. Answering 404 "The requested resource was not found" therefore
  // pointed at the wrong thing: op 17 rejected a bad letter/language pair, an
  // unknown delivery location and a mobile that is not the employee's ALL as
  // 404, with nothing to say which field was at fault. It is a rejected input,
  // so report it as one.
  if (code === ORA_NO_DATA_FOUND) return of(ErrorCategory.UNRESOLVED_VALUE);
  // A custom ORA-20xxx business raise carries user-facing validation text
  // authored in the procedure (RAISE_APPLICATION_ERROR) — surface it when it is
  // clean, mirroring toSubmitResult's handling of the same range in OUT params.
  if (code! >= 20000 && code! <= 20999) {
    return of(ErrorCategory.BUSINESS_RULE_ERROR, {
      message: extractBusinessRaiseText(ex.message),
    });
  }
  // unique/integrity constraint violations → business rule conflict
  if (code === 1 || code === 2290 || code === 2291 || code === 2292) {
    return of(ErrorCategory.BUSINESS_RULE_ERROR);
  }
  return of(ErrorCategory.DATABASE_ERROR);
}

/** Nest HttpExceptions: category is driven by the status code. */
function classifyHttp(ex: HttpException): ClassifiedError {
  const status = ex.getStatus();
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return of(ErrorCategory.VALIDATION_ERROR, {
        httpStatus: status,
        errors: extractValidationErrors(ex),
      });
    case HttpStatus.UNAUTHORIZED:
      return of(ErrorCategory.AUTHENTICATION_ERROR);
    case HttpStatus.FORBIDDEN:
      return of(ErrorCategory.AUTHORIZATION_ERROR);
    case HttpStatus.NOT_FOUND:
      return of(ErrorCategory.NOT_FOUND);
    case HttpStatus.REQUEST_TIMEOUT:
    case HttpStatus.GATEWAY_TIMEOUT:
      return of(ErrorCategory.TIMEOUT, { httpStatus: status });
    case HttpStatus.CONFLICT:
      return of(ErrorCategory.BUSINESS_RULE_ERROR);
    case HttpStatus.BAD_GATEWAY:
    case HttpStatus.SERVICE_UNAVAILABLE:
      return of(ErrorCategory.EXTERNAL_SERVICE_ERROR, { httpStatus: status });
    default:
      if (status >= 500) return of(ErrorCategory.APPLICATION_ERROR, { httpStatus: status });
      // Any other 4xx: a client-side rule violation, message kept generic.
      return of(ErrorCategory.BUSINESS_RULE_ERROR, { httpStatus: status });
  }
}

/**
 * Pull class-validator messages out of a BadRequestException into a safe
 * `errors` object. These describe the caller's OWN input, so they carry no
 * internal detail.
 */
function extractValidationErrors(ex: HttpException): Record<string, unknown> | undefined {
  const response = ex.getResponse();
  if (typeof response !== 'object' || response === null) return undefined;
  const raw = (response as { message?: string | string[] }).message;
  const details = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return details.length ? { details } : undefined;
}
