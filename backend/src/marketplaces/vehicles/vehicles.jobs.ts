import { execute, queryRows, type Row } from '../../db/query';
import { loggerFor } from '../../config/logger';
import { notifyUser } from '../../modules/notifications/notify';
import { protectVehicleDocuments } from './vehicles.documents';
import { expireVehicleOffers } from './vehicles.offers';
import { expireRentalBookings } from './vehicles.rental';
import { analyseVehicleRisk } from './vehicles.fraud';
import { analyseListingImages, assessListingQuality, refreshListingValuation } from './vehicles.ai';
import { pollShipments } from './vehicles.trade';
import { VEHICLE_MARKETPLACE_ID } from './vehicles.rules';

const log = loggerFor('vehicles.jobs');

export async function runVehicleMaintenance(): Promise<{
  documents: number;
  offers: number;
  bookings: number;
  reminders: number;
}> {
  const documents = await protectVehicleDocuments();
  const offers = await expireVehicleOffers();
  const bookings = await expireRentalBookings();
  const reminders = await sendReminders();
  log.info({ documents, offers, bookings, reminders }, 'vehicle maintenance');
  return { documents, offers, bookings, reminders };
}

export async function onVehiclePublished(listingId: number): Promise<void> {
  await protectVehicleDocuments();
  await assessListingQuality(listingId).catch((error) => log.warn({ err: error, listingId }, 'quality skipped'));
  await analyseListingImages(listingId).catch((error) => log.warn({ err: error, listingId }, 'image ai skipped'));
  await refreshListingValuation(listingId).catch((error) => log.warn({ err: error, listingId }, 'valuation skipped'));
  await analyseVehicleRisk(listingId).catch((error) => log.warn({ err: error, listingId }, 'risk skipped'));
  await matchSavedSearches(listingId).catch((error) => log.warn({ err: error, listingId }, 'saved search skipped'));
}

export async function matchSavedSearches(listingId: number): Promise<number> {
  const listing = await queryRows<Row>(
    `SELECT l.id, l.marketplace_id, l.operation, l.price, l.currency, l.city_id, l.title,
            vd.vehicle_type, vd.make_id, vd.model_id, vd.year, vd.mileage_km, vd.fuel_type
       FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ?`,
    [listingId],
  );
  if (listing.length === 0) return 0;
  const item = listing[0]!;
  const searches = await queryRows<Row>(
    `SELECT id, user_id, name, query FROM saved_searches
      WHERE is_active = 1 AND alert_frequency IN ('instant','daily')
        AND (marketplace_id = ${VEHICLE_MARKETPLACE_ID} OR marketplace_id IS NULL)
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
      categoryCode: 'vehicle.search',
      title: 'New vehicle match',
      body: `${String(item.title)} matches “${String(search.name)}”.`,
      actionType: 'listing',
      actionTarget: String(listingId),
      data: { listingId, savedSearchId: Number(search.id), name: String(search.name), title: String(item.title) },
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

function matches(query: Record<string, unknown>, item: Row): boolean {
  if (query.operation && String(query.operation) !== String(item.operation)) return false;
  if (query.vehicleType && String(query.vehicleType) !== String(item.vehicle_type)) return false;
  if (query.makeId && Number(query.makeId) !== Number(item.make_id)) return false;
  if (query.modelId && Number(query.modelId) !== Number(item.model_id)) return false;
  if (query.fuelType && String(query.fuelType) !== String(item.fuel_type)) return false;
  if (query.yearMin && Number(item.year ?? 0) < Number(query.yearMin)) return false;
  if (query.yearMax && Number(item.year ?? 9999) > Number(query.yearMax)) return false;
  if (query.mileageMax && Number(item.mileage_km ?? 0) > Number(query.mileageMax)) return false;
  if (query.priceMax && Number(item.price ?? 0) > Number(query.priceMax)) return false;
  return true;
}

async function sendReminders(): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT v.id, v.owner_user_id, r.expires_at
       FROM vehicle_registrations r
       JOIN vehicles v ON v.id = r.vehicle_id
      WHERE r.expires_at IS NOT NULL
        AND r.expires_at BETWEEN CURRENT_DATE AND DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY)
      LIMIT 100`,
  );
  for (const row of rows) {
    await notifyUser({
      userId: Number(row.owner_user_id),
      categoryCode: 'vehicle.reminder',
      title: 'Registration reminder',
      body: 'A vehicle registration is due within 30 days. Confirm locally — this is not a legal notice.',
      actionType: 'listing',
      actionTarget: String(row.id),
    });
  }
  return rows.length;
}

export async function rollupVehicleAnalytics(): Promise<number> {
  const result = await execute(
    `INSERT INTO vehicle_analytics_daily (listing_id, day, views, unique_visitors, favorites, leads, offers)
     SELECT l.id, CURRENT_DATE, l.view_count, l.unique_view_count, l.favorite_count, l.lead_count,
            (SELECT COUNT(*) FROM listing_offers o WHERE o.listing_id = l.id)
       FROM listings l
      WHERE l.marketplace_id = ${VEHICLE_MARKETPLACE_ID} AND l.deleted_at IS NULL
        AND l.status IN ('published','reserved','sold','rented')
     ON DUPLICATE KEY UPDATE
       views = VALUES(views),
       unique_visitors = VALUES(unique_visitors),
       favorites = VALUES(favorites),
       leads = VALUES(leads),
       offers = VALUES(offers)`,
  );
  return result.affectedRows;
}

export async function trackVehicleShipments(): Promise<number> {
  return pollShipments();
}
