import type { Options, Store } from 'express-rate-limit';
import { getRedisClient } from '../config/cache';

/**
 * Shared hit counter for multi-instance deploys. Falls back to process memory
 * when Redis is not connected so local development does not require it.
 */
export class RedisRateLimitStore implements Store {
  prefix = 'rl';
  localKeys = false;
  private windowMs = 60_000;
  private readonly memory = new Map<string, { hits: number; resetAt: number }>();

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  setPrefix(prefix: string): void {
    this.prefix = prefix.replace(/:$/, '');
  }

  async get(key: string) {
    const client = getRedisClient();
    if (!client) {
      const entry = this.memory.get(key);
      if (!entry || entry.resetAt <= Date.now()) return undefined;
      return { totalHits: entry.hits, resetTime: new Date(entry.resetAt) };
    }
    const redisKey = this.redisKey(key);
    const raw = await client.get(redisKey);
    if (raw === null || raw === undefined) return undefined;
    const ttl = Number(await client.pTTL(redisKey));
    return {
      totalHits: Number(raw),
      resetTime: new Date(Date.now() + Math.max(ttl, 0)),
    };
  }

  async increment(key: string) {
    const client = getRedisClient();
    if (!client) return this.incrementMemory(key);

    const redisKey = this.redisKey(key);
    const hits = await client.incr(redisKey);
    if (hits === 1) await client.pExpire(redisKey, this.windowMs);
    const ttl = Number(await client.pTTL(redisKey));
    return { totalHits: hits, resetTime: new Date(Date.now() + Math.max(ttl, 0)) };
  }

  async decrement(key: string) {
    const client = getRedisClient();
    if (!client) {
      const entry = this.memory.get(key);
      if (entry && entry.hits > 0) entry.hits -= 1;
      return;
    }
    const redisKey = this.redisKey(key);
    const hits = await client.decr(redisKey);
    if (hits <= 0) await client.del(redisKey);
  }

  async resetKey(key: string) {
    this.memory.delete(key);
    const client = getRedisClient();
    if (client) await client.del(this.redisKey(key));
  }

  private incrementMemory(key: string) {
    const now = Date.now();
    const existing = this.memory.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + this.windowMs;
      this.memory.set(key, { hits: 1, resetAt });
      return { totalHits: 1, resetTime: new Date(resetAt) };
    }
    existing.hits += 1;
    return { totalHits: existing.hits, resetTime: new Date(existing.resetAt) };
  }

  private redisKey(key: string): string {
    return `${this.prefix}:${key}`;
  }
}
