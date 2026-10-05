import { execute, queryOne, type Row } from '../../db/query';
import { AppError, ErrorCode } from '../../core/errors';
import { packIp, sha256, uuid } from '../../core/security/crypto';
import { contextOrDefaults } from '../../core/context';
import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';

const log = loggerFor('captcha');

export async function issueCaptchaChallenge(action: string): Promise<{ token: string; provider: string; expiresAt: string }> {
  const context = contextOrDefaults();
  const token = uuid();
  const expiresAt = new Date(Date.now() + env.CAPTCHA_TTL_SECONDS * 1000);
  await execute(
    `INSERT INTO captcha_challenges (token, provider, action, ip_address, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [token, env.TURNSTILE_SECRET ? 'turnstile' : 'internal', action, packIp(context.ip), expiresAt],
  );
  return {
    token,
    provider: env.TURNSTILE_SECRET ? 'turnstile' : 'internal',
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Internal captcha: the client must echo the issued token after the user has
 * confirmed they are human (checkbox / delay). Turnstile: verify with Cloudflare.
 */
export async function verifyCaptchaToken(token: string | undefined, action: string): Promise<boolean> {
  if (!token) return false;
  const context = contextOrDefaults();

  if (env.TURNSTILE_SECRET) {
    try {
      const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET,
          response: token,
          ...(context.ip ? { remoteip: context.ip } : {}),
        }),
      });
      const body = (await response.json()) as { success?: boolean };
      return body.success === true;
    } catch (error) {
      log.warn({ err: error }, 'turnstile verification failed');
      return false;
    }
  }

  const record = await queryOne<Row>(
    `SELECT id, action, solved_at, expires_at FROM captcha_challenges WHERE token = ?`,
    [token],
  );
  if (!record) return false;
  if ((record.expires_at as Date).getTime() < Date.now()) return false;
  if (record.solved_at) return String(record.action) === action || String(record.action) === 'auth';
  return false;
}

export async function solveInternalCaptcha(token: string): Promise<{ solved: boolean }> {
  const result = await execute(
    `UPDATE captcha_challenges
        SET solved_at = CURRENT_TIMESTAMP
      WHERE token = ? AND solved_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [token],
  );
  if (result.affectedRows === 0) {
    throw new AppError('Captcha challenge is invalid or expired', { status: 400, code: ErrorCode.CAPTCHA_REQUIRED });
  }
  return { solved: true };
}

export function assertCaptchaIfRequired(token: string | undefined, required: boolean, action: string): Promise<void> {
  if (!required) return Promise.resolve();
  return verifyCaptchaToken(token, action).then((ok) => {
    if (!ok) {
      throw new AppError('Additional verification is required', {
        status: 403,
        code: ErrorCode.CAPTCHA_REQUIRED,
      });
    }
  });
}

/** Used only to keep unused import lint-free if sha256 is needed for future hashed tokens. */
export const captchaFingerprint = (token: string): string => sha256(token);
