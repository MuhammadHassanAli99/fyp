import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import type { KycStatus } from './risk.types';

export async function getKyc(userId: number) {
  const row = await queryOne<Row>(`SELECT * FROM kyc_records WHERE user_id = ?`, [userId]);
  return {
    status: ((row?.status as KycStatus | undefined) ?? 'not_started') as KycStatus,
    level: (row?.level as string | undefined) ?? 'none',
    provider: (row?.provider as string | null) ?? null,
    verifiedAt: row?.verified_at ? (row.verified_at as Date).toISOString() : null,
    expiresAt: row?.expires_at ? (row.expires_at as Date).toISOString() : null,
  };
}

export async function syncKycFromVerification(params: {
  userId: number;
  decision: 'approved' | 'rejected' | 'revoked' | 'action_required';
  docType: string;
}): Promise<void> {
  const level =
    params.docType === 'passport' || params.docType === 'government_id'
      ? 'standard'
      : params.docType === 'business_license'
        ? 'enhanced'
        : 'basic';
  const status: KycStatus =
    params.decision === 'approved'
      ? 'verified'
      : params.decision === 'rejected'
        ? 'rejected'
        : params.decision === 'revoked'
          ? 'requires_update'
          : 'in_review';

  await execute(
    `INSERT INTO kyc_records (user_id, level, status, provider, verified_at)
     VALUES (?, ?, ?, 'internal', IF(? = 'verified', CURRENT_TIMESTAMP, NULL))
     ON DUPLICATE KEY UPDATE
       level = VALUES(level),
       status = VALUES(status),
       provider = 'internal',
       verified_at = IF(VALUES(status) = 'verified', CURRENT_TIMESTAMP, verified_at)`,
    [params.userId, level, status, status],
  );
}

export async function listKycQueue(limit = 50) {
  return queryRows<Row>(
    `SELECT k.id, k.user_id, k.level, k.status, k.provider, k.created_at, k.verified_at
       FROM kyc_records k
      WHERE k.status IN ('pending','in_review','requires_update')
      ORDER BY k.created_at ASC
      LIMIT ?`,
    [limit],
  );
}

export { insertAndGetId, uuid };
