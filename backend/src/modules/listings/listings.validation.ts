import { queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { env } from '../../config/env';
import type { CreateListingInput } from './listings.schema';

export interface ValidationIssue {
  field: string;
  code: string;
  message: string;
}

export interface ListingValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  missingFields: string[];
  completenessScore: number;
}

const ISO_CURRENCIES = /^[A-Z]{3}$/;

export function scoreCompleteness(input: {
  title?: string | null;
  description?: string | null;
  price?: number | null;
  mediaCount?: number;
  cityId?: number | null;
  latitude?: number | null;
  attributeCount?: number;
  documentCount?: number;
  detailsPresent?: boolean;
}): number {
  let score = 0;
  if (input.title && input.title.trim().length >= 6) score += 15;
  if (input.description && input.description.length > 80) score += 20;
  if (input.price !== undefined && input.price !== null) score += 15;
  if ((input.mediaCount ?? 0) >= 1) score += 10;
  if ((input.mediaCount ?? 0) >= 5) score += 10;
  if (input.cityId) score += 10;
  if (input.latitude) score += 5;
  if ((input.attributeCount ?? 0) >= 3) score += 10;
  if ((input.documentCount ?? 0) > 0) score += 5;
  if (input.detailsPresent) score += 10;
  return Math.min(100, score);
}

export function validateListingPayload(input: {
  title?: string | null;
  description?: string | null;
  price?: number | null;
  currency?: string | null;
  priceType?: string | null;
  categoryId?: number | null;
  countryId?: number | null;
  cityId?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  mediaCount?: number;
  operation?: string | null;
  requireMedia?: boolean;
}): ListingValidationResult {
  const issues: ValidationIssue[] = [];
  const missing: string[] = [];

  if (!input.title || input.title.trim().length < 6) {
    issues.push({ field: 'title', code: 'MISSING_INFORMATION', message: 'Give the listing a descriptive title' });
    missing.push('title');
  }
  if (!input.categoryId) {
    issues.push({ field: 'categoryId', code: 'WRONG_CATEGORY', message: 'Pick a category' });
    missing.push('category');
  }
  if (!input.countryId) {
    issues.push({ field: 'countryId', code: 'MISSING_INFORMATION', message: 'A country is required' });
    missing.push('location.country');
  }
  if (input.price === undefined || input.price === null) {
    if (input.priceType !== 'on_call' && input.priceType !== 'free') {
      issues.push({ field: 'price', code: 'INVALID_PRICE', message: 'Enter a price' });
      missing.push('price');
    }
  } else if (input.price < 0) {
    issues.push({ field: 'price', code: 'INVALID_PRICE', message: 'Price cannot be negative' });
  } else if (input.price === 0 && input.operation === 'sell' && input.priceType === 'fixed') {
    issues.push({ field: 'price', code: 'INVALID_PRICE', message: 'A zero price on a for-sale listing looks like a mistake' });
  }
  if (input.currency && !ISO_CURRENCIES.test(input.currency)) {
    issues.push({ field: 'currency', code: 'INVALID_PRICE', message: 'Currency must be a 3-letter ISO code' });
  }
  if ((input.latitude != null) !== (input.longitude != null)) {
    issues.push({ field: 'location', code: 'MISSING_INFORMATION', message: 'Latitude and longitude must be provided together' });
  }
  if (input.latitude != null && (input.latitude < -90 || input.latitude > 90)) {
    issues.push({ field: 'location', code: 'MISSING_INFORMATION', message: 'Latitude is out of range' });
  }
  if (input.longitude != null && (input.longitude < -180 || input.longitude > 180)) {
    issues.push({ field: 'location', code: 'MISSING_INFORMATION', message: 'Longitude is out of range' });
  }
  if (input.requireMedia && (input.mediaCount ?? 0) < 1) {
    issues.push({ field: 'media', code: 'MISSING_INFORMATION', message: 'Add at least one photo before submitting' });
    missing.push('media');
  }
  if ((input.mediaCount ?? 0) > env.LISTING_MAX_MEDIA) {
    issues.push({ field: 'media', code: 'MISSING_INFORMATION', message: `At most ${env.LISTING_MAX_MEDIA} media items are allowed` });
  }

  return {
    ok: issues.length === 0,
    issues,
    missingFields: missing,
    completenessScore: scoreCompleteness({
      title: input.title,
      description: input.description,
      price: input.price,
      mediaCount: input.mediaCount,
      cityId: input.cityId,
      latitude: input.latitude,
      detailsPresent: true,
    }),
  };
}

export function validateCreateInput(input: CreateListingInput, mediaCount: number, countryId: number | null): ListingValidationResult {
  return validateListingPayload({
    title: input.title,
    description: input.description,
    price: input.price,
    currency: input.currency,
    priceType: input.priceType,
    categoryId: input.categoryId,
    countryId: input.location?.countryId ?? countryId,
    cityId: input.location?.cityId,
    latitude: input.location?.latitude,
    longitude: input.location?.longitude,
    mediaCount,
    operation: input.operation,
    requireMedia: false,
  });
}

export async function validateListingForSubmit(listingId: number): Promise<ListingValidationResult> {
  const listing = await queryOne<Row>(
    `SELECT title, description, price, currency, price_type, category_id, country_id, city_id,
            latitude, longitude, media_count, operation
       FROM listings WHERE id = ? AND deleted_at IS NULL`,
    [listingId],
  );
  if (!listing) {
    return {
      ok: false,
      issues: [{ field: 'listing', code: 'MISSING_INFORMATION', message: 'Listing not found' }],
      missingFields: ['listing'],
      completenessScore: 0,
    };
  }

  const documentCount = await queryCount('SELECT COUNT(*) FROM listing_documents WHERE listing_id = ?', [listingId]);
  const result = validateListingPayload({
    title: listing.title as string,
    description: (listing.description as string | null) ?? null,
    price: toNumber(listing.price),
    currency: (listing.currency as string | null) ?? null,
    priceType: String(listing.price_type),
    categoryId: Number(listing.category_id),
    countryId: Number(listing.country_id),
    cityId: listing.city_id === null ? null : Number(listing.city_id),
    latitude: toNumber(listing.latitude),
    longitude: toNumber(listing.longitude),
    mediaCount: Number(listing.media_count ?? 0),
    operation: String(listing.operation),
    requireMedia: true,
  });

  if (documentCount === 0 && String(listing.operation) === 'sell') {
    // Documents are recommended, not always required — marketplace modules enforce their own rules.
  }

  return result;
}

export async function loadMissingFieldTracker(listingId: number): Promise<{ completenessScore: number; missingFields: string[] }> {
  const result = await validateListingForSubmit(listingId);
  return { completenessScore: result.completenessScore, missingFields: result.missingFields };
}

export async function similarTitleExists(params: {
  listingId: number;
  userId: number;
  title: string;
  marketplaceId: number;
}): Promise<boolean> {
  const normalized = params.title.trim().toLowerCase();
  if (normalized.length < 8) return false;
  const rows = await queryRows<Row>(
    `SELECT id, title FROM listings
      WHERE user_id = ? AND marketplace_id = ? AND id <> ? AND deleted_at IS NULL
        AND lifecycle_status IN ('draft','pending_review','published')
      ORDER BY id DESC LIMIT 30`,
    [params.userId, params.marketplaceId, params.listingId],
  );
  return rows.some((row) => String(row.title).trim().toLowerCase() === normalized);
}
