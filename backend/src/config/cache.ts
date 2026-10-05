import { createClient } from 'redis';
import { env } from './env';
import { loggerFor } from './logger';

const log = loggerFor('cache');

export interface CacheStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Invalidate a whole family, e.g. `taxonomy:*` after a category edit. */
  delPrefix(prefix: string): Promise<void>;
  clear(): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

type RedisConn = {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options: { expiration: { type: 'EX'; value: number } },
  ): Promise<unknown>;
  del(key: string | string[]): Promise<unknown>;
  scanIterator(options: { MATCH: string; COUNT: number }): AsyncIterable<unknown>;
  ping(): Promise<unknown>;
  close(): Promise<void>;
  connect(): Promise<unknown>;
  on(event: 'error', listener: (error: unknown) => void): unknown;
  incr(key: string): Promise<number>;
  decr(key: string): Promise<number>;
  pExpire(key: string, milliseconds: number): Promise<unknown>;
  pTTL(key: string): Promise<number>;
};

const CACHE_PREFIX = 'c:';

/**
 * Default store: bounded in-memory LRU-ish map.
 *
 * Reference data (countries, taxonomy, plans, FX) is read on nearly every
 * request and changes rarely, so caching it locally removes most of the query
 * load without needing Redis in a single-node deployment. Set REDIS_URL to move
 * to a shared store when running more than one instance.
 */
class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries = 5_000;

  async get<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    // Refresh recency so the eviction below drops genuinely cold keys.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds = env.CACHE_TTL_SECONDS): Promise<void> {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async delPrefix(prefix: string): Promise<void> {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

class RedisCache implements CacheStore {
  constructor(private readonly client: RedisConn) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(CACHE_PREFIX + key);
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = env.CACHE_TTL_SECONDS): Promise<void> {
    await this.client.set(CACHE_PREFIX + key, JSON.stringify(value), {
      expiration: { type: 'EX', value: Math.max(1, ttlSeconds) },
    });
  }

  async del(key: string): Promise<void> {
    await this.client.del(CACHE_PREFIX + key);
  }

  async delPrefix(prefix: string): Promise<void> {
    const match = `${CACHE_PREFIX}${prefix}*`;
    for await (const batch of this.client.scanIterator({ MATCH: match, COUNT: 200 })) {
      const keys = (Array.isArray(batch) ? batch : [batch]).filter(Boolean);
      if (keys.length > 0) await this.client.del(keys);
    }
  }

  async clear(): Promise<void> {
    await this.delPrefix('');
  }
}

const memory = new MemoryCache();

/** Live binding — `initCache()` may replace this with Redis. */
export let cache: CacheStore = memory;

let redisClient: RedisConn | null = null;
let driverName: 'memory' | 'redis' = 'memory';

export const cacheDriverName = (): 'memory' | 'redis' => driverName;

export const getRedisClient = (): RedisConn | null => redisClient;

/**
 * Connect to Redis when REDIS_URL is set. Development falls back to memory if
 * the server is unreachable; production refuses to boot with a broken URL.
 */
export async function initCache(): Promise<void> {
  if (!env.REDIS_URL) {
    log.info('cache driver: memory (REDIS_URL unset)');
    return;
  }

  const client = createClient({ url: env.REDIS_URL });
  client.on('error', (error) => {
    log.warn({ err: error }, 'redis client error');
  });

  try {
    await client.connect();
    await client.ping();
    redisClient = client as unknown as RedisConn;
    cache = new RedisCache(redisClient);
    driverName = 'redis';
    log.info('cache driver: redis');
  } catch (error) {
    try {
      await client.close();
    } catch {
      /* already closed */
    }
    if (env.isProduction) {
      console.error('Refusing to start: REDIS_URL is set but Redis is unreachable');
      process.exit(1);
    }
    log.warn({ err: error }, 'redis unreachable; using in-memory cache');
    cache = memory;
    driverName = 'memory';
  }
}

export async function closeCache(): Promise<void> {
  const client = redisClient;
  redisClient = null;
  cache = memory;
  driverName = 'memory';
  if (!client) return;
  try {
    await client.close();
  } catch (error) {
    log.warn({ err: error }, 'redis close failed');
  }
}

/**
 * Cache-aside helper. On a miss it runs `loader`, stores the result, and returns
 * it. Errors from `loader` are not cached.
 */
export async function remember<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const hit = await cache.get<T>(key);
  if (hit !== null) return hit;
  const value = await loader();
  await cache.set(key, value, ttlSeconds);
  return value;
}

export const cacheKeys = {
  countries: () => 'ref:countries',
  country: (iso2: string) => `ref:country:${iso2.toUpperCase()}`,
  languages: () => 'ref:languages',
  currencies: () => 'ref:currencies',
  fxRate: (base: string, quote: string) => `fx:${base}:${quote}`,
  marketplaces: () => 'ref:marketplaces',
  taxonomy: (marketplaceId: number, language: string) => `taxonomy:${marketplaceId}:${language}`,
  taxonomyVersion: (marketplaceId: number) => `taxonomy:version:${marketplaceId}`,
  attributes: (marketplaceId: number, categoryId: number | null) => `attrs:${marketplaceId}:${categoryId ?? 'all'}`,
  plans: (marketplaceId: number | null, countryId: number | null) => `plans:${marketplaceId ?? 'all'}:${countryId ?? 'all'}`,
  entitlements: (userId: number) => `entitlements:${userId}`,
  goldRate: (countryId: number | null, currency: string, karat: number) => `gold:${countryId ?? 'intl'}:${currency}:${karat}`,
  featureFlags: () => 'ref:feature-flags',
  publicSettings: () => 'ref:settings:public',
  sortOptions: (marketplaceId: number | null) => `ref:sort:${marketplaceId ?? 'all'}`,
  permissions: (userId: number) => `perms:${userId}`,
  trending: (marketplaceId: number | null, countryId: number | null) => `trending:${marketplaceId ?? 'all'}:${countryId ?? 'all'}`,
  searchQuery: (hash: string) => `search:q:${hash}`,
  presence: (userId: number) => `presence:user:${userId}`,
  presenceDevices: (userId: number) => `presence:user:${userId}:devices`,
  typing: (conversationId: number, userId: number) => `typing:${conversationId}:${userId}`,
  callLock: (userId: number) => `call:active:${userId}`,
  maskedDaily: (userId: number, day: string) => `masked:day:${userId}:${day}`,
  notificationCategory: (code: string) => `notify:cat:${code}`,
  notificationTemplate: (code: string, channel: string, language: string) =>
    `notify:tpl:${code}:${channel}:${language}`,
  notificationUnread: (userId: number) => `notify:unread:${userId}`,
  notificationPrefs: (userId: number) => `notify:prefs:${userId}`,
  aiProviders: () => 'ai:providers',
  aiThresholds: () => 'ai:thresholds',
  aiTranslation: (hash: string, source: string, target: string) => `ai:tr:${hash}:${source}:${target}`,
  sellerDashboard: (userId: number, key: string) => `seller:dash:${userId}:${key}`,
  analytics: (userId: number, key: string) => `analytics:${userId}:${key}`,
} as const;
