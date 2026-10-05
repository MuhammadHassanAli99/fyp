import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { toJson } from '../../db/sql';
import { sha256 } from '../../core/security/crypto';
import { notifyUser } from '../notifications/notify';
import { searchQueryHash, validateSearchQuery, type SearchQuery } from './search.dsl';
import { retrieveAndRank } from './search.engine';

export interface SavedSearchRecord {
  id: number;
  name: string;
  marketplaceId: number | null;
  originalQuery: string | null;
  query: Record<string, unknown>;
  sortKey: string | null;
  alertChannel: string;
  alertFrequency: string;
  resultCountAtSave: number;
  newResultCount: number;
  lastRunAt: string | null;
  isActive: boolean;
  createdAt: string;
}

const mapSavedSearch = (row: Row): SavedSearchRecord => ({
  id: Number(row.id),
  name: String(row.name),
  marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
  originalQuery: (row.original_query as string | null) ?? null,
  query: toJson<Record<string, unknown>>(row.query, {}),
  sortKey: (row.sort_key as string | null) ?? null,
  alertChannel: String(row.alert_channel),
  alertFrequency: String(row.alert_frequency),
  resultCountAtSave: Number(row.result_count_at_save),
  newResultCount: Number(row.new_result_count),
  lastRunAt: row.last_run_at ? (row.last_run_at as Date).toISOString() : null,
  isActive: row.is_active === 1 || row.is_active === true,
  createdAt: (row.created_at as Date).toISOString(),
});

export async function listSavedSearches(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT id, name, original_query, marketplace_id, query, sort_key, alert_channel, alert_frequency,
            result_count_at_save, new_result_count, last_run_at, is_active, created_at
       FROM saved_searches
      WHERE user_id = ? AND is_active = 1
      ORDER BY updated_at DESC`,
    [userId],
  );
  return rows.map(mapSavedSearch);
}

export async function saveSearch(
  userId: number,
  input: {
    name: string;
    marketplaceId?: number | null;
    query: Record<string, unknown>;
    originalQuery?: string | null;
    sortKey?: string | null;
    alertChannel?: 'none' | 'push' | 'email' | 'sms' | 'all';
    alertFrequency?: 'instant' | 'daily' | 'weekly' | 'never';
    resultCount?: number;
    language?: string;
  },
) {
  const dsl = validateSearchQuery(
    {
      ...input.query,
      originalQuery: input.originalQuery ?? String(input.query.originalQuery ?? input.name),
    },
    { currency: 'USD', language: input.language ?? 'en' },
  );
  const hash = sha256(searchQueryHash(dsl));
  const id = await insertAndGetId(
    `INSERT INTO saved_searches
       (user_id, marketplace_id, name, original_query, query, dsl_hash, language, sort_key,
        alert_channel, alert_frequency, result_count_at_save)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      input.marketplaceId ?? null,
      input.name.slice(0, 128),
      (input.originalQuery ?? dsl.originalQuery).slice(0, 500),
      JSON.stringify(dsl),
      hash,
      input.language ?? dsl.language,
      input.sortKey ?? dsl.sort,
      input.alertChannel ?? 'push',
      input.alertFrequency ?? 'instant',
      input.resultCount ?? 0,
    ],
  );
  const row = await queryOne<Row>('SELECT * FROM saved_searches WHERE id = ?', [id]);
  return mapSavedSearch(row!);
}

export async function updateSavedSearch(
  userId: number,
  id: number,
  patch: {
    name?: string;
    query?: Record<string, unknown>;
    originalQuery?: string | null;
    alertChannel?: 'none' | 'push' | 'email' | 'sms' | 'all';
    alertFrequency?: 'instant' | 'daily' | 'weekly' | 'never';
    isActive?: boolean;
  },
) {
  const existing = await queryOne<Row>('SELECT * FROM saved_searches WHERE id = ? AND user_id = ?', [id, userId]);
  if (!existing) return null;
  const dsl = patch.query
    ? validateSearchQuery({ ...patch.query, originalQuery: patch.originalQuery ?? String(existing.original_query ?? '') }, { currency: 'USD', language: 'en' })
    : null;
  await execute(
    `UPDATE saved_searches
        SET name = COALESCE(?, name),
            original_query = COALESCE(?, original_query),
            query = COALESCE(?, query),
            dsl_hash = COALESCE(?, dsl_hash),
            alert_channel = COALESCE(?, alert_channel),
            alert_frequency = COALESCE(?, alert_frequency),
            is_active = COALESCE(?, is_active)
      WHERE id = ? AND user_id = ?`,
    [
      patch.name ?? null,
      patch.originalQuery ?? null,
      dsl ? JSON.stringify(dsl) : null,
      dsl ? sha256(searchQueryHash(dsl)) : null,
      patch.alertChannel ?? null,
      patch.alertFrequency ?? null,
      patch.isActive === undefined ? null : patch.isActive ? 1 : 0,
      id,
      userId,
    ],
  );
  const row = await queryOne<Row>('SELECT * FROM saved_searches WHERE id = ?', [id]);
  return row ? mapSavedSearch(row) : null;
}

export async function deleteSavedSearch(userId: number, id: number) {
  await execute('UPDATE saved_searches SET is_active = 0 WHERE id = ? AND user_id = ?', [id, userId]);
  return { deleted: true };
}

function listingMatchesDsl(
  listing: {
    marketplaceId: number;
    categoryId: number;
    operation: string;
    title: string;
    price: number | null;
    cityId: number | null;
    countryId: number;
  },
  dsl: SearchQuery,
  marketplaceIdByCode: Map<string, number>,
): boolean {
  if (dsl.marketplace) {
    const expected = marketplaceIdByCode.get(dsl.marketplace);
    if (expected && expected !== listing.marketplaceId) return false;
  }
  if (dsl.operation && dsl.operation !== listing.operation) return false;
  if (dsl.location?.cityId && listing.cityId !== dsl.location.cityId) return false;
  if (dsl.location?.countryId && listing.countryId !== dsl.location.countryId) return false;
  if (dsl.price?.max !== undefined && listing.price !== null && listing.price > dsl.price.max) return false;
  if (dsl.price?.min !== undefined && listing.price !== null && listing.price < dsl.price.min) return false;
  if (dsl.keywords) {
    const terms = dsl.keywords.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
    const title = listing.title.toLowerCase();
    if (terms.length > 0 && !terms.some((term) => title.includes(term))) return false;
  }
  return true;
}

export async function matchListingToSavedSearches(listingId: number): Promise<number> {
  const listing = await queryOne<Row>(
    `SELECT id, user_id, marketplace_id, category_id, operation, title, price, city_id, country_id
       FROM listings WHERE id = ? AND deleted_at IS NULL`,
    [listingId],
  );
  if (!listing) return 0;
  const marketplaces = await queryRows<Row>('SELECT id, code FROM marketplaces');
  const byCode = new Map(marketplaces.map((row) => [String(row.code), Number(row.id)]));

  const searches = await queryRows<Row>(
    `SELECT id, user_id, query, alert_frequency, alert_channel
       FROM saved_searches
      WHERE is_active = 1
        AND alert_frequency IN ('instant','daily','weekly')
        AND (marketplace_id IS NULL OR marketplace_id = ?)
      LIMIT 200`,
    [listing.marketplace_id],
  );

  let matched = 0;
  for (const search of searches) {
    const dsl = validateSearchQuery(toJson<Record<string, unknown>>(search.query, {}), { currency: 'USD', language: 'en' });
    if (
      !listingMatchesDsl(
        {
          marketplaceId: Number(listing.marketplace_id),
          categoryId: Number(listing.category_id),
          operation: String(listing.operation),
          title: String(listing.title),
          price: listing.price === null ? null : Number(listing.price),
          cityId: listing.city_id === null ? null : Number(listing.city_id),
          countryId: Number(listing.country_id),
        },
        dsl,
        byCode,
      )
    ) {
      continue;
    }

    const inserted = await execute(
      `INSERT IGNORE INTO saved_search_matches (saved_search_id, listing_id) VALUES (?, ?)`,
      [search.id, listingId],
    );
    if (!inserted.affectedRows) continue;
    matched += 1;
    await execute('UPDATE saved_searches SET new_result_count = new_result_count + 1 WHERE id = ?', [search.id]);

    if (String(search.alert_frequency) === 'instant' && String(search.alert_channel) !== 'none') {
      await notifyUser({
        userId: Number(search.user_id),
        categoryCode: 'search.saved_match',
        title: 'New listing matches your search',
        body: String(listing.title).slice(0, 180),
        actionType: 'listing',
        actionTarget: String(listingId),
        data: { listingId, savedSearchId: Number(search.id) },
      });
      await execute(
        'UPDATE saved_search_matches SET notified_at = CURRENT_TIMESTAMP WHERE saved_search_id = ? AND listing_id = ?',
        [search.id, listingId],
      );
    }
  }
  return matched;
}

export async function runSavedSearchDigests(frequency: 'daily' | 'weekly'): Promise<number> {
  const interval = frequency === 'daily' ? '1 DAY' : '7 DAY';
  const searches = await queryRows<Row>(
    `SELECT id, user_id, name, new_result_count
       FROM saved_searches
      WHERE is_active = 1 AND alert_frequency = ?
        AND (last_run_at IS NULL OR last_run_at <= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${interval}))
      LIMIT 100`,
    [frequency],
  );
  let sent = 0;
  for (const search of searches) {
    const count = Number(search.new_result_count ?? 0);
    if (count > 0) {
      await notifyUser({
        userId: Number(search.user_id),
        categoryCode: 'search.saved_digest',
        title: `${count} new matches`,
        body: `New listings match “${String(search.name)}”.`,
        actionType: 'listing',
        actionTarget: 'saved-search',
        data: { savedSearchId: Number(search.id), count },
      });
      sent += 1;
    }
    await execute(
      `UPDATE saved_searches SET last_run_at = CURRENT_TIMESTAMP, last_notified_at = CURRENT_TIMESTAMP, new_result_count = 0 WHERE id = ?`,
      [search.id],
    );
  }
  return sent;
}

export async function previewSavedSearch(userId: number, dsl: SearchQuery, ctx: { language: string; currency: string; countryId: number | null }) {
  void userId;
  return retrieveAndRank(dsl, { ...ctx, viewerId: userId });
}
