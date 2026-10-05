import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../../config/env';
import { validationFailed } from '../errors';

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: crypto.ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing behind a narrow interface.
 *
 * Default is scrypt with memory-hard parameters (N=2^15, r=8, p=1 ≈ 32 MiB per
 * hash), available in Node's core so there is no native build step. The stored
 * format is self-describing (`scrypt$N$r$p$salt$hash`), so introducing Argon2id
 * later is a matter of adding a branch to `verify` — existing hashes keep working
 * and are upgraded on next successful login via `needsRehash`.
 */
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, saltBytes: 16 } as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const derived = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 256 * 1024 * 1024,
  });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) {
    // Spend comparable time anyway so "no password set" is not distinguishable.
    await hashPassword(password);
    return false;
  }
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt' || parts.length !== 6) return false;

  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltRaw, 'base64');
  const expected = Buffer.from(hashRaw, 'base64');
  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N: Number(nRaw),
    r: Number(rRaw),
    p: Number(pRaw),
    maxmem: 256 * 1024 * 1024,
  });
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/** True when the hash was produced with weaker parameters than we now use. */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < SCRYPT.N;
}

/* -------------------------------------------------------------------------- */
/* Strength policy                                                            */
/* -------------------------------------------------------------------------- */

/** The 20 passwords that show up in every credential-stuffing list. */
const COMMON = new Set([
  'password', 'password1', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop',
  'iloveyou', 'admin123', 'welcome1', 'letmein1', 'password123', 'abc12345', '11111111',
  'sunshine', 'princess', 'football', 'monkey123', 'dragon123', 'baseball',
]);

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'very_weak' | 'weak' | 'fair' | 'strong' | 'very_strong';
  issues: string[];
}

export function assessPassword(password: string, context: { email?: string | null; username?: string | null } = {}): PasswordStrength {
  const issues: string[] = [];
  const lower = password.toLowerCase();

  if (password.length < env.PASSWORD_MIN_LENGTH) issues.push(`Use at least ${env.PASSWORD_MIN_LENGTH} characters`);
  if (!/[a-z]/.test(password)) issues.push('Add a lowercase letter');
  if (!/[A-Z]/.test(password)) issues.push('Add an uppercase letter');
  if (!/\d/.test(password)) issues.push('Add a number');
  if (!/[^A-Za-z0-9]/.test(password)) issues.push('Add a symbol');
  if (COMMON.has(lower)) issues.push('This password is too common');
  if (/^(.)\1+$/.test(password)) issues.push('Do not repeat a single character');
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/.test(lower)) issues.push('Avoid sequences like 1234 or qwer');

  const localPart = context.email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length > 2 && lower.includes(localPart)) issues.push('Do not include your email address');
  const username = context.username?.toLowerCase();
  if (username && username.length > 2 && lower.includes(username)) issues.push('Do not include your username');

  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const lengthPoints = password.length >= 16 ? 2 : password.length >= 12 ? 1 : 0;
  const raw = Math.max(0, Math.min(4, variety - 1 + lengthPoints - (COMMON.has(lower) ? 4 : 0)));
  const score = raw as PasswordStrength['score'];
  const labels = ['very_weak', 'weak', 'fair', 'strong', 'very_strong'] as const;

  return { score, label: labels[score] ?? 'very_weak', issues };
}

/** Throws a field-level validation error, so the client can highlight the input. */
export function assertPasswordAcceptable(password: string, context: { email?: string | null; username?: string | null } = {}): void {
  const { issues } = assessPassword(password, context);
  if (issues.length > 0) {
    throw validationFailed(issues.map((message) => ({ field: 'password', message })), 'Password does not meet the requirements');
  }
}
