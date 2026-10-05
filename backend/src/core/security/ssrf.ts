import { AppError, ErrorCode } from '../errors';

const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal', 'metadata']);

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Rejects user-supplied URLs that would make the server fetch internal
 * infrastructure (SSRF). Provider adapters that call known HTTPS APIs should
 * not go through this — only URLs that originated from a client.
 */
export function assertPublicHttpUrl(raw: string, label = 'URL'): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError(`Invalid ${label}`, { status: 400, code: ErrorCode.BAD_REQUEST });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError(`${label} must be http(s)`, { status: 400, code: ErrorCode.SSRF_BLOCKED });
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(host) || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new AppError(`${label} is not allowed`, { status: 400, code: ErrorCode.SSRF_BLOCKED });
  }
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    throw new AppError(`${label} is not allowed`, { status: 400, code: ErrorCode.SSRF_BLOCKED });
  }
  if (isPrivateIpv4(host)) {
    throw new AppError(`${label} is not allowed`, { status: 400, code: ErrorCode.SSRF_BLOCKED });
  }
  return parsed;
}
