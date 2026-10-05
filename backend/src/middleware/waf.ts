import type { RequestHandler } from 'express';
import { env } from '../config/env';
import { AppError, ErrorCode } from '../core/errors';
import { loggerFor } from '../config/logger';

const log = loggerFor('waf');

/**
 * Application-layer WAF. This is not a substitute for a CDN/WAF in front of
 * the API, parameterized queries, or schema validation — it is a last-mile
 * filter for obviously hostile payloads that reached Node.
 */
const SQLI = /(\bUNION\b\s+\bSELECT\b|\bOR\b\s+1\s*=\s*1|\bAND\b\s+1\s*=\s*1|;+\s*(DROP|ALTER|TRUNCATE)\b|\bINFORMATION_SCHEMA\b|\bSLEEP\s*\(|\bBENCHMARK\s*\(|\bLOAD_FILE\s*\(|\bINTO\s+OUTFILE\b|\bXP_CMDSHELL\b)/i;
const XSS = /(<\s*script\b|javascript\s*:|on(error|load|click)\s*=|<\s*iframe\b|<\s*object\b)/i;
const TRAVERSAL = /(\.\.[/\\]|%2e%2e[%/\\]|%2e%2e%2f)/i;
const POLLUTION = /(__proto__|constructor\s*\[|prototype\s*\[)/i;
const COMMAND = /(\b(?:bash|sh|cmd|powershell)\b\s+-c\b|\|\s*(?:nc|netcat|curl|wget)\b|`[^`]{2,}`)/i;

const SKIP_PREFIXES = ['/payments/webhooks/', '/uploads/local'];

function walk(value: unknown, depth = 0, hits: string[] = []): string[] {
  if (depth > 8 || hits.length >= 4 || value == null) return hits;
  if (typeof value === 'string') {
    if (value.length > 8_192) {
      hits.push('oversized_string');
      return hits;
    }
    if (SQLI.test(value)) hits.push('sqli');
    if (XSS.test(value)) hits.push('xss');
    if (TRAVERSAL.test(value)) hits.push('path_traversal');
    if (POLLUTION.test(value)) hits.push('prototype_pollution');
    if (COMMAND.test(value)) hits.push('command_injection');
    return hits;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return hits;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) walk(item, depth + 1, hits);
    return hits;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (POLLUTION.test(key) || key === '__proto__' || key === 'constructor') {
        hits.push('prototype_pollution');
        continue;
      }
      walk(nested, depth + 1, hits);
    }
  }
  return hits;
}

export const applicationWaf: RequestHandler = (req, _res, next) => {
  if (!env.WAF_ENABLED) return next();
  const path = req.originalUrl.split('?')[0] ?? '';
  if (SKIP_PREFIXES.some((prefix) => path.includes(prefix))) return next();
  if (req.is('multipart/form-data')) return next();

  const hits = [
    ...walk(req.query),
    ...walk(req.params),
    ...walk(req.body),
  ];

  if (hits.length === 0) return next();

  log.warn(
    { path: req.originalUrl, method: req.method, hits, requestId: req.context?.requestId },
    'application waf blocked request',
  );
  next(
    new AppError('Request blocked by security policy', {
      status: 400,
      code: ErrorCode.WAF_BLOCKED,
    }),
  );
};
