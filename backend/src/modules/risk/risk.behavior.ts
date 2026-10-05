import { execute, queryCount } from '../../db/query';
import { signalHit } from './risk.signals';
import type { RiskEventType, RiskSignalHit } from './risk.types';

const WINDOWS: Array<{ seconds: number; label: string }> = [
  { seconds: 60, label: '1m' },
  { seconds: 300, label: '5m' },
  { seconds: 3600, label: '1h' },
  { seconds: 86_400, label: '24h' },
  { seconds: 604_800, label: '7d' },
];

export async function bumpVelocity(params: {
  subjectKind: 'user' | 'ip' | 'device' | 'fingerprint';
  subjectId: string;
  action: string;
  threshold?: number;
}): Promise<void> {
  const hourStart = new Date();
  hourStart.setUTCMinutes(0, 0, 0);
  await execute(
    `INSERT INTO velocity_counters (subject_kind, subject_id, action, window_start, window_seconds, counter, threshold)
     VALUES (?, ?, ?, ?, 3600, 1, ?)
     ON DUPLICATE KEY UPDATE counter = counter + 1,
       breached_at = IF(threshold IS NOT NULL AND counter + 1 >= threshold AND breached_at IS NULL, CURRENT_TIMESTAMP, breached_at)`,
    [params.subjectKind, params.subjectId.slice(0, 96), params.action, hourStart, params.threshold ?? null],
  ).catch(() => undefined);
}

export async function recordBehavior(params: {
  userId?: number | null;
  deviceId?: number | null;
  action: string;
  targetType?: string | null;
  targetId?: number | null;
  ip?: Buffer | null;
}): Promise<void> {
  await execute(
    `INSERT INTO behavior_events (user_id, device_id, action, target_type, target_id, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      params.userId ?? null,
      params.deviceId ?? null,
      params.action.slice(0, 64),
      params.targetType ?? null,
      params.targetId ?? null,
      params.ip ?? null,
    ],
  ).catch(() => undefined);
}

export async function velocitySignals(userId: number | null, eventType: RiskEventType): Promise<RiskSignalHit[]> {
  if (!userId) return [];
  const signals: RiskSignalHit[] = [];
  const hourAgo = new Date(Date.now() - 3600 * 1000);

  if (eventType === 'LISTING_CREATED' || eventType === 'LISTING_SUBMITTED') {
    const count = await queryCount(
      `SELECT COUNT(*) FROM listings WHERE user_id = ? AND created_at >= ? AND deleted_at IS NULL`,
      [userId, hourAgo],
    );
    if (count >= 20) signals.push(await signalHit('listing_velocity', 18, `${count}/1h`, 'velocity'));
    else if (count >= 8) signals.push(await signalHit('listing_velocity', 10, `${count}/1h`, 'velocity'));
  }

  if (eventType === 'REVIEW_CREATED') {
    const count = await queryCount(`SELECT COUNT(*) FROM reviews WHERE reviewer_id = ? AND created_at >= ?`, [
      userId,
      hourAgo,
    ]);
    if (count >= 8) signals.push(await signalHit('review_velocity', 16, `${count}/1h`, 'velocity'));
  }

  if (eventType === 'AD_CLICK') {
    const count = await queryCount(
      `SELECT COUNT(*) FROM ad_clicks WHERE user_id = ? AND created_at >= ?`,
      [userId, hourAgo],
    ).catch(() => 0);
    if (count >= 30) signals.push(await signalHit('click_velocity', 24, `${count}/1h`, 'velocity'));
  }

  if (eventType === 'MESSAGE_SENT') {
    const count = await queryCount(
      `SELECT COUNT(*) FROM messages WHERE sender_id = ? AND created_at >= ?`,
      [userId, hourAgo],
    ).catch(() => 0);
    if (count >= 80) signals.push(await signalHit('message_velocity', 12, `${count}/1h`, 'velocity'));
  }

  if (eventType === 'FAVORITE_CREATED') {
    const count = await queryCount(`SELECT COUNT(*) FROM favorites WHERE user_id = ? AND created_at >= ?`, [
      userId,
      hourAgo,
    ]).catch(() => 0);
    if (count >= 60) signals.push(await signalHit('favorite_velocity', 8, `${count}/1h`, 'velocity'));
  }

  if (eventType === 'LOGIN_FAILED') {
    const count = await queryCount(
      `SELECT COUNT(*) FROM login_attempts WHERE user_id = ? AND succeeded = 0 AND created_at >= ?`,
      [userId, hourAgo],
    ).catch(() => 0);
    if (count >= 8) signals.push(await signalHit('recent_failures', 10, `${count}/1h`, 'behavior'));
  }

  return signals;
}

export { WINDOWS as BEHAVIOR_WINDOWS };
