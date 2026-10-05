/**
 * Ranking after candidate retrieval. Organic relevance is computed first;
 * sponsored placement is a separate pass that cannot rescue an irrelevant hit.
 */

export const MIN_SPONSORED_RELEVANCE = 0.35;

export interface RankSignals {
  text: number;
  semantic: number;
  filterMatch: number;
  location: number;
  price: number;
  availability: number;
  quality: number;
  trust: number;
  freshness: number;
  preference: number;
}

export interface RankableHit {
  listingId: number;
  marketplaceCode: string;
  isFeatured: boolean;
  isBoosted: boolean;
  isSponsoredEligible: boolean;
  publishedAt: string | null;
  distanceKm: number | null;
  price: number | null;
  currency: string | null;
  publicTrustBand: string | null;
  qualityScore: number;
  attributes: Record<string, unknown>;
  signals: RankSignals;
  organicScore: number;
  finalScore: number;
  placement: 'organic' | 'sponsored';
  matchReasons: string[];
  card?: unknown;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function organicScore(signals: RankSignals): number {
  return (
    signals.text * 0.22 +
    signals.semantic * 0.16 +
    signals.filterMatch * 0.2 +
    signals.location * 0.12 +
    signals.price * 0.08 +
    signals.availability * 0.05 +
    signals.quality * 0.06 +
    signals.trust * 0.04 +
    signals.freshness * 0.04 +
    signals.preference * 0.03
  );
}

export function freshnessScore(publishedAt: string | null, now = Date.now()): number {
  if (!publishedAt) return 0.3;
  const ageDays = (now - new Date(publishedAt).getTime()) / 86_400_000;
  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.8;
  if (ageDays <= 30) return 0.55;
  if (ageDays <= 90) return 0.35;
  return 0.15;
}

export function locationScore(distanceKm: number | null, radiusKm: number | null): number {
  if (distanceKm === null) return 0.45;
  const radius = radiusKm && radiusKm > 0 ? radiusKm : 50;
  return clamp01(1 - distanceKm / (radius * 1.5));
}

export function priceScore(listingPrice: number | null, max: number | undefined, min: number | undefined): number {
  if (listingPrice === null) return 0.4;
  if (max === undefined && min === undefined) return 0.5;
  if (max !== undefined && listingPrice > max) return 0;
  if (min !== undefined && listingPrice < min) return 0.2;
  if (max === undefined) return 0.7;
  const ratio = listingPrice / max;
  if (ratio <= 0.7) return 1;
  if (ratio <= 0.9) return 0.8;
  return 0.55;
}

export function preferenceScore(
  attributes: Record<string, unknown>,
  preferences: Record<string, unknown>,
): number {
  let score = 0.5;
  if (preferences.lowMileage && typeof attributes.mileageKm === 'number') {
    score += attributes.mileageKm < 80_000 ? 0.25 : attributes.mileageKm < 150_000 ? 0.1 : -0.05;
  }
  if (preferences.fuelEconomy && typeof attributes.fuelType === 'string') {
    if (['hybrid', 'electric'].includes(attributes.fuelType)) score += 0.2;
  }
  if (preferences.familyUse && typeof attributes.vehicleType === 'string') {
    if (['car', 'van', 'suv'].includes(String(attributes.vehicleType))) score += 0.1;
  }
  if (preferences.budgetSensitive) score += 0.05;
  if (preferences.investment && attributes.investmentGrade) score += 0.2;
  return clamp01(score);
}

export function trustScore(band: string | null): number {
  switch (band) {
    case 'excellent':
    case 'high':
      return 1;
    case 'good':
      return 0.75;
    case 'fair':
      return 0.5;
    default:
      return 0.4;
  }
}

/**
 * Paid promotion may only boost listings that already cleared organic relevance.
 * Irrelevant boosted rows stay organic and keep their organic score.
 */
export function applySponsoredPlacement(hits: RankableHit[], injectAt = [2, 6]): RankableHit[] {
  const organic = [...hits].sort((a, b) => b.organicScore - a.organicScore);
  const sponsored = organic.filter(
    (hit) => hit.isSponsoredEligible && hit.organicScore >= MIN_SPONSORED_RELEVANCE,
  );
  const organicOnly = organic.filter((hit) => !sponsored.some((row) => row.listingId === hit.listingId));
  if (sponsored.length === 0) {
    return organic.map((hit) => ({ ...hit, placement: 'organic' as const, finalScore: hit.organicScore }));
  }

  const used = new Set<number>();
  const merged: RankableHit[] = [];
  let sponsorIndex = 0;
  let organicIndex = 0;
  const total = organicOnly.length + sponsored.length;

  for (let i = 0; i < total; i += 1) {
    if (injectAt.includes(i) && sponsorIndex < sponsored.length) {
      const candidate = sponsored[sponsorIndex]!;
      sponsorIndex += 1;
      if (!used.has(candidate.listingId)) {
        merged.push({
          ...candidate,
          placement: 'sponsored',
          finalScore: candidate.organicScore + 0.02,
        });
        used.add(candidate.listingId);
        continue;
      }
    }
    const hit = organicOnly[organicIndex];
    organicIndex += 1;
    if (!hit || used.has(hit.listingId)) continue;
    merged.push({ ...hit, placement: 'organic', finalScore: hit.organicScore });
    used.add(hit.listingId);
  }

  for (const leftover of [...organicOnly, ...sponsored]) {
    if (used.has(leftover.listingId)) continue;
    merged.push({
      ...leftover,
      placement: leftover.isSponsoredEligible && leftover.organicScore >= MIN_SPONSORED_RELEVANCE ? 'sponsored' : 'organic',
      finalScore: leftover.organicScore,
    });
    used.add(leftover.listingId);
  }

  return merged;
}

export function paginateHits<T>(items: T[], page: number, perPage: number): T[] {
  const start = (page - 1) * perPage;
  return items.slice(start, start + perPage);
}
