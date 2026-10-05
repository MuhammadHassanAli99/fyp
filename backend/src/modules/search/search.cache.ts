import { sha256 } from '../../core/security/crypto';
import { execute, queryOne, type Row } from '../../db/query';
import { cache } from '../../config/cache';
import { searchQueryHash, type SearchQuery } from './search.dsl';

const MEMORY_PREFIX = 'search:q:';
const DEFAULT_TTL_SECONDS = 45;

export function cacheKeyFor(query: SearchQuery, countryId: number | null): string {
  return sha256(`${searchQueryHash(query)}|${countryId ?? 'all'}|${query.pagination.page}|${query.pagination.perPage}`);
}

export async function getCachedSearch<T>(key: string): Promise<T | null> {
  const memory = await cache.get<T>(MEMORY_PREFIX + key);
  if (memory) return memory;
  const row = await queryOne<Row>(
    `SELECT payload FROM search_result_cache WHERE cache_key = ? AND expires_at > CURRENT_TIMESTAMP`,
    [key],
  ).catch(() => null);
  if (!row) return null;
  try {
    const parsed = JSON.parse(String(row.payload)) as T;
    await cache.set(MEMORY_PREFIX + key, parsed, DEFAULT_TTL_SECONDS);
    await execute('UPDATE search_result_cache SET hit_count = hit_count + 1 WHERE cache_key = ?', [key]).catch(() => undefined);
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedSearch(key: string, payload: unknown, marketplaceId: number | null, countryId: number | null, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
  await cache.set(MEMORY_PREFIX + key, payload, ttlSeconds);
  const expires = new Date(Date.now() + ttlSeconds * 1000);
  await execute(
    `INSERT INTO search_result_cache (cache_key, marketplace_id, country_id, payload, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), expires_at = VALUES(expires_at), marketplace_id = VALUES(marketplace_id)`,
    [key, marketplaceId, countryId, JSON.stringify(payload), expires],
  ).catch(() => undefined);
}

export async function invalidateSearchCache(): Promise<void> {
  await cache.delPrefix(MEMORY_PREFIX);
  await execute('DELETE FROM search_result_cache').catch(() => undefined);
}

export async function purgeExpiredSearchCache(): Promise<number> {
  const result = await execute(`DELETE FROM search_result_cache WHERE expires_at <= CURRENT_TIMESTAMP`).catch(
    () => ({ affectedRows: 0 }),
  );
  return Number(result.affectedRows ?? 0);
}
