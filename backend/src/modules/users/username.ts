import { AppError, ErrorCode, validationFailed } from '../../core/errors';

/**
 * Centralised username rules. Uniqueness is enforced in the database
 * (`users.username_normalized`) and again in username.service — this module is
 * the format / reserved / impersonation / profanity gate used by both
 * registration and username changes.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]*[a-zA-Z0-9]$|^[a-zA-Z][a-zA-Z0-9]{2,31}$/;

/** Built-in reserved set. The reserved_usernames table can extend this. */
export const BUILTIN_RESERVED = new Set([
  'admin',
  'administrator',
  'support',
  'official',
  'security',
  'moderator',
  'mod',
  'staff',
  'help',
  'helpdesk',
  'root',
  'system',
  'api',
  'www',
  'mail',
  'noreply',
  'no-reply',
  'gold',
  'property',
  'vehicles',
  'vehicle',
  'marketplace',
  'aurelia',
  'verified',
  'identity',
  'kyc',
  'aml',
  'police',
  'government',
  'gov',
  'bank',
  'owner',
  'null',
  'undefined',
  'me',
  'user',
  'users',
  'profile',
]);

const PROFANITY = new Set([
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'cunt',
  'nigger',
  'nigga',
  'rape',
  'porn',
  'sex',
  'xxx',
]);

const CONFUSABLES: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  $: 's',
};

export type UsernameIssueCode =
  | 'too_short'
  | 'too_long'
  | 'invalid_format'
  | 'reserved'
  | 'impersonation'
  | 'profanity'
  | 'taken';

export interface UsernameValidation {
  ok: boolean;
  normalized: string;
  display: string;
  issues: Array<{ code: UsernameIssueCode; message: string }>;
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

function foldConfusables(value: string, map: Record<string, string> = CONFUSABLES): string {
  return value
    .split('')
    .map((char) => map[char] ?? char)
    .join('')
    .replace(/[._-]+/g, '');
}

function foldedVariants(value: string): string[] {
  const primary = foldConfusables(value);
  const asI = foldConfusables(value, { ...CONFUSABLES, '1': 'i' });
  const asL = foldConfusables(value, { ...CONFUSABLES, '1': 'l' });
  return [...new Set([primary, asI, asL])];
}

function looksLikeReserved(normalized: string, extraReserved: Iterable<string> = []): boolean {
  const reserved = new Set([...BUILTIN_RESERVED, ...extraReserved]);
  if (reserved.has(normalized)) return true;

  const folded = foldedVariants(normalized);
  for (const name of reserved) {
    const foldedReserved = foldConfusables(name);
    if (folded.some((variant) => variant === foldedReserved)) return true;
    if (folded.some((variant) => variant.startsWith(foldedReserved) && variant.length - foldedReserved.length <= 3)) {
      return true;
    }
    if (normalized === `${name}s` || normalized === `the${name}` || normalized === `${name}official`) return true;
  }
  return false;
}

function containsProfanity(normalized: string): boolean {
  const compact = normalized.replace(/[._-]/g, '');
  for (const term of PROFANITY) {
    if (compact.includes(term) || normalized.includes(term)) return true;
  }
  return false;
}

/**
 * Format + policy check. Does not hit the database.
 */
export function validateUsername(
  raw: string,
  extraReserved: Iterable<string> = [],
): UsernameValidation {
  const display = raw.trim();
  const normalized = normalizeUsername(raw);
  const issues: UsernameValidation['issues'] = [];

  if (normalized.length < USERNAME_MIN) {
    issues.push({ code: 'too_short', message: `Username must be at least ${USERNAME_MIN} characters` });
  }
  if (normalized.length > USERNAME_MAX) {
    issues.push({ code: 'too_long', message: `Username must be at most ${USERNAME_MAX} characters` });
  }
  if (normalized.length >= USERNAME_MIN && normalized.length <= USERNAME_MAX) {
    if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(display) || /[._-]{2,}/.test(display) || /[._-]$/.test(display)) {
      issues.push({
        code: 'invalid_format',
        message: 'Username must start with a letter and may only contain letters, numbers, dots, dashes and underscores',
      });
    }
  }
  if (looksLikeReserved(normalized, extraReserved)) {
    issues.push({
      code: 'reserved',
      message: 'This username is reserved for the platform and cannot be used',
    });
  }
  if (containsProfanity(normalized)) {
    issues.push({ code: 'profanity', message: 'This username is not allowed' });
  }

  return { ok: issues.length === 0, normalized, display, issues };
}

export function assertUsernameValid(raw: string, extraReserved: Iterable<string> = []): UsernameValidation {
  const result = validateUsername(raw, extraReserved);
  if (!result.ok) {
    throw validationFailed(
      result.issues.map((issue) => ({ field: 'username', message: issue.message, code: issue.code })),
      result.issues[0]?.message ?? 'Invalid username',
    );
  }
  return result;
}

export function usernameTakenError(): AppError {
  return new AppError('This username is taken', { status: 409, code: ErrorCode.USERNAME_TAKEN });
}
