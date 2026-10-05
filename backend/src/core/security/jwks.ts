import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError, ErrorCode } from '../errors';
import { loggerFor } from '../../config/logger';

const log = loggerFor('jwks');

interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

interface Jwks {
  keys: Jwk[];
}

export interface VerifiedOidcToken {
  sub: string;
  iss: string;
  aud: string | string[];
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  nonce?: string;
  exp?: number;
}

const cache = new Map<string, { fetchedAt: number; keys: Jwk[] }>();
const TTL_MS = 60 * 60_000;

async function loadJwks(jwksUrl: string): Promise<Jwk[]> {
  const cached = cache.get(jwksUrl);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.keys;

  const response = await fetch(jwksUrl, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new AppError('Could not verify the identity provider', {
      status: 401,
      code: ErrorCode.OAUTH_INVALID,
      details: { status: response.status },
    });
  }
  const body = (await response.json()) as Jwks;
  const keys = Array.isArray(body.keys) ? body.keys : [];
  cache.set(jwksUrl, { fetchedAt: Date.now(), keys });
  return keys;
}

function publicKeyFromJwk(jwk: Jwk): crypto.KeyObject {
  return crypto.createPublicKey({ key: jwk as never, format: 'jwk' });
}

function asJwtList(value: string | string[]): string | [string, ...string[]] {
  if (typeof value === 'string') return value;
  if (value.length === 0) return '';
  return [value[0]!, ...value.slice(1)];
}

/**
 * Verifies an OIDC ID token against the provider JWKS.
 * Audience and issuer are checked here so Flutter-supplied tokens cannot be swapped.
 */
export async function verifyOidcIdToken(params: {
  token: string;
  jwksUrl: string;
  issuer: string | string[];
  audience: string | string[];
  nonce?: string;
}): Promise<VerifiedOidcToken> {
  const decoded = jwt.decode(params.token, { complete: true });
  if (!decoded || typeof decoded === 'string' || !decoded.header) {
    throw new AppError('Invalid identity token', { status: 401, code: ErrorCode.OAUTH_INVALID });
  }

  const keys = await loadJwks(params.jwksUrl);
  const kid = decoded.header.kid;
  const jwk = (kid ? keys.find((key) => key.kid === kid) : keys[0]) ?? keys[0];
  if (!jwk) {
    throw new AppError('Identity provider key not found', { status: 401, code: ErrorCode.OAUTH_INVALID });
  }

  let payload: VerifiedOidcToken;
  try {
    payload = jwt.verify(params.token, publicKeyFromJwk(jwk), {
      algorithms: ['RS256', 'ES256'],
      issuer: asJwtList(params.issuer),
      audience: asJwtList(params.audience),
    }) as VerifiedOidcToken;
  } catch (error) {
    log.warn({ err: error }, 'oidc token verification failed');
    throw new AppError('Identity token could not be verified', { status: 401, code: ErrorCode.OAUTH_INVALID });
  }

  if (!payload.sub) {
    throw new AppError('Identity token is missing a subject', { status: 401, code: ErrorCode.OAUTH_INVALID });
  }
  if (params.nonce && payload.nonce && payload.nonce !== params.nonce) {
    throw new AppError('Identity token nonce mismatch', { status: 401, code: ErrorCode.OAUTH_INVALID });
  }
  return payload;
}

export function clearJwksCache(): void {
  cache.clear();
}
