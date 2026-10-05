import { randomUUID } from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { encryptBytes, decryptBytes, packIp } from '../../core/security/crypto';
import { queryCount, queryOne, queryRows, execute, type Row } from '../../db/query';
import { recordAudit } from '../../middleware/audit';
import { storage } from '../../providers/storage';
import { getContext } from '../../core/context';
import { GDPR_COUNTRY_CODES, type PrivacyKind, type PrivacyRegulation } from './security.types';

const KIND_MAP: Record<string, PrivacyKind> = {
  export: 'export',
  access: 'export',
  disclosure: 'export',
  portability: 'portability',
  erasure: 'erasure',
  deletion: 'erasure',
  rectification: 'rectification',
  correction: 'rectification',
  restriction: 'restriction',
  opt_out: 'restriction',
};

export function resolvePrivacyKind(raw: string): PrivacyKind {
  const kind = KIND_MAP[raw];
  if (!kind) throw badRequest('Unsupported privacy request type');
  return kind;
}

export async function resolveRegulation(userId: number, requested?: PrivacyRegulation): Promise<PrivacyRegulation> {
  if (requested) return requested;
  const row = await queryOne<Row>(
    `SELECT c.iso2 AS iso2
       FROM users u
       LEFT JOIN countries c ON c.id = u.country_id
      WHERE u.id = ?`,
    [userId],
  );
  const iso2 = String(row?.iso2 ?? '').toUpperCase();
  if (GDPR_COUNTRY_CODES.has(iso2)) return 'gdpr';
  if (iso2 === 'US') return 'ccpa';
  return 'other';
}

export async function listConsents(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT c.consent_type, c.granted, c.document_version, c.created_at
       FROM user_consents c
       JOIN (
         SELECT consent_type, MAX(id) AS id
           FROM user_consents
          WHERE user_id = ?
          GROUP BY consent_type
       ) latest ON latest.id = c.id
      ORDER BY c.consent_type`,
    [userId],
  );
  return rows.map((row) => ({
    type: String(row.consent_type),
    granted: Number(row.granted) === 1,
    documentVersion: (row.document_version as string | null) ?? null,
    recordedAt: (row.created_at as Date).toISOString(),
  }));
}

export async function recordConsent(
  userId: number,
  consentType: string,
  granted: boolean,
  documentVersion?: string | null,
) {
  const context = getContext();
  await execute(
    `INSERT INTO user_consents (user_id, consent_type, granted, document_version, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      userId,
      consentType,
      granted ? 1 : 0,
      documentVersion?.slice(0, 24) ?? null,
      packIp(context?.ip),
      context?.userAgent?.slice(0, 512) ?? null,
    ],
  );
  void recordAudit({
    action: granted ? 'privacy.consent_granted' : 'privacy.consent_withdrawn',
    entityType: 'user_consent',
    entityId: userId,
    after: { consentType, granted },
  });
  return listConsents(userId);
}

export async function listPrivacyRequests(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT uuid, kind, regulation, status, requested_at, due_at, completed_at, notes
       FROM data_subject_requests
      WHERE user_id = ?
      ORDER BY requested_at DESC
      LIMIT 50`,
    [userId],
  );
  return rows.map(mapRequest);
}

export async function createPrivacyRequest(params: {
  userId: number;
  kind: string;
  regulation?: PrivacyRegulation;
  notes?: string;
  fields?: Record<string, unknown>;
}) {
  const kind = resolvePrivacyKind(params.kind);
  const regulation = await resolveRegulation(params.userId, params.regulation);
  const open = await queryOne<Row>(
    `SELECT uuid FROM data_subject_requests
      WHERE user_id = ? AND kind = ? AND status IN ('pending','in_progress')
      LIMIT 1`,
    [params.userId, kind],
  );
  if (open) {
    throw conflict('A similar privacy request is already in progress');
  }

  const uuid = randomUUID();
  const dueDays = regulation === 'ccpa' ? 45 : 30;
  const notes = JSON.stringify({
    message: params.notes ?? null,
    fields: params.fields ?? null,
    systems: ['users', 'profiles', 'listings', 'orders', 'consents', 'sessions', 'devices', 'audit'],
  }).slice(0, 500);

  await execute(
    `INSERT INTO data_subject_requests
       (uuid, user_id, kind, regulation, status, due_at, notes)
     VALUES (?, ?, ?, ?, 'pending', DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? DAY), ?)`,
    [uuid, params.userId, kind, regulation, dueDays, notes],
  );

  void recordAudit({
    action: 'privacy.request_created',
    entityType: 'data_subject_request',
    entityId: uuid,
    after: { kind, regulation },
  });

  if (kind === 'export' || kind === 'portability' || kind === 'rectification' || kind === 'erasure' || kind === 'restriction') {
    await processPrivacyRequest(uuid);
  }

  return getPrivacyRequest(params.userId, uuid, false);
}

export async function getPrivacyRequest(userId: number, uuid: string, staff: boolean) {
  const row = await queryOne<Row>(
    `SELECT * FROM data_subject_requests WHERE uuid = ?`,
    [uuid],
  );
  if (!row) throw notFound('Privacy request');
  if (!staff && Number(row.user_id) !== userId) throw forbidden();
  return mapRequest(row);
}

export async function downloadPrivacyExport(userId: number, uuid: string, staff: boolean) {
  const row = await queryOne<Row>(
    `SELECT * FROM data_subject_requests WHERE uuid = ?`,
    [uuid],
  );
  if (!row) throw notFound('Privacy request');
  if (!staff && Number(row.user_id) !== userId) throw forbidden();
  if (String(row.kind) !== 'export' && String(row.kind) !== 'portability') {
    throw badRequest('This request is not an export');
  }
  const path = String(row.export_url ?? '');
  if (!path) throw notFound('Export file');
  const stored = await storage.read(path);
  try {
    return decryptBytes(stored);
  } catch {
    return stored;
  }
}

export async function processPrivacyRequest(uuid: string): Promise<void> {
  const row = await queryOne<Row>(`SELECT * FROM data_subject_requests WHERE uuid = ?`, [uuid]);
  if (!row) return;
  if (!['pending', 'in_progress'].includes(String(row.status))) return;

  await execute(`UPDATE data_subject_requests SET status = 'in_progress' WHERE id = ?`, [row.id]);
  const userId = Number(row.user_id);
  const kind = String(row.kind) as PrivacyKind;

  try {
    if (kind === 'export' || kind === 'portability') {
      const payload = await buildExport(userId);
      const encrypted = encryptBytes(Buffer.from(JSON.stringify(payload), 'utf8'));
      const storagePath = `document/${userId}/privacy-export-${uuid}.bin`;
      await storage.put(storagePath, encrypted, 'application/octet-stream');
      await execute(
        `UPDATE data_subject_requests
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP, export_url = ?
          WHERE id = ?`,
        [storagePath, row.id],
      );
      void recordAudit({ action: 'privacy.export_completed', entityType: 'data_subject_request', entityId: uuid, actorType: 'job' });
      return;
    }

    if (kind === 'erasure') {
      await eraseUser(userId);
      await execute(
        `UPDATE data_subject_requests SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [row.id],
      );
      void recordAudit({ action: 'privacy.erasure_completed', entityType: 'data_subject_request', entityId: uuid, actorType: 'job' });
      return;
    }

    if (kind === 'restriction') {
      await recordConsent(userId, 'marketing_email', false);
      await recordConsent(userId, 'marketing_sms', false);
      await recordConsent(userId, 'marketing_push', false);
      await recordConsent(userId, 'cookies_ads', false);
      await execute(
        `UPDATE data_subject_requests SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [row.id],
      );
      void recordAudit({ action: 'privacy.restriction_completed', entityType: 'data_subject_request', entityId: uuid, actorType: 'job' });
      return;
    }

    if (kind === 'rectification') {
      await execute(
        `UPDATE data_subject_requests
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
                notes = LEFT(CONCAT(COALESCE(notes, ''), ' | Correct fields via profile APIs'), 500)
          WHERE id = ?`,
        [row.id],
      );
    }
  } catch (error) {
    await execute(
      `UPDATE data_subject_requests SET status = 'pending', notes = LEFT(CONCAT(COALESCE(notes,''), ' | process_error'), 500) WHERE id = ?`,
      [row.id],
    );
    throw error;
  }
}

export async function processDuePrivacyRequests(limit = 20): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT uuid FROM data_subject_requests
      WHERE status IN ('pending','in_progress')
      ORDER BY requested_at ASC
      LIMIT ?`,
    [limit],
  );
  for (const row of rows) {
    await processPrivacyRequest(String(row.uuid)).catch(() => undefined);
  }
  return rows.length;
}

export async function staffListPrivacyRequests(page: number, perPage: number, status?: string) {
  const offset = (page - 1) * perPage;
  const filter = status ? 'WHERE status = ?' : '';
  const params: unknown[] = status ? [status, perPage, offset] : [perPage, offset];
  const rows = await queryRows<Row>(
    `SELECT r.*, u.email, u.username
       FROM data_subject_requests r
       JOIN users u ON u.id = r.user_id
      ${filter}
      ORDER BY r.requested_at DESC
      LIMIT ? OFFSET ?`,
    params,
  );
  const total = await queryCount(
    `SELECT COUNT(*) FROM data_subject_requests ${status ? 'WHERE status = ?' : ''}`,
    status ? [status] : [],
  );
  return {
    items: rows.map((row) => ({
      ...mapRequest(row),
      email: (row.email as string | null) ?? null,
      username: (row.username as string | null) ?? null,
    })),
    total,
  };
}

export async function staffDecidePrivacyRequest(uuid: string, actorId: number, status: 'completed' | 'rejected' | 'in_progress', notes?: string) {
  const row = await queryOne<Row>(`SELECT * FROM data_subject_requests WHERE uuid = ?`, [uuid]);
  if (!row) throw notFound('Privacy request');
  if (status === 'completed' && ['export', 'portability', 'erasure', 'restriction'].includes(String(row.kind))) {
    await processPrivacyRequest(uuid);
  } else {
    await execute(
      `UPDATE data_subject_requests
          SET status = ?, handled_by = ?, notes = COALESCE(?, notes),
              completed_at = IF(? IN ('completed','rejected'), CURRENT_TIMESTAMP, completed_at)
        WHERE uuid = ?`,
      [status, actorId, notes ?? null, status, uuid],
    );
  }
  void recordAudit({
    action: 'privacy.request_decided',
    entityType: 'data_subject_request',
    entityId: uuid,
    after: { status },
  });
  return getPrivacyRequest(Number(row.user_id), uuid, true);
}

async function buildExport(userId: number) {
  const [user, profile, consents, sessions, devices, listings, roles] = await Promise.all([
    queryOne<Row>(
      `SELECT uuid, email, phone_e164, username, status, language, currency, timezone, created_at
         FROM users WHERE id = ?`,
      [userId],
    ),
    queryOne<Row>(`SELECT display_name, first_name, last_name, bio, website FROM user_profiles WHERE user_id = ?`, [userId]),
    listConsents(userId),
    queryRows<Row>(
      `SELECT uuid, login_method, created_at, last_used_at, revoked_at FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [userId],
    ),
    queryRows<Row>(
      `SELECT uuid, device_name, device_model, os_version, last_seen_at FROM user_devices WHERE user_id = ? LIMIT 50`,
      [userId],
    ),
    queryRows<Row>(
      `SELECT uuid, title, status, lifecycle_status, created_at FROM listings WHERE user_id = ? AND deleted_at IS NULL LIMIT 200`,
      [userId],
    ),
    queryRows<Row>(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
      [userId],
    ),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    subject: {
      uuid: user?.uuid ?? null,
      email: user?.email ?? null,
      phone: user?.phone_e164 ?? null,
      username: user?.username ?? null,
      status: user?.status ?? null,
      language: user?.language ?? null,
      currency: user?.currency ?? null,
      timezone: user?.timezone ?? null,
      createdAt: user?.created_at ?? null,
    },
    profile,
    consents,
    roles: roles.map((row) => String(row.code)),
    sessions: sessions.map(sanitizeRow),
    devices: devices.map(sanitizeRow),
    listings: listings.map(sanitizeRow),
  };
}

async function eraseUser(userId: number): Promise<void> {
  const marker = `deleted_${userId}_${Date.now()}`;
  await execute(
    `UPDATE user_sessions
        SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'privacy_erasure'
      WHERE user_id = ? AND revoked_at IS NULL`,
    [userId],
  );
  await execute(
    `UPDATE users
        SET email = NULL,
            phone_country_code = NULL,
            phone_number = NULL,
            phone_e164 = NULL,
            username = ?,
            password_hash = NULL,
            status = 'deleted',
            deleted_at = CURRENT_TIMESTAMP,
            status_reason = 'privacy_erasure'
      WHERE id = ? AND deleted_at IS NULL`,
    [marker.slice(0, 64), userId],
  );
  await execute(
    `UPDATE user_profiles
        SET display_name = 'Deleted user',
            first_name = NULL,
            last_name = NULL,
            bio = NULL,
            avatar_url = NULL,
            cover_url = NULL,
            date_of_birth = NULL,
            address_line1 = NULL,
            address_line2 = NULL,
            website = NULL,
            whatsapp = NULL
      WHERE user_id = ?`,
    [userId],
  );
}

function mapRequest(row: Row) {
  return {
    uuid: String(row.uuid),
    kind: String(row.kind),
    regulation: String(row.regulation),
    status: String(row.status),
    requestedAt: (row.requested_at as Date).toISOString(),
    dueAt: row.due_at ? (row.due_at as Date).toISOString() : null,
    completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : null,
    hasExport: Boolean(row.export_url),
    notes: typeof row.notes === 'string' ? row.notes : null,
  };
}

function sanitizeRow(row: Row): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (/password|token|secret|hash/i.test(key)) continue;
    output[key] = value instanceof Date ? value.toISOString() : value;
  }
  return output;
}

export const privacyApplicability = (iso2: string | null) => ({
  gdpr: Boolean(iso2 && GDPR_COUNTRY_CODES.has(iso2.toUpperCase())),
  ccpa: iso2?.toUpperCase() === 'US',
  iso2,
});
