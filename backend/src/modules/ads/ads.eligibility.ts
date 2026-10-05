import { queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { FORBIDDEN_TARGET_KINDS } from './ads.types';

export interface DeliveryContext {
  marketplaceId: number | null;
  countryId: number | null;
  cityId: number | null;
  platform: string | null;
  language: string | null;
  categoryId: number | null;
  keywords: string[];
  userId: number | null;
}

export interface EligibleCreative {
  campaignId: number;
  creativeId: number;
  creativeUuid: string;
  advertiserId: number;
  advertiserUserId: number | null;
  placementId: number;
  placementCode: string;
  format: string;
  headline: string | null;
  body: string | null;
  ctaLabel: string | null;
  imageUrl: string | null;
  videoUrl: string | null;
  landingUrl: string | null;
  deepLink: string | null;
  listingId: number | null;
  objective: string;
  pricingModel: string;
  bid: number;
  floorCpm: number;
  floorCpc: number;
  moderationScore: number | null;
  ctr: number | null;
  spent: number;
  dailyBudget: number | null;
  totalBudget: number | null;
}

export interface TargetingRule {
  kind: string;
  operator: string;
  values: unknown[];
}

/** Age/gender rules are ignored even if a row exists — they are not productized. */
export function targetingAllows(rules: TargetingRule[], ctx: DeliveryContext): boolean {
  if (rules.length === 0) return true;
  for (const rule of rules) {
    const kind = rule.kind;
    if (FORBIDDEN_TARGET_KINDS.has(kind)) continue;
    const op = rule.operator === 'exclude' ? 'exclude' : 'include';
    const values = Array.isArray(rule.values) ? rule.values : [];
    const asStrings = values.map((value) => String(value).toLowerCase());
    let hit = true;
    if (kind === 'marketplace' && ctx.marketplaceId !== null) {
      hit = asStrings.includes(String(ctx.marketplaceId));
    } else if (kind === 'country' && ctx.countryId !== null) {
      hit = asStrings.includes(String(ctx.countryId));
    } else if (kind === 'city' && ctx.cityId !== null) {
      hit = asStrings.includes(String(ctx.cityId));
    } else if (kind === 'platform' && ctx.platform) {
      hit = asStrings.includes(ctx.platform.toLowerCase());
    } else if (kind === 'language' && ctx.language) {
      hit = asStrings.includes(ctx.language.toLowerCase());
    } else if (kind === 'category' && ctx.categoryId !== null) {
      hit = asStrings.includes(String(ctx.categoryId));
    } else if (kind === 'keyword' && ctx.keywords.length > 0) {
      hit = ctx.keywords.some((word) => asStrings.includes(word.toLowerCase()));
    } else {
      continue;
    }
    if (op === 'include' && !hit) return false;
    if (op === 'exclude' && hit) return false;
  }
  return true;
}

function targetingValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function targetingMatches(rules: Row[], ctx: DeliveryContext): boolean {
  return targetingAllows(
    rules.map((rule) => ({
      kind: String(rule.target_kind),
      operator: String(rule.operator),
      values: targetingValues(rule.target_values),
    })),
    ctx,
  );
}

/** Lifetime `spent_amount` is not today's spend. Daily cap uses billed events from CURRENT_DATE. */
export function isDailyBudgetReached(spentToday: number, dailyBudget: number | null): boolean {
  return dailyBudget !== null && spentToday >= dailyBudget;
}

export async function loadEligibleCreatives(placementCode: string, ctx: DeliveryContext): Promise<EligibleCreative[]> {
  const placement = await queryOne<Row>(
    `SELECT id, code, format, floor_cpm, floor_cpc FROM ad_placements WHERE code = ? AND is_active = 1`,
    [placementCode],
  );
  if (!placement) return [];

  const rows = await queryRows<Row>(
    `SELECT cr.id AS creative_id, cr.uuid AS creative_uuid, cr.headline, cr.body, cr.cta_label, cr.image_url, cr.video_url,
            cr.landing_url, cr.deep_link, cr.format, cr.moderation_score, cr.impressions, cr.clicks,
            c.id AS campaign_id, c.advertiser_id, c.objective, c.pricing_model, c.bid_amount, c.spent_amount,
            c.daily_budget, c.total_budget, c.marketplace_id, c.category_id, c.status, c.starts_at, c.ends_at,
            a.user_id AS advertiser_user_id, a.status AS advertiser_status,
            cp.bid_amount AS placement_bid, p.id AS placement_id, p.code AS placement_code,
            sl.listing_id
       FROM ad_creatives cr
       JOIN ad_campaigns c ON c.id = cr.campaign_id
       JOIN ad_advertisers a ON a.id = c.advertiser_id
       JOIN ad_campaign_placements cp ON cp.campaign_id = c.id AND cp.is_active = 1
       JOIN ad_placements p ON p.id = cp.placement_id
       LEFT JOIN sponsored_listings sl ON sl.campaign_id = c.id AND sl.status = 'active'
      WHERE p.code = ?
        AND cr.status = 'approved'
        AND a.status = 'active'
        AND c.status IN ('active','scheduled')
        AND (c.starts_at IS NULL OR c.starts_at <= CURRENT_TIMESTAMP)
        AND (c.ends_at IS NULL OR c.ends_at >= CURRENT_TIMESTAMP)
        AND (c.marketplace_id IS NULL OR ? IS NULL OR c.marketplace_id = ?)
        AND (c.total_budget IS NULL OR c.spent_amount < c.total_budget)`,
    [placementCode, ctx.marketplaceId, ctx.marketplaceId],
  );

  const targeting = await queryRows<Row>(
    `SELECT campaign_id, target_kind, operator, target_values FROM ad_targeting WHERE campaign_id IN (${
      rows.length === 0 ? '0' : rows.map(() => '?').join(',')
    })`,
    rows.map((row) => Number(row.campaign_id)),
  );
  const byCampaign = new Map<number, Row[]>();
  for (const rule of targeting) {
    const id = Number(rule.campaign_id);
    const list = byCampaign.get(id) ?? [];
    list.push(rule);
    byCampaign.set(id, list);
  }

  const campaignIds = [...new Set(rows.map((row) => Number(row.campaign_id)))];
  const todaySpendRows =
    campaignIds.length === 0
      ? []
      : await queryRows<Row>(
          `SELECT campaign_id, SUM(amount) AS spent
             FROM ad_spend_events
            WHERE billed = 1 AND created_at >= CURRENT_DATE
              AND campaign_id IN (${campaignIds.map(() => '?').join(',')})
            GROUP BY campaign_id`,
          campaignIds,
        );
  const todaySpend = new Map<number, number>();
  for (const row of todaySpendRows) {
    todaySpend.set(Number(row.campaign_id), Number(row.spent ?? 0));
  }

  const eligible: EligibleCreative[] = [];
  for (const row of rows) {
    if (String(row.advertiser_status) !== 'active') continue;
    if (!targetingMatches(byCampaign.get(Number(row.campaign_id)) ?? [], ctx)) continue;
    const dailyBudget = toNumber(row.daily_budget);
    if (isDailyBudgetReached(todaySpend.get(Number(row.campaign_id)) ?? 0, dailyBudget)) continue;
    const clicks = Number(row.clicks ?? 0);
    const impressions = Number(row.impressions ?? 0);
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : null;
    eligible.push({
      campaignId: Number(row.campaign_id),
      creativeId: Number(row.creative_id),
      creativeUuid: String(row.creative_uuid),
      advertiserId: Number(row.advertiser_id),
      advertiserUserId: row.advertiser_user_id === null ? null : Number(row.advertiser_user_id),
      placementId: Number(row.placement_id),
      placementCode: String(row.placement_code),
      format: String(row.format),
      headline: (row.headline as string | null) ?? null,
      body: (row.body as string | null) ?? null,
      ctaLabel: (row.cta_label as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      videoUrl: (row.video_url as string | null) ?? null,
      landingUrl: (row.landing_url as string | null) ?? null,
      deepLink: (row.deep_link as string | null) ?? null,
      listingId: row.listing_id === null ? null : Number(row.listing_id),
      objective: String(row.objective),
      pricingModel: String(row.pricing_model),
      bid: toNumber(row.placement_bid) ?? toNumber(row.bid_amount) ?? 0,
      floorCpm: toNumber(placement.floor_cpm) ?? 0,
      floorCpc: toNumber(placement.floor_cpc) ?? 0,
      moderationScore: row.moderation_score === null ? null : Number(row.moderation_score),
      ctr,
      spent: toNumber(row.spent_amount) ?? 0,
      dailyBudget: toNumber(row.daily_budget),
      totalBudget: toNumber(row.total_budget),
    });
  }
  return eligible;
}

export async function advertiserOwnsCampaign(userId: number, campaignId: number): Promise<boolean> {
  const count = await queryCount(
    `SELECT COUNT(*) FROM ad_campaigns c
       JOIN ad_advertisers a ON a.id = c.advertiser_id
      WHERE c.id = ? AND a.user_id = ?`,
    [campaignId, userId],
  );
  return count > 0;
}
