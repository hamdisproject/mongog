/**
 * Normalized application error model (plan §22).
 * Every error crossing a process boundary is serialized as AppError.
 */
import { redactForLog } from '../redaction/index.js';

export type ErrorCategory =
  | 'Authentication'
  | 'Authorization'
  | 'Dns'
  | 'Tls'
  | 'Network'
  | 'NetworkTimeout'
  | 'ServerSelection'
  | 'ReplicaSet'
  | 'InvalidConnectionString'
  | 'InvalidQuerySyntax'
  | 'JavaScriptRuntime'
  | 'MongoDBCommand'
  | 'DuplicateKey'
  | 'Validation'
  | 'ReadOnlyProtection'
  | 'Cancellation'
  | 'Serialization'
  | 'UtilityProcessCrash'
  | 'LocalPersistence'
  | 'SecureStorageFailure'
  | 'ModuleNotAllowed'
  | 'StaleDocument'
  | 'NotFound'
  | 'CursorNotFound'
  | 'Unknown';

export interface SourceRange {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

export interface AppError {
  category: ErrorCategory;
  message: string;
  /** Original error class name, e.g. "MongoServerError". */
  name?: string;
  code?: number;
  codeName?: string;
  labels?: string[];
  statementRange?: SourceRange;
  hint?: string;
  causeMessage?: string;
}

interface MongoLikeError {
  name?: string;
  message?: string;
  code?: number;
  codeName?: string;
  errorLabels?: string[];
  cause?: { message?: string; name?: string };
  stack?: string;
}

const hasLabel = (e: MongoLikeError, label: string): boolean =>
  Array.isArray(e.errorLabels) && e.errorLabels.includes(label);

/** Map any thrown value (driver error, JS error, string) to an AppError. */
export function classifyError(err: unknown, range?: SourceRange): AppError {
  if (isAppError(err)) {
    const withRange = range && !err.statementRange ? { ...err, statementRange: range } : err;
    return redactError(withRange);
  }

  const e = (err ?? {}) as MongoLikeError;
  const name = typeof e.name === 'string' ? e.name : 'Error';
  const rawMessage = typeof e.message === 'string' ? e.message : String(err);
  const message = redactText(rawMessage);
  const base: AppError = {
    category: 'Unknown',
    message,
    name,
    ...(typeof e.code === 'number' ? { code: e.code } : {}),
    ...(typeof e.codeName === 'string' ? { codeName: e.codeName } : {}),
    ...(Array.isArray(e.errorLabels) ? { labels: [...e.errorLabels] } : {}),
    ...(range ? { statementRange: range } : {}),
    ...(e.cause?.message ? { causeMessage: redactText(e.cause.message) } : {}),
  };

  if (name === 'AbortError' || name === 'MongoGCancelled') {
    return { ...base, category: 'Cancellation' };
  }
  if (name === 'ModuleNotAllowed') {
    return { ...base, category: 'ModuleNotAllowed' };
  }

  switch (name) {
    case 'MongoParseError':
      return { ...base, category: 'InvalidConnectionString' };
    case 'MongoServerSelectionError':
      return { ...base, category: 'ServerSelection', hint: serverSelectionHint(e) };
    case 'MongoNetworkTimeoutError':
      return { ...base, category: 'NetworkTimeout' };
    case 'MongoNetworkError': {
      if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(rawMessage)) return { ...base, category: 'Dns' };
      if (/TLS|SSL|certificate|CERT_/i.test(rawMessage)) return { ...base, category: 'Tls' };
      if (/timed? ?out/i.test(rawMessage)) return { ...base, category: 'NetworkTimeout' };
      return { ...base, category: 'Network' };
    }
    case 'MongoBulkWriteError':
    case 'MongoWriteConcernError':
    case 'MongoServerError':
      return { ...base, category: serverErrorCategory(e) };
    case 'MongoExpiredSessionError':
    case 'MongoTransactionError':
      return { ...base, category: 'MongoDBCommand' };
    case 'MongoRuntimeError':
    case 'MongoAPIError':
      return { ...base, category: 'MongoDBCommand' };
    case 'MongoCursorExhaustedError':
    case 'MongoCursorInUseError':
      return { ...base, category: 'CursorNotFound' };
    default:
      break;
  }

  if (hasLabel(e, 'TransientTransactionError') || hasLabel(e, 'UnknownTransactionCommitResult')) {
    return { ...base, category: 'MongoDBCommand' };
  }
  // Anything that is not a driver error is a user-script (JavaScript) error.
  if (!name.startsWith('Mongo')) {
    return { ...base, category: 'JavaScriptRuntime' };
  }
  return { ...base, category: 'MongoDBCommand' };
}

function serverErrorCategory(e: MongoLikeError): ErrorCategory {
  switch (e.code) {
    case 18:
    case 8000:
      return 'Authentication';
    case 13:
    case 31:
      return 'Authorization';
    case 11000:
    case 11001:
    case 12582:
      return 'DuplicateKey';
    case 121:
      return 'Validation';
    case 50:
      return 'NetworkTimeout'; // ExceededTimeLimit (maxTimeMS)
    case 26:
    case 48:
      return 'NotFound'; // NamespaceNotFound / NamespaceExists-adjacent
    default:
      return 'MongoDBCommand';
  }
}

function serverSelectionHint(e: MongoLikeError): string | undefined {
  const msg = `${e.message ?? ''} ${e.cause?.message ?? ''}`;
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'DNS resolution failed; check hostnames / SRV record.';
  if (/ECONNREFUSED/i.test(msg)) return 'Connection refused; is mongod running and reachable?';
  if (/certificate|TLS|SSL/i.test(msg)) return 'TLS handshake failed; check CA/cert options.';
  if (/Authentication/i.test(msg)) return 'Authentication failed during server selection.';
  return undefined;
}

export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'category' in value &&
    'message' in value &&
    typeof (value as AppError).message === 'string'
  );
}

/** Structured-clone-safe serializer for transport across IPC/processes. */
export function serializeError(err: unknown, range?: SourceRange): AppError {
  return classifyError(err, range);
}

function redactText(value: string): string {
  const redacted = redactForLog(value);
  return typeof redacted === 'string' ? redacted : String(redacted);
}

function redactError(error: AppError): AppError {
  const message = redactText(error.message);
  const causeMessage = error.causeMessage === undefined
    ? undefined
    : redactText(error.causeMessage);
  const hint = error.hint === undefined ? undefined : redactText(error.hint);

  if (message === error.message && causeMessage === error.causeMessage && hint === error.hint) {
    return error;
  }

  return {
    ...error,
    message,
    ...(causeMessage === undefined ? {} : { causeMessage }),
    ...(hint === undefined ? {} : { hint }),
  };
}

export function appError(
  category: ErrorCategory,
  message: string,
  extra?: Partial<AppError>,
): AppError {
  return { category, message, ...extra };
}

/** Thrown inside the engine when the user cancels; mapped to Cancellation. */
export class MongoGCancellationError extends Error {
  override readonly name = 'MongoGCancelled';
  constructor(message = 'Execution cancelled') {
    super(message);
  }
}
