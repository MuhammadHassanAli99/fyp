export const AD_OBJECTIVES = [
  'awareness',
  'traffic',
  'leads',
  'listing_views',
  'app_installs',
  'conversions',
  'messages',
  'calls',
  'website_visits',
] as const;
export type AdObjective = (typeof AD_OBJECTIVES)[number];

export const AD_STATUSES = [
  'draft',
  'pending_review',
  'approved',
  'active',
  'paused',
  'scheduled',
  'completed',
  'rejected',
  'exhausted',
] as const;
export type AdStatus = (typeof AD_STATUSES)[number];

export const PRICING_MODELS = ['cpm', 'cpc', 'cpa', 'cpv', 'fixed', 'sponsored'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const FORBIDDEN_TARGET_KINDS = new Set(['age', 'gender']);

export interface RankInputs {
  bid: number;
  quality: number;
  expectedEngagement: number;
  floor: number;
}

/**
 * Configurable rank: bid is never the sole winner.
 * quality and expected engagement are 0..1.
 */
export function computeAdRank(input: RankInputs): number {
  const bid = Math.max(0, input.bid);
  const floor = Math.max(0, input.floor);
  const quality = Math.max(0, Math.min(1, input.quality));
  const engagement = Math.max(0, Math.min(1, input.expectedEngagement));
  const effectiveBid = Math.max(bid, floor);
  return effectiveBid * (0.35 + 0.65 * quality) * (0.45 + 0.55 * engagement);
}

export function qualityFromCreative(params: { moderationScore: number | null; ctr: number | null }): number {
  const moderation = params.moderationScore === null ? 0.6 : Math.max(0, Math.min(1, params.moderationScore / 100));
  const ctr = params.ctr === null ? 0.5 : Math.max(0, Math.min(1, params.ctr / 10));
  return 0.4 * moderation + 0.6 * ctr;
}

export function expectedEngagement(objective: string, historicalCtr: number | null): number {
  const base =
    objective === 'awareness' ? 0.45 : objective === 'traffic' || objective === 'listing_views' ? 0.7 : 0.55;
  if (historicalCtr === null) return base;
  return Math.max(0.2, Math.min(1, 0.4 * base + 0.6 * Math.min(1, historicalCtr / 8)));
}

export function labelForFormat(format: string): 'Sponsored' | 'Featured' | 'Advertisement' {
  if (format === 'sponsored_listing' || format === 'native') return 'Sponsored';
  if (format === 'featured') return 'Featured';
  return 'Advertisement';
}
