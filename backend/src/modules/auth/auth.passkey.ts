import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { AppError, ErrorCode, notFound } from '../../core/errors';
import { packIp, uuid } from '../../core/security/crypto';
import {
  createWebAuthnChallenge,
  decodeCredentialId,
  verifyClientData,
  verifyEs256Assertion,
  webAuthnOptions,
} from '../../core/security/webauthn';
import { contextOrDefaults } from '../../core/context';
import { env } from '../../config/env';
import type { DeviceInput } from './auth.schema';
import {
  afterSuccessfulLogin,
  assertLoginable,
  createSession,
  loadAuthenticatedUser,
  loadGrants,
  loadMfaFactorHints,
  upsertDevice,
  type AuthResult,
} from './auth.service';
import { AuthEvent, recordAuthEvent } from './auth.security';

export async function beginPasskeyRegistration(userId: number, deviceLabel?: string) {
  const user = await queryOne<Row>('SELECT uuid, email, username FROM users WHERE id = ?', [userId]);
  if (!user) throw notFound('User');
  const challenge = createWebAuthnChallenge();
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  await execute(
    `INSERT INTO webauthn_challenges (user_id, challenge, purpose, expires_at) VALUES (?, ?, 'register', ?)`,
    [userId, challenge.raw, expiresAt],
  );
  const options = webAuthnOptions();
  return {
    ...options,
    challenge: challenge.encoded,
    user: {
      id: String(user.uuid),
      name: (user.email as string | null) ?? (user.username as string | null) ?? `user-${userId}`,
      displayName: deviceLabel ?? env.APP_NAME,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -257 },
    ],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    expiresAt: expiresAt.toISOString(),
  };
}

export async function finishPasskeyRegistration(params: {
  userId: number;
  credentialId: string;
  publicKey: string;
  challenge: string;
  clientDataJSON?: string;
  transports?: string;
  aaguid?: string;
  deviceLabel?: string;
  backedUp?: boolean;
}): Promise<{ id: number; deviceLabel: string | null }> {
  const record = await queryOne<Row>(
    `SELECT * FROM webauthn_challenges
      WHERE user_id = ? AND purpose = 'register' AND consumed_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [params.userId],
  );
  if (!record || (record.expires_at as Date).getTime() < Date.now()) {
    throw new AppError('Passkey registration challenge expired', { status: 400, code: ErrorCode.PASSKEY_INVALID });
  }

  const expected = Buffer.isBuffer(record.challenge)
    ? Buffer.from(record.challenge).toString('base64url')
    : Buffer.from(record.challenge as string).toString('base64url');
  if (params.challenge !== expected) {
    throw new AppError('Passkey challenge mismatch', { status: 400, code: ErrorCode.PASSKEY_INVALID });
  }
  if (params.clientDataJSON) {
    verifyClientData({
      clientDataJSON: params.clientDataJSON,
      expectedChallenge: expected,
      expectedType: 'webauthn.create',
    });
  }

  const credentialId = decodeCredentialId(params.credentialId);
  const publicKey = Buffer.from(params.publicKey, 'base64url');
  const result = await execute(
    `INSERT INTO user_passkeys
       (user_id, credential_id, public_key, aaguid, transports, device_label, backed_up)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      credentialId,
      publicKey,
      params.aaguid ?? null,
      params.transports ?? null,
      params.deviceLabel ?? null,
      params.backedUp ? 1 : 0,
    ],
  );
  await execute('UPDATE webauthn_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [record.id]);
  void recordAuthEvent({ type: AuthEvent.PASSKEY_ADDED, userId: params.userId, metadata: { label: params.deviceLabel ?? null } });
  return { id: result.insertId, deviceLabel: params.deviceLabel ?? null };
}

export async function beginPasskeyAuthentication(userId?: number) {
  const challenge = createWebAuthnChallenge();
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  await execute(
    `INSERT INTO webauthn_challenges (user_id, challenge, purpose, expires_at) VALUES (?, ?, 'authenticate', ?)`,
    [userId ?? null, challenge.raw, expiresAt],
  );
  const allowCredentials =
    userId !== undefined
      ? (
          await queryRows<Row>('SELECT credential_id FROM user_passkeys WHERE user_id = ?', [userId])
        ).map((row) => ({
          type: 'public-key' as const,
          id: Buffer.isBuffer(row.credential_id)
            ? Buffer.from(row.credential_id).toString('base64url')
            : Buffer.from(row.credential_id as string).toString('base64url'),
        }))
      : [];
  return {
    ...webAuthnOptions(),
    challenge: challenge.encoded,
    allowCredentials,
    userVerification: 'preferred' as const,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function finishPasskeyAuthentication(params: {
  credentialId: string;
  challenge: string;
  signature?: string;
  authenticatorData?: string;
  clientDataJSON?: string;
  device?: DeviceInput;
}): Promise<AuthResult> {
  const credentialId = decodeCredentialId(params.credentialId);
  const passkey = await queryOne<Row>('SELECT * FROM user_passkeys WHERE credential_id = ?', [credentialId]);
  if (!passkey) throw new AppError('Unknown passkey', { status: 401, code: ErrorCode.PASSKEY_INVALID });

  const record = await queryOne<Row>(
    `SELECT * FROM webauthn_challenges
      WHERE purpose = 'authenticate' AND consumed_at IS NULL
        AND (user_id IS NULL OR user_id = ?)
      ORDER BY id DESC LIMIT 1`,
    [passkey.user_id],
  );
  if (!record || (record.expires_at as Date).getTime() < Date.now()) {
    throw new AppError('Passkey challenge expired', { status: 401, code: ErrorCode.PASSKEY_INVALID });
  }
  const expected = Buffer.isBuffer(record.challenge)
    ? Buffer.from(record.challenge).toString('base64url')
    : Buffer.from(record.challenge as string).toString('base64url');
  if (params.challenge !== expected) {
    throw new AppError('Passkey challenge mismatch', { status: 401, code: ErrorCode.PASSKEY_INVALID });
  }

  if (params.clientDataJSON) {
    verifyClientData({
      clientDataJSON: params.clientDataJSON,
      expectedChallenge: expected,
      expectedType: 'webauthn.get',
    });
  }

  if (params.signature && params.authenticatorData && params.clientDataJSON) {
    const ok = verifyEs256Assertion({
      publicKeySpki: Buffer.isBuffer(passkey.public_key) ? passkey.public_key : Buffer.from(passkey.public_key as string),
      authenticatorData: Buffer.from(params.authenticatorData, 'base64url'),
      clientDataJSON: Buffer.from(params.clientDataJSON, 'base64url'),
      signature: Buffer.from(params.signature, 'base64url'),
    });
    if (!ok) {
      throw new AppError('Passkey signature is invalid', { status: 401, code: ErrorCode.PASSKEY_INVALID });
    }
  } else if (env.isProduction) {
    throw new AppError('Passkey assertion is incomplete', { status: 400, code: ErrorCode.PASSKEY_INVALID });
  }

  await execute('UPDATE webauthn_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [record.id]);
  await execute(
    `UPDATE user_passkeys
        SET last_used_at = CURRENT_TIMESTAMP, sign_count = sign_count + 1, last_ip = ?
      WHERE id = ?`,
    [packIp(contextOrDefaults().ip), passkey.id],
  );

  const userId = Number(passkey.user_id);
  const user = await queryOne<Row>('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', [userId]);
  if (!user) throw new AppError('Account not found', { status: 401, code: ErrorCode.INVALID_CREDENTIALS });
  assertLoginable(user);

  const grants = await loadGrants(userId);
  const deviceId = await upsertDevice(userId, params.device);
  const session = await createSession({
    userId,
    deviceId,
    method: 'passkey',
    mfaSatisfied: true,
    roles: grants.roles,
    permissions: grants.permissions,
  });
  await afterSuccessfulLogin(userId, session.sessionId, deviceId, 'passkey');

  const mfaEnabled = user.mfa_enabled === 1;
  if (mfaEnabled) {
    return {
      user: await loadAuthenticatedUser(userId),
      tokens: session.tokens,
      mfaRequired: false,
      mfaFactors: await loadMfaFactorHints(userId),
    };
  }
  return { user: await loadAuthenticatedUser(userId), tokens: session.tokens };
}

export async function listPasskeys(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT id, device_label, transports, backed_up, created_at, last_used_at, aaguid
       FROM user_passkeys WHERE user_id = ? ORDER BY last_used_at DESC, created_at DESC`,
    [userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    label: (row.device_label as string | null) ?? 'Passkey',
    transports: (row.transports as string | null) ?? null,
    backedUp: row.backed_up === 1,
    createdAt: (row.created_at as Date).toISOString(),
    lastUsedAt: row.last_used_at ? (row.last_used_at as Date).toISOString() : null,
  }));
}

export async function renamePasskey(userId: number, passkeyId: number, label: string): Promise<void> {
  const result = await execute('UPDATE user_passkeys SET device_label = ? WHERE id = ? AND user_id = ?', [
    label,
    passkeyId,
    userId,
  ]);
  if (result.affectedRows === 0) throw notFound('Passkey');
}

export async function removePasskey(userId: number, passkeyId: number): Promise<void> {
  const result = await execute('DELETE FROM user_passkeys WHERE id = ? AND user_id = ?', [passkeyId, userId]);
  if (result.affectedRows === 0) throw notFound('Passkey');
  void recordAuthEvent({ type: AuthEvent.PASSKEY_REMOVED, userId, metadata: { passkeyId } });
}

export const newChallengeId = (): string => uuid();
