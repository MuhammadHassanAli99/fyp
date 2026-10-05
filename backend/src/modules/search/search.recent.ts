import { execute, queryRows, type Row } from '../../db/query';
import { sha256 } from '../../core/security/crypto';
import { normalizeQueryText } from './search.dsl';

export async function recordSearchHistory(params: {
  userId: number | null;
  guestUuid: string | null;
  marketplaceId: number | null;
  query: string;
  normalizedQuery?: string;
  searchType: string;
  filters: Record<string, unknown> | null;
  dsl?: Record<string, unknown> | null;
  resultCount: number;
  countryId: number | null;
  language?: string | null;
}) {
  const normalized = params.normalizedQuery ?? normalizeQueryText(params.query);
  if (normalized.length < 2) return;
  await execute(
    `INSERT INTO search_history
       (user_id, guest_uuid, marketplace_id, query, normalized_query, query_hash, search_type, language, filters, dsl, result_count, country_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId,
      params.guestUuid,
      params.marketplaceId,
      params.query.slice(0, 255),
      normalized.slice(0, 255),
      sha256(normalized),
      params.searchType,
      params.language ?? null,
      params.filters ? JSON.stringify(params.filters) : null,
      params.dsl ? JSON.stringify(params.dsl) : null,
      params.resultCount,
      params.countryId,
    ],
  );
}

function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value ? String(value) : '';
}

export async function listRecentSearches(userId: number | null, guestUuid: string | null, limit = 10) {
  if (!userId && !guestUuid) return [];
  const fetchLimit = Math.min(Math.max(limit, 1) * 4, 80);
  const rows = await queryRows<Row>(
    userId
      ? `SELECT id, normalized_query AS term, query, marketplace_id, search_type, created_at AS last_at
           FROM search_history WHERE user_id = ?
           ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, normalized_query AS term, query, marketplace_id, search_type, created_at AS last_at
           FROM search_history WHERE guest_uuid = ?
           ORDER BY created_at DESC LIMIT ?`,
    [userId ?? guestUuid, fetchLimit],
  );

  const seen = new Set<string>();
  const items: Array<{ id: number; term: string; marketplaceId: number | null; lastAt: string; searchType: string }> = [];
  for (const row of rows) {
    const term = String(row.query ?? row.term ?? '');
    const key = `${String(row.term ?? term).toLowerCase()}|${row.marketplace_id ?? ''}`;
    if (!term || seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: Number(row.id),
      term,
      marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
      lastAt: isoDate(row.last_at),
      searchType: String(row.search_type ?? 'text'),
    });
  }
  return items.slice(0, limit);
}

export async function deleteRecentSearch(userId: number | null, guestUuid: string | null, id: number) {
  await execute(
    userId
      ? 'DELETE FROM search_history WHERE id = ? AND user_id = ?'
      : 'DELETE FROM search_history WHERE id = ? AND guest_uuid = ?',
    [id, userId ?? guestUuid],
  );
  return { deleted: true };
}

export async function clearRecentSearches(userId: number | null, guestUuid: string | null) {
  await execute(
    userId ? 'DELETE FROM search_history WHERE user_id = ?' : 'DELETE FROM search_history WHERE guest_uuid = ?',
    [userId ?? guestUuid],
  );
  return { cleared: true };
}
