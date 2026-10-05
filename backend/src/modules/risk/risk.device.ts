import { execute, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import type { DeviceState } from './risk.types';

export function nextDeviceState(input: {
  current: string;
  isNew: boolean;
  riskScore: number;
  trusted: boolean;
}): DeviceState {
  if (input.current === 'blocked' || input.current === 'revoked' || input.current === 'retired') {
    return input.current as DeviceState;
  }
  if (input.riskScore >= 90) return 'blocked';
  if (input.riskScore >= 65) return 'suspicious';
  if (input.trusted || input.current === 'trusted') return 'trusted';
  if (input.isNew) return 'first_seen';
  return 'active';
}

export async function applyDeviceState(deviceId: number, state: DeviceState, riskScore: number): Promise<void> {
  await execute(`UPDATE user_devices SET status = ?, risk_score = ? WHERE id = ?`, [state, Math.round(riskScore), deviceId]);
}

export async function listUserDevices(userId: number) {
  return queryRows<Row>(
    `SELECT d.id, d.uuid, d.status, d.risk_score, d.is_trusted, d.is_rooted, d.is_jailbroken, d.is_emulator,
            d.first_seen_at, d.last_seen_at, d.device_model, d.os_version, p.code AS platform
       FROM user_devices d
       LEFT JOIN platforms p ON p.id = d.platform_id
      WHERE d.user_id = ?
      ORDER BY d.last_seen_at DESC`,
    [userId],
  );
}

export async function deviceCount(userId: number): Promise<number> {
  return queryCount(
    `SELECT COUNT(*) FROM user_devices WHERE user_id = ? AND status IN ('first_seen','active','trusted','suspicious')`,
    [userId],
  );
}

export async function markDeviceFirstSeen(deviceId: number): Promise<boolean> {
  const row = await queryOne<Row>('SELECT login_count, status FROM user_devices WHERE id = ?', [deviceId]);
  if (!row) return false;
  if (Number(row.login_count ?? 0) <= 1 && row.status === 'active') {
    await execute(`UPDATE user_devices SET status = 'first_seen' WHERE id = ?`, [deviceId]);
    return true;
  }
  return false;
}

export { uuid };
