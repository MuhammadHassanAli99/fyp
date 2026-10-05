import { queryRows, queryCount, queryOne, type Row } from '../../db/query';
import { haversineExpression, toBoolean, toNumber, where, type SqlValue } from '../../db/sql';
import {
  buildOrderBy,
  cursorFromFeedRow,
  encodeCursor,
  keysetClause,
  DEFAULT_FEED_ORDER,
  type Cursor,
  type SortClause,
} from '../../core/http/pagination';
import { marketplaceRegistry } from '../../marketplaces/module';
import type { ListingQueryInput } from './listings.schema';

/**
 * Feed and search query construction.
 *
 * Core filters (§10) are built here; the active marketplace module contributes
 * its own conditions through `applyFilters`, which is how "each marketplace has
 * independent filters" stays true without this file knowing about karats or
 * bedrooms.
 */

export interface ListingCard {
  id: number;
  uuid: string;
  referenceCode: string;
  marketplaceId: number;
  marketplaceCode: string;
  categoryId: number;
  categoryName: string | null;
  operation: string;
  title: string;
  slug: string;
  conditionCode: string | null;
  price: number | null;
  currency: string | null;
  priceType: string;
  pricePeriod: string;
  priceNegotiable: boolean;
  installmentsAvailable: boolean;
  status: string;
  lifecycleStatus?: string;
  transactionStatus?: string;
  moderationStatus?: string;
  expirationStatus?: string;
  countryId: number;
  cityId: number | null;
  cityName: string | null;
  areaName: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  primaryImage: string | null;
  mediaCount: number;
  hasVideo: boolean;
  viewCount: number;
  favoriteCount: number;
  isFeatured: boolean;
  isBoosted: boolean;
  isUrgent: boolean;
  isVerified: boolean;
  higherSearchRanking: boolean;
  publishedAt: string | null;
  createdAt: string;
  seller: {
    id: number;
    displayName: string | null;
    avatarUrl: string | null;
    isBusiness: boolean;
    businessName: string | null;
    businessKind: string | null;
    isVerified: boolean;
    rating: number | null;
    reviewCount: number;
    trustBand: string | null;
  };
  /** Populated by the marketplace module for the fields shown on a card. */
  details?: Record<string, unknown>;
  isFavorited?: boolean;
}

const CARD_SELECT = `
  l.id, l.uuid, l.reference_code, l.marketplace_id, l.category_id, l.operation, l.title, l.slug,
  l.condition_code, l.price, l.currency, l.price_type, l.price_period, l.price_negotiable,
  l.installments_available, l.status, l.lifecycle_status, l.transaction_status, l.moderation_status,
  l.expiration_status, l.country_id, l.city_id, l.area_id, l.latitude, l.longitude,
  l.hide_exact_location, l.view_count, l.favorite_count, l.media_count, l.is_featured, l.is_boosted,
  l.is_urgent, l.is_verified, l.published_at, l.created_at, l.bump_at, l.search_rank, l.user_id, l.business_id,
  m.code  AS marketplace_code,
  c.name  AS category_name,
  ct.name AS category_name_localized,
  city.name AS city_name,
  ar.name   AS area_name,
  COALESCE(NULLIF(lm_img.thumb_url, ''), NULLIF(lm_img.card_url, ''), lm_img.url) AS primary_image,
  EXISTS (SELECT 1 FROM listing_media lmv WHERE lmv.listing_id = l.id AND lmv.kind = 'video') AS has_video,
  p.display_name AS seller_name,
  p.avatar_url   AS seller_avatar,
  bp.trade_name  AS business_name,
  bp.kind        AS business_kind,
  bp.verified_at AS business_verified_at,
  u.account_type AS seller_account_type,
  ts.band        AS seller_trust_band,
  rs.average_rating AS seller_rating,
  rs.review_count   AS seller_review_count,
  EXISTS (
    SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
     WHERE ub.user_id = l.user_id AND b.code = 'verified'
  ) AS seller_verified,
  EXISTS (
    SELECT 1 FROM user_subscriptions us
    LEFT JOIN plan_features pf ON pf.plan_id = us.plan_id AND pf.feature_code = 'higher_search_ranking'
    LEFT JOIN subscription_entitlement_overrides o
      ON o.subscription_id = us.id AND o.feature_code = 'higher_search_ranking'
    WHERE us.user_id = l.user_id
      AND us.status IN ('trialing','active','past_due','grace_period')
      AND COALESCE(o.is_enabled, pf.is_enabled, 0) = 1
  ) AS higher_ranking
`;

const CARD_JOINS = `
  FROM listings l
  JOIN marketplaces m ON m.id = l.marketplace_id
  JOIN categories c ON c.id = l.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  LEFT JOIN cities city ON city.id = l.city_id
  LEFT JOIN areas ar ON ar.id = l.area_id
  JOIN users u ON u.id = l.user_id
  LEFT JOIN user_profiles p ON p.user_id = l.user_id
  LEFT JOIN business_profiles bp ON bp.id = l.business_id
  LEFT JOIN trust_scores ts ON ts.user_id = l.user_id
  LEFT JOIN rating_summaries rs ON rs.subject_kind = 'user' AND rs.subject_id = l.user_id AND rs.marketplace_id = 0
  LEFT JOIN listing_media lm_img ON lm_img.id = (
    SELECT lm.id FROM listing_media lm
     WHERE lm.listing_id = l.id AND lm.kind = 'image'
     ORDER BY lm.is_primary DESC, lm.sort_order ASC, lm.id ASC
     LIMIT 1
  )
`;

const csv = (value: string | undefined): string[] | undefined => {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
};

const csvNumbers = (value: string | undefined): number[] | undefined => {
  const parts = csv(value);
  if (!parts) return undefined;
  const numbers = parts.map(Number).filter(Number.isFinite);
  return numbers.length > 0 ? numbers : undefined;
};

export interface FeedParams {
  query: ListingQueryInput;
  language: string;
  /** Resolved marketplace, when the request is scoped to one. */
  marketplaceId: number | null;
  marketplaceCode: string | null;
  /** Country from the request context, used when the query does not override it. */
  countryId: number | null;
  currency: string;
  viewerId: number | null;
  /** Only an owner or staff may see non-published listings. */
  includePrivate?: boolean;
  /** Seller-dashboard / mine: own + assignments + grants + company by persona. */
  ownerScope?: { sql: string; params: SqlValue[] };
  sort: SortClause[];
  offset: number;
  limit: number;
  cursor?: Cursor | null;
  /** When false, fetch exactly `limit` rows (search candidate window). */
  probeHasMore?: boolean;
}

export interface FeedResult {
  items: ListingCard[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export async function queryFeed(params: FeedParams): Promise<FeedResult> {
  const q = params.query;
  const builder = where();
  const selectParams: SqlValue[] = [params.language];
  const extraSelects: string[] = [];

  builder.isNull('l.deleted_at');

  // Visibility. A feed only ever shows published listings unless the caller has
  // explicitly been granted a private view (own listings, admin).
  if (params.includePrivate && q.status) {
    builder.in('l.status', csv(q.status));
  } else if (params.includePrivate) {
    builder.not('l.status', 'removed');
  } else {
    builder.raw(
      `((l.lifecycle_status = 'published' AND l.expiration_status IN ('active','expiring') AND l.transaction_status IN ('available','reserved'))
        OR (l.lifecycle_status IS NULL AND l.status = 'published'))`,
    );
    builder.raw('(l.expires_at IS NULL OR l.expires_at > CURRENT_TIMESTAMP)');
  }

  if (q.lifecycleStatus) builder.in('l.lifecycle_status', csv(q.lifecycleStatus));
  if (q.transactionStatus) builder.in('l.transaction_status', csv(q.transactionStatus));

  let marketplaceId = q.marketplaceId ?? params.marketplaceId;
  if (!marketplaceId && q.marketplace) {
    const marketplace = await queryOne<Row>('SELECT id FROM marketplaces WHERE code = ? AND is_active = 1', [
      q.marketplace,
    ]);
    marketplaceId = marketplace ? Number(marketplace.id) : null;
  }
  builder.eq('l.marketplace_id', marketplaceId);
  builder.in('l.operation', csv(q.operation));

  // Category, optionally including the whole subtree via the materialised path.
  if (q.categoryId) {
    if (q.includeSubcategories) {
      builder.raw(
        `(l.category_id = ? OR EXISTS (
            SELECT 1 FROM categories sub
             WHERE sub.id = l.category_id
               AND sub.path LIKE CONCAT((SELECT path FROM categories WHERE id = ?), '%')))`,
        q.categoryId,
        q.categoryId,
      );
    } else {
      builder.eq('l.category_id', q.categoryId);
    }
  }

  builder.fullText(['l.title', 'l.description'], q.q);

  builder.eq('l.country_id', q.countryId ?? params.countryId);
  builder.eq('l.region_id', q.regionId);
  builder.in('l.city_id', csvNumbers(q.cityId));
  builder.in('l.area_id', csvNumbers(q.areaId));

  builder.between('l.price', q.priceMin, q.priceMax);
  builder.between('l.price_base', q.priceBaseMin, q.priceBaseMax);
  builder.in('l.price_type', csv(q.priceType));
  builder.in('l.price_period', csv(q.pricePeriod));
  builder.in('l.condition_code', csv(q.condition));
  if (params.ownerScope) {
    builder.raw(`(${params.ownerScope.sql})`, ...params.ownerScope.params);
  } else {
    builder.eq('l.user_id', q.sellerId);
    builder.eq('l.business_id', q.businessId);
  }
  builder.bool('l.price_negotiable', q.negotiable);
  builder.bool('l.installments_available', q.installments);
  builder.bool('l.is_verified', q.verifiedListing);
  if (q.featuredOnly) builder.bool('l.is_featured', true);
  if (q.withPhotos) builder.raw('l.media_count > 0');
  if (q.withVideo) {
    builder.raw(`EXISTS (SELECT 1 FROM listing_media lmv WHERE lmv.listing_id = l.id AND lmv.kind = 'video')`);
  }
  if (q.postedWithinHours) {
    builder.raw('l.published_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? HOUR)', q.postedWithinHours);
  }

  // §10 Verified Seller / Premium Seller.
  if (q.verifiedSeller) {
    builder.raw(
      `EXISTS (SELECT 1 FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
                WHERE ub.user_id = l.user_id AND b.code IN ('verified','id_verified','business_verified')
                  AND (ub.expires_at IS NULL OR ub.expires_at > CURRENT_TIMESTAMP))`,
    );
  }
  if (q.premiumSeller) {
    builder.raw(
      `EXISTS (
         SELECT 1 FROM user_subscriptions us
         LEFT JOIN plan_features pf ON pf.plan_id = us.plan_id
           AND pf.feature_code IN ('higher_search_ranking','premium_badge')
         LEFT JOIN subscription_entitlement_overrides o ON o.subscription_id = us.id
           AND o.feature_code IN ('higher_search_ranking','premium_badge')
        WHERE us.user_id = l.user_id AND us.status IN ('trialing','active','past_due','grace_period')
          AND COALESCE(o.is_enabled, pf.is_enabled, 0) = 1
      )`,
    );
  }
  if (q.minRating !== undefined) {
    builder.raw('COALESCE(rs.average_rating, 0) >= ?', q.minRating);
  }

  // §11 Radius Search. Bounding box narrows via index, then the exact haversine
  // distance is computed for display and for the HAVING filter.
  let distanceExpression: string | null = null;
  const distanceParams: SqlValue[] = [];
  if (q.lat !== undefined && q.lng !== undefined) {
    distanceExpression = haversineExpression('l.latitude', 'l.longitude');
    distanceParams.push(q.lat, q.lng, q.lat);
    extraSelects.push(`${distanceExpression} AS distance_km`);
    selectParams.push(...distanceParams);
    if (q.radiusKm) {
      builder.withinBoundingBox('l.latitude', 'l.longitude', q.lat, q.lng, q.radiusKm);
    }
  }

  // Module-specific filters (§5/§6/§7).
  const module = marketplaceId ? marketplaceRegistry.getById(marketplaceId) : null;
  if (module) {
    module.applyFilters(builder, {
      query: q as Record<string, unknown>,
      countryId: params.countryId,
      currency: params.currency,
      language: params.language,
      measurementSystem: 'metric',
    });
  }

  if (params.sort.length === 1) {
    extraSelects.push(`${params.sort[0]!.field} AS cursor_sort_value`);
  }

  const { sql: filterSql, params: filterParams } = builder.build();
  const moduleJoin = module ? module.joinClause() : '';

  const having =
    distanceExpression && q.radiusKm ? 'HAVING distance_km <= ?' : '';
  const havingParams: SqlValue[] = distanceExpression && q.radiusKm ? [q.radiusKm] : [];

  /**
   * Feed ordering. Promotion always wins over recency — that is what sellers pay
   * for — and `bump_at` lets a renewed listing resurface without faking its
   * publication date.
   */
  const orderBy = buildOrderBy(params.sort, DEFAULT_FEED_ORDER);

  const keyset = params.cursor ? keysetClause(params.sort, params.cursor) : null;
  const pageSql = keyset
    ? filterSql
      ? `${filterSql} AND ${keyset.sql}`
      : `WHERE ${keyset.sql}`
    : filterSql;
  const pageParams = keyset ? [...filterParams, ...keyset.params] : filterParams;

  const selectClause = [CARD_SELECT, ...extraSelects].join(',\n  ');
  const fetchLimit = params.probeHasMore === false ? params.limit : params.limit + 1;
  const useKeyset = Boolean(keyset);

  const rows = await queryRows<Row>(
    `SELECT ${selectClause}
     ${CARD_JOINS}
     ${moduleJoin}
     ${pageSql}
     ${having}
     ORDER BY ${orderBy}
     LIMIT ?${useKeyset ? '' : ' OFFSET ?'}`,
    useKeyset
      ? [...selectParams, ...pageParams, ...havingParams, fetchLimit]
      : [...selectParams, ...pageParams, ...havingParams, fetchLimit, params.offset],
  );

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;

  const countFrom = `FROM listings l
       JOIN marketplaces m ON m.id = l.marketplace_id
       JOIN categories c ON c.id = l.category_id
       JOIN users u ON u.id = l.user_id
       LEFT JOIN business_profiles bp ON bp.id = l.business_id
       LEFT JOIN rating_summaries rs ON rs.subject_kind = 'user' AND rs.subject_id = l.user_id AND rs.marketplace_id = 0
       ${moduleJoin}
       ${filterSql}`;

  // Cursor pages skip COUNT; numbered first pages keep it for totals.
  const total = useKeyset
    ? 0
    : await queryCount(
        distanceExpression && q.radiusKm
          ? `SELECT COUNT(*) FROM (
           SELECT l.id, ${distanceExpression} AS distance_km
             ${countFrom}
             HAVING distance_km <= ?
         ) feed_count`
          : `SELECT COUNT(DISTINCT l.id) ${countFrom}`,
        distanceExpression && q.radiusKm ? [...distanceParams, ...filterParams, q.radiusKm] : filterParams,
      );

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && lastRow ? encodeCursor(cursorFromFeedRow(lastRow, params.sort)) : null;

  const items = pageRows.map(mapCard);

  // Attach the module details a card needs (karat/weight, beds/area, year/mileage).
  if (module && items.length > 0) {
    const detailMap = await module.loadDetailsBatch(items.map((item) => item.id));
    for (const item of items) {
      item.details = detailMap.get(item.id) ?? {};
    }
  }

  // Mark the viewer's saved items so the heart renders correctly in one pass.
  if (params.viewerId && items.length > 0) {
    const favorites = await queryRows<Row>(
      `SELECT listing_id FROM favorites
        WHERE user_id = ? AND entity_type = 'listing' AND listing_id IN (${items.map(() => '?').join(', ')})`,
      [params.viewerId, ...items.map((item) => item.id)],
    );
    const favorited = new Set(favorites.map((row) => Number(row.listing_id)));
    for (const item of items) {
      item.isFavorited = favorited.has(item.id);
    }
  }

  return { items, total, nextCursor, hasMore };
}

export function mapCard(row: Row): ListingCard {
  const hideLocation = toBoolean(row.hide_exact_location);
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    referenceCode: String(row.reference_code),
    marketplaceId: Number(row.marketplace_id),
    marketplaceCode: String(row.marketplace_code),
    categoryId: Number(row.category_id),
    categoryName: (row.category_name_localized as string | null) ?? (row.category_name as string | null) ?? null,
    operation: String(row.operation),
    title: String(row.title),
    slug: String(row.slug),
    conditionCode: (row.condition_code as string | null) ?? null,
    price: toNumber(row.price),
    currency: (row.currency as string | null) ?? null,
    priceType: String(row.price_type),
    pricePeriod: String(row.price_period),
    priceNegotiable: toBoolean(row.price_negotiable),
    installmentsAvailable: toBoolean(row.installments_available),
    status: String(row.status),
    lifecycleStatus: (row.lifecycle_status as string | undefined) ?? undefined,
    transactionStatus: (row.transaction_status as string | undefined) ?? undefined,
    moderationStatus: (row.moderation_status as string | undefined) ?? undefined,
    expirationStatus: (row.expiration_status as string | undefined) ?? undefined,
    countryId: Number(row.country_id),
    cityId: row.city_id === null ? null : Number(row.city_id),
    cityName: (row.city_name as string | null) ?? null,
    areaName: (row.area_name as string | null) ?? null,
    // Respect the seller's choice to hide the pin (§8 privacy).
    latitude: hideLocation ? null : toNumber(row.latitude),
    longitude: hideLocation ? null : toNumber(row.longitude),
    distanceKm: toNumber(row.distance_km),
    primaryImage: (row.primary_image as string | null) ?? null,
    mediaCount: Number(row.media_count ?? 0),
    hasVideo: Number(row.has_video ?? row.video_count ?? 0) > 0,
    viewCount: Number(row.view_count ?? 0),
    favoriteCount: Number(row.favorite_count ?? 0),
    isFeatured: toBoolean(row.is_featured),
    isBoosted: toBoolean(row.is_boosted),
    isUrgent: toBoolean(row.is_urgent),
    isVerified: toBoolean(row.is_verified),
    higherSearchRanking: Number(row.higher_ranking) === 1,
    publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
    createdAt: (row.created_at as Date).toISOString(),
    seller: {
      id: Number(row.user_id),
      displayName: (row.business_name as string | null) ?? (row.seller_name as string | null) ?? null,
      avatarUrl: (row.seller_avatar as string | null) ?? null,
      isBusiness: row.seller_account_type === 'business' || row.business_name !== null,
      businessName: (row.business_name as string | null) ?? null,
      businessKind: (row.business_kind as string | null) ?? null,
      isVerified: Number(row.seller_verified ?? 0) > 0 || row.business_verified_at !== null,
      rating: toNumber(row.seller_rating),
      reviewCount: Number(row.seller_review_count ?? 0),
      trustBand: (row.seller_trust_band as string | null) ?? null,
    },
  };
}

/** Similar listings for the detail page — same category, comparable price. */
export async function findSimilar(params: {
  listingId: number;
  marketplaceId: number;
  categoryId: number;
  price: number | null;
  cityId: number | null;
  countryId: number;
  language: string;
  limit: number;
}): Promise<ListingCard[]> {
  const builder = where();
  builder.isNull('l.deleted_at');
  builder.raw(
    `((l.lifecycle_status = 'published' AND l.transaction_status IN ('available','reserved'))
      OR (l.lifecycle_status IS NULL AND l.status = 'published'))`,
  );
  builder.eq('l.marketplace_id', params.marketplaceId);
  builder.eq('l.category_id', params.categoryId);
  builder.eq('l.country_id', params.countryId);
  builder.not('l.id', params.listingId);
  if (params.price !== null && params.price > 0) {
    builder.between('l.price', params.price * 0.6, params.price * 1.6);
  }

  const { sql: whereSql, params: whereParams } = builder.build();

  const rows = await queryRows<Row>(
    `SELECT ${CARD_SELECT}
     ${CARD_JOINS}
     ${whereSql}
     ORDER BY (l.city_id = ?) DESC, l.is_featured DESC, l.published_at DESC
     LIMIT ?`,
    [params.language, ...whereParams, params.cityId ?? 0, params.limit],
  );

  return rows.map(mapCard);
}

/** Loads the cards for a specific set of ids, preserving the requested order. */
export async function findCardsByIds(listingIds: number[], language: string): Promise<ListingCard[]> {
  if (listingIds.length === 0) return [];
  const placeholders = listingIds.map(() => '?').join(', ');
  const rows = await queryRows<Row>(
    `SELECT ${CARD_SELECT} ${CARD_JOINS} WHERE l.id IN (${placeholders}) AND l.deleted_at IS NULL`,
    [language, ...listingIds],
  );
  const byId = new Map(rows.map((row) => [Number(row.id), mapCard(row)]));
  return listingIds.map((id) => byId.get(id)).filter((card): card is ListingCard => card !== undefined);
}
