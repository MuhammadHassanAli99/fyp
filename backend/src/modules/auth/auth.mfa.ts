import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, forbidden, notFound } from '../../core/errors';
import { decryptSecret, encryptSecret, sha256, uuid } from '../../core/security/crypto';
import { generateRecoveryCodes, generateTotpSecret, totpOtpauthUrl, verifyTotp } from '../../core/security/totp';
import { env } from '../../config/env';
import { contextOrDefaults } from '../../core/context';
import { messaging } from '../../providers/messaging';
import { packIp } from '../../core/security/crypto';
import {
  loadAuthenticatedUser,
  loadMfaFactorHints,
  maskDestination,
  satisfyMfaOnSession,
  sendOtp,
  verifyOtp,
} from './auth.service';
import { AuthEvent, recordAuthEvent } from './auth.security';

function secretFromFactor(row: Row): string {
  const raw = row.secret as Buffer | null;
  if (!raw) throw new AppError('This factor cannot be verified', { status: 400, code: ErrorCode.MFA_INVALID });
  return decryptSecret(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
}

export async function beginEnableMfa(userId: number, kind: 'totp' | 'sms' | 'email', destination?: string) {
  const user = await queryOne<Row>('SELECT email, phone_e164 FROM users WHERE id = ?', [userId]);
  if (!user) throw notFound('User');

  if (kind === 'totp') {
    const secret = generateTotpSecret();
    const otpauth = totpOtpauthUrl(secret, String(user.email ?? `user-${userId}`), env.APP_NAME);
    const encrypted = encryptSecret(secret);
    await execute(
      `INSERT INTO mfa_factors (user_id, kind, label, secret, destination, is_primary)
       VALUES (?, 'totp', 'Authenticator', ?, '', 1)
       ON DUPLICATE KEY UPDATE secret = VALUES(secret), verified_at = NULL`,
      [userId, encrypted],
    );
    const factor = await queryOne<Row>(`SELECT id FROM mfa_factors WHERE user_id = ? AND kind = 'totp'`, [userId]);
    return {
      factorId: Number(factor?.id),
      kind,
      secret,
      otpauthUrl: otpauth,
      recoveryCodes: null as string[] | null,
    };
  }

  const dest =
    destination ??
    (kind === 'email' ? (user.email as string | null) : (user.phone_e164 as string | null));
  if (!dest) throw badRequest(`Add a ${kind === 'email' ? 'email address' : 'phone number'} first`);

  await execute(
    `INSERT INTO mfa_factors (user_id, kind, label, destination, is_primary)
     VALUES (?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE destination = VALUES(destination), verified_at = NULL`,
    [userId, kind, kind.toUpperCase(), dest],
  );
  await sendOtp({
    destination: dest,
    channel: kind === 'email' ? 'email' : 'sms',
    purpose: 'mfa',
    userId,
  });
  const factor = await queryOne<Row>(`SELECT id FROM mfa_factors WHERE user_id = ? AND kind = ? AND destination = ?`, [
    userId,
    kind,
    dest,
  ]);
  return { factorId: Number(factor?.id), kind, secret: null, otpauthUrl: null, hint: maskDestination(dest) };
}

export async function confirmEnableMfa(userId: number, code: string, factorId?: number) {
  const factor = await queryOne<Row>(
    factorId
      ? 'SELECT * FROM mfa_factors WHERE id = ? AND user_id = ?'
      : 'SELECT * FROM mfa_factors WHERE user_id = ? AND verified_at IS NULL ORDER BY id DESC LIMIT 1',
    factorId ? [factorId, userId] : [userId],
  );
  if (!factor) throw notFound('MFA factor');

  const kind = String(factor.kind);
  if (kind === 'totp') {
    if (!verifyTotp(secretFromFactor(factor), code)) {
      throw new AppError('Invalid authenticator code', { status: 401, code: ErrorCode.MFA_INVALID });
    }
  } else {
    await verifyOtp({
      destination: String(factor.destination),
      code,
      purpose: 'mfa',
    });
  }

  await execute('UPDATE mfa_factors SET verified_at = CURRENT_TIMESTAMP, last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [
    factor.id,
  ]);
  await execute('UPDATE users SET mfa_enabled = 1 WHERE id = ?', [userId]);

  const codes = generateRecoveryCodes();
  await execute('DELETE FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL', [userId]);
  for (const recovery of codes) {
    await execute('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)', [userId, sha256(recovery.toUpperCase())]);
  }

  void recordAuthEvent({ type: AuthEvent.MFA_ENABLED, userId, metadata: { kind } });
  return { enabled: true, recoveryCodes: codes, factors: await loadMfaFactorHints(userId) };
}

export async function disableMfa(userId: number, code: string, currentPassword?: string): Promise<{ disabled: boolean }> {
  const user = await queryOne<Row>('SELECT password_hash, mfa_enabled FROM users WHERE id = ?', [userId]);
  if (!user || user.mfa_enabled !== 1) throw badRequest('MFA is not enabled');

  const verified = await verifyAnyMfa(userId, code);
  if (!verified) {
    throw new AppError('Verification failed. MFA was not disabled.', { status: 401, code: ErrorCode.MFA_INVALID });
  }

  await execute('UPDATE users SET mfa_enabled = 0 WHERE id = ?', [userId]);
  await execute('UPDATE mfa_factors SET verified_at = NULL WHERE user_id = ?', [userId]);
  await execute('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
  void recordAuthEvent({ type: AuthEvent.MFA_DISABLED, userId });
  void currentPassword;
  return { disabled: true };
}

export async function listMfaFactors(userId: number) {
  const enabled = await queryOne<Row>('SELECT mfa_enabled FROM users WHERE id = ?', [userId]);
  return {
    enabled: enabled?.mfa_enabled === 1,
    factors: await loadMfaFactorHints(userId),
  };
}

export async function regenerateRecoveryCodes(userId: number, code: string) {
  const ok = await verifyAnyMfa(userId, code);
  if (!ok) throw new AppError('Verification failed', { status: 401, code: ErrorCode.MFA_INVALID });
  const codes = generateRecoveryCodes();
  await execute('DELETE FROM mfa_recovery_codes WHERE user_id = ?', [userId]);
  for (const recovery of codes) {
    await execute('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES (?, ?)', [userId, sha256(recovery.toUpperCase())]);
  }
  return { recoveryCodes: codes };
}

export async function beginMfaChallenge(userId: number, sessionId: number, factorId?: number) {
  const factor = await queryOne<Row>(
    factorId
      ? 'SELECT * FROM mfa_factors WHERE id = ? AND user_id = ? AND verified_at IS NOT NULL'
      : 'SELECT * FROM mfa_factors WHERE user_id = ? AND verified_at IS NOT NULL ORDER BY is_primary DESC, id LIMIT 1',
    factorId ? [factorId, userId] : [userId],
  );
  if (!factor) throw badRequest('No verified MFA factor on this account');

  const challengeUuid = uuid();
  const expiresAt = new Date(Date.now() + env.MFA_CHALLENGE_TTL_SECONDS * 1000);
  const kind = String(factor.kind) as 'totp' | 'sms' | 'email' | 'passkey';

  if (kind === 'sms' || kind === 'email') {
    await sendOtp({
      destination: String(factor.destination),
      channel: kind === 'email' ? 'email' : 'sms',
      purpose: 'mfa',
      userId,
    });
  }

  await execute(
    `INSERT INTO mfa_challenges (uuid, user_id, session_id, factor_id, kind, expires_at, ip_address, max_attempts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [challengeUuid, userId, sessionId, factor.id, kind === 'passkey' ? 'passkey' : kind, expiresAt, packIp(contextOrDefaults().ip), env.OTP_MAX_ATTEMPTS],
  );

  void recordAuthEvent({ type: AuthEvent.MFA_CHALLENGE, userId, sessionId, metadata: { kind } });
  void messaging;

  return {
    challengeId: challengeUuid,
    kind,
    hint: maskDestination(factor.destination as string | null),
    expiresAt: expiresAt.toISOString(),
  };
}

export async function verifyMfaChallenge(params: {
  userId: number;
  sessionId: number;
  code: string;
  challengeId?: string;
}): Promise<{ user: Awaited<ReturnType<typeof loadAuthenticatedUser>>; mfaSatisfied: true }> {
  const challenge = await queryOne<Row>(
    params.challengeId
      ? 'SELECT * FROM mfa_challenges WHERE uuid = ? AND user_id = ? AND consumed_at IS NULL'
      : 'SELECT * FROM mfa_challenges WHERE user_id = ? AND session_id = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1',
    params.challengeId ? [params.challengeId, params.userId] : [params.userId, params.sessionId],
  );
  if (!challenge) throw new AppError('No active MFA challenge', { status: 400, code: ErrorCode.MFA_INVALID });
  if ((challenge.expires_at as Date).getTime() < Date.now()) {
    throw new AppError('MFA challenge expired', { status: 401, code: ErrorCode.TOKEN_EXPIRED });
  }
  if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
    throw new AppError('Too many MFA attempts', { status: 429, code: ErrorCode.TOO_MANY_ATTEMPTS });
  }

  const ok = await verifyAnyMfa(params.userId, params.code, challenge.factor_id === null ? undefined : Number(challenge.factor_id));
  if (!ok) {
    await execute('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = ?', [challenge.id]);
    throw new AppError('Invalid verification code', { status: 401, code: ErrorCode.MFA_INVALID });
  }

  await execute('UPDATE mfa_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?', [challenge.id]);
  await satisfyMfaOnSession(params.sessionId);
  return { user: await loadAuthenticatedUser(params.userId), mfaSatisfied: true };
}

async function verifyAnyMfa(userId: number, code: string, factorId?: number): Promise<boolean> {
  const normalized = code.trim().toUpperCase();
  const recovery = await queryOne<Row>(
    `SELECT id FROM mfa_recovery_codes WHERE user_id = ? AND used_at IS NULL AND code_hash = ?`,
    [userId, sha256(normalized)],
  );
  if (recovery) {
    await execute('UPDATE mfa_recovery_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [recovery.id]);
    return true;
  }

  const factors = await queryRows<Row>(
    factorId
      ? 'SELECT * FROM mfa_factors WHERE id = ? AND user_id = ? AND verified_at IS NOT NULL'
      : 'SELECT * FROM mfa_factors WHERE user_id = ? AND verified_at IS NOT NULL',
    factorId ? [factorId, userId] : [userId],
  );

  for (const factor of factors) {
    const kind = String(factor.kind);
    if (kind === 'totp' && verifyTotp(secretFromFactor(factor), code)) {
      await execute('UPDATE mfa_factors SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [factor.id]);
      return true;
    }
    if ((kind === 'sms' || kind === 'email') && factor.destination) {
      try {
        await verifyOtp({ destination: String(factor.destination), code, purpose: 'mfa' });
        await execute('UPDATE mfa_factors SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?', [factor.id]);
        return true;
      } catch {
        // try next factor
      }
    }
  }
  return false;
}

export async function requireReauthForDisable(): Promise<void> {
  throw forbidden('Verify MFA before disabling it');
}
