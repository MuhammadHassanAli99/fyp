import type { RequestHandler } from 'express';
import { execute } from '../db/query';
import { packIp } from '../core/security/crypto';
import { getContext } from '../core/context';
import { loggerFor } from '../config/logger';

const log = loggerFor('audit');

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  actorType?: 'user' | 'admin' | 'system' | 'api_key' | 'job';
  actorId?: number | null;
  organizationId?: number | null;
  roleCode?: string | null;
  permissionCode?: string | null;
  reason?: string | null;
}

const SENSITIVE = new Set([
  'password',
  'password_hash',
  'code_hash',
  'refresh_token_hash',
  'secret',
  'client_secret',
  'token',
  'access_token',
  'refresh_token',
  'card_number',
  'cvv',
  'iban',
  'encryption_key',
  'api_key',
  'webhook_secret',
  'authorization',
]);

/** Strips secrets before anything reaches the immutable audit table. */
function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrub(item, depth + 1));
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE.has(key.toLowerCase()) ? '[redacted]' : scrub(nested, depth + 1);
  }
  return output;
}

/**
 * Writes an audit row (§22/§25 Audit Logs).
 *
 * Never throws: losing an audit row is bad, but failing the user's action
 * because the audit insert failed is worse. Failures are logged at error level
 * so they are alertable.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  const context = getContext();
  try {
    await execute(
      `INSERT INTO audit_logs
         (actor_id, actor_type, action, entity_type, entity_id, before_state, after_state,
          ip_address, user_agent, request_id, organization_id, role_code, permission_code, reason, session_id, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.actorId ?? context?.userId ?? null,
        entry.actorType ?? (context?.isStaff ? 'admin' : context?.userId ? 'user' : 'system'),
        entry.action,
        entry.entityType,
        entry.entityId != null ? String(entry.entityId) : null,
        entry.before !== undefined ? JSON.stringify(scrub(entry.before)) : null,
        entry.after !== undefined ? JSON.stringify(scrub(entry.after)) : null,
        packIp(context?.ip),
        context?.userAgent?.slice(0, 512) ?? null,
        context?.requestId ?? null,
        entry.organizationId ?? null,
        entry.roleCode ?? context?.roles[0] ?? null,
        entry.permissionCode ?? null,
        entry.reason ?? null,
        context?.sessionId ?? null,
        context?.deviceId ?? null,
      ],
    );
  } catch (error) {
    log.error({ err: error, action: entry.action, entityType: entry.entityType }, 'audit write failed');
  }
}

/**
 * Blanket audit for mutating routes, recording the outcome after the response is
 * sent so it adds nothing to request latency.
 */
export const auditMutations =
  (entityType: string, actionPrefix = ''): RequestHandler =>
  (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      const action = `${actionPrefix || entityType}.${req.method.toLowerCase()}`;
      void recordAudit({
        action,
        entityType,
        entityId: (() => {
          const raw = req.params.id ?? req.params.uuid;
          return raw === undefined ? null : Array.isArray(raw) ? raw[0] ?? null : raw;
        })(),
        after: req.valid.body ?? undefined,
      });
    });

    next();
  };
