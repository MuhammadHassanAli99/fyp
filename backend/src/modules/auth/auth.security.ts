import { execute, queryRows, type Row } from '../../db/query';
import { packIp, uuid } from '../../core/security/crypto';
import { contextOrDefaults } from '../../core/context';
import { recordAudit } from '../../middleware/audit';
import { loggerFor } from '../../config/logger';

const log = loggerFor('auth.security');

export const AuthEvent = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  LOGOUT_ALL: 'LOGOUT_ALL',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  EMAIL_CHANGED: 'EMAIL_CHANGED',
  PHONE_CHANGED: 'PHONE_CHANGED',
  MFA_ENABLED: 'MFA_ENABLED',
  MFA_DISABLED: 'MFA_DISABLED',
  MFA_CHALLENGE: 'MFA_CHALLENGE',
  PASSKEY_ADDED: 'PASSKEY_ADDED',
  PASSKEY_REMOVED: 'PASSKEY_REMOVED',
  DEVICE_ADDED: 'DEVICE_ADDED',
  DEVICE_REMOVED: 'DEVICE_REMOVED',
  SESSION_CREATED: 'SESSION_CREATED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  SUSPICIOUS_LOGIN: 'SUSPICIOUS_LOGIN',
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  OAUTH_LINKED: 'OAUTH_LINKED',
  OAUTH_UNLINKED: 'OAUTH_UNLINKED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  PHONE_VERIFIED: 'PHONE_VERIFIED',
  USERNAME_CHANGED: 'USERNAME_CHANGED',
  PROFILE_CHANGED: 'PROFILE_CHANGED',
  BUSINESS_OWNERSHIP_CHANGED: 'BUSINESS_OWNERSHIP_CHANGED',
  VERIFICATION_SUBMITTED: 'VERIFICATION_SUBMITTED',
} as const;

export type AuthEventType = (typeof AuthEvent)[keyof typeof AuthEvent];

const SEVERITY: Record<string, 'info' | 'low' | 'medium' | 'high' | 'critical'> = {
  LOGIN_SUCCESS: 'info',
  LOGOUT: 'info',
  SESSION_CREATED: 'info',
  EMAIL_VERIFIED: 'info',
  PHONE_VERIFIED: 'info',
  PASSKEY_ADDED: 'low',
  OAUTH_LINKED: 'low',
  MFA_ENABLED: 'low',
  PASSWORD_CHANGED: 'medium',
  EMAIL_CHANGED: 'medium',
  PHONE_CHANGED: 'medium',
  USERNAME_CHANGED: 'medium',
  PROFILE_CHANGED: 'low',
  BUSINESS_OWNERSHIP_CHANGED: 'high',
  VERIFICATION_SUBMITTED: 'medium',
  DEVICE_ADDED: 'medium',
  LOGIN_FAILED: 'medium',
  CAPTCHA_REQUIRED: 'medium',
  MFA_DISABLED: 'high',
  LOGOUT_ALL: 'high',
  SESSION_REVOKED: 'high',
  DEVICE_REMOVED: 'high',
  OAUTH_UNLINKED: 'high',
  SUSPICIOUS_LOGIN: 'high',
  ACCOUNT_LOCKED: 'critical',
  ACCOUNT_UNLOCKED: 'high',
};

/**
 * Persists a security event without secrets. Failures never abort the user action.
 */
export async function recordAuthEvent(params: {
  type: AuthEventType | string;
  userId?: number | null;
  deviceId?: number | null;
  sessionId?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const context = contextOrDefaults();
  const metadata = scrub(params.metadata ?? {});
  try {
    await execute(
      `INSERT INTO auth_security_events
         (uuid, user_id, device_id, session_id, event_type, severity, ip_address, country_id, user_agent, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(),
        params.userId ?? null,
        params.deviceId ?? null,
        params.sessionId ?? null,
        params.type,
        SEVERITY[params.type] ?? 'info',
        packIp(context.ip),
        context.countryId,
        context.userAgent?.slice(0, 512) ?? null,
        JSON.stringify(metadata),
      ],
    );
  } catch (error) {
    log.warn({ err: error, type: params.type }, 'auth security event write skipped');
  }

  void recordAudit({
    action: `auth.${params.type.toLowerCase()}`,
    entityType: 'auth',
    entityId: params.userId ?? null,
    actorId: params.userId ?? null,
    after: metadata,
  });
}

const SECRET_KEYS = /password|token|secret|otp|code|refresh|authorization|nonce|verifier/i;

function scrub(input: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = SECRET_KEYS.test(key) ? '[redacted]' : value;
  }
  return output;
}

export async function listSecurityEvents(userId: number, limit = 50) {
  const rows = await queryRows<Row>(
    `SELECT uuid, event_type, severity, created_at, country_id, metadata
       FROM auth_security_events
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT ?`,
    [userId, Math.min(100, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: String(row.uuid),
    type: String(row.event_type),
    severity: String(row.severity),
    createdAt: (row.created_at as Date).toISOString(),
    countryId: row.country_id === null ? null : Number(row.country_id),
    metadata: row.metadata ?? {},
  }));
}
