import crypto from 'node:crypto';
import { env } from '../../config/env';
import { AppError, ErrorCode } from '../errors';
import { randomToken, sha256, uuid } from './crypto';

export interface WebAuthnChallenge {
  challenge: string;
  challengeId: string;
  rpId: string;
  rpName: string;
  timeoutMs: number;
}

export function createWebAuthnChallenge(): { raw: Buffer; encoded: string } {
  const raw = crypto.randomBytes(32);
  return { raw, encoded: raw.toString('base64url') };
}

export function webAuthnOptions(): Pick<WebAuthnChallenge, 'rpId' | 'rpName' | 'timeoutMs'> {
  return {
    rpId: env.WEBAUTHN_RP_ID,
    rpName: env.WEBAUTHN_RP_NAME,
    timeoutMs: 60_000,
  };
}

interface ClientData {
  type: string;
  challenge: string;
  origin: string;
  crossOrigin?: boolean;
}

function parseClientData(clientDataJSON: string): ClientData {
  const json = Buffer.from(clientDataJSON, 'base64url').toString('utf8');
  const parsed = JSON.parse(json) as ClientData;
  if (!parsed.type || !parsed.challenge || !parsed.origin) {
    throw new AppError('Invalid authenticator client data', { status: 400, code: ErrorCode.PASSKEY_INVALID });
  }
  return parsed;
}

function assertOrigin(origin: string): void {
  const allowed = new Set(
    [env.WEBAUTHN_ORIGIN, env.WEB_URL, env.APP_URL].map((value) => value.replace(/\/$/, '')),
  );
  if (!allowed.has(origin.replace(/\/$/, ''))) {
    throw new AppError('Passkey origin is not allowed', { status: 400, code: ErrorCode.PASSKEY_INVALID });
  }
}

/**
 * Verifies WebAuthn clientData against the issued challenge.
 * Signature verification of the assertion is handled separately when a public key is present.
 */
export function verifyClientData(params: {
  clientDataJSON: string;
  expectedChallenge: string;
  expectedType: 'webauthn.create' | 'webauthn.get';
}): ClientData {
  const data = parseClientData(params.clientDataJSON);
  if (data.type !== params.expectedType) {
    throw new AppError('Unexpected passkey ceremony type', { status: 400, code: ErrorCode.PASSKEY_INVALID });
  }
  if (data.challenge !== params.expectedChallenge) {
    throw new AppError('Passkey challenge mismatch', { status: 400, code: ErrorCode.PASSKEY_INVALID });
  }
  assertOrigin(data.origin);
  return data;
}

/**
 * Verifies an ES256 (P-256) assertion signature.
 * `publicKey` is SPKI DER (base64url) as stored at registration.
 */
export function verifyEs256Assertion(params: {
  publicKeySpki: Buffer;
  authenticatorData: Buffer;
  clientDataJSON: Buffer;
  signature: Buffer;
}): boolean {
  const hash = crypto.createHash('sha256').update(params.clientDataJSON).digest();
  const signed = Buffer.concat([params.authenticatorData, hash]);
  try {
    const key = crypto.createPublicKey({ key: params.publicKeySpki, format: 'der', type: 'spki' });
    return crypto.verify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, params.signature);
  } catch {
    try {
      const key = crypto.createPublicKey({ key: params.publicKeySpki, format: 'der', type: 'spki' });
      return crypto.verify('sha256', signed, { key, dsaEncoding: 'der' }, params.signature);
    } catch {
      return false;
    }
  }
}

export function decodeCredentialId(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export { randomToken, sha256, uuid };
