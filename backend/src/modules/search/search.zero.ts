import type { SearchQuery } from './search.dsl';

export interface ZeroResultHelp {
  message: string;
  suggestions: string[];
}

export function zeroResultHelp(query: SearchQuery, options: { nearbyCities?: string[] } = {}): ZeroResultHelp {
  const suggestions: string[] = [];
  const bits: string[] = [];
  if (query.filters.make) bits.push(String(query.filters.make));
  if (query.filters.model) bits.push(String(query.filters.model));
  if (query.filters.propertyKind) bits.push(String(query.filters.propertyKind).replaceAll('_', ' '));
  if (query.filters.karat) bits.push(`${query.filters.karat}K gold`);
  if (query.price?.max) bits.push(`under ${query.price.currency} ${query.price.max.toLocaleString()}`);
  if (query.location?.cityName) bits.push(`in ${query.location.cityName}`);

  const subject = bits.length > 0 ? bits.join(' ') : query.originalQuery || 'that search';
  const message = `No ${subject} was found.`;

  if (query.location?.radiusKm && query.location.radiusKm < 50) {
    suggestions.push(`Expand radius to ${query.location.radiusKm <= 10 ? 25 : 50} km`);
  } else if (query.location?.cityName) {
    suggestions.push('Include nearby cities');
  }
  if (query.price?.max) {
    const raised = Math.round(query.price.max * 1.15);
    suggestions.push(`Increase budget to ${query.price.currency} ${raised.toLocaleString()}`);
  }
  if (query.filters.yearMin && Number(query.filters.yearMin) > 2015) {
    suggestions.push('Include older years');
  }
  if (query.filters.bedroomsMin && Number(query.filters.bedroomsMin) > 2) {
    suggestions.push('Try fewer bedrooms');
  }
  if (query.operation === 'rent') suggestions.push('Try for sale listings');
  if (query.operation === 'sell') suggestions.push('Try rental listings');
  for (const city of options.nearbyCities ?? []) {
    suggestions.push(`Search in ${city}`);
  }
  if (suggestions.length === 0) {
    suggestions.push('Remove a filter');
    suggestions.push('Try a broader keyword');
  }

  return { message, suggestions: [...new Set(suggestions)].slice(0, 5) };
}
