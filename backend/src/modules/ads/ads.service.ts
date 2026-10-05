import { execute, insertAndGetId, queryCount, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { uuid, hashIp } from '../../core/security/crypto';
import { eventBus } from '../../core/events/event-bus';
import { toJson, toNumber } from '../../db/sql';
import { consumeQuota } from '../../middleware/entitlements';
import { contextOrDefaults } from '../../core/context';
import { evaluateRisk } from '../risk/risk.engine';
import { FORBIDDEN_TARGET_KINDS, computeAdRank, expectedEngagement, labelForFormat, qualityFromCreative } from './ads.types';
import { loadEligibleCreatives, type DeliveryContext, type EligibleCreative } from './ads.eligibility';
import {
  classifyInvalidTraffic,
  eventCost,
  isBotUserAgent,
  signDeliveryToken,
  verifyDeliveryToken,
} from './ads.tracking';
import { applySpend, fundCampaign as billFundCampaign } from './ads.billing';

export type { DeliveryContext };

export async function getPlacements(marketplaceId: number | null, page?: string | null) {
  const rows = await queryRows<Row>(
    `SELECT id, code, name, page, position, format, width, height, aspect_ratio, marketplace_id
       FROM ad_placements
      WHERE is_active = 1
        AND (marketplace_id = ? OR marketplace_id IS NULL)
        AND (? IS NULL OR page = ?)
      ORDER BY sort_order, code`,
    [marketplaceId, page ?? null, page ?? null],
  );

  return rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    page: (row.page as string | null) ?? null,
    position: (row.position as string | null) ?? null,
    format: String(row.format),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    aspectRatio: (row.aspect_ratio as string | null) ?? null,
    marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
  }));
}

export interface ServedAd {
  uuid: string;
  campaignId: number;
  headline: string | null;
  body: string | null;
  ctaLabel: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  landingUrl: string | null;
  deepLink: string | null;
  format: string;
  listingId: number | null;
  label: 'Sponsored' | 'Featured' | 'Advertisement';
  impressionToken: string;
}

async function ensureAdvertiser(userId: number): Promise<Row> {
  const existing = await queryOne<Row>(`SELECT * FROM ad_advertisers WHERE user_id = ? LIMIT 1`, [userId]);
  if (existing) return existing;
  const user = await queryOne<Row>(
    `SELECT u.id, u.country_id, p.display_name, p.preferred_currency
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.id = ?`,
    [userId],
  );
  if (!user) throw notFound('User');
  const id = await insertAndGetId(
    `INSERT INTO ad_advertisers (uuid, user_id, company_name, country_id, currency, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [
      uuid(),
      userId,
      (user.display_name as string | null) || `Advertiser ${userId}`,
      user.country_id,
      (user.preferred_currency as string | null) || 'USD',
    ],
  );
  const created = await queryOne<Row>(`SELECT * FROM ad_advertisers WHERE id = ?`, [id]);
  return created!;
}

function mapCampaign(row: Row) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    name: String(row.name),
    objective: String(row.objective),
    status: String(row.status),
    pricingModel: String(row.pricing_model),
    bidAmount: toNumber(row.bid_amount),
    totalBudget: toNumber(row.total_budget),
    dailyBudget: toNumber(row.daily_budget),
    spentAmount: toNumber(row.spent_amount) ?? 0,
    currency: String(row.currency),
    marketplaceId: row.marketplace_id === null ? null : Number(row.marketplace_id),
    categoryId: row.category_id === null ? null : Number(row.category_id),
    startsAt: row.starts_at ? (row.starts_at as Date).toISOString() : null,
    endsAt: row.ends_at ? (row.ends_at as Date).toISOString() : null,
    reviewNotes: (row.review_notes as string | null) ?? null,
  };
}

async function loadOwnedCampaign(userId: number, campaignUuid: string, isStaff = false) {
  const row = await queryOne<Row>(
    `SELECT c.*, a.user_id AS advertiser_user_id, a.balance, a.credit_limit, a.status AS advertiser_status
       FROM ad_campaigns c
       JOIN ad_advertisers a ON a.id = c.advertiser_id
      WHERE c.uuid = ?`,
    [campaignUuid],
  );
  if (!row) throw notFound('Campaign');
  if (!isStaff && Number(row.advertiser_user_id) !== userId) throw forbidden('You do not own this campaign');
  return row;
}

function sanitizeTargeting(rules: Array<{ kind: string; operator?: string; values?: unknown[] }>) {
  return rules.filter((rule) => !FORBIDDEN_TARGET_KINDS.has(rule.kind));
}

function creativeLooksSafe(input: { headline?: string | null; body?: string | null; landingUrl?: string | null }) {
  const text = `${input.headline ?? ''} ${input.body ?? ''}`.toLowerCase();
  if (/(viagra|crypto giveaway|double your money|guaranteed returns)/i.test(text)) return false;
  if (input.landingUrl && !/^https:\/\//i.test(input.landingUrl) && !/^marketplace:\/\//i.test(input.landingUrl)) {
    return false;
  }
  return true;
}

export async function getAdvertiser(userId: number) {
  const row = await ensureAdvertiser(userId);
  return {
    uuid: String(row.uuid),
    companyName: String(row.company_name),
    status: String(row.status),
    balance: toNumber(row.balance) ?? 0,
    creditLimit: toNumber(row.credit_limit) ?? 0,
    currency: String(row.currency),
  };
}

export async function listCampaigns(userId: number) {
  await ensureAdvertiser(userId);
  const rows = await queryRows<Row>(
    `SELECT c.* FROM ad_campaigns c
       JOIN ad_advertisers a ON a.id = c.advertiser_id
      WHERE a.user_id = ?
      ORDER BY c.created_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map(mapCampaign);
}

export async function getCampaign(userId: number, campaignUuid: string, isStaff = false) {
  const row = await loadOwnedCampaign(userId, campaignUuid, isStaff);
  const creatives = await queryRows<Row>(
    `SELECT id, uuid, name, format, headline, body, cta_label, image_url, video_url, landing_url, deep_link, status, impressions, clicks
       FROM ad_creatives WHERE campaign_id = ? ORDER BY id`,
    [row.id],
  );
  const targeting = await queryRows<Row>(
    `SELECT target_kind, operator, target_values FROM ad_targeting WHERE campaign_id = ?`,
    [row.id],
  );
  const placements = await queryRows<Row>(
    `SELECT p.code, p.name, p.format, cp.bid_amount
       FROM ad_campaign_placements cp JOIN ad_placements p ON p.id = cp.placement_id
      WHERE cp.campaign_id = ? AND cp.is_active = 1`,
    [row.id],
  );
  const stats = await queryOne<Row>(
    `SELECT SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(spend) AS spend, SUM(conversions) AS conversions
       FROM ad_daily_stats WHERE campaign_id = ?`,
    [row.id],
  );
  return {
    ...mapCampaign(row),
    advertiserBalance: toNumber(row.balance) ?? 0,
    creatives: creatives.map((item) => ({
      uuid: String(item.uuid),
      name: (item.name as string | null) ?? null,
      format: String(item.format),
      headline: (item.headline as string | null) ?? null,
      body: (item.body as string | null) ?? null,
      ctaLabel: (item.cta_label as string | null) ?? null,
      imageUrl: (item.image_url as string | null) ?? null,
      videoUrl: (item.video_url as string | null) ?? null,
      landingUrl: (item.landing_url as string | null) ?? null,
      deepLink: (item.deep_link as string | null) ?? null,
      status: String(item.status),
      impressions: Number(item.impressions ?? 0),
      clicks: Number(item.clicks ?? 0),
    })),
    targeting: targeting
      .filter((item) => !FORBIDDEN_TARGET_KINDS.has(String(item.target_kind)))
      .map((item) => ({
        kind: String(item.target_kind),
        operator: String(item.operator),
        values: toJson(item.target_values, []),
      })),
    placements: placements.map((item) => ({
      code: String(item.code),
      name: String(item.name),
      format: String(item.format),
      bidAmount: toNumber(item.bid_amount),
    })),
    analytics: {
      impressions: Number(stats?.impressions ?? 0),
      clicks: Number(stats?.clicks ?? 0),
      conversions: Number(stats?.conversions ?? 0),
      spend: toNumber(stats?.spend) ?? Number(row.spent_amount ?? 0),
    },
  };
}

export async function createCampaign(
  userId: number,
  input: {
    name: string;
    objective?: string;
    marketplaceId?: number | null;
    categoryId?: number | null;
    pricingModel?: string;
    bidAmount?: number | null;
    totalBudget?: number | null;
    dailyBudget?: number | null;
    currency?: string;
    startsAt?: string | null;
    endsAt?: string | null;
    placementCodes?: string[];
    listingId?: number | null;
  },
) {
  await consumeQuota(userId, 'ad_campaigns');
  const advertiser = await ensureAdvertiser(userId);
  if (String(advertiser.status) !== 'active') throw forbidden('Advertiser account is not active');
  const campaignUuid = uuid();
  const id = await insertAndGetId(
    `INSERT INTO ad_campaigns
       (uuid, advertiser_id, name, objective, marketplace_id, category_id, status, pricing_model,
        bid_amount, total_budget, daily_budget, currency, starts_at, ends_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      campaignUuid,
      advertiser.id,
      input.name,
      input.objective ?? 'traffic',
      input.marketplaceId ?? null,
      input.categoryId ?? null,
      input.pricingModel ?? 'cpc',
      input.bidAmount ?? null,
      input.totalBudget ?? null,
      input.dailyBudget ?? null,
      input.currency ?? String(advertiser.currency),
      input.startsAt ? new Date(input.startsAt) : null,
      input.endsAt ? new Date(input.endsAt) : null,
      userId,
    ],
  );

  if (input.placementCodes?.length) {
    await attachPlacements(id, input.placementCodes);
  }
  if (input.listingId) {
    await execute(
      `INSERT INTO sponsored_listings (campaign_id, listing_id, bid_amount, currency, status)
       VALUES (?, ?, ?, ?, 'paused')
       ON DUPLICATE KEY UPDATE bid_amount = VALUES(bid_amount)`,
      [id, input.listingId, input.bidAmount ?? null, input.currency ?? String(advertiser.currency)],
    );
  }
  return getCampaign(userId, campaignUuid);
}

async function attachPlacements(campaignId: number, codes: string[]) {
  const placements = await queryRows<Row>(
    `SELECT id, code FROM ad_placements WHERE code IN (${codes.map(() => '?').join(',')}) AND is_active = 1`,
    codes,
  );
  for (const placement of placements) {
    await execute(
      `INSERT INTO ad_campaign_placements (campaign_id, placement_id, is_active)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE is_active = 1`,
      [campaignId, placement.id],
    );
  }
}

export async function updateCampaign(
  userId: number,
  campaignUuid: string,
  input: {
    name?: string;
    bidAmount?: number | null;
    totalBudget?: number | null;
    dailyBudget?: number | null;
    startsAt?: string | null;
    endsAt?: string | null;
    placementCodes?: string[];
  },
) {
  const row = await loadOwnedCampaign(userId, campaignUuid);
  if (!['draft', 'paused', 'rejected', 'scheduled'].includes(String(row.status))) {
    throw conflict('Active campaigns must be paused before editing');
  }
  await execute(
    `UPDATE ad_campaigns SET name = ?, bid_amount = ?, total_budget = ?, daily_budget = ?, starts_at = ?, ends_at = ?
      WHERE id = ?`,
    [
      input.name ?? row.name,
      input.bidAmount === undefined ? row.bid_amount : input.bidAmount,
      input.totalBudget === undefined ? row.total_budget : input.totalBudget,
      input.dailyBudget === undefined ? row.daily_budget : input.dailyBudget,
      input.startsAt === undefined ? row.starts_at : input.startsAt ? new Date(input.startsAt) : null,
      input.endsAt === undefined ? row.ends_at : input.endsAt ? new Date(input.endsAt) : null,
      row.id,
    ],
  );
  if (input.placementCodes) await attachPlacements(Number(row.id), input.placementCodes);
  return getCampaign(userId, campaignUuid);
}

export async function setTargeting(
  userId: number,
  campaignUuid: string,
  rules: Array<{ kind: string; operator?: string; values?: unknown[] }>,
) {
  const row = await loadOwnedCampaign(userId, campaignUuid);
  const allowed = sanitizeTargeting(rules);
  await execute(`DELETE FROM ad_targeting WHERE campaign_id = ?`, [row.id]);
  for (const rule of allowed) {
    await execute(
      `INSERT INTO ad_targeting (campaign_id, target_kind, operator, target_values) VALUES (?, ?, ?, ?)`,
      [row.id, rule.kind, rule.operator === 'exclude' ? 'exclude' : 'include', JSON.stringify(rule.values ?? [])],
    );
  }
  return getCampaign(userId, campaignUuid);
}

export async function addCreative(
  userId: number,
  campaignUuid: string,
  input: {
    name?: string;
    format?: string;
    headline?: string | null;
    body?: string | null;
    ctaLabel?: string | null;
    imageUrl?: string | null;
    videoUrl?: string | null;
    landingUrl?: string | null;
    deepLink?: string | null;
  },
) {
  const row = await loadOwnedCampaign(userId, campaignUuid);
  const approved = creativeLooksSafe(input);
  const creativeUuid = uuid();
  await insertAndGetId(
    `INSERT INTO ad_creatives
       (uuid, campaign_id, name, format, headline, body, cta_label, image_url, video_url, landing_url, deep_link, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      creativeUuid,
      row.id,
      input.name ?? null,
      input.format ?? 'native',
      input.headline ?? null,
      input.body ?? null,
      input.ctaLabel ?? 'View',
      input.imageUrl ?? null,
      input.videoUrl ?? null,
      input.landingUrl ?? null,
      input.deepLink ?? null,
      approved ? 'approved' : 'pending_review',
    ],
  );
  return getCampaign(userId, campaignUuid);
}

export async function submitCampaign(userId: number, campaignUuid: string) {
  const row = await loadOwnedCampaign(userId, campaignUuid);
  const creatives = await queryCount(`SELECT COUNT(*) FROM ad_creatives WHERE campaign_id = ?`, [row.id]);
  if (creatives === 0) throw badRequest('Add a creative before submitting');
  const pending = await queryCount(
    `SELECT COUNT(*) FROM ad_creatives WHERE campaign_id = ? AND status = 'pending_review'`,
    [row.id],
  );
  const rejected = await queryCount(
    `SELECT COUNT(*) FROM ad_creatives WHERE campaign_id = ? AND status = 'rejected'`,
    [row.id],
  );
  if (rejected > 0) throw conflict('Replace rejected creatives before submitting');
  const next = pending > 0 ? 'pending_review' : 'approved';
  const live =
    next === 'approved' && (!row.starts_at || new Date(row.starts_at as Date).getTime() <= Date.now()) ? 'active' : next === 'approved' ? 'scheduled' : next;
  await execute(`UPDATE ad_campaigns SET status = ? WHERE id = ?`, [live === 'active' ? 'active' : live, row.id]);
  await execute(
    `UPDATE sponsored_listings SET status = 'active' WHERE campaign_id = ? AND status = 'paused'`,
    [row.id],
  );
  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'ad_campaign.submitted', 'ad_campaign', Number(row.id), {
      campaignId: Number(row.id),
      advertiserId: Number(row.advertiser_id),
    });
    void eventBus.publishAfterCommit(event);
    if (live === 'active' || live === 'scheduled') {
      const approved = await eventBus.enqueue(connection, 'ad_campaign.approved', 'ad_campaign', Number(row.id), {
        campaignId: Number(row.id),
        advertiserId: Number(row.advertiser_id),
      });
      void eventBus.publishAfterCommit(approved);
    }
  });
  return getCampaign(userId, campaignUuid);
}

export async function pauseCampaign(userId: number, campaignUuid: string) {
  const row = await loadOwnedCampaign(userId, campaignUuid);
  await execute(`UPDATE ad_campaigns SET status = 'paused' WHERE id = ? AND status IN ('active','scheduled')`, [row.id]);
  await execute(`UPDATE sponsored_listings SET status = 'paused' WHERE campaign_id = ?`, [row.id]);
  return getCampaign(userId, campaignUuid);
}

export async function resumeCampaign(userId: number, campaignUuid: string) {
  const row = await loadOwnedCampaign(userId, campaignUuid);
  if (String(row.status) !== 'paused') throw conflict('Only paused campaigns can be resumed');
  const live = !row.starts_at || new Date(row.starts_at as Date).getTime() <= Date.now() ? 'active' : 'scheduled';
  await execute(`UPDATE ad_campaigns SET status = ? WHERE id = ?`, [live, row.id]);
  await execute(`UPDATE sponsored_listings SET status = 'active' WHERE campaign_id = ?`, [row.id]);
  return getCampaign(userId, campaignUuid);
}

export async function fundCampaign(
  userId: number,
  campaignUuid: string,
  input: { amount: number; gatewayCode: string; paymentMethod?: string; returnUrl?: string; countryId?: number; currency?: string },
) {
  const row = await loadOwnedCampaign(userId, campaignUuid);
  const ctx = contextOrDefaults();
  return billFundCampaign({
    userId,
    campaignId: Number(row.id),
    amount: input.amount,
    currency: input.currency ?? String(row.currency),
    countryId: input.countryId ?? ctx.countryId ?? 1,
    gatewayCode: input.gatewayCode,
    paymentMethod: input.paymentMethod,
    returnUrl: input.returnUrl,
  });
}

export async function staffDecideCampaign(
  staffId: number,
  campaignUuid: string,
  decision: 'approve' | 'reject',
  reason?: string,
) {
  const row = await queryOne<Row>(`SELECT * FROM ad_campaigns WHERE uuid = ?`, [campaignUuid]);
  if (!row) throw notFound('Campaign');
  if (decision === 'reject') {
    await execute(
      `UPDATE ad_campaigns SET status = 'rejected', review_notes = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [reason ?? 'Rejected', staffId, row.id],
    );
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'ad_campaign.rejected', 'ad_campaign', Number(row.id), {
        campaignId: Number(row.id),
        advertiserId: Number(row.advertiser_id),
        reason: reason ?? 'Rejected',
      });
      void eventBus.publishAfterCommit(event);
    });
  } else {
    const live = !row.starts_at || new Date(row.starts_at as Date).getTime() <= Date.now() ? 'active' : 'scheduled';
    await execute(
      `UPDATE ad_campaigns SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [live, staffId, row.id],
    );
    await execute(`UPDATE ad_creatives SET status = 'approved' WHERE campaign_id = ? AND status = 'pending_review'`, [row.id]);
    await transaction(async (connection) => {
      const event = await eventBus.enqueue(connection, 'ad_campaign.approved', 'ad_campaign', Number(row.id), {
        campaignId: Number(row.id),
        advertiserId: Number(row.advertiser_id),
      });
      void eventBus.publishAfterCommit(event);
    });
  }
  return { uuid: campaignUuid, status: decision === 'reject' ? 'rejected' : 'approved' };
}

export async function listModerationCampaigns() {
  const rows = await queryRows<Row>(
    `SELECT c.uuid, c.name, c.status, c.objective, c.created_at, a.company_name
       FROM ad_campaigns c
       JOIN ad_advertisers a ON a.id = c.advertiser_id
      WHERE c.status = 'pending_review'
      ORDER BY c.created_at ASC LIMIT 50`,
  );
  return rows.map((row) => ({
    uuid: String(row.uuid),
    name: String(row.name),
    status: String(row.status),
    objective: String(row.objective),
    advertiser: String(row.company_name),
    createdAt: (row.created_at as Date).toISOString(),
  }));
}

function rankCreatives(items: EligibleCreative[]): EligibleCreative[] {
  return [...items]
    .map((item) => {
      const quality = qualityFromCreative({ moderationScore: item.moderationScore, ctr: item.ctr });
      const engagement = expectedEngagement(item.objective, item.ctr);
      const floor = item.pricingModel === 'cpc' ? item.floorCpc : item.floorCpm;
      return { item, rank: computeAdRank({ bid: item.bid, quality, expectedEngagement: engagement, floor }) };
    })
    .sort((a, b) => b.rank - a.rank)
    .map((row) => row.item);
}

async function withinFrequencyCap(creative: EligibleCreative, ctx: DeliveryContext): Promise<boolean> {
  const campaign = await queryOne<Row>(
    `SELECT frequency_cap_per_user, frequency_cap_period FROM ad_campaigns WHERE id = ?`,
    [creative.campaignId],
  );
  const cap = Number(campaign?.frequency_cap_per_user ?? 0);
  if (!cap) return true;
  const period = String(campaign?.frequency_cap_period ?? 'day');
  const interval = period === 'hour' ? '1 HOUR' : period === 'week' ? '7 DAY' : period === 'campaign' ? '365 DAY' : '1 DAY';
  const count = ctx.userId
    ? await queryCount(
        `SELECT COUNT(*) FROM ad_impressions WHERE campaign_id = ? AND user_id = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${interval})`,
        [creative.campaignId, ctx.userId],
      )
    : 0;
  return count < cap;
}

export async function servePlacement(placementCode: string, ctx: DeliveryContext, limit = 3): Promise<{
  placement: { code: string; format: string } | null;
  ads: ServedAd[];
}> {
  const placement = await queryOne<Row>(`SELECT code, format FROM ad_placements WHERE code = ? AND is_active = 1`, [
    placementCode,
  ]);
  if (!placement) return { placement: null, ads: [] };

  const eligible = await loadEligibleCreatives(placementCode, ctx);
  const capped: EligibleCreative[] = [];
  for (const item of eligible) {
    if (await withinFrequencyCap(item, ctx)) capped.push(item);
  }
  const winners = rankCreatives(capped).slice(0, Math.max(1, Math.min(limit, 5)));
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return {
    placement: { code: String(placement.code), format: String(placement.format) },
    ads: winners.map((item) => ({
      uuid: item.creativeUuid,
      campaignId: item.campaignId,
      headline: item.headline,
      body: item.body,
      ctaLabel: item.ctaLabel,
      imageUrl: item.imageUrl,
      videoUrl: item.videoUrl,
      landingUrl: item.landingUrl,
      deepLink: item.deepLink,
      format: item.format,
      listingId: item.listingId,
      label: labelForFormat(item.format),
      impressionToken: signDeliveryToken({
        creativeUuid: item.creativeUuid,
        campaignId: item.campaignId,
        placementCode,
        exp,
      }),
    })),
  };
}

async function loadCreativeForToken(token: string) {
  const parsed = verifyDeliveryToken(token);
  if (!parsed) throw badRequest('Invalid or expired ad token');
  const row = await queryOne<Row>(
    `SELECT cr.id, cr.uuid, cr.campaign_id, c.advertiser_id, c.pricing_model, c.bid_amount, c.currency,
            c.spent_amount, c.total_budget, c.daily_budget, a.user_id AS advertiser_user_id, a.balance, a.credit_limit,
            p.id AS placement_id, p.code AS placement_code
       FROM ad_creatives cr
       JOIN ad_campaigns c ON c.id = cr.campaign_id
       JOIN ad_advertisers a ON a.id = c.advertiser_id
       JOIN ad_placements p ON p.code = ?
      WHERE cr.uuid = ? AND cr.campaign_id = ?`,
    [parsed.placementCode, parsed.creativeUuid, parsed.campaignId],
  );
  if (!row) throw notFound('Creative');
  return { parsed, row };
}

export async function recordImpression(input: {
  token: string;
  userId: number | null;
  viewable?: boolean;
  viewDurationMs?: number | null;
  listingId?: number | null;
}) {
  const { parsed, row } = await loadCreativeForToken(input.token);
  const ctx = contextOrDefaults();
  const ipHash = hashIp(ctx.ip);
  const recent = await queryCount(
    `SELECT COUNT(*) FROM ad_impressions WHERE campaign_id = ? AND ip_hash = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 MINUTE)`,
    [row.campaign_id, ipHash],
  );
  const verdict = classifyInvalidTraffic({
    isSelfClick: input.userId !== null && input.userId === Number(row.advertiser_user_id),
    hasImpression: true,
    duplicateWithinWindow: false,
    clickCountWindow: 0,
    impressionCountWindow: recent,
    isBotUa: isBotUserAgent(ctx.userAgent),
  });
  const impressionUuid = uuid();
  const id = await insertAndGetId(
    `INSERT INTO ad_impressions
       (uuid, campaign_id, creative_id, placement_id, user_id, guest_uuid, device_id, country_id, city_id,
        platform_id, marketplace_id, listing_id, cost, currency, is_viewable, view_duration_ms, is_invalid, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      impressionUuid,
      row.campaign_id,
      row.id,
      row.placement_id,
      input.userId,
      ctx.guestUuid,
      ctx.deviceId,
      ctx.countryId,
      null,
      ctx.platformId,
      ctx.marketplaceId,
      input.listingId ?? null,
      row.currency,
      input.viewable ? 1 : 0,
      input.viewDurationMs ?? null,
      verdict.invalid ? 1 : 0,
      ipHash,
    ],
  );
  await execute(`UPDATE ad_creatives SET impressions = impressions + 1 WHERE id = ?`, [row.id]);

  let billed = false;
  if (!verdict.invalid) {
    const kind = (input.viewDurationMs ?? 0) >= 2000 ? 'view' : 'impression';
    const cost = eventCost(String(row.pricing_model), toNumber(row.bid_amount) ?? 0, kind);
    if (cost > 0) {
      billed = await applySpend({
        campaignId: Number(row.campaign_id),
        advertiserId: Number(row.advertiser_id),
        amount: cost,
        currency: String(row.currency),
        pricingModel: String(row.pricing_model),
        impressionId: id,
      });
      if (billed) await execute(`UPDATE ad_impressions SET cost = ? WHERE id = ?`, [cost, id]);
    }
  }
  return { uuid: impressionUuid, invalid: verdict.invalid, reason: verdict.reason, billed, placement: parsed.placementCode };
}

export async function recordClick(input: {
  token: string;
  impressionUuid?: string | null;
  userId: number | null;
}) {
  const { row } = await loadCreativeForToken(input.token);
  const ctx = contextOrDefaults();
  const ipHash = hashIp(ctx.ip);
  const impression = input.impressionUuid
    ? await queryOne<Row>(`SELECT id, campaign_id FROM ad_impressions WHERE uuid = ?`, [input.impressionUuid])
    : null;
  const recentClicks = await queryCount(
    `SELECT COUNT(*) FROM ad_clicks WHERE campaign_id = ? AND ip_hash = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE)`,
    [row.campaign_id, ipHash],
  );
  const duplicate = await queryCount(
    `SELECT COUNT(*) FROM ad_clicks WHERE campaign_id = ? AND ip_hash = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 SECOND)`,
    [row.campaign_id, ipHash],
  );
  const isSelf = input.userId !== null && input.userId === Number(row.advertiser_user_id);
  const verdict = classifyInvalidTraffic({
    isSelfClick: isSelf,
    hasImpression: Boolean(impression),
    duplicateWithinWindow: duplicate > 0,
    clickCountWindow: recentClicks,
    impressionCountWindow: 0,
    isBotUa: isBotUserAgent(ctx.userAgent),
  });

  const extraSignals = [];
  if (isSelf) extraSignals.push({ code: 'self_click', weight: 40, detail: 'advertiser', category: 'behavior' });
  if (recentClicks >= 12) extraSignals.push({ code: 'click_velocity', weight: 24, detail: `${recentClicks}/5m`, category: 'velocity' });
  if (verdict.invalid) extraSignals.push({ code: 'invalid_ad_traffic', weight: 30, detail: verdict.reason ?? 'invalid', category: 'network' });
  if (verdict.invalid && extraSignals.length > 0) {
    await evaluateRisk({
      eventType: 'AD_CLICK',
      subjectKind: 'user',
      subjectId: input.userId ?? 0,
      userId: input.userId,
      policyCode: 'ads',
      extraSignals,
      persist: true,
    }).catch(() => undefined);
  }

  const clickId = await insertAndGetId(
    `INSERT INTO ad_clicks
       (impression_id, campaign_id, creative_id, placement_id, user_id, guest_uuid, cost, currency,
        country_id, platform_id, is_fraud_suspected, is_invalid, invalid_reason, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
    [
      impression ? Number(impression.id) : null,
      row.campaign_id,
      row.id,
      row.placement_id,
      input.userId,
      ctx.guestUuid,
      row.currency,
      ctx.countryId,
      ctx.platformId,
      verdict.invalid ? 1 : 0,
      verdict.invalid ? 1 : 0,
      verdict.reason,
      ipHash,
    ],
  );
  await execute(`UPDATE ad_creatives SET clicks = clicks + 1 WHERE id = ?`, [row.id]);

  let billed = false;
  if (!verdict.invalid) {
    const cost = eventCost(String(row.pricing_model), toNumber(row.bid_amount) ?? 0, 'click');
    if (cost > 0) {
      billed = await applySpend({
        campaignId: Number(row.campaign_id),
        advertiserId: Number(row.advertiser_id),
        amount: cost,
        currency: String(row.currency),
        pricingModel: String(row.pricing_model),
        clickId,
      });
      if (billed) await execute(`UPDATE ad_clicks SET cost = ? WHERE id = ?`, [cost, clickId]);
    }
  }
  return { clickId, invalid: verdict.invalid, reason: verdict.reason, billed };
}

export async function recordConversion(input: {
  clickId?: number | null;
  campaignUuid?: string | null;
  kind: 'lead' | 'signup' | 'listing_view' | 'contact' | 'purchase' | 'call';
  userId: number | null;
  value?: number | null;
}) {
  const click = input.clickId
    ? await queryOne<Row>(`SELECT * FROM ad_clicks WHERE id = ? AND is_invalid = 0`, [input.clickId])
    : null;
  const campaign = click
    ? await queryOne<Row>(`SELECT * FROM ad_campaigns WHERE id = ?`, [click.campaign_id])
    : input.campaignUuid
      ? await queryOne<Row>(`SELECT * FROM ad_campaigns WHERE uuid = ?`, [input.campaignUuid])
      : null;
  if (!campaign) throw notFound('Campaign');
  const id = await insertAndGetId(
    `INSERT INTO ad_conversions (campaign_id, creative_id, click_id, user_id, conversion_kind, value, currency, attributed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [
      campaign.id,
      click ? click.creative_id : null,
      click ? click.id : null,
      input.userId,
      input.kind,
      input.value ?? null,
      campaign.currency,
    ],
  );
  let billed = false;
  if (String(campaign.pricing_model) === 'cpa') {
    billed = await applySpend({
      campaignId: Number(campaign.id),
      advertiserId: Number(campaign.advertiser_id),
      amount: toNumber(campaign.bid_amount) ?? 0,
      currency: String(campaign.currency),
      pricingModel: 'cpa',
      clickId: click ? Number(click.id) : null,
    });
  }
  return { id, billed };
}
