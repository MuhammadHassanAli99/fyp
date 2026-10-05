import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { estimateVehiclePrice } from './vehicles.service';
import { LEGAL_AI_DISCLAIMER, VALUATION_DISCLAIMER } from './vehicles.rules';

export const VALUATION_MODEL = { id: 'vehicle-valuation', version: '2', featureVersion: '1' } as const;
export const QUALITY_MODEL = { id: 'vehicle-listing-quality', version: '1', featureVersion: '1' } as const;
export const IMAGE_MODEL = { id: 'vehicle-image-assist', version: '1', featureVersion: '1' } as const;

export async function runValuation(input: Parameters<typeof estimateVehiclePrice>[0]) {
  const estimate = await estimateVehiclePrice(input);
  await persistAssessment({
    listingId: input.listingId ?? null,
    userId: input.requestedBy ?? null,
    kind: 'valuation',
    model: VALUATION_MODEL,
    confidence: estimate.confidence,
    score: estimate.confidence,
    result: estimate,
    disclaimer: VALUATION_DISCLAIMER,
  });
  return {
    ...estimate,
    model: VALUATION_MODEL,
    disclaimer: VALUATION_DISCLAIMER,
    legalDisclaimer: LEGAL_AI_DISCLAIMER,
  };
}

export async function assessListingQuality(listingId: number) {
  const row = await queryOne<Row>(
    `SELECT l.title, l.description, l.media_count, vd.make_id, vd.model_id, vd.year, vd.mileage_km,
            vd.vin, vd.fuel_type, vd.transmission
       FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ?`,
    [listingId],
  );
  if (!row) return null;
  let score = 20;
  if (String(row.title ?? '').length >= 12) score += 10;
  if (String(row.description ?? '').length >= 80) score += 15;
  if (Number(row.media_count ?? 0) >= 5) score += 15;
  if (row.make_id && row.model_id && row.year) score += 15;
  if (row.mileage_km != null) score += 10;
  if (row.vin) score += 10;
  if (row.fuel_type && row.transmission) score += 5;
  score = Math.min(100, score);
  await persistAssessment({
    listingId,
    kind: 'listing_quality',
    model: QUALITY_MODEL,
    confidence: score,
    score,
    result: { score, hints: score < 70 ? ['Add more photos, VIN and a complete description'] : [] },
    disclaimer: 'Listing quality is assistance only and is not a verification of the vehicle.',
  });
  await execute(`UPDATE listings SET quality_score = ? WHERE id = ?`, [score, listingId]);
  return { score, disclaimer: 'Listing quality is assistance only.' };
}

export async function analyseListingImages(listingId: number) {
  const media = await queryRows<Row>(
    `SELECT id, kind, perceptual_hash FROM listing_media WHERE listing_id = ? LIMIT 40`,
    [listingId],
  );
  await persistAssessment({
    listingId,
    kind: 'image_analysis',
    model: IMAGE_MODEL,
    confidence: 40,
    score: 40,
    result: { mediaCount: media.length, hashes: media.filter((row) => row.perceptual_hash).length },
    disclaimer: 'Image analysis is assistance only. It cannot prove VIN, damage or ownership.',
  });
  return { mediaCount: media.length, disclaimer: 'Image analysis is assistance only.' };
}

export async function refreshListingValuation(listingId: number) {
  const row = await queryOne<Row>(
    `SELECT l.user_id, l.country_id, l.city_id, l.price, l.currency, vd.make_id, vd.model_id, vd.variant_id,
            vd.year, vd.mileage_km, vd.condition_grade, vd.accident_history, vd.owners_count, vd.inspection_score
       FROM listings l JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ?`,
    [listingId],
  );
  if (!row?.make_id || row.year == null) return null;
  return runValuation({
    listingId,
    requestedBy: Number(row.user_id),
    countryId: row.country_id === null ? null : Number(row.country_id),
    cityId: row.city_id === null ? null : Number(row.city_id),
    makeId: Number(row.make_id),
    modelId: row.model_id === null ? null : Number(row.model_id),
    variantId: row.variant_id === null ? null : Number(row.variant_id),
    year: Number(row.year),
    mileageKm: row.mileage_km === null ? null : Number(row.mileage_km),
    conditionGrade: (row.condition_grade as string | null) ?? null,
    accidentHistory: (row.accident_history as string | null) ?? null,
    ownersCount: row.owners_count === null ? null : Number(row.owners_count),
    inspectionScore: row.inspection_score === null ? null : Number(row.inspection_score),
    askingPrice: row.price === null ? null : Number(row.price),
    currency: String(row.currency ?? 'USD'),
  });
}

async function persistAssessment(params: {
  listingId?: number | null;
  vehicleId?: number | null;
  userId?: number | null;
  kind: 'valuation' | 'listing_quality' | 'image_analysis' | 'duplicate' | 'fraud_assist' | 'search_assist' | 'parts_compat' | 'document_class';
  model: { id: string; version: string; featureVersion: string };
  confidence: number;
  score: number;
  result: unknown;
  disclaimer: string;
}) {
  await insertAndGetId(
    `INSERT INTO vehicle_ai_assessments
       (uuid, listing_id, vehicle_id, user_id, kind, model_id, model_version, feature_version,
        confidence, score, result, result_status, disclaimer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?)`,
    [
      uuid(),
      params.listingId ?? null,
      params.vehicleId ?? null,
      params.userId ?? null,
      params.kind,
      params.model.id,
      params.model.version,
      params.model.featureVersion,
      params.confidence,
      params.score,
      JSON.stringify(params.result),
      params.disclaimer,
    ],
  );
}
