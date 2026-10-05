import type { RequestHandler } from 'express';
import { AppError, ErrorCode, unauthenticated } from '../core/errors';
import { extractBearerToken, verifyAccessToken } from '../core/security/tokens';
import { queryOne, execute, type Row } from '../db/query';
import { env } from '../config/env';
import { loadPrincipalGrants } from './grants';

interface PrincipalRow extends Row {
  user_id: number;
  session_id: number;
  status: string;
  locked_until: Date | null;
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  mfa_satisfied: number;
  session_revoked_at: Date | null;
  session_expires_at: Date;
  idle_expires_at: Date | null;
  country_id: number | null;
  language: string | null;
  currency: string | null;
  timezone: string | null;
  measurement_system: 'metric' | 'imperial' | null;
  last_marketplace_id: number | null;
}

/**
 * The claims are trusted for identity, but the *session* is verified against the
 * database on every request. A revoked session, a suspended account or a fresh
 * ban must take effect immediately — not in up to 15 minutes when the access
 * token happens to expire.
 */
const loadPrincipal = (userId: number, sessionId: number) =>
  queryOne<PrincipalRow>(
    `SELECT u.id            AS user_id,
            s.id            AS session_id,
            u.status,
            u.locked_until,
            u.email_verified_at,
            u.phone_verified_at,
            s.mfa_satisfied,
            s.revoked_at    AS session_revoked_at,
            s.expires_at    AS session_expires_at,
            s.idle_expires_at AS idle_expires_at,
            u.country_id, u.language, u.currency, u.timezone, u.measurement_system, u.last_marketplace_id
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ? AND u.deleted_at IS NULL`,
    [sessionId, userId],
  );

const loadGrants = (userId: number) => loadPrincipalGrants(userId);

/**
 * Populates `req.auth` when a valid token is present and never throws for a
 * missing one — guests are a first-class case (§1 Guest Mode). Routes that
 * require a user compose `requireAuth` on top.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  void (async () => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) return next();

    let claims;
    try {
      claims = verifyAccessToken(token);
    } catch (error) {
      // A stale bearer token must not break guest browsing (§1 Guest Mode).
      if (
        error instanceof AppError &&
        (error.code === ErrorCode.TOKEN_INVALID || error.code === ErrorCode.TOKEN_EXPIRED)
      ) {
        return next();
      }
      throw error;
    }

    const userId = Number(claims.sub);
    const sessionId = Number(claims.sid);
    if (!Number.isFinite(userId) || !Number.isFinite(sessionId)) {
      return next();
    }

    const principal = await loadPrincipal(userId, sessionId);
    if (!principal || principal.session_revoked_at || principal.session_expires_at.getTime() < Date.now()) {
      return next();
    }
    const idleExpires = principal.idle_expires_at;
    if (idleExpires && idleExpires.getTime() < Date.now()) {
      return next();
    }
    if (principal.status === 'banned') {
      throw new AppError('This account has been banned', { status: 403, code: ErrorCode.ACCOUNT_BANNED });
    }
    if (principal.status === 'suspended') {
      throw new AppError('This account is suspended', { status: 403, code: ErrorCode.ACCOUNT_SUSPENDED });
    }
    if (principal.locked_until && principal.locked_until.getTime() > Date.now()) {
      throw new AppError('This account is temporarily locked', {
        status: 403,
        code: ErrorCode.ACCOUNT_LOCKED,
        details: { until: principal.locked_until.toISOString() },
      });
    }

    const grants = await loadGrants(userId);

    req.auth = {
      userId,
      sessionId,
      roles: grants.roles,
      permissions: grants.permissions,
      grants: grants.grants,
      scopes: grants.scopes,
      mfaSatisfied: principal.mfa_satisfied === 1,
      isStaff: grants.isStaff,
      status: principal.status,
      emailVerified: principal.email_verified_at !== null,
      phoneVerified: principal.phone_verified_at !== null,
    };

    void execute(
      `UPDATE user_sessions
          SET last_used_at = CURRENT_TIMESTAMP,
              idle_expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? HOUR)
        WHERE id = ?`,
      [env.SESSION_IDLE_HOURS, sessionId],
    ).catch(() => undefined);

    // The user's stored preferences win over header-derived guesses.
    const context = req.context;
    context.userId = userId;
    context.sessionId = sessionId;
    context.roles = grants.roles;
    context.permissions = grants.permissions;
    context.isStaff = grants.isStaff;
    if (principal.country_id) context.countryId = principal.country_id;
    if (principal.language) context.language = principal.language;
    if (principal.currency) context.currency = principal.currency;
    if (principal.timezone) context.timezone = principal.timezone;
    if (principal.measurement_system) context.measurementSystem = principal.measurement_system;
    if (context.marketplaceId === null && principal.last_marketplace_id) {
      context.marketplaceId = principal.last_marketplace_id;
    }

    next();
  })().catch(next);
};

/** Rejects guests. The most common guard in the API. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  next();
};

/** For actions that must not be performed by an unverified contact (§2). */
export const requireVerifiedEmail: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  if (!req.auth.emailVerified) {
    return next(new AppError('Verify your email address to continue', { status: 403, code: ErrorCode.EMAIL_NOT_VERIFIED }));
  }
  next();
};

export const requireVerifiedPhone: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  if (!req.auth.phoneVerified) {
    return next(new AppError('Verify your phone number to continue', { status: 403, code: ErrorCode.PHONE_NOT_VERIFIED }));
  }
  next();
};

/** Step-up authentication for sensitive operations (payouts, account deletion). */
export const requireMfa: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  if (!req.auth.mfaSatisfied) {
    return next(new AppError('Additional verification required', { status: 401, code: ErrorCode.MFA_REQUIRED }));
  }
  next();
};
