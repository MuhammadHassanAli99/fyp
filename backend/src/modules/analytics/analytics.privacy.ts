const BLOCKED_KEY =
  /^(password|passwd|pwd|token|secret|authorization|cookie|otp|pin|cvv|cvc|pan|ssn|nid|national.?id|government|iban|card|credit|email|phone|msisdn|message|body|content|text|gps|lat|lng|latitude|longitude|precise.?location|client_secret|refresh_token|access_token)$/i;

const BLOCKED_SUBSTRING = /(password|secret|token|otp|card.?number|gov(ernment)?.?id|national.?id)/i;

export function isBlockedKey(key: string): boolean {
  const normalized = key.trim();
  if (BLOCKED_KEY.test(normalized)) return true;
  return BLOCKED_SUBSTRING.test(normalized.replace(/[_-]/g, ''));
}

const MAX_DEPTH = 3;
const MAX_KEYS = 24;
const MAX_STRING = 191;

function clipValue(value: unknown, depth: number): unknown {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.slice(0, MAX_STRING);
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return undefined;
    return value.slice(0, 8).map((item) => clipValue(item, depth + 1)).filter((item) => item !== undefined);
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return undefined;
    return sanitizeProperties(value as Record<string, unknown>, depth + 1);
  }
  return undefined;
}

/** Drop credentials, PII, message bodies and precise coordinates. */
export function sanitizeProperties(
  input: Record<string, unknown> | null | undefined,
  depth = 0,
): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (count >= MAX_KEYS) break;
    if (isBlockedKey(key)) continue;
    const cleaned = clipValue(value, depth);
    if (cleaned === undefined) continue;
    out[key] = cleaned;
    count += 1;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function parseDeviceKind(userAgent: string | null | undefined, platform: string | null | undefined): 'phone' | 'tablet' | 'desktop' | 'tv' | 'other' {
  const ua = (userAgent ?? '').toLowerCase();
  const plat = (platform ?? '').toLowerCase();
  if (/tv|android tv|appletv|crkey/.test(ua)) return 'tv';
  if (/ipad|tablet|sm-t|kindle/.test(ua) || plat === 'tablet') return 'tablet';
  if (/iphone|android.+mobile|mobile safari|windows phone/.test(ua) || plat === 'android' || plat === 'ios') {
    if (/mobile/.test(ua) || plat === 'ios' || plat === 'android') return 'phone';
  }
  if (plat === 'windows' || plat === 'macos' || plat === 'linux' || plat === 'web' || /windows|macintosh|linux|x11/.test(ua)) {
    return 'desktop';
  }
  return 'other';
}

export function parseOs(userAgent: string | null | undefined, platform: string | null | undefined): { osName: string | null; osVersion: string | null } {
  const ua = userAgent ?? '';
  const plat = (platform ?? '').toLowerCase();
  if (plat === 'android' || /android/i.test(ua)) {
    const version = ua.match(/Android\s([\d.]+)/i)?.[1] ?? null;
    return { osName: 'android', osVersion: version };
  }
  if (plat === 'ios' || /iPhone|iPad|iOS/i.test(ua)) {
    const version = ua.match(/OS\s([\d_]+)/i)?.[1]?.replace(/_/g, '.') ?? null;
    return { osName: 'ios', osVersion: version };
  }
  if (plat === 'windows' || /Windows NT/i.test(ua)) {
    const version = ua.match(/Windows NT\s([\d.]+)/i)?.[1] ?? null;
    return { osName: 'windows', osVersion: version };
  }
  if (plat === 'macos' || /Mac OS X/i.test(ua)) {
    const version = ua.match(/Mac OS X\s([\d_]+)/i)?.[1]?.replace(/_/g, '.') ?? null;
    return { osName: 'macos', osVersion: version };
  }
  if (plat === 'linux' || /Linux/i.test(ua)) return { osName: 'linux', osVersion: null };
  if (plat === 'web') return { osName: 'web', osVersion: null };
  return { osName: plat || null, osVersion: null };
}

export function parseBrowser(userAgent: string | null | undefined, platform: string | null | undefined): string | null {
  if ((platform ?? '').toLowerCase() !== 'web') return null;
  const ua = userAgent ?? '';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/Chrome\//i.test(ua)) return 'chrome';
  if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) return 'safari';
  if (/Firefox\//i.test(ua)) return 'firefox';
  return 'other';
}
