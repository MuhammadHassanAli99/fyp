import { execute, queryRows, type Row } from '../../db/query';
import { eventBus, type DomainEvent } from '../../core/events/event-bus';
import { loggerFor } from '../../config/logger';
import { expireDueListings, markExpiringListings } from './listings.engine';
import { expirePromotions } from './listings.promotions';
import { rollupListingAnalytics } from './listings.analytics';
import { reindexPending } from './listings.search-index';
import { matchListingToSavedSearches } from '../search/search.saved';
import type { DomainEventName, DomainEventPayloads } from '../../core/events/domain-events';

const log = loggerFor('listings.jobs');

export async function runListingExpiry(): Promise<number> {
  const expired = await expireDueListings();
  const expiring = await markExpiringListings();
  return expired + expiring;
}

export async function runPromotionExpiry(): Promise<number> {
  return expirePromotions();
}

export async function runAnalyticsRollup(): Promise<number> {
  return rollupListingAnalytics();
}

export async function runSearchReindex(): Promise<number> {
  return reindexPending();
}

export async function processOutbox(limit = 50): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT event_id, event_name, aggregate_type, aggregate_id, payload, created_at
       FROM outbox_events
      WHERE status = 'pending' AND available_at <= CURRENT_TIMESTAMP
      ORDER BY id
      LIMIT ?`,
    [limit],
  );
  if (rows.length === 0) return 0;

  const ids = rows.map((row) => String(row.event_id));
  await execute(
    `UPDATE outbox_events SET status = 'processing' WHERE event_id IN (${ids.map(() => '?').join(', ')}) AND status = 'pending'`,
    ids,
  );

  let processed = 0;
  for (const row of rows) {
    const event: DomainEvent<DomainEventName> = {
      id: String(row.event_id),
      name: String(row.event_name) as DomainEventName,
      aggregateType: String(row.aggregate_type),
      aggregateId: String(row.aggregate_id),
      payload: (typeof row.payload === 'object' && row.payload
        ? row.payload
        : JSON.parse(String(row.payload ?? '{}'))) as DomainEventPayloads[DomainEventName],
      occurredAt: row.created_at as Date,
    };
    try {
      await eventBus.dispatch(event);
      processed += 1;
    } catch (error) {
      log.warn({ err: error, eventId: event.id, name: event.name }, 'outbox dispatch failed');
    }
  }
  return processed;
}

export async function matchSavedSearches(limit = 20): Promise<number> {
  const listings = await queryRows<Row>(
    `SELECT l.id
       FROM listings l
      WHERE l.lifecycle_status = 'published'
        AND l.published_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE)
        AND l.deleted_at IS NULL
      ORDER BY l.published_at DESC
      LIMIT ?`,
    [limit],
  );
  let matched = 0;
  for (const listing of listings) {
    matched += await matchListingToSavedSearches(Number(listing.id));
  }
  return matched;
}
