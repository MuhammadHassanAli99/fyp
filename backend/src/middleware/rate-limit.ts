import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError, ErrorCode } from '../core/errors';
import { RedisRateLimitStore } from './rate-limit-redis';

/**
 * Layered rate limiting.
 *
 * Dimensions are evaluated independently (AND): a shared NAT IP does not lock
 * every colleague out once a user is authenticated, and an authenticated
 * attacker cannot multiply budget by rotating IPs.
 */
type Dimension = 'ip' | 'user' | 'session' | 'device' | 'endpoint';

const keyFor = (req: Request, dimension: Dimension, endpoint?: string): string => {
  if (dimension === 'user' && req.auth) return `u:${req.auth.userId}`;
  if (dimension === 'session' && req.auth) return `s:${req.auth.sessionId}`;
  if (dimension === 'device' && (req.device?.uuid || req.device?.fingerprintHash)) {
    return `d:${req.device.uuid ?? req.device.fingerprintHash}`;
  }
  if (dimension === 'endpoint') return `e:${endpoint ?? req.route?.path ?? req.path}`;
  if (req.guestUuid && dimension === 'ip') return `g:${req.guestUuid}`;
  const ip = req.context?.ip ?? req.ip ?? 'unknown';
  return `ip:${ipKeyGenerator(ip)}`;
};

const tooMany: Options['handler'] = (_req, _res, next, opts) => {
  next(
    new AppError('Too many requests, please slow down', {
      status: 429,
      code: ErrorCode.RATE_LIMITED,
      retryAfter: Math.ceil(opts.windowMs / 1000),
    }),
  );
};

const make = (options: {
  windowMs: number;
  limit: number;
  dimension: Dimension;
  endpoint?: string;
  skipStaff?: boolean;
  skipSuccessfulRequests?: boolean;
}): RequestHandler => {
  const store = env.REDIS_URL ? new RedisRateLimitStore() : undefined;
  store?.setPrefix(`rl:${options.dimension}:${options.endpoint ?? 'all'}:${options.limit}`);
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store,
    keyGenerator: (req) => keyFor(req, options.dimension, options.endpoint),
    skip: (req) => Boolean(options.skipStaff && req.auth?.isStaff),
    skipSuccessfulRequests: options.skipSuccessfulRequests ?? false,
    handler: tooMany,
  });
};

const stack = (...handlers: RequestHandler[]): RequestHandler => (req, res, next) => {
  let i = 0;
  const run = (error?: unknown) => {
    if (error) return next(error);
    const handler = handlers[i];
    i += 1;
    if (!handler) return next();
    handler(req, res, run);
  };
  run();
};

const windowMs = env.RATE_LIMIT_WINDOW_MS;

/** Broad ceiling. Staff skip this so incident response is not throttled. */
export const globalRateLimit = stack(
  make({ windowMs, limit: env.RATE_LIMIT_MAX, dimension: 'ip', skipStaff: true }),
  make({ windowMs, limit: env.RATE_LIMIT_MAX, dimension: 'user', skipStaff: true }),
);

/** Login / register — IP and user (or guest) independently. Staff are NOT skipped. */
export const authRateLimit = stack(
  make({ windowMs, limit: env.RATE_LIMIT_AUTH_MAX, dimension: 'ip' }),
  make({ windowMs, limit: env.RATE_LIMIT_AUTH_MAX, dimension: 'user' }),
  make({ windowMs, limit: env.RATE_LIMIT_AUTH_MAX, dimension: 'device' }),
);

export const otpRateLimit = stack(
  make({ windowMs: 5 * 60_000, limit: 5, dimension: 'ip' }),
  make({ windowMs: 5 * 60_000, limit: 5, dimension: 'user' }),
);

export const passwordResetRateLimit = stack(
  make({ windowMs: 15 * 60_000, limit: env.RATE_LIMIT_PASSWORD_MAX, dimension: 'ip' }),
  make({ windowMs: 15 * 60_000, limit: env.RATE_LIMIT_PASSWORD_MAX, dimension: 'user' }),
);

export const oauthRateLimit = stack(
  make({ windowMs, limit: env.RATE_LIMIT_OAUTH_MAX, dimension: 'ip' }),
  make({ windowMs, limit: env.RATE_LIMIT_OAUTH_MAX, dimension: 'user' }),
);

export const writeRateLimit = stack(
  make({ windowMs, limit: env.RATE_LIMIT_WRITE_MAX, dimension: 'ip', skipStaff: true }),
  make({ windowMs, limit: env.RATE_LIMIT_WRITE_MAX, dimension: 'user', skipStaff: true }),
);

export const aiRateLimit = stack(
  make({ windowMs: 60_000, limit: 15, dimension: 'ip', skipStaff: true }),
  make({ windowMs: 60_000, limit: 15, dimension: 'user', skipStaff: true }),
);

export const searchRateLimit = stack(
  make({ windowMs: 60_000, limit: 120, dimension: 'ip', skipStaff: true }),
  make({ windowMs: 60_000, limit: 120, dimension: 'user', skipStaff: true }),
);

export const uploadRateLimit = stack(
  make({ windowMs: 60_000, limit: 30, dimension: 'ip' }),
  make({ windowMs: 60_000, limit: 30, dimension: 'user' }),
);

export const messagingRateLimit = stack(
  make({ windowMs: 60_000, limit: 60, dimension: 'ip', skipStaff: true }),
  make({ windowMs: 60_000, limit: 60, dimension: 'user', skipStaff: true }),
);

export const paymentRateLimit = stack(
  make({ windowMs, limit: env.RATE_LIMIT_PAYMENT_MAX, dimension: 'ip' }),
  make({ windowMs, limit: env.RATE_LIMIT_PAYMENT_MAX, dimension: 'user' }),
  make({ windowMs, limit: env.RATE_LIMIT_PAYMENT_MAX, dimension: 'session' }),
);

export const privacyRateLimit = stack(
  make({ windowMs: 60 * 60_000, limit: env.RATE_LIMIT_PRIVACY_MAX, dimension: 'ip' }),
  make({ windowMs: 60 * 60_000, limit: env.RATE_LIMIT_PRIVACY_MAX, dimension: 'user' }),
);

export const customRateLimit = (customWindowMs: number, limit: number): RequestHandler =>
  stack(
    make({ windowMs: customWindowMs, limit, dimension: 'ip' }),
    make({ windowMs: customWindowMs, limit, dimension: 'user' }),
  );
