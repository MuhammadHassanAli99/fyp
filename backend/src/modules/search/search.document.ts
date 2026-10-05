/**
 * Marketplace-aware public search documents. Listing rows stay the source of
 * truth; this table is a projection used for retrieval and ranking.
 */

import crypto from 'node:crypto';
import type { PoolConnection } from '../../db/pool';
import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { toBoolean, toNumber } from '../../db/sql';
import { isPubliclySearchable, readDimensions } from '../listings/listings.lifecycle';
import { getMapProvider } from '../../providers/maps';
import { encodeGeohash } from '../geo/geohash';
import { loggerFor } from '../../config/logger';

const log = loggerFor('search.document');

export interface SearchDocument {
  listingId: number;
  marketplaceId: number;
  marketplaceCode: string;
  categoryId: number;
  categoryCode: string | null;
  operation: string;
  title: string;
  description: string | null;
  keywords: string;
  price: number | null;
  currency: string | null;
  priceBase: number | null;
  countryId: number;
  regionId: number | null;
  cityId: number | null;
  areaId: number | null;
  latitude: number | null;
  longitude: number | null;
  hideExactLocation: boolean;
  geohash: string | null;
  attributes: Record<string, unknown>;
  availability: string;
  publishedAt: Date | null;
  qualityScore: number;
  publicTrustBand: string | null;
  isFeatured: boolean;
  isBoosted: boolean;
  searchRank: number;
  contentHash: string;
}

function hashContent(parts: Array<string | null | undefined>): string {
  return crypto.createHash('sha256').update(parts.filter(Boolean).join('\n')).digest('hex');
}

async function loadPublicAttributes(listingId: number, marketplaceId: number, connection?: PoolConnection): Promise<Record<string, unknown>> {
  if (marketplaceId === 1) {
    const row = await queryOne<Row>(
      `SELECT karat, net_weight_g, form, jewellery_type, metal_type, is_hallmarked, has_certificate,
              is_investment_grade, is_antique, is_scrap
         FROM gold_listing_details WHERE listing_id = ?`,
      [listingId],
      connection,
    );
    if (!row) return {};
    return {
      karat: toNumber(row.karat),
      weightG: toNumber(row.net_weight_g),
      form: row.form,
      jewelleryType: row.jewellery_type,
      metalType: row.metal_type,
      hallmarked: toBoolean(row.is_hallmarked),
      certified: toBoolean(row.has_certificate),
      investmentGrade: toBoolean(row.is_investment_grade),
      antique: toBoolean(row.is_antique),
      scrap: toBoolean(row.is_scrap),
    };
  }
  if (marketplaceId === 2) {
    const row = await queryOne<Row>(
      `SELECT property_kind, usage_type, bedrooms, bathrooms, area_sqm, furnishing, parking_spaces,
              has_swimming_pool, has_gym, has_garden, has_elevator, is_gated_community
         FROM property_listing_details WHERE listing_id = ?`,
      [listingId],
      connection,
    );
    if (!row) return {};
    return {
      propertyKind: row.property_kind,
      usageType: row.usage_type,
      bedrooms: toNumber(row.bedrooms),
      bathrooms: toNumber(row.bathrooms),
      areaSqm: toNumber(row.area_sqm),
      furnishing: row.furnishing,
      parking: toNumber(row.parking_spaces),
      swimmingPool: toBoolean(row.has_swimming_pool),
      gym: toBoolean(row.has_gym),
      garden: toBoolean(row.has_garden),
      elevator: toBoolean(row.has_elevator),
      gatedCommunity: toBoolean(row.is_gated_community),
    };
  }
  if (marketplaceId === 3) {
    const row = await queryOne<Row>(
      `SELECT vd.vehicle_type, vd.year, vd.mileage_km, vd.fuel_type, vd.transmission, vd.body_type,
              vd.color_family, mk.name AS make_name, md.name AS model_name
         FROM vehicle_listing_details vd
         LEFT JOIN vehicle_makes mk ON mk.id = vd.make_id
         LEFT JOIN vehicle_models md ON md.id = vd.model_id
        WHERE vd.listing_id = ?`,
      [listingId],
      connection,
    );
    if (!row) return {};
    return {
      vehicleType: row.vehicle_type,
      year: toNumber(row.year),
      mileageKm: toNumber(row.mileage_km),
      fuelType: row.fuel_type,
      transmission: row.transmission,
      bodyType: row.body_type,
      colorFamily: row.color_family,
      make: row.make_name,
      model: row.model_name,
    };
  }
  return {};
}

export async function buildSearchDocument(listingId: number, connection?: PoolConnection): Promise<SearchDocument | null> {
  const listing = await queryOne<Row>(
    `SELECT l.id, l.marketplace_id, l.category_id, l.operation, l.title, l.description, l.price, l.currency,
            l.price_base, l.country_id, l.region_id, l.city_id, l.area_id, l.latitude, l.longitude,
            l.is_featured, l.is_boosted, l.search_rank, l.status, l.lifecycle_status, l.transaction_status,
            l.expiration_status, l.hide_exact_location, l.published_at, l.media_count, l.is_verified,
            l.user_id, m.code AS marketplace_code, c.code AS category_code, ts.band AS trust_band,
            EXISTS (
              SELECT 1
                FROM user_subscriptions us
                LEFT JOIN plan_features pf
                  ON pf.plan_id = us.plan_id AND pf.feature_code = 'higher_search_ranking'
                LEFT JOIN subscription_entitlement_overrides o
                  ON o.subscription_id = us.id AND o.feature_code = 'higher_search_ranking'
               WHERE us.user_id = l.user_id
                 AND us.status IN ('trialing','active','past_due','grace_period')
                 AND (us.current_period_end IS NULL OR us.current_period_end > CURRENT_TIMESTAMP)
                 AND COALESCE(o.is_enabled, pf.is_enabled, 0) = 1
            ) AS higher_ranking
       FROM listings l
       JOIN marketplaces m ON m.id = l.marketplace_id
       JOIN categories c ON c.id = l.category_id
       LEFT JOIN trust_scores ts ON ts.user_id = l.user_id
      WHERE l.id = ?`,
    [listingId],
    connection,
  );
  if (!listing) return null;

  const dimensions = readDimensions(listing);
  if (!isPubliclySearchable(dimensions)) return null;

  const hide = toBoolean(listing.hide_exact_location);
  const exactLat = toNumber(listing.latitude);
  const exactLng = toNumber(listing.longitude);
  let publicLat = exactLat;
  let publicLng = exactLng;
  if (hide && exactLat !== null && exactLng !== null) {
    const approx = getMapProvider().approximate(exactLat, exactLng, listingId);
    publicLat = approx.latitude;
    publicLng = approx.longitude;
  }
  const geohash =
    publicLat !== null && publicLng !== null ? encodeGeohash(publicLat, publicLng, 8) : null;
  const attributes = await loadPublicAttributes(listingId, Number(listing.marketplace_id), connection);
  const keywords = [
    String(listing.title),
    listing.category_code,
    ...Object.values(attributes).map((value) => (value === null || value === undefined ? '' : String(value))),
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 512);

  const rankingBoost = Number(listing.higher_ranking) === 1 ? 0.8 : 0;
  const quality =
    Math.min(
      5,
      (toBoolean(listing.is_verified) ? 1.2 : 0) +
        Math.min(Number(listing.media_count ?? 0), 8) * 0.15 +
        (toNumber(listing.search_rank) ?? 1) * 0.2 +
        rankingBoost,
    );

  const contentHash = hashContent([
    String(listing.title),
    (listing.description as string | null) ?? '',
    String(listing.category_code),
    JSON.stringify(attributes),
    listing.city_id === null ? '' : String(listing.city_id),
  ]);

  return {
    listingId,
    marketplaceId: Number(listing.marketplace_id),
    marketplaceCode: String(listing.marketplace_code),
    categoryId: Number(listing.category_id),
    categoryCode: (listing.category_code as string | null) ?? null,
    operation: String(listing.operation),
    title: String(listing.title),
    description: (listing.description as string | null) ?? null,
    keywords,
    price: toNumber(listing.price),
    currency: (listing.currency as string | null) ?? null,
    priceBase: toNumber(listing.price_base),
    countryId: Number(listing.country_id),
    regionId: listing.region_id === null ? null : Number(listing.region_id),
    cityId: listing.city_id === null ? null : Number(listing.city_id),
    areaId: listing.area_id === null ? null : Number(listing.area_id),
    latitude: publicLat,
    longitude: publicLng,
    hideExactLocation: hide,
    geohash,
    attributes,
    availability: dimensions.transactionStatus,
    publishedAt: (listing.published_at as Date | null) ?? null,
    qualityScore: Number(quality.toFixed(4)),
    publicTrustBand: (listing.trust_band as string | null) ?? null,
    isFeatured: toBoolean(listing.is_featured),
    isBoosted: toBoolean(listing.is_boosted),
    searchRank: (toNumber(listing.search_rank) ?? 1) + (Number(listing.higher_ranking) === 1 ? 25 : 0),
    contentHash,
  };
}

export async function upsertSearchIndex(listingId: number, connection?: PoolConnection): Promise<void> {
  const document = await buildSearchDocument(listingId, connection);
  if (!document) {
    await execute('DELETE FROM listing_search_index WHERE listing_id = ?', [listingId], connection);
    return;
  }

  await execute(
    `INSERT INTO listing_search_index
       (listing_id, marketplace_id, marketplace_code, category_id, category_code, operation,
        lifecycle_status, transaction_status, expiration_status, availability, title, description, keywords,
        price, currency, price_base, country_id, region_id, city_id, area_id, latitude, longitude,
        hide_exact_location, geohash, is_featured, is_boosted, search_rank, quality_score, public_trust_band,
        facets, attributes, published_at, content_hash, indexed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'published', ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       marketplace_id = VALUES(marketplace_id), marketplace_code = VALUES(marketplace_code),
       category_id = VALUES(category_id), category_code = VALUES(category_code),
       operation = VALUES(operation), transaction_status = VALUES(transaction_status),
       availability = VALUES(availability), title = VALUES(title), description = VALUES(description),
       keywords = VALUES(keywords), price = VALUES(price), currency = VALUES(currency),
       price_base = VALUES(price_base), country_id = VALUES(country_id), region_id = VALUES(region_id),
       city_id = VALUES(city_id), area_id = VALUES(area_id), latitude = VALUES(latitude),
       longitude = VALUES(longitude), hide_exact_location = VALUES(hide_exact_location),
       geohash = VALUES(geohash),
       is_featured = VALUES(is_featured), is_boosted = VALUES(is_boosted), search_rank = VALUES(search_rank),
       quality_score = VALUES(quality_score), public_trust_band = VALUES(public_trust_band),
       facets = VALUES(facets), attributes = VALUES(attributes), published_at = VALUES(published_at),
       content_hash = VALUES(content_hash), indexed_at = CURRENT_TIMESTAMP`,
    [
      document.listingId,
      document.marketplaceId,
      document.marketplaceCode,
      document.categoryId,
      document.categoryCode,
      document.operation,
      document.availability,
      document.availability,
      document.title,
      document.description,
      document.keywords,
      document.price,
      document.currency,
      document.priceBase,
      document.countryId,
      document.regionId,
      document.cityId,
      document.areaId,
      document.latitude,
      document.longitude,
      document.hideExactLocation ? 1 : 0,
      document.geohash,
      document.isFeatured ? 1 : 0,
      document.isBoosted ? 1 : 0,
      document.searchRank,
      document.qualityScore,
      document.publicTrustBand,
      JSON.stringify({
        featured: document.isFeatured,
        boosted: document.isBoosted,
        operation: document.operation,
      }),
      JSON.stringify(document.attributes),
      document.publishedAt,
      document.contentHash,
    ],
    connection,
  );
}

export async function reindexPending(limit = 200): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT l.id FROM listings l
      LEFT JOIN listing_search_index i ON i.listing_id = l.id
     WHERE l.deleted_at IS NULL
       AND l.lifecycle_status = 'published'
       AND (i.listing_id IS NULL OR i.indexed_at < l.updated_at)
     ORDER BY l.updated_at DESC
     LIMIT ?`,
    [limit],
  );
  for (const row of rows) {
    try {
      await upsertSearchIndex(Number(row.id));
    } catch (error) {
      log.warn({ err: error, listingId: Number(row.id) }, 'search reindex skipped');
    }
  }
  return rows.length;
}

export function embedTextFor(document: SearchDocument): string {
  return [
    document.title,
    document.description ?? '',
    document.marketplaceCode,
    document.categoryCode ?? '',
    document.keywords,
    document.attributes.make,
    document.attributes.model,
    document.attributes.propertyKind,
    document.attributes.form,
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 4000);
}
