import type { ListingCard } from '../listings/listings.repository';
import type { RankableHit } from './search.rank';
import type { SearchQuery } from './search.dsl';

function field(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

export function matchReasons(query: SearchQuery, hit: RankableHit, card: ListingCard): string[] {
  const reasons: string[] = [];
  if (query.marketplace && card.marketplaceCode === query.marketplace) {
    reasons.push(`Listed in ${query.marketplace}`);
  }
  if (query.operation && card.operation === query.operation) {
    reasons.push(query.operation === 'rent' ? 'Available to rent' : `Listed for ${query.operation}`);
  }
  if (query.filters.make && field(hit.attributes.make)?.toLowerCase() === String(query.filters.make).toLowerCase()) {
    reasons.push(`${hit.attributes.make} make`);
  }
  if (query.filters.model && field(hit.attributes.model)?.toLowerCase() === String(query.filters.model).toLowerCase()) {
    reasons.push(`${hit.attributes.model} model`);
  }
  if (query.filters.transmission && field(hit.attributes.transmission) === query.filters.transmission) {
    reasons.push(`${query.filters.transmission} transmission`);
  }
  if (query.filters.karat && Number(hit.attributes.karat) === Number(query.filters.karat)) {
    reasons.push(`${query.filters.karat}K`);
  }
  if (query.filters.propertyKind && field(hit.attributes.propertyKind) === query.filters.propertyKind) {
    reasons.push(String(query.filters.propertyKind).replaceAll('_', ' '));
  }
  if (query.filters.bedroomsMin && Number(hit.attributes.bedrooms) >= Number(query.filters.bedroomsMin)) {
    reasons.push(`${hit.attributes.bedrooms}+ bedrooms`);
  }
  if (query.price?.max && card.price !== null && card.price <= query.price.max && card.currency === query.price.currency) {
    reasons.push(`Within ${query.price.currency} ${query.price.max.toLocaleString()}`);
  } else if (query.price?.max && card.price !== null) {
    reasons.push(`Priced at ${card.currency ?? ''} ${card.price.toLocaleString()}`.trim());
  }
  if (query.location?.cityName && card.cityName && card.cityName.toLowerCase() === query.location.cityName.toLowerCase()) {
    reasons.push(`In ${card.cityName}`);
  }
  if (hit.distanceKm !== null) {
    reasons.push(`${hit.distanceKm.toFixed(1)} km away`);
  }
  return reasons.slice(0, 8);
}

export function explainResults(query: SearchQuery, hits: RankableHit[]): string | null {
  if (hits.length === 0) return null;
  const sample = hits.find((hit) => hit.placement === 'organic') ?? hits[0]!;
  const reasons = sample.matchReasons;
  if (reasons.length === 0) {
    return `These listings match “${query.originalQuery}”.`;
  }
  return `These results match because they are ${reasons.join(', ')}.`;
}
