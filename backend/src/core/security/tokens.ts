import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import { AppError, ErrorCode } from '../errors';
import { randomToken, sha256 } from './crypto';

/**
 * Short-lived access token, long-lived rotating refresh token.
 *
 * The refresh token is opaque (never a JWT) and only its SHA-256 lives in the
 * database, so a database leak cannot be replayed as a session. Rotation is
 * tracked by `familyId`: presenting an already-rotated token means the token was
 * stolen, and the whole family is revoked.
 */
/**
 * Minimal access-token claims. Authorization is always re-checked server-side
 * from the session + grants tables — never from these fields alone.
 *
 * Legacy tokens may still carry `roles`/`perms`; they are ignored.
 */
export interface AccessTokenClaims {
  sub: string;
  sid: string;
  typ: 'access';
  /** Access-token scheme version (not a user profile). */
  tv?: number;
  mfa?: boolean;
  roles?: string[];
  perms?: string[];
}

export interface IssuedAccessToken {
  token: string;
  expiresIn: number;
  expiresAt: Date;
}

export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
  familyId: string;
}

export function signAccessToken(claims: Omit<AccessTokenClaims, 'typ'>): IssuedAccessToken {
  const expiresIn = env.ACCESS_TOKEN_TTL_MINUTES * 60;
  const payload: AccessTokenClaims = {
    sub: claims.sub,
    sid: claims.sid,
    typ: 'access',
    tv: claims.tv ?? 1,
    mfa: Boolean(claims.mfa),
  };
  const token = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
  return { token, expiresIn, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as AccessTokenClaims;
    if (payload.typ !== 'access') {
      throw new AppError('Wrong token type', { status: 401, code: ErrorCode.TOKEN_INVALID });
    }
    return payload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError('Access token expired', { status: 401, code: ErrorCode.TOKEN_EXPIRED });
    }
    if (error instanceof AppError) throw error;
    throw new AppError('Invalid access token', { status: 401, code: ErrorCode.TOKEN_INVALID, cause: error });
  }
}

export function issueRefreshToken(familyId: string): IssuedRefreshToken {
  const token = randomToken(48);
  return {
    token,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    familyId,
  };
}

export const hashRefreshToken = (token: string): string => sha256(token);

/** Bearer scheme only — cookies are reserved for the web client's CSRF-protected flow. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || !value) return null;
  return scheme.toLowerCase() === 'bearer' ? value.trim() : null;
}

/**
 * Signed, single-purpose tokens for links in email/SMS (verify email, unsubscribe,
 * shared collection). Short TTL, purpose-bound so one cannot be replayed as another.
 */
export function signPurposeToken(purpose: string, subject: string, ttlSeconds: number, extra: Record<string, unknown> = {}): string {
  return jwt.sign({ ...extra, typ: 'purpose', pur: purpose }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject,
    expiresIn: ttlSeconds,
    issuer: env.JWT_ISSUER,
  });
}

export function verifyPurposeToken(token: string, purpose: string): { subject: string; payload: Record<string, unknown> } {
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
    }) as jwt.JwtPayload & { pur?: string; typ?: string };
    if (payload.typ !== 'purpose' || payload.pur !== purpose) {
      throw new AppError('Token is not valid for this action', { status: 400, code: ErrorCode.TOKEN_INVALID });
    }
    return { subject: String(payload.sub ?? ''), payload: payload as Record<string, unknown> };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof jwt.TokenExpiredError) {
      throw new AppError('This link has expired', { status: 400, code: ErrorCode.TOKEN_EXPIRED });
    }
    throw new AppError('This link is invalid', { status: 400, code: ErrorCode.TOKEN_INVALID, cause: error });
  }
}
