import { execute, queryRows, type Row } from '../../db/query';
import { loggerFor } from '../../config/logger';
import { notifyUser } from '../../modules/notifications/notify';
import { protectPropertyDocuments } from './property.documents';
import { expireDueOffers } from './property.offers';
import { expireLeasesAndBookings, remindDueRent, scheduleNextRent } from './property.rental';
import { analysePropertyRisk } from './property.fraud';
import { analyseListingImages, assessListingQuality, refreshListingValuation } from './property.ai';

const log = loggerFor('property.jobs');

export async function runPropertyMaintenance(): Promise<{
  documents: number;
  offers: number;
  leases: number;
  bookings: number;
  rentReminders: number;
}> {
  const documents = await protectPropertyDocuments();
  const offers = await expireDueOffers();
  const expired = await expireLeasesAndBookings();
  const rentReminders = await remindDueRent();
  log.info({ documents, offers, ...expired, rentReminders }, 'property maintenance');
  return { documents, offers, leases: expired.leases, bookings: expired.bookings, rentReminders };
}

export async function onPropertyPublished(listingId: number): Promise<void> {
  await protectPropertyDocuments();
  await assessListingQuality(listingId).catch((error) => log.warn({ err: error, listingId }, 'quality skipped'));
  await analyseListingImages(listingId).catch((error) => log.warn({ err: error, listingId }, 'image ai skipped'));
  await refreshListingValuation(listingId).catch((error) => log.warn({ err: error, listingId }, 'valuation skipped'));
  await analysePropertyRisk(listingId).catch((error) => log.warn({ err: error, listingId }, 'risk skipped'));
  await matchSavedSearches(listingId).catch((error) => log.warn({ err: error, listingId }, 'saved search skipped'));
}

export async function matchSavedSearches(listingId: number): Promise<number> {
  const listing = await queryRows<Row>(
    `SELECT l.id, l.marketplace_id, l.operation, l.price, l.currency, l.city_id, l.title,
            pd.property_kind, pd.bedrooms, pd.area_sqm
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
      WHERE l.id = ?`,
    [listingId],
  );
  if (listing.length === 0) return 0;
  const item = listing[0]!;
  const searches = await queryRows<Row>(
    `SELECT id, user_id, name, query FROM saved_searches
      WHERE is_active = 1 AND alert_frequency IN ('instant','daily')
        AND (marketplace_id = 2 OR marketplace_id IS NULL)
      LIMIT 500`,
  );
  let matched = 0;
  for (const search of searches) {
    const query = parseQuery(search.query);
    if (!matches(query, item)) continue;
    await execute(
      `INSERT IGNORE INTO saved_search_matches (saved_search_id, listing_id) VALUES (?, ?)`,
      [Number(search.id), listingId],
    );
    await notifyUser({
      userId: Number(search.user_id),
      categoryCode: 'property.search',
      title: 'New property match',
      body: `${String(item.title)} matches “${String(search.name)}”.`,
      actionType: 'listing',
      actionTarget: String(listingId),
      data: { listingId, savedSearchId: Number(search.id) },
    });
    matched += 1;
  }
  return matched;
}

function parseQuery(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function matches(query: Record<string, unknown>, listing: Row): boolean {
  if (query.operation && String(query.operation) !== String(listing.operation)) return false;
  if (query.propertyKind && String(query.propertyKind) !== String(listing.property_kind)) return false;
  if (query.cityId && Number(query.cityId) !== Number(listing.city_id)) return false;
  if (query.bedroomsMin && Number(listing.bedrooms ?? 0) < Number(query.bedroomsMin)) return false;
  if (query.priceMin && Number(listing.price ?? 0) < Number(query.priceMin)) return false;
  if (query.priceMax && Number(listing.price ?? 0) > Number(query.priceMax)) return false;
  return true;
}

export async function rollupPropertyAnalytics(): Promise<number> {
  const result = await execute(
    `INSERT INTO property_analytics_daily (listing_id, day, views, unique_visitors, favorites, leads)
     SELECT l.id, CURRENT_DATE,
            l.view_count, l.unique_view_count, l.favorite_count, l.lead_count
       FROM listings l
      WHERE l.marketplace_id = 2 AND l.deleted_at IS NULL
        AND l.status IN ('published','reserved','sold','rented')
     ON DUPLICATE KEY UPDATE
       views = VALUES(views),
       unique_visitors = VALUES(unique_visitors),
       favorites = VALUES(favorites),
       leads = VALUES(leads)`,
  );
  return result.affectedRows;
}

export async function advanceLeaseSchedules(): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id FROM property_leases
      WHERE status = 'active' AND next_due_date IS NOT NULL AND next_due_date <= CURRENT_DATE`,
  );
  for (const row of rows) {
    await scheduleNextRent(Number(row.id)).catch((error) => log.warn({ err: error }, 'lease schedule skipped'));
  }
  return rows.length;
}
