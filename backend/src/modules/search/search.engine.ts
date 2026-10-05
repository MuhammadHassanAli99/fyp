import { queryFeed, type ListingCard } from '../listings/listings.repository';
import { listingQuerySchema, type ListingQueryInput } from '../listings/listings.schema';
import { convertAmount } from '../locale/fx.service';
import { env } from '../../config/env';
import { marketplaceRegistry } from '../../marketplaces/module';
import { queryOne, type Row } from '../../db/query';
import type { SearchQuery } from './search.dsl';
import { resolveLocationName, resolveVehicleMakeId, resolveVehicleModelId } from './search.location';
import {
  applySponsoredPlacement,
  freshnessScore,
  locationScore,
  organicScore,
  paginateHits,
  preferenceScore,
  priceScore,
  trustScore,
  type RankableHit,
} from './search.rank';
import { cosineSimilarity, embedQuery, loadListingVectors } from './search.embed';
import { matchReasons } from './search.explain';
import { searchParts, type PartHit } from './search.parts';
import { personalizationBoost } from './search.personalize';
import { rankingBoostFromEntitlement } from '../subscriptions/subscriptions.rules';
import { markCampaignSponsored } from '../ads/ads.contextual';

const CANDIDATE_LIMIT = 120;
const QUERY_TIMEOUT_MS = 8_000;

export interface EngineContext {
  language: string;
  currency: string;
  countryId: number | null;
  viewerId: number | null;
}

export interface EngineResult {
  hits: RankableHit[];
  total: number;
  parts: PartHit[];
}

async function marketplaceIdFor(code: string | null): Promise<number | null> {
  if (!code) return null;
  const bound = marketplaceRegistry.get(code);
  if (!bound) return null;
  const row = await queryOne<Row>('SELECT id FROM marketplaces WHERE code = ? AND is_active = 1', [code]);
  return row ? Number(row.id) : null;
}

async function withTimeout<T>(work: Promise<T>, ms = QUERY_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('search_timeout')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function toListingQuery(dsl: SearchQuery, ctx: EngineContext): Promise<ListingQueryInput> {
  const location = dsl.location ? { ...dsl.location } : null;
  if (location?.cityName && !location.cityId) {
    const resolved = await resolveLocationName(location.cityName, location.countryId ?? ctx.countryId);
    if (resolved) Object.assign(location, resolved);
  }

  let makeId = dsl.filters.makeId ? Number(dsl.filters.makeId) : undefined;
  if (!makeId && typeof dsl.filters.make === 'string') {
    makeId = (await resolveVehicleMakeId(dsl.filters.make)) ?? undefined;
  }
  let modelId = dsl.filters.modelId ? Number(dsl.filters.modelId) : undefined;
  if (!modelId && typeof dsl.filters.model === 'string') {
    modelId = (await resolveVehicleModelId(makeId ?? null, dsl.filters.model)) ?? undefined;
  }

  let priceBaseMin = dsl.price?.minBase;
  let priceBaseMax = dsl.price?.maxBase;
  if (dsl.price && (dsl.price.min !== undefined || dsl.price.max !== undefined)) {
    const from = dsl.price.currency;
    const to = env.BASE_CURRENCY;
    if (dsl.price.min !== undefined) {
      const converted = await convertAmount(dsl.price.min, from, to);
      priceBaseMin = converted?.amount ?? dsl.price.min;
    }
    if (dsl.price.max !== undefined) {
      const converted = await convertAmount(dsl.price.max, from, to);
      priceBaseMax = converted?.amount ?? dsl.price.max;
    }
  }

  const raw: Record<string, unknown> = {
    q: dsl.keywords || undefined,
    marketplace: dsl.marketplace ?? undefined,
    operation: dsl.operation ?? undefined,
    countryId: location?.countryId ?? ctx.countryId ?? undefined,
    regionId: location?.regionId,
    cityId: location?.cityId ? String(location.cityId) : undefined,
    areaId: location?.areaId ? String(location.areaId) : undefined,
    lat: location?.lat,
    lng: location?.lng,
    radiusKm: location?.radiusKm,
    priceBaseMin,
    priceBaseMax,
    sort: 'relevance',
    page: 1,
    perPage: CANDIDATE_LIMIT,
    includeSubcategories: true,
    ...dsl.filters,
    makeId,
    modelId,
  };

  return listingQuerySchema.parse(raw);
}

function keywordOverlap(query: string, title: string, description: string | null): number {
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((term) => term.length > 2);
  if (terms.length === 0) return 0.4;
  const haystack = `${title} ${description ?? ''}`.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term)).length;
  return hits / terms.length;
}

function filterMatchScore(dsl: SearchQuery, attributes: Record<string, unknown>, card: ListingCard): number {
  const checks: boolean[] = [];
  const eq = (key: string, actual: unknown) => {
    const expected = dsl.filters[key as keyof typeof dsl.filters];
    if (expected === undefined) return;
    checks.push(String(actual ?? '').toLowerCase() === String(expected).toLowerCase());
  };
  eq('make', attributes.make);
  eq('model', attributes.model);
  eq('transmission', attributes.transmission);
  eq('fuelType', attributes.fuelType);
  eq('propertyKind', attributes.propertyKind);
  eq('form', attributes.form);
  eq('karat', attributes.karat);
  if (dsl.filters.bedroomsMin !== undefined) {
    checks.push(Number(attributes.bedrooms ?? 0) >= Number(dsl.filters.bedroomsMin));
  }
  if (dsl.operation) checks.push(card.operation === dsl.operation);
  if (checks.length === 0) return 0.5;
  return checks.filter(Boolean).length / checks.length;
}

export async function retrieveAndRank(dsl: SearchQuery, ctx: EngineContext): Promise<EngineResult> {
  const work = (async () => {
    if (dsl.intent === 'parts' || dsl.filters.partCategory) {
      const parts = await searchParts(dsl, ctx);
      return { hits: [] as RankableHit[], total: parts.length, parts };
    }

    const mapped = await toListingQuery(dsl, ctx);
    const marketplaceId = await marketplaceIdFor(dsl.marketplace);
    const feed = await queryFeed({
      query: mapped,
      language: ctx.language,
      marketplaceId,
      marketplaceCode: dsl.marketplace,
      countryId: ctx.countryId,
      currency: ctx.currency,
      viewerId: ctx.viewerId,
      sort: [{ field: 'l.search_rank', direction: 'DESC' }],
      offset: 0,
      limit: CANDIDATE_LIMIT,
      probeHasMore: false,
    });

    const queryVector =
      dsl.semanticQuery || dsl.keywords
        ? await embedQuery(dsl.semanticQuery || dsl.originalQuery || dsl.keywords).catch(() => null)
        : null;
    const vectors = queryVector ? await loadListingVectors(feed.items.map((item) => item.id)) : new Map<number, number[]>();

    const rankable: RankableHit[] = feed.items.map((card) => {
      const attributes = (card.details ?? {}) as Record<string, unknown>;
      const semantic = queryVector && vectors.has(card.id) ? Math.max(0, cosineSimilarity(queryVector, vectors.get(card.id)!)) : 0;
      const signals = {
        text: keywordOverlap(dsl.keywords || dsl.originalQuery, card.title, null),
        semantic,
        filterMatch: filterMatchScore(dsl, attributes, card),
        location: locationScore(card.distanceKm, dsl.location?.radiusKm ?? null),
        price: priceScore(card.price, dsl.price?.max, dsl.price?.min),
        availability: card.transactionStatus === 'available' || !card.transactionStatus ? 1 : 0.6,
        quality: Math.min(
          1,
          (card.mediaCount ?? 0) / 8 +
            (card.isVerified ? 0.2 : 0) +
            rankingBoostFromEntitlement(card.higherSearchRanking, card.isFeatured, card.isBoosted),
        ),
        trust: trustScore(card.seller.trustBand),
        freshness: freshnessScore(card.publishedAt),
        preference: preferenceScore(attributes, dsl.preferences),
      };
      const hit: RankableHit = {
        listingId: card.id,
        marketplaceCode: card.marketplaceCode,
        isFeatured: card.isFeatured,
        isBoosted: card.isBoosted,
        isSponsoredEligible: card.isFeatured || card.isBoosted,
        publishedAt: card.publishedAt,
        distanceKm: card.distanceKm,
        price: card.price,
        currency: card.currency,
        publicTrustBand: card.seller.trustBand,
        qualityScore: signals.quality,
        attributes,
        signals,
        organicScore: organicScore(signals),
        finalScore: 0,
        placement: 'organic',
        matchReasons: [],
        card,
      };
      hit.matchReasons = matchReasons(dsl, hit, card);
      return hit;
    });

    const withCampaigns = await markCampaignSponsored(rankable);
    const ranked = applySponsoredPlacement(await personalizationBoost(ctx.viewerId, withCampaigns));
    const page = paginateHits(ranked, dsl.pagination.page, dsl.pagination.perPage);
    return { hits: page, total: feed.total, parts: [] as PartHit[] };
  })();

  return withTimeout(work);
}
