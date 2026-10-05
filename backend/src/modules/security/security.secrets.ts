import { env } from '../../config/env';
import { loggerFor } from '../../config/logger';

const log = loggerFor('security.secrets');

const PLACEHOLDER = /change-me|0123456789abcdef0123456789abcdef|password|secret/i;

/**
 * Boot-time secrets hygiene. Production already refuses to start on default
 * JWT/encryption keys; this adds extra length and HTTPS checks and warns in
 * development so local setups stay honest.
 */
export function assertSecretsHygiene(): void {
  const issues: string[] = [];
  if (env.JWT_ACCESS_SECRET.length < 32) issues.push('JWT_ACCESS_SECRET is shorter than 32 characters');
  if (env.JWT_REFRESH_SECRET.length < 32) issues.push('JWT_REFRESH_SECRET is shorter than 32 characters');
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) issues.push('JWT access and refresh secrets must differ');
  if (env.isProduction && PLACEHOLDER.test(env.JWT_ACCESS_SECRET)) issues.push('JWT_ACCESS_SECRET looks like a placeholder');
  if (env.isProduction && env.APP_URL.startsWith('http://')) issues.push('APP_URL must be https in production');
  if (env.isProduction && env.CORS_ORIGINS.includes('*')) issues.push('CORS_ORIGINS must not be * in production');

  if (env.isProduction && issues.length > 0) {
    console.error(`Refusing to start: secrets hygiene failed: ${issues.join('; ')}`);
    process.exit(1);
  }
  if (issues.length > 0) {
    log.warn({ issues }, 'development secrets hygiene warnings');
  }
}

export function publicSecurityConfig() {
  return {
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    mfaChallengeTtlSeconds: env.MFA_CHALLENGE_TTL_SECONDS,
    sessionIdleHours: env.SESSION_IDLE_HOURS,
    wafEnabled: env.WAF_ENABLED,
    rpoMinutes: env.RPO_MINUTES,
    rtoMinutes: env.RTO_MINUTES,
    tlsRequired: env.isProduction,
  };
}
