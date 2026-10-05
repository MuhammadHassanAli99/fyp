import { execute, insertAndGetId, queryOne, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { env } from '../../config/env';
import { notFound } from '../../core/errors';

export type ShareTargetType = 'listing' | 'favorite' | 'collection' | 'comparison';

export interface ShareTokenRecord {
  id: number;
  token: string;
  ownerUserId: number;
  targetType: ShareTargetType;
  targetId: number;
  accessPolicy: 'public' | 'restricted';
  expiresAt: string | null;
  url: string;
}

export function publicShareUrl(token: string): string {
  return `${env.WEB_URL.replace(/\/$/, '')}/share/${token}`;
}

export async function createShareToken(params: {
  ownerUserId: number;
  targetType: ShareTargetType;
  targetId: number;
  accessPolicy?: 'public' | 'restricted';
  expiresAt?: Date | null;
  token?: string;
}): Promise<ShareTokenRecord> {
  const existing = await queryOne<Row>(
    `SELECT * FROM share_tokens
      WHERE owner_user_id = ? AND target_type = ? AND target_id = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY id DESC LIMIT 1`,
    [params.ownerUserId, params.targetType, params.targetId],
  );
  if (existing && !params.token) {
    return mapToken(existing);
  }

  const token = params.token ?? uuid();
  const id = await insertAndGetId(
    `INSERT INTO share_tokens (token, owner_user_id, target_type, target_id, access_policy, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      token,
      params.ownerUserId,
      params.targetType,
      params.targetId,
      params.accessPolicy ?? 'public',
      params.expiresAt ?? null,
    ],
  );
  const row = await queryOne<Row>('SELECT * FROM share_tokens WHERE id = ?', [id]);
  return mapToken(row!);
}

export async function revokeShareTokens(targetType: ShareTargetType, targetId: number, ownerUserId: number): Promise<void> {
  await execute(
    `UPDATE share_tokens SET revoked_at = CURRENT_TIMESTAMP
      WHERE target_type = ? AND target_id = ? AND owner_user_id = ? AND revoked_at IS NULL`,
    [targetType, targetId, ownerUserId],
  );
}

export async function loadActiveShareToken(token: string): Promise<Row> {
  const row = await queryOne<Row>(
    `SELECT * FROM share_tokens
      WHERE token = ? AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    [token],
  );
  if (!row) throw notFound('Share link');
  await execute('UPDATE share_tokens SET view_count = view_count + 1 WHERE id = ?', [row.id]);
  return row;
}

export function mapToken(row: Row): ShareTokenRecord {
  const token = String(row.token);
  return {
    id: Number(row.id),
    token,
    ownerUserId: Number(row.owner_user_id),
    targetType: row.target_type as ShareTargetType,
    targetId: Number(row.target_id),
    accessPolicy: row.access_policy as 'public' | 'restricted',
    expiresAt: row.expires_at ? (row.expires_at as Date).toISOString() : null,
    url: publicShareUrl(token),
  };
}
