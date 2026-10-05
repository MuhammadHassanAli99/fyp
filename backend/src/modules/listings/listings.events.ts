import type { PoolConnection } from '../../db/pool';
import { execute } from '../../db/query';
import type { ListingEventType } from './listings.lifecycle';

export async function recordListingEvent(
  listingId: number,
  eventType: ListingEventType,
  actor: { id: number | null; type: 'owner' | 'business' | 'moderator' | 'admin' | 'system' | 'job' | 'ai' | 'buyer' },
  payload: Record<string, unknown> | null,
  connection: PoolConnection,
): Promise<void> {
  await execute(
    `INSERT INTO listing_events (listing_id, event_type, actor_id, actor_type, payload)
     VALUES (?, ?, ?, ?, ?)`,
    [listingId, eventType, actor.id, actor.type, payload ? JSON.stringify(payload) : null],
    connection,
  );
}
