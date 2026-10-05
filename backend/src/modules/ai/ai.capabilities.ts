import { createHash } from 'node:crypto';
import { env } from '../../config/env';
import { execute, insertAndGetId, queryOne, queryRows, queryCount, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { uuid } from '../../core/security/crypto';
import { AppError, ErrorCode, forbidden, notFound } from '../../core/errors';
import { storage } from '../../providers/storage';
import type { AiDriver } from '../../providers/ai/types';
import { wrapUntrusted } from './ai.security';
import { finishJob } from './ai.orchestrator';
import { runWithFallback } from '../../providers/ai';
import type { AiTask } from './ai.types';

function factBag(attributes: Record<string, unknown>, details: Record<string, unknown>): Set<string> {
  const bag = new Set<string>();
  for (const value of Object.values({ ...attributes, ...details })) {
    if (value === null || value === undefined || value === '') continue;
    bag.add(String(value).toLowerCase());
  }
  return bag;
}

/** Reject invented numeric specs that never appeared in structured listing data. */
export function validateGeneratedDescription(
  description: string,
  attributes: Record<string, unknown>,
  details: Record<string, unknown>,
): { ok: boolean; invented: string[] } {
  const bag = factBag(attributes, details);
  const invented: string[] = [];
  const numbers = description.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  for (const token of numbers) {
    if (token.length > 6) continue;
    const allowed = [...bag].some((fact) => fact.includes(token));
    if (!allowed && Number(token) > 31) invented.push(token);
  }
  return { ok: invented.length === 0, invented };
}

export async function persistGeneratedContent(params: {
  entityType: string;
  entityId: number;
  kind: 'title' | 'description' | 'summary' | 'highlights' | 'seo_title' | 'seo_description';
  language: string | null;
  content: string;
  model: string;
  jobId?: number | null;
}): Promise<void> {
  await execute(
    `INSERT INTO ai_generated_content (entity_type, entity_id, kind, language, content, model, job_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [params.entityType, params.entityId, params.kind, params.language, params.content, params.model, params.jobId ?? null],
  ).catch(() => undefined);
}

export async function acceptGeneratedContent(params: {
  userId: number;
  entityType: string;
  entityId: number;
  kind: string;
  editedContent?: string | null;
}): Promise<{ accepted: true }> {
  const row = await queryOne<Row>(
    `SELECT id, content FROM ai_generated_content
      WHERE entity_type = ? AND entity_id = ? AND kind = ?
      ORDER BY id DESC LIMIT 1`,
    [params.entityType, params.entityId, params.kind],
  );
  if (!row) throw notFound('AI content');
  const edited = params.editedContent ?? null;
  const wasEdited = Boolean(edited && edited !== String(row.content));
  await execute(
    `UPDATE ai_generated_content
        SET was_accepted = 1, was_edited = ?, edit_distance = ?
      WHERE id = ?`,
    [wasEdited ? 1 : 0, wasEdited && edited ? Math.abs(edited.length - String(row.content).length) : 0, row.id],
  );
  return { accepted: true };
}

export async function persistPriceRecommendation(params: {
  marketplaceId: number;
  listingId?: number | null;
  userId?: number | null;
  categoryId: number;
  currency: string;
  recommended: number;
  low: number;
  high: number;
  confidence: number;
  rationale: string;
  comparables: unknown;
  model: string;
}): Promise<void> {
  await execute(
    `INSERT INTO ai_price_recommendations
       (uuid, marketplace_id, listing_id, user_id, category_id, currency, recommended_price,
        price_low, price_high, confidence, rationale, comparable_count, comparables, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      params.marketplaceId,
      params.listingId ?? null,
      params.userId ?? null,
      params.categoryId,
      params.currency,
      params.recommended,
      params.low,
      params.high,
      params.confidence,
      params.rationale,
      Array.isArray(params.comparables) ? params.comparables.length : 0,
      JSON.stringify(params.comparables),
      params.model,
    ],
  ).catch(() => undefined);
}

function hashText(text: string): string {
  return createHash('sha256').update(text.normalize('NFKC').trim().toLowerCase()).digest('hex');
}

export async function translateCached(
  driver: AiDriver,
  text: string,
  targetLanguage: string,
  sourceLanguage?: string | null,
): Promise<{ text: string; sourceLanguage: string; confidence: number; model: string; latencyMs?: number; cacheHit: boolean }> {
  const source = sourceLanguage ?? 'auto';
  const key = hashText(text);
  const cached = await queryOne<Row>(
    `SELECT translated_text, source_language, quality_score, provider
       FROM ai_translation_cache
      WHERE source_hash = ? AND source_language = ? AND target_language = ?`,
    [key, source, targetLanguage],
  );
  if (cached) {
    await execute(
      'UPDATE ai_translation_cache SET hit_count = hit_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE source_hash = ? AND source_language = ? AND target_language = ?',
      [key, source, targetLanguage],
    ).catch(() => undefined);
    return {
      text: String(cached.translated_text),
      sourceLanguage: String(cached.source_language),
      confidence: Number(cached.quality_score ?? 80),
      model: String(cached.provider ?? 'cache'),
      cacheHit: true,
    };
  }
  const result = await driver.translate({
    text: wrapUntrusted('user_text', text),
    targetLanguage,
    sourceLanguage: sourceLanguage ?? null,
  });
  if (result.confidence > 0 && result.text !== text) {
    await execute(
      `INSERT INTO ai_translation_cache
         (source_hash, source_language, target_language, source_text, translated_text, provider, quality_score, hit_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE translated_text = VALUES(translated_text), hit_count = hit_count + 1, last_used_at = CURRENT_TIMESTAMP`,
      [key, result.sourceLanguage || source, targetLanguage, text.slice(0, 65000), result.text, result.model, result.confidence],
    ).catch(() => undefined);
  }
  return { ...result, cacheHit: false };
}

function storagePathFromUrl(url: string): string | null {
  const prefix = env.STORAGE_PUBLIC_URL.replace(/\/+$/, '') + '/';
  if (url.startsWith(prefix)) return url.slice(prefix.length);
  const idx = url.indexOf('/uploads/');
  if (idx >= 0) return url.slice(idx + '/uploads/'.length);
  return null;
}

async function enhanceBuffer(buffer: Buffer): Promise<{ buffer: Buffer; engine: string } | null> {
  try {
    const req = eval('require') as NodeRequire;
    const sharp = req('sharp') as (input: Buffer) => {
      rotate: () => {
        normalize: () => {
          sharpen: (opts: { sigma: number }) => {
            jpeg: (opts: { quality: number; mozjpeg?: boolean }) => { toBuffer: () => Promise<Buffer> };
          };
        };
      };
    };
    const out = await sharp(buffer).rotate().normalize().sharpen({ sigma: 0.6 }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
    return { buffer: out, engine: 'sharp-normalize' };
  } catch {
    return null;
  }
}

export async function enhanceListingImage(params: {
  userId: number;
  mediaId: number;
  jobId: number;
  jobUuid: string;
}): Promise<void> {
  const startedAt = Date.now();
  const media = await queryOne<Row>(
    `SELECT m.id, m.listing_id, m.url, m.original_url, m.thumb_url, m.card_url, l.user_id
       FROM listing_media m
       JOIN listings l ON l.id = m.listing_id
      WHERE m.id = ?`,
    [params.mediaId],
  );
  if (!media) throw notFound('Media');
  if (Number(media.user_id) !== params.userId) throw forbidden('You do not own this image');

  const originalUrl = String(media.original_url ?? media.url);
  if (!media.original_url) {
    await execute('UPDATE listing_media SET original_url = url WHERE id = ? AND original_url IS NULL', [params.mediaId]);
  }
  const path = storagePathFromUrl(originalUrl);
  if (!path) {
    await finishJob({
      jobId: params.jobId,
      jobUuid: params.jobUuid,
      userId: params.userId,
      task: 'image_enhance',
      status: 'failed',
      provider: 'heuristic',
      model: 'heuristic-enhance-v1',
      output: { error: 'image_not_local' },
      latencyMs: Date.now() - startedAt,
      error: 'Original image is not readable from local storage',
      confidence: 0,
      decision: 'low',
    });
    return;
  }

  const original = await storage.read(path);
  const enhanced = await enhanceBuffer(original);
  if (!enhanced) {
    await finishJob({
      jobId: params.jobId,
      jobUuid: params.jobUuid,
      userId: params.userId,
      task: 'image_enhance',
      status: 'succeeded',
      provider: 'heuristic',
      model: 'passthrough',
      output: {
        originalUrl,
        enhancedUrl: originalUrl,
        previewOnly: true,
        disclaimer: 'Image enhancement is unavailable on this server. The original was not changed.',
      },
      latencyMs: Date.now() - startedAt,
      confidence: 20,
      decision: 'low',
    });
    return;
  }

  const enhancedPath = path.replace(/(\.[a-z0-9]+)?$/i, '-enhanced.jpg');
  const stored = await storage.put(enhancedPath, enhanced.buffer, 'image/jpeg');
  let thumbUrl: string | null = null;
  let cardUrl: string | null = null;
  let largeUrl: string | null = stored.fileUrl;
  try {
    const req = eval('require') as NodeRequire;
    const sharp = req('sharp') as (input: Buffer) => {
      resize: (w: number, h: number, o: { fit: string }) => {
        jpeg: (opts: { quality: number }) => { toBuffer: () => Promise<Buffer> };
      };
    };
    const thumb = await sharp(enhanced.buffer).resize(320, 320, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
    const card = await sharp(enhanced.buffer).resize(800, 600, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
    const large = await sharp(enhanced.buffer).resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer();
    const t = await storage.put(enhancedPath.replace('-enhanced.jpg', '-thumb.jpg'), thumb, 'image/jpeg');
    const c = await storage.put(enhancedPath.replace('-enhanced.jpg', '-card.jpg'), card, 'image/jpeg');
    const l = await storage.put(enhancedPath.replace('-enhanced.jpg', '-large.jpg'), large, 'image/jpeg');
    thumbUrl = t.fileUrl;
    cardUrl = c.fileUrl;
    largeUrl = l.fileUrl;
  } catch {
    thumbUrl = stored.fileUrl;
    cardUrl = stored.fileUrl;
  }

  await execute(
    `UPDATE listing_media
        SET url = ?, thumb_url = COALESCE(?, thumb_url), card_url = COALESCE(?, card_url),
            large_url = ?, is_ai_enhanced = 1, original_url = COALESCE(original_url, ?)
      WHERE id = ?`,
    [stored.fileUrl, thumbUrl, cardUrl, largeUrl, originalUrl, params.mediaId],
  );

  await finishJob({
    jobId: params.jobId,
    jobUuid: params.jobUuid,
    userId: params.userId,
    task: 'image_enhance',
    status: 'succeeded',
    provider: 'heuristic',
    model: enhanced.engine,
    output: {
      mediaId: params.mediaId,
      originalUrl,
      enhancedUrl: stored.fileUrl,
      thumbUrl,
      cardUrl,
      largeUrl,
      disclaimer:
        'Enhancement is limited to colour/contrast/sharpening. It must not hide damage, alter structure, or invent gold characteristics.',
    },
    latencyMs: Date.now() - startedAt,
    confidence: 72,
    decision: 'medium',
  });
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const token of a) if (b.has(token)) n += 1;
  return n / (a.size + b.size - n);
}

const tokenize = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );

export async function detectDuplicates(listingId: number): Promise<{
  matches: Array<{ listingId: number; similarity: number; method: string; reason: string }>;
  score: number;
  confidence: number;
}> {
  const listing = await queryOne<Row>(
    `SELECT l.id, l.user_id, l.marketplace_id, l.category_id, l.title, l.description, l.price,
            l.city_id, l.country_id, l.currency
       FROM listings l WHERE l.id = ?`,
    [listingId],
  );
  if (!listing) return { matches: [], score: 0, confidence: 0 };

  const matches: Array<{ listingId: number; similarity: number; method: string; reason: string }> = [];
  const text = `${listing.title ?? ''} ${listing.description ?? ''}`;
  const tokens = tokenize(text);

  const candidates = await queryRows<Row>(
    `SELECT id, title, description, price, city_id, currency FROM listings
      WHERE category_id = ? AND id <> ? AND deleted_at IS NULL
        AND status IN ('published','pending_review','draft')
      ORDER BY created_at DESC LIMIT 80`,
    [listing.category_id, listingId],
  );

  for (const candidate of candidates) {
    const sim = jaccard(tokens, tokenize(`${candidate.title ?? ''} ${candidate.description ?? ''}`));
    const samePrice =
      toNumber(listing.price) !== null &&
      toNumber(candidate.price) !== null &&
      Math.abs((toNumber(listing.price) ?? 0) - (toNumber(candidate.price) ?? 0)) < 0.01;
    const sameCity = listing.city_id && candidate.city_id && Number(listing.city_id) === Number(candidate.city_id);
    let score = sim;
    const reasons: string[] = [];
    if (sim >= 0.82) reasons.push('title_description');
    if (samePrice && sameCity) {
      score = Math.min(1, score + 0.08);
      reasons.push('location_price');
    }
    if (score >= 0.82) {
      matches.push({
        listingId: Number(candidate.id),
        similarity: Number(score.toFixed(4)),
        method: sim >= 0.98 ? 'text_hash' : 'composite',
        reason: reasons.join(',') || 'composite',
      });
    }
  }

  const vin = await queryOne<Row>('SELECT vin FROM vehicle_listing_details WHERE listing_id = ?', [listingId]);
  if (vin?.vin && String(vin.vin).length >= 11) {
    const dup = await queryOne<Row>(
      `SELECT d.listing_id FROM vehicle_listing_details d JOIN listings l ON l.id = d.listing_id
        WHERE d.vin = ? AND d.listing_id <> ? AND l.deleted_at IS NULL LIMIT 1`,
      [vin.vin, listingId],
    );
    if (dup) {
      matches.push({ listingId: Number(dup.listing_id), similarity: 1, method: 'vin', reason: 'vin' });
    }
  }

  const gold = await queryOne<Row>(
    'SELECT serial_number, certificate_number FROM gold_listing_details WHERE listing_id = ?',
    [listingId],
  );
  if (gold?.certificate_number) {
    const dup = await queryOne<Row>(
      `SELECT listing_id FROM gold_listing_details WHERE certificate_number = ? AND listing_id <> ? LIMIT 1`,
      [gold.certificate_number, listingId],
    );
    if (dup) {
      matches.push({ listingId: Number(dup.listing_id), similarity: 1, method: 'certificate', reason: 'gold_certificate' });
    }
  }

  const phash = await queryCount(
    `SELECT COUNT(*) FROM media_hashes mine
       JOIN media_hashes other ON other.phash = mine.phash AND other.listing_id <> mine.listing_id
      WHERE mine.listing_id = ?`,
    [listingId],
  );
  if (phash > 0) {
    const other = await queryOne<Row>(
      `SELECT other.listing_id FROM media_hashes mine
         JOIN media_hashes other ON other.phash = mine.phash AND other.listing_id <> mine.listing_id
        WHERE mine.listing_id = ? LIMIT 1`,
      [listingId],
    );
    if (other) {
      matches.push({ listingId: Number(other.listing_id), similarity: 0.9, method: 'image_hash', reason: 'perceptual_hash' });
    }
  }

  for (const match of matches) {
    await execute(
      `INSERT INTO duplicate_detections
         (listing_id, duplicate_of_listing_id, similarity, method, matched_fields, status)
       VALUES (?, ?, ?, ?, ?, 'detected')
       ON DUPLICATE KEY UPDATE similarity = VALUES(similarity)`,
      [listingId, match.listingId, match.similarity, match.method, JSON.stringify([match.reason])],
    ).catch(() => undefined);
  }

  const best = matches.reduce((max, item) => Math.max(max, item.similarity), 0);
  return { matches, score: best, confidence: matches.length === 0 ? 40 : Math.min(99, 50 + best * 50) };
}

export function computeSpamSignals(
  text: string,
  extra?: { price?: number | null; mediaCount?: number },
): { score: number; signals: Record<string, number> } {
  const signals: Record<string, number> = {};
  const lower = text.toLowerCase();
  if (text.trim().length < 25) signals.short = 0.2;
  if (/(.)\1{6,}/.test(text)) signals.repeat = 0.2;
  if ((text.match(/[!?]/g)?.length ?? 0) > 8) signals.punctuation = 0.15;
  if (/\b(free|guaranteed|100%|act now|limited time|click here|whatsapp me)\b/i.test(lower)) signals.lure = 0.15;
  if (/(https?:\/\/|www\.)/i.test(text)) signals.url = 0.2;
  if (/\b(bitcoin|crypto|western union|money ?gram|advance fee)\b/i.test(lower)) signals.scam = 0.3;
  if (extra?.price === 0) signals.zero_price = 0.1;
  if ((extra?.mediaCount ?? 1) === 0) signals.no_media = 0.15;
  const score = Math.min(1, Object.values(signals).reduce((sum, n) => sum + n, 0));
  return { score, signals };
}

export async function scoreSpamSignals(text: string, extra?: { price?: number | null; mediaCount?: number }): Promise<{
  score: number;
  confidence: number;
  signals: Record<string, number>;
  decision: 'ALLOW' | 'REVIEW' | 'REJECT';
}> {
  const { score, signals } = computeSpamSignals(text, extra);
  const policy = await queryOne<Row>(
    `SELECT threshold, rules FROM moderation_policies WHERE code = 'ai.spam.listing' AND is_active = 1 ORDER BY version DESC LIMIT 1`,
  );
  const rules = policy?.rules && typeof policy.rules === 'object' ? (policy.rules as { review?: number; reject?: number }) : {};
  const reviewAt = Number(rules.review ?? 0.35);
  const rejectAt = Number(rules.reject ?? 0.85);
  const decision: 'ALLOW' | 'REVIEW' | 'REJECT' = score >= rejectAt ? 'REJECT' : score >= reviewAt ? 'REVIEW' : 'ALLOW';
  return { score, confidence: Math.round(40 + score * 50), signals, decision };
}

export async function assessFraudSignals(params: {
  userId: number;
  listingId?: number | null;
}): Promise<{
  score: number;
  confidence: number;
  decision: 'ALLOW' | 'REVIEW' | 'REJECT';
  signals: Record<string, number>;
  explanation: string;
}> {
  const signals: Record<string, number> = {};
  const user = await queryOne<Row>(
    `SELECT created_at, status FROM users WHERE id = ?`,
    [params.userId],
  );
  const ageHours = user?.created_at ? (Date.now() - new Date(user.created_at as Date).getTime()) / 3_600_000 : 0;
  if (ageHours < 1) signals.new_account = 0.4;
  else if (ageHours < 48) signals.young_account = 0.2;

  const devices = await queryCount(
    `SELECT COUNT(DISTINCT device_id) FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL`,
    [params.userId],
  ).catch(() => 0);
  if (devices >= 8) signals.many_devices = 0.35;

  const failedPays = await queryCount(
    `SELECT COUNT(*) FROM payment_intents WHERE user_id = ? AND status IN ('failed','cancelled')
       AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 7 DAY)`,
    [params.userId],
  ).catch(() => 0);
  if (failedPays >= 5) signals.failed_payments = 0.4;

  const prior = await queryCount(
    `SELECT COUNT(*) FROM fake_detections WHERE target_kind = 'user' AND target_id = ? AND status IN ('detected','confirmed')`,
    [params.userId],
  );
  if (prior > 0) signals.prior_flags = Math.min(1, 0.3 + prior * 0.15);

  const velocity = await queryCount(
    `SELECT COUNT(*) FROM listings WHERE user_id = ? AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
    [params.userId],
  );
  if (velocity >= 20) signals.velocity = 0.7;
  else if (velocity >= 8) signals.velocity = 0.3;

  const score = Math.min(1, Object.values(signals).reduce((max, n) => Math.max(max, n), 0) + Object.values(signals).reduce((s, n) => s + n, 0) * 0.12);
  const decision: 'ALLOW' | 'REVIEW' | 'REJECT' = score >= 0.85 ? 'REVIEW' : score >= 0.4 ? 'REVIEW' : 'ALLOW';
  return {
    score,
    confidence: Math.round(35 + Object.keys(signals).length * 8),
    decision,
    signals,
    explanation:
      decision === 'ALLOW'
        ? 'No high-risk pattern from account, device, payment and listing velocity signals.'
        : 'Multiple risk signals. A human must review before any irreversible fraud action.',
  };
}

export async function runMarketAnalysis(params: {
  marketplaceId: number;
  countryId: number;
  currency: string;
  period?: 'week' | 'month';
}): Promise<Record<string, unknown>> {
  const period = params.period ?? 'month';
  const days = period === 'week' ? 7 : 30;
  const stats = await queryOne<Row>(
    `SELECT COUNT(*) AS total_listings,
            SUM(created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? DAY)) AS new_listings,
            AVG(price) AS avg_price,
            MIN(price) AS min_price,
            MAX(price) AS max_price
       FROM listings
      WHERE marketplace_id = ? AND deleted_at IS NULL AND status = 'published'
        AND (country_id = ? OR ? IS NULL)`,
    [days, params.marketplaceId, params.countryId, params.countryId],
  );
  const medianRow = await queryOne<Row>(
    `SELECT price FROM listings
      WHERE marketplace_id = ? AND deleted_at IS NULL AND status = 'published' AND price IS NOT NULL
      ORDER BY price LIMIT 1 OFFSET (
        SELECT GREATEST(FLOOR(COUNT(*)/2)-1, 0) FROM listings
         WHERE marketplace_id = ? AND deleted_at IS NULL AND status = 'published' AND price IS NOT NULL
      )`,
    [params.marketplaceId, params.marketplaceId],
  ).catch(() => null);

  const result = {
    marketplaceId: params.marketplaceId,
    countryId: params.countryId,
    currency: params.currency,
    period,
    totalListings: Number(stats?.total_listings ?? 0),
    newListings: Number(stats?.new_listings ?? 0),
    averagePrice: toNumber(stats?.avg_price),
    medianPrice: toNumber(medianRow?.price),
    minPrice: toNumber(stats?.min_price),
    maxPrice: toNumber(stats?.max_price),
    source: 'database',
    disclaimer: 'Figures are computed from live marketplace listings. They are not a forecast.',
  };

  await execute(
    `INSERT INTO ai_market_analysis
       (uuid, marketplace_id, country_id, city_id, category_id, period, period_start, period_end, currency,
        total_listings, new_listings, avg_price, median_price, summary, model)
     VALUES (?, ?, ?, 0, 0, ?, DATE_SUB(CURRENT_DATE, INTERVAL ? DAY), CURRENT_DATE, ?, ?, ?, ?, ?, ?, 'stats-v1')
     ON DUPLICATE KEY UPDATE total_listings = VALUES(total_listings), avg_price = VALUES(avg_price),
       median_price = VALUES(median_price), summary = VALUES(summary)`,
    [
      uuid(),
      params.marketplaceId,
      params.countryId,
      period === 'week' ? 'week' : 'month',
      days,
      params.currency,
      result.totalListings,
      result.newListings,
      result.averagePrice,
      result.medianPrice,
      `Supply ${result.totalListings} live listings; ${result.newListings} new in the last ${days} days.`,
    ],
  ).catch(() => undefined);

  return result;
}

export async function generateRecommendations(params: {
  userId?: number | null;
  guestUuid?: string | null;
  marketplaceId?: number | null;
  limit?: number;
}): Promise<{ listingIds: number[]; strategy: string; explanation: string }> {
  const limit = Math.min(params.limit ?? 12, 24);
  if (params.userId) {
    const viewed = await queryRows<Row>(
      `SELECT listing_id, COUNT(*) AS c FROM listing_views
        WHERE user_id = ? AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)
        GROUP BY listing_id ORDER BY c DESC LIMIT 20`,
      [params.userId],
    );
    const favs = await queryRows<Row>(
      `SELECT COALESCE(listing_id, entity_id) AS listing_id FROM favorites
        WHERE user_id = ? AND (entity_type = 'listing' OR listing_id IS NOT NULL)
        ORDER BY created_at DESC LIMIT 20`,
      [params.userId],
    ).catch(() => [] as Row[]);
    const seedIds = [...viewed, ...favs].map((row) => Number(row.listing_id)).filter(Boolean);
    if (seedIds.length > 0) {
      const cats = await queryRows<Row>(
        `SELECT category_id, marketplace_id, AVG(price) AS avg_price FROM listings WHERE id IN (${seedIds.map(() => '?').join(',')}) GROUP BY category_id, marketplace_id`,
        seedIds,
      );
      const listingIds: number[] = [];
      for (const cat of cats) {
        const rows = await queryRows<Row>(
          `SELECT id FROM listings
            WHERE category_id = ? AND deleted_at IS NULL AND status = 'published'
              AND id NOT IN (${seedIds.map(() => '?').join(',')})
            ORDER BY published_at DESC LIMIT ?`,
          [cat.category_id, ...seedIds, limit],
        );
        listingIds.push(...rows.map((row) => Number(row.id)));
      }
      const unique = [...new Set(listingIds)].slice(0, limit);
      if (unique.length > 0) {
        await execute(
          `INSERT INTO ai_recommendations (user_id, guest_uuid, marketplace_id, strategy, listing_ids, generated_at, expires_at)
           VALUES (?, ?, ?, 'hybrid', ?, CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 6 HOUR))`,
          [params.userId, params.guestUuid ?? null, params.marketplaceId ?? null, JSON.stringify(unique)],
        ).catch(() => undefined);
        return {
          listingIds: unique,
          strategy: 'hybrid',
          explanation: 'Based on recent views and saved listings in the same categories — not on your subscription tier.',
        };
      }
    }
  }

  const trending = await queryRows<Row>(
    `SELECT id FROM listings
      WHERE deleted_at IS NULL AND status = 'published'
        AND (? IS NULL OR marketplace_id = ?)
      ORDER BY published_at DESC LIMIT ?`,
    [params.marketplaceId ?? null, params.marketplaceId ?? null, limit],
  );
  const listingIds = trending.map((row) => Number(row.id));
  return {
    listingIds,
    strategy: 'trending',
    explanation: 'Cold start: showing recently published listings until we learn your preferences.',
  };
}

export async function persistSearchInterpretation(params: {
  query: string;
  language: string;
  interpretation: Record<string, unknown>;
  userId?: number | null;
  jobId?: number | null;
}): Promise<void> {
  await execute(
    `INSERT INTO ai_search_interpretations
       (uuid, raw_query, language, detected_intent, rewritten_query, confidence, model, user_id, job_id, extracted_filters)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      params.query.slice(0, 500),
      params.language,
      String(params.interpretation.intent ?? 'unknown'),
      String(params.interpretation.rewrittenQuery ?? params.query).slice(0, 500),
      Number(params.interpretation.confidence ?? 0),
      String(params.interpretation.model ?? 'unknown'),
      params.userId ?? null,
      params.jobId ?? null,
      JSON.stringify(params.interpretation.filters ?? {}),
    ],
  ).catch(() => undefined);
}

export async function runQueuedCapability(params: {
  jobId: number;
  jobUuid: string;
  task: AiTask;
  userId: number | null;
  input: unknown;
  entityId: number | null;
}): Promise<void> {
  const input = (params.input ?? {}) as Record<string, unknown>;
  if (params.task === 'image_enhance') {
    if (!params.userId) throw new AppError('Enhancement requires a signed-in user', { status: 401, code: ErrorCode.UNAUTHENTICATED });
    const mediaId = Number(input.mediaId ?? params.entityId);
    await enhanceListingImage({ userId: params.userId, mediaId, jobId: params.jobId, jobUuid: params.jobUuid });
    return;
  }
  if (params.task === 'market_analysis') {
    const startedAt = Date.now();
    const result = await runMarketAnalysis({
      marketplaceId: Number(input.marketplaceId ?? 1),
      countryId: Number(input.countryId ?? 1),
      currency: String(input.currency ?? 'USD'),
      period: input.period === 'week' ? 'week' : 'month',
    });
    await finishJob({
      jobId: params.jobId,
      jobUuid: params.jobUuid,
      userId: params.userId,
      task: 'market_analysis',
      status: 'succeeded',
      provider: 'stats',
      model: 'stats-v1',
      output: result,
      latencyMs: Date.now() - startedAt,
      confidence: 90,
      decision: 'high',
    });
    return;
  }
  if (params.task === 'recommend') {
    const startedAt = Date.now();
    const result = await generateRecommendations({
      userId: params.userId,
      marketplaceId: input.marketplaceId ? Number(input.marketplaceId) : null,
    });
    await finishJob({
      jobId: params.jobId,
      jobUuid: params.jobUuid,
      userId: params.userId,
      task: 'recommend',
      status: 'succeeded',
      provider: 'heuristic',
      model: 'rec-v1',
      output: result,
      latencyMs: Date.now() - startedAt,
      confidence: 60,
      decision: 'medium',
    });
    return;
  }
  if (params.task === 'translate') {
    const startedAt = Date.now();
    const result = await runWithFallback((driver) =>
      translateCached(
        driver,
        String(input.text ?? ''),
        String(input.targetLanguage ?? 'en'),
        input.sourceLanguage as string | undefined,
      ),
    );
    await finishJob({
      jobId: params.jobId,
      jobUuid: params.jobUuid,
      userId: params.userId,
      task: 'translate',
      status: 'succeeded',
      provider: result.model,
      model: result.model,
      output: result,
      latencyMs: Date.now() - startedAt,
      confidence: result.confidence,
      decision: result.cacheHit ? 'high' : 'medium',
      cacheHit: result.cacheHit,
    });
    return;
  }
}
