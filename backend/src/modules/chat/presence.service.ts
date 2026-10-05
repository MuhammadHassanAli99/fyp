import { cache, cacheKeys } from '../../config/cache';
import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { loggerFor } from '../../config/logger';
import type { PresenceStatus } from './chat.types';

const log = loggerFor('chat.presence');

const HEARTBEAT_TTL_SECONDS = 90;
const AWAY_AFTER_MS = 5 * 60_000;

export interface PresenceSnapshot {
  userId: number;
  status: PresenceStatus;
  lastSeenAt: string | null;
  visible: boolean;
}

interface PresenceRecord {
  status: PresenceStatus;
  lastSeenAt: number;
  sockets: number;
  visible: boolean;
  deviceId?: number | null;
}

/**
 * Distributed presence on top of the existing cache store.
 *
 * Heartbeats live in cache (in-memory today, Redis when REDIS_URL is wired).
 * `user_presence.last_seen_at` is written on transition to offline, not on
 * every ping — that is the "controlled way" the spec asks for.
 */
export async function heartbeat(userId: number, status: PresenceStatus = 'online', deviceId?: number | null) {
  const key = cacheKeys.presence(userId);
  const current = (await cache.get<PresenceRecord>(key)) ?? {
    status: 'offline' as PresenceStatus,
    lastSeenAt: Date.now(),
    sockets: 0,
    visible: true,
    deviceId: deviceId ?? null,
  };

  const next: PresenceRecord = {
    ...current,
    status,
    lastSeenAt: Date.now(),
    sockets: Math.max(1, current.sockets),
    deviceId: deviceId ?? current.deviceId ?? null,
  };
  await cache.set(key, next, HEARTBEAT_TTL_SECONDS);

  if (current.status === 'offline') {
    await persist(userId, status, deviceId ?? null);
  }
}

export async function socketConnected(userId: number, deviceId?: number | null) {
  const key = cacheKeys.presence(userId);
  const current = (await cache.get<PresenceRecord>(key)) ?? {
    status: 'offline' as PresenceStatus,
    lastSeenAt: Date.now(),
    sockets: 0,
    visible: true,
    deviceId: deviceId ?? null,
  };
  current.sockets += 1;
  current.status = 'online';
  current.lastSeenAt = Date.now();
  current.deviceId = deviceId ?? current.deviceId ?? null;
  await cache.set(key, current, HEARTBEAT_TTL_SECONDS);
  await persist(userId, 'online', current.deviceId ?? null);
}

export async function socketDisconnected(userId: number) {
  const key = cacheKeys.presence(userId);
  const current = await cache.get<PresenceRecord>(key);
  if (!current) {
    await persist(userId, 'offline', null);
    return;
  }
  current.sockets = Math.max(0, current.sockets - 1);
  current.lastSeenAt = Date.now();
  if (current.sockets === 0) {
    current.status = 'offline';
    await cache.del(key);
    await persist(userId, 'offline', current.deviceId ?? null);
    return;
  }
  await cache.set(key, current, HEARTBEAT_TTL_SECONDS);
}

export async function getPresence(userId: number): Promise<PresenceSnapshot> {
  const stored = await cache.get<PresenceRecord>(cacheKeys.presence(userId));
  if (stored) {
    const stale = Date.now() - stored.lastSeenAt > AWAY_AFTER_MS;
    const status: PresenceStatus = stored.status === 'online' && stale ? 'away' : stored.status;
    return {
      userId,
      status: stored.visible === false ? 'offline' : status,
      lastSeenAt: new Date(stored.lastSeenAt).toISOString(),
      visible: stored.visible !== false,
    };
  }

  const row = await queryOne<Row>(
    `SELECT status, last_seen_at, is_visible FROM user_presence WHERE user_id = ?`,
    [userId],
  );
  if (!row) {
    return { userId, status: 'offline', lastSeenAt: null, visible: true };
  }
  const visible = Number(row.is_visible) !== 0;
  const raw = String(row.status) === 'busy' ? 'away' : String(row.status);
  const status = (['online', 'away', 'offline'].includes(raw) ? raw : 'offline') as PresenceStatus;
  return {
    userId,
    status: visible ? status : 'offline',
    lastSeenAt: row.last_seen_at ? (row.last_seen_at as Date).toISOString() : null,
    visible,
  };
}

export async function getPresenceMap(userIds: number[]): Promise<Map<number, PresenceSnapshot>> {
  const unique = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))];
  const map = new Map<number, PresenceSnapshot>();
  await Promise.all(
    unique.map(async (id) => {
      map.set(id, await getPresence(id));
    }),
  );
  return map;
}

export async function setVisibility(userId: number, visible: boolean) {
  await execute(
    `INSERT INTO user_presence (user_id, status, last_seen_at, is_visible)
     VALUES (?, 'offline', CURRENT_TIMESTAMP, ?)
     ON DUPLICATE KEY UPDATE is_visible = VALUES(is_visible)`,
    [userId, visible ? 1 : 0],
  );
  const key = cacheKeys.presence(userId);
  const current = await cache.get<PresenceRecord>(key);
  if (current) {
    current.visible = visible;
    await cache.set(key, current, HEARTBEAT_TTL_SECONDS);
  }
}

async function persist(userId: number, status: PresenceStatus, deviceId: number | null): Promise<void> {
  try {
    const dbStatus = status === 'away' ? 'away' : status;
    await execute(
      `INSERT INTO user_presence (user_id, status, last_seen_at, is_visible, device_id)
       VALUES (?, ?, CURRENT_TIMESTAMP, 1, ?)
       ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         last_seen_at = VALUES(last_seen_at),
         device_id = COALESCE(VALUES(device_id), device_id)`,
      [userId, dbStatus, deviceId],
    );
  } catch (error) {
    log.debug({ err: error, userId }, 'presence persist skipped');
  }
}

export async function listOnlineAmong(userIds: number[]): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = await queryRows<Row>(
    `SELECT user_id FROM user_presence WHERE user_id IN (${userIds.map(() => '?').join(',')}) AND status IN ('online','away') AND is_visible = 1`,
    userIds,
  );
  const fromDb = new Set(rows.map((row) => Number(row.user_id)));
  const live: number[] = [];
  for (const id of userIds) {
    const cached = await cache.get<PresenceRecord>(cacheKeys.presence(id));
    if (cached && cached.sockets > 0 && cached.visible !== false) live.push(id);
    else if (fromDb.has(id)) live.push(id);
  }
  return live;
}
