import crypto from 'node:crypto';
import { env } from '../../config/env';

/** SHA-256 hex. Used for lookup keys — never for passwords. */
export const sha256 = (value: string | Buffer): string => crypto.createHash('sha256').update(value).digest('hex');

export const hmacSha256 = (value: string, key: string = env.ENCRYPTION_KEY): string =>
  crypto.createHmac('sha256', key).update(value).digest('hex');

export const randomToken = (bytes = 32): string => crypto.randomBytes(bytes).toString('base64url');

export const randomHex = (bytes = 16): string => crypto.randomBytes(bytes).toString('hex');

export const uuid = (): string => crypto.randomUUID();

/** Numeric OTP with no modulo bias. */
export function randomNumericCode(length = env.OTP_LENGTH): string {
  let code = '';
  while (code.length < length) {
    code += crypto.randomInt(0, 10).toString();
  }
  return code;
}

/**
 * Short, human-quotable reference like `GLD-8F2K19`.
 * Excludes I/O/0/1 so it survives being read out over the phone.
 */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function referenceCode(prefix: string, length = 6): string {
  let body = '';
  for (let i = 0; i < length; i += 1) {
    body += REFERENCE_ALPHABET[crypto.randomInt(0, REFERENCE_ALPHABET.length)];
  }
  return `${prefix.toUpperCase()}-${body}`;
}

/** Constant-time compare, safe against length-leaking early exit. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Still do the work so timing does not reveal the length mismatch.
    crypto.timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/* -------------------------------------------------------------------------- */
/* Symmetric encryption for secrets at rest (MFA seeds, OAuth client secrets)  */
/* -------------------------------------------------------------------------- */

const KEY = (() => {
  const raw = env.ENCRYPTION_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const buffer = Buffer.from(raw, 'utf8');
  if (buffer.length === 32) return buffer;
  // Stretch or truncate deterministically so a short dev key still works.
  return crypto.createHash('sha256').update(raw).digest();
})();

/** AES-256-GCM. Output layout: iv(12) | authTag(16) | ciphertext. */
export function encryptSecret(plaintext: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(payload: Buffer): string {
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** AES-256-GCM for binary blobs (verification documents). Same layout as encryptSecret. */
export function encryptBytes(plaintext: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBytes(payload: Buffer): Buffer {
  const iv = payload.subarray(0, 12);
  const authTag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Packs an IPv4/IPv6 address into VARBINARY(16); null for unparseable input. */
export function packIp(ip: string | null | undefined): Buffer | null {
  if (!ip) return null;
  const normalized = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(normalized)) {
    const octets = normalized.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) return null;
    return Buffer.from(octets);
  }
  try {
    const groups = expandIpv6(normalized);
    if (!groups) return null;
    const buffer = Buffer.alloc(16);
    groups.forEach((group, index) => buffer.writeUInt16BE(group, index * 2));
    return buffer;
  } catch {
    return null;
  }
}

function expandIpv6(ip: string): number[] | null {
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':').filter(Boolean) : [];
  const tailParts = tail ? tail.split(':').filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const parts = ip.includes('::')
    ? [...headParts, ...Array<string>(missing).fill('0'), ...tailParts]
    : ip.split(':');
  if (parts.length !== 8) return null;
  const groups = parts.map((part) => Number.parseInt(part || '0', 16));
  return groups.some((group) => Number.isNaN(group) || group < 0 || group > 0xffff) ? null : groups;
}

/** Pseudonymised IP for analytics — keeps aggregation possible without storing PII. */
export const hashIp = (ip: string | null | undefined): string | null => (ip ? sha256(`${ip}:${env.ENCRYPTION_KEY}`) : null);
