import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';
import { AppError, ErrorCode, internal, notFound, validationFailed } from '../core/errors';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { getContext } from '../core/context';

/** 404 for any route that no router claimed. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`Route ${req.method} ${req.path}`));
};

const normalize = (error: unknown): AppError => {
  if (error instanceof AppError) return error;

  if (error instanceof z.ZodError) {
    return validationFailed(
      error.issues.map((issue) => ({
        field: issue.path.map(String).join('.'),
        message: issue.message,
        code: issue.code,
      })),
    );
  }

  const candidate = error as { type?: string; status?: number; statusCode?: number; message?: string; code?: string };

  // body-parser failures arrive as plain errors with a `type`.
  if (candidate.type === 'entity.parse.failed') {
    return new AppError('Request body is not valid JSON', { status: 400, code: ErrorCode.BAD_REQUEST });
  }
  if (candidate.type === 'entity.too.large') {
    return new AppError('Request body is too large', { status: 413, code: ErrorCode.PAYLOAD_TOO_LARGE });
  }
  if (candidate.type === 'charset.unsupported' || candidate.type === 'encoding.unsupported') {
    return new AppError('Unsupported content encoding', { status: 415, code: ErrorCode.UNSUPPORTED_MEDIA_TYPE });
  }

  const status = candidate.status ?? candidate.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 600) {
    return new AppError(candidate.message ?? 'Request failed', {
      status,
      code: status < 500 ? ErrorCode.BAD_REQUEST : ErrorCode.INTERNAL,
      cause: error,
    });
  }

  return internal('An unexpected error occurred', { cause: error });
};

/**
 * The only place that turns an error into HTTP. Client-safe details are kept;
 * anything unexpected is logged in full and returned as an opaque 500 with the
 * request id, so support can correlate without leaking internals.
 */
export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const appError = normalize(error);
  const context = getContext();
  const requestId = context?.requestId ?? (res.getHeader('X-Request-Id') as string | undefined);

  const logPayload = {
    err: appError,
    cause: appError.cause,
    requestId,
    method: req.method,
    path: req.originalUrl,
    status: appError.status,
    code: appError.code,
    userId: req.auth?.userId ?? null,
    ip: context?.ip,
  };

  if (appError.status >= 500) logger.error(logPayload, appError.message);
  else if (appError.status === 429) logger.warn(logPayload, appError.message);
  else logger.debug(logPayload, appError.message);

  if (res.headersSent) return;

  if (appError.retryAfter) res.setHeader('Retry-After', String(appError.retryAfter));

  const exposeDetails = appError.expected || !env.isProduction;

  res.status(appError.status).json({
    success: false,
    error: {
      code: appError.code,
      message: exposeDetails ? appError.message : 'An unexpected error occurred',
      ...(appError.issues ? { issues: appError.issues } : {}),
      ...(exposeDetails && appError.details !== undefined ? { details: appError.details } : {}),
      ...(env.isProduction ? {} : { stack: appError.stack?.split('\n').slice(0, 6) }),
    },
    meta: { requestId, timestamp: new Date().toISOString() },
  });
};

/**
 * Last-resort handlers. An unhandled rejection leaves the process in an unknown
 * state, so log loudly and let the supervisor restart us cleanly.
 */
export function installProcessHandlers(shutdown: () => Promise<void>): void {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception, shutting down');
    void shutdown().finally(() => process.exit(1));
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      logger.info({ signal }, 'received shutdown signal');
      void shutdown().finally(() => process.exit(0));
    });
  }
}
