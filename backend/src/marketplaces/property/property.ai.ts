import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { uuid } from '../../core/security/crypto';
import { roundDecimal } from '../../core/decimal';
import { valuateProperty, type PropertyValuation } from './property.service';

export const VALUATION_MODEL = { id: 'property-valuation', version: '2', featureVersion: '1' } as const;
export const IMAGE_MODEL = { id: 'property-image-assist', version: '1', featureVersion: '1' } as const;
export const QUALITY_MODEL = { id: 'property-listing-quality', version: '1', featureVersion: '1' } as const;

const VALUATION_DISCLAIMER =
  'This is an automated estimate from comparable asking prices. It is not a guaranteed market price and is not a surveyed valuation.';

const IMAGE_DISCLAIMER =
  'Image analysis is assistance only. It cannot legally or physically verify a property, room, or document.';

export async function runValuation(input: Parameters<typeof valuateProperty>[0] & { listingId?: number | null; propertyId?: number | null }) {
  const valuation: PropertyValuation = await valuateProperty(input);
  await persistAssessment({
    listingId: input.listingId ?? null,
    propertyId: input.propertyId ?? null,
    userId: input.requestedBy ?? null,
    kind: 'valuation',
    model: VALUATION_MODEL,
    confidence: valuation.confidence,
    score: valuation.confidence,
    result: {
      currency: valuation.currency,
      valueLow: valuation.valueLow,
      valueMid: valuation.valueMid,
      valueHigh: valuation.valueHigh,
      method: valuation.method,
      sampleSize: valuation.sampleSize,
      comparables: valuation.comparables,
      explanation: valuation.explanation,
    },
    disclaimer: VALUATION_DISCLAIMER,
  });
  return {
    ...valuation,
    model: VALUATION_MODEL,
    disclaimer: VALUATION_DISCLAIMER,
  };
}

export async function assessListingQuality(listingId: number) {
  const row = await queryOne<Row>(
    `SELECT l.title, l.description, l.media_count, l.completeness_score, pd.bedrooms, pd.bathrooms,
            pd.area_sqm, pd.has_ownership_papers, pd.furnishing
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
      WHERE l.id = ?`,
    [listingId],
  );
  if (!row) return null;
  let score = Number(row.completeness_score ?? 0);
  const reasons: string[] = [];
  if (!row.description || String(row.description).length < 80) {
    score -= 10;
    reasons.push('Short description reduces listing quality');
  }
  if (Number(row.media_count ?? 0) < 5) {
    score -= 8;
    reasons.push('Fewer than 5 photos');
  }
  if (row.bedrooms === null) {
    score -= 6;
    reasons.push('Bedroom count missing');
  }
  score = Math.max(0, Math.min(100, score));
  const result = { score, reasons, recommendation: score >= 70 ? 'Ready to publish' : 'Add photos, area and rooms before publishing' };
  await persistAssessment({
    listingId,
    propertyId: null,
    userId: null,
    kind: 'listing_quality',
    model: QUALITY_MODEL,
    confidence: 60,
    score,
    result,
    disclaimer: IMAGE_DISCLAIMER,
  });
  return { ...result, model: QUALITY_MODEL, disclaimer: IMAGE_DISCLAIMER };
}

export async function analyseListingImages(listingId: number) {
  const rows = await queryRows<Row>(
    `SELECT id, caption, perceptual_hash, ai_labels, nsfw_score, is_ai_enhanced
       FROM listing_media WHERE listing_id = ? AND kind = 'image'`,
    [listingId],
  );
  const hashes = new Map<string, number>();
  const labels: string[] = [];
  for (const row of rows) {
    const hash = row.perceptual_hash as string | null;
    if (hash) hashes.set(hash, (hashes.get(hash) ?? 0) + 1);
    const raw = row.ai_labels;
    if (Array.isArray(raw)) labels.push(...raw.map(String));
    else if (row.caption) labels.push(String(row.caption));
  }
  const duplicateInside = [...hashes.values()].some((count) => count > 1);
  const result = {
    imageCount: rows.length,
    possibleDuplicateImages: duplicateInside,
    suggestedRooms: uniqueGuess(labels, ['bedroom', 'kitchen', 'bathroom', 'living', 'garden', 'pool']),
    furnitureDetected: uniqueGuess(labels, ['bed', 'sofa', 'wardrobe', 'table']),
    qualityNotes: rows.length < 3 ? ['Add more photos covering each room'] : [],
    manipulationSuspected: rows.some((row) => Number(row.is_ai_enhanced) === 1),
  };
  await persistAssessment({
    listingId,
    propertyId: null,
    userId: null,
    kind: 'image_analysis',
    model: IMAGE_MODEL,
    confidence: 45,
    score: duplicateInside ? 40 : 70,
    result,
    disclaimer: IMAGE_DISCLAIMER,
  });
  return { ...result, model: IMAGE_MODEL, disclaimer: IMAGE_DISCLAIMER };
}

function uniqueGuess(labels: string[], vocab: string[]): string[] {
  const lower = labels.map((label) => label.toLowerCase());
  return vocab.filter((word) => lower.some((label) => label.includes(word)));
}

async function persistAssessment(params: {
  listingId: number | null;
  propertyId: number | null;
  userId: number | null;
  kind: 'valuation' | 'listing_quality' | 'image_analysis' | 'duplicate' | 'fraud_assist' | 'search_assist';
  model: { id: string; version: string; featureVersion: string };
  confidence: number;
  score: number;
  result: unknown;
  disclaimer: string;
}) {
  await insertAndGetId(
    `INSERT INTO property_ai_assessments
       (uuid, listing_id, property_id, user_id, kind, model_id, model_version, feature_version,
        confidence, score, result, result_status, disclaimer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
    [
      uuid(),
      params.listingId,
      params.propertyId,
      params.userId,
      params.kind,
      params.model.id,
      params.model.version,
      params.model.featureVersion,
      roundDecimal(params.confidence, 2),
      roundDecimal(params.score, 2),
      JSON.stringify(params.result),
      params.disclaimer,
    ],
  ).catch(() => 0);
}

export async function refreshListingValuation(listingId: number): Promise<void> {
  const row = await queryOne<Row>(
    `SELECT l.id, l.user_id, l.country_id, l.city_id, l.area_id, l.operation, l.currency,
            pd.property_kind, pd.area_value, pd.area_unit, pd.bedrooms, pd.bathrooms, pd.furnishing, pd.year_built
       FROM listings l
       JOIN property_listing_details pd ON pd.listing_id = l.id
      WHERE l.id = ? AND l.city_id IS NOT NULL AND pd.area_value IS NOT NULL`,
    [listingId],
  );
  if (!row || !row.city_id) return;
  await runValuation({
    listingId,
    requestedBy: Number(row.user_id),
    countryId: row.country_id === null ? null : Number(row.country_id),
    cityId: Number(row.city_id),
    areaId: row.area_id === null ? null : Number(row.area_id),
    propertyKind: String(row.property_kind),
    operation: String(row.operation) === 'rent' ? 'rent' : 'sell',
    areaValue: toNumber(row.area_value) ?? 0,
    areaUnit: String(row.area_unit ?? 'sqm'),
    bedrooms: row.bedrooms === null ? null : Number(row.bedrooms),
    bathrooms: row.bathrooms === null ? null : Number(row.bathrooms),
    furnishing: (row.furnishing as string | null) ?? null,
    yearBuilt: row.year_built === null ? null : Number(row.year_built),
    currency: String(row.currency ?? 'USD'),
  }).catch(() => undefined);
}

export { execute };
