import { sha256 } from '../../core/security/crypto';
import type { NotificationChannel } from './notifications.types';

export function buildIdempotencyKey(params: {
  eventId?: string | null;
  userId: number;
  categoryCode: string;
  channel?: NotificationChannel | 'inbox';
  entityId?: string | number | null;
}): string {
  const event = params.eventId?.trim() || `${params.categoryCode}:${params.entityId ?? 'none'}`;
  const channel = params.channel ?? 'inbox';
  return sha256(`${event}|${params.userId}|${params.categoryCode}|${channel}`).slice(0, 64);
}
