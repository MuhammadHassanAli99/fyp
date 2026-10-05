import { execute, queryRows, queryCount, type Row } from '../../db/query';
import { notFound } from '../../core/errors';
import { AuthEvent, recordAuthEvent } from './auth.security';

export async function listDevices(userId: number, currentDeviceId: number | null) {
  const rows = await queryRows<Row>(
    `SELECT d.id, d.uuid, d.installation_id, d.device_name, d.device_model, d.manufacturer, d.browser,
            d.os_version, d.app_version, d.login_count, d.status, d.risk_score, d.first_seen_at, d.last_seen_at,
            d.is_trusted, d.is_rooted, d.is_jailbroken, d.is_emulator, p.code AS platform,
            (SELECT COUNT(*) FROM user_sessions s WHERE s.device_id = d.id AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP) AS active_sessions
       FROM user_devices d
       LEFT JOIN platforms p ON p.id = d.platform_id
      WHERE d.user_id = ?
      ORDER BY d.last_seen_at DESC`,
    [userId],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    installationId: (row.installation_id as string | null) ?? null,
    isCurrent: currentDeviceId !== null && Number(row.id) === currentDeviceId,
    name: (row.device_name as string | null) ?? (row.device_model as string | null) ?? 'Device',
    model: (row.device_model as string | null) ?? null,
    manufacturer: (row.manufacturer as string | null) ?? null,
    browser: (row.browser as string | null) ?? null,
    platform: (row.platform as string | null) ?? null,
    osVersion: (row.os_version as string | null) ?? null,
    appVersion: (row.app_version as string | null) ?? null,
    loginCount: Number(row.login_count ?? 0),
    status: String(row.status ?? 'active'),
    riskScore: Number(row.risk_score ?? 0),
    trusted: row.is_trusted === 1,
    integrity: {
      rooted: row.is_rooted === 1,
      jailbroken: row.is_jailbroken === 1,
      emulator: row.is_emulator === 1,
    },
    activeSessions: Number(row.active_sessions ?? 0),
    firstSeenAt: (row.first_seen_at as Date).toISOString(),
    lastSeenAt: (row.last_seen_at as Date).toISOString(),
  }));
}

export async function revokeDevice(userId: number, deviceUuid: string): Promise<{ revokedSessions: number }> {
  const devices = await queryRows<Row>('SELECT id FROM user_devices WHERE uuid = ? AND user_id = ?', [deviceUuid, userId]);
  const device = devices[0];
  if (!device) throw notFound('Device');

  await execute(`UPDATE user_devices SET status = 'revoked' WHERE id = ?`, [device.id]);
  const sessions = await execute(
    `UPDATE user_sessions
        SET revoked_at = CURRENT_TIMESTAMP, logged_out_at = CURRENT_TIMESTAMP, revoked_reason = 'device_revoked'
      WHERE device_id = ? AND user_id = ? AND revoked_at IS NULL`,
    [device.id, userId],
  );
  void recordAuthEvent({
    type: AuthEvent.DEVICE_REMOVED,
    userId,
    deviceId: Number(device.id),
    metadata: { revokedSessions: sessions.affectedRows },
  });
  void recordAuthEvent({ type: AuthEvent.SESSION_REVOKED, userId, deviceId: Number(device.id) });
  return { revokedSessions: sessions.affectedRows };
}

export async function deviceAccountRelationships(userId: number) {
  const accountsOnSharedDevices = await queryRows<Row>(
    `SELECT fu.fingerprint_hash, fu.user_id, fu.session_count, fu.last_seen_at,
            df.distinct_user_count, df.risk_score
       FROM fingerprint_users mine
       JOIN fingerprint_users fu ON fu.fingerprint_hash = mine.fingerprint_hash
       LEFT JOIN device_fingerprints df ON df.fingerprint_hash = mine.fingerprint_hash
      WHERE mine.user_id = ?
      ORDER BY fu.last_seen_at DESC`,
    [userId],
  );

  const myDevices = await queryCount('SELECT COUNT(*) FROM user_devices WHERE user_id = ? AND status = \'active\'', [userId]);
  const sharedFingerprints = new Set(
    accountsOnSharedDevices.filter((row) => Number(row.distinct_user_count ?? 0) > 1).map((row) => String(row.fingerprint_hash)),
  );

  return {
    deviceCount: myDevices,
    sharedInstallationCount: sharedFingerprints.size,
    relatedAccounts: accountsOnSharedDevices
      .filter((row) => Number(row.user_id) !== userId)
      .map((row) => ({
        userId: Number(row.user_id),
        fingerprint: String(row.fingerprint_hash).slice(0, 8),
        sessionCount: Number(row.session_count),
        lastSeenAt: (row.last_seen_at as Date).toISOString(),
        distinctUserCount: Number(row.distinct_user_count ?? 0),
      })),
    note: 'Multiple accounts on one installation is a risk signal, not automatic fraud.',
  };
}
