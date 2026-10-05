/**
 * A single error type crosses every layer. Services throw `AppError`;
 * the error middleware is the only place that knows about HTTP.
 *
 * `code` is a stable machine-readable string — the Flutter client maps it to a
 * localized message, so changing `message` never breaks a client.
 */
export const ErrorCode = {
  // 400
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  UNSUPPORTED_MARKETPLACE: 'UNSUPPORTED_MARKETPLACE',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  INVALID_CURRENCY: 'INVALID_CURRENCY',

  // 401
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  SESSION_REVOKED: 'SESSION_REVOKED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  MFA_INVALID: 'MFA_INVALID',
  OTP_REQUIRED: 'OTP_REQUIRED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  PASSKEY_INVALID: 'PASSKEY_INVALID',
  OAUTH_INVALID: 'OAUTH_INVALID',
  LINKING_REQUIRED: 'LINKING_REQUIRED',

  // 403
  FORBIDDEN: 'FORBIDDEN',
  WAF_BLOCKED: 'WAF_BLOCKED',
  SSRF_BLOCKED: 'SSRF_BLOCKED',
  GUEST_NOT_ALLOWED: 'GUEST_NOT_ALLOWED',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  PHONE_NOT_VERIFIED: 'PHONE_NOT_VERIFIED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  ACCOUNT_BANNED: 'ACCOUNT_BANNED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  KYC_REQUIRED: 'KYC_REQUIRED',
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  RISK_BLOCKED: 'RISK_BLOCKED',
  DEVICE_NOT_TRUSTED: 'DEVICE_NOT_TRUSTED',
  APP_VERSION_UNSUPPORTED: 'APP_VERSION_UNSUPPORTED',
  SCHEMA_INCOMPATIBLE: 'SCHEMA_INCOMPATIBLE',
  IDENTITY_IN_USE: 'IDENTITY_IN_USE',
  FEATURE_NOT_IN_PLAN: 'FEATURE_NOT_IN_PLAN',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',

  // 404
  NOT_FOUND: 'NOT_FOUND',

  // 409
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  PHONE_TAKEN: 'PHONE_TAKEN',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  DUPLICATE_LISTING: 'DUPLICATE_LISTING',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',

  // 413 / 415
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',

  // 422
  UNPROCESSABLE: 'UNPROCESSABLE',
  PAYMENT_FAILED: 'PAYMENT_FAILED',

  // 429
  RATE_LIMITED: 'RATE_LIMITED',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',

  // 5xx
  INTERNAL: 'INTERNAL',
  DATABASE_ERROR: 'DATABASE_ERROR',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface FieldIssue {
  field: string;
  message: string;
  code?: string;
}

export interface AppErrorOptions {
  status?: number;
  code?: ErrorCodeValue;
  details?: unknown;
  issues?: FieldIssue[];
  cause?: unknown;
  /** Seconds until the client may retry — surfaced as Retry-After. */
  retryAfter?: number;
  /** false ⇒ log at error level and hide details from the response. */
  expected?: boolean;
}

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue;
  readonly details?: unknown;
  readonly issues?: FieldIssue[];
  readonly retryAfter?: number;
  readonly expected: boolean;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.status = options.status ?? 500;
    this.code = options.code ?? ErrorCode.INTERNAL;
    this.details = options.details;
    this.issues = options.issues;
    this.retryAfter = options.retryAfter;
    this.expected = options.expected ?? this.status < 500;
    Error.captureStackTrace?.(this, AppError);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.issues ? { issues: this.issues } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Factories — keep call sites short and status codes consistent.             */
/* -------------------------------------------------------------------------- */

export const badRequest = (message = 'Bad request', options: AppErrorOptions = {}) =>
  new AppError(message, { status: 400, code: ErrorCode.BAD_REQUEST, ...options });

export const validationFailed = (issues: FieldIssue[], message = 'Validation failed') =>
  new AppError(message, { status: 400, code: ErrorCode.VALIDATION_FAILED, issues });

export const unauthenticated = (message = 'Authentication required', options: AppErrorOptions = {}) =>
  new AppError(message, { status: 401, code: ErrorCode.UNAUTHENTICATED, ...options });

export const forbidden = (message = 'You do not have access to this resource', options: AppErrorOptions = {}) =>
  new AppError(message, { status: 403, code: ErrorCode.FORBIDDEN, ...options });

export const notFound = (resource = 'Resource', options: AppErrorOptions = {}) =>
  new AppError(`${resource} not found`, { status: 404, code: ErrorCode.NOT_FOUND, ...options });

export const conflict = (message = 'Conflict', options: AppErrorOptions = {}) =>
  new AppError(message, { status: 409, code: ErrorCode.CONFLICT, ...options });

export const unprocessable = (message = 'Request could not be processed', options: AppErrorOptions = {}) =>
  new AppError(message, { status: 422, code: ErrorCode.UNPROCESSABLE, ...options });

export const rateLimited = (message = 'Too many requests', retryAfter = 60) =>
  new AppError(message, { status: 429, code: ErrorCode.RATE_LIMITED, retryAfter });

export const internal = (message = 'Something went wrong', options: AppErrorOptions = {}) =>
  new AppError(message, { status: 500, code: ErrorCode.INTERNAL, expected: false, ...options });

export const notImplemented = (message = 'Not implemented') =>
  new AppError(message, { status: 501, code: ErrorCode.NOT_IMPLEMENTED });

export const serviceUnavailable = (message = 'Service temporarily unavailable', retryAfter = 30) =>
  new AppError(message, { status: 503, code: ErrorCode.SERVICE_UNAVAILABLE, retryAfter, expected: false });

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;

/**
 * Translate MySQL driver errors into domain errors so callers never leak SQL.
 */
export function fromDatabaseError(error: unknown): AppError {
  const err = error as { code?: string; errno?: number; sqlMessage?: string; message?: string };
  switch (err.code) {
    case 'ER_DUP_ENTRY':
      return new AppError('A record with these details already exists', {
        status: 409,
        code: ErrorCode.ALREADY_EXISTS,
        cause: error,
      });
    case 'ER_NO_REFERENCED_ROW':
    case 'ER_NO_REFERENCED_ROW_2':
      return new AppError('A referenced record does not exist', {
        status: 400,
        code: ErrorCode.BAD_REQUEST,
        cause: error,
      });
    case 'ER_ROW_IS_REFERENCED':
    case 'ER_ROW_IS_REFERENCED_2':
      return new AppError('This record is still referenced by other data', {
        status: 409,
        code: ErrorCode.CONFLICT,
        cause: error,
      });
    case 'ER_DATA_TOO_LONG':
      return new AppError('A submitted value is too long', {
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        cause: error,
      });
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return new AppError('A submitted value is out of range', {
        status: 400,
        code: ErrorCode.VALIDATION_FAILED,
        cause: error,
      });
    case 'ER_LOCK_DEADLOCK':
      return new AppError('The request conflicted with another operation, please retry', {
        status: 409,
        code: ErrorCode.CONCURRENT_MODIFICATION,
        retryAfter: 1,
        cause: error,
      });
    case 'ECONNREFUSED':
    case 'PROTOCOL_CONNECTION_LOST':
    case 'ER_CON_COUNT_ERROR':
      return new AppError('Database is unavailable', {
        status: 503,
        code: ErrorCode.DATABASE_ERROR,
        expected: false,
        retryAfter: 5,
        cause: error,
      });
    default:
      return new AppError('Database error', {
        status: 500,
        code: ErrorCode.DATABASE_ERROR,
        expected: false,
        cause: error,
      });
  }
}
