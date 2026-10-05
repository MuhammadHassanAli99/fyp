/**
 * Natural-language property search. Maps phrases onto existing listing filters
 * instead of a LIKE scan of the whole catalogue.
 */

const KIND_ALIASES: Array<{ pattern: RegExp; kind: string }> = [
  { pattern: /\bfarm\s*houses?\b/i, kind: 'farm_house' },
  { pattern: /\bapartments?\b/i, kind: 'apartment' },
  { pattern: /\bflats?\b/i, kind: 'flat' },
  { pattern: /\bvillas?\b/i, kind: 'villa' },
  { pattern: /\bhouses?\b|\bhomes?\b/i, kind: 'house' },
  { pattern: /\boffices?\b/i, kind: 'office' },
  { pattern: /\bshops?\b/i, kind: 'shop' },
  { pattern: /\bwarehouses?\b/i, kind: 'warehouse' },
  { pattern: /\bfactor(?:y|ies)\b/i, kind: 'factory' },
  { pattern: /\bhotels?\b/i, kind: 'hotel' },
  { pattern: /\bguest\s*houses?\b/i, kind: 'guest_house' },
  { pattern: /\bhostels?\b/i, kind: 'hostel' },
  { pattern: /\brooms?\b/i, kind: 'room' },
  { pattern: /\bcommercial\s+plots?\b/i, kind: 'commercial_plot' },
  { pattern: /\bresidential\s+plots?\b|\bplots?\b/i, kind: 'residential_plot' },
  { pattern: /\bagricultural\s+land\b|\bfarmland\b/i, kind: 'agricultural_land' },
];

export interface ParsedPropertyQuery {
  q: string;
  operation?: 'sell' | 'rent' | 'buy';
  propertyKind?: string;
  bedroomsMin?: number;
  bathroomsMin?: number;
  cityHint?: string;
  usageType?: string;
}

export function parsePropertyQuery(raw: string): ParsedPropertyQuery {
  const text = raw.trim();
  const result: ParsedPropertyQuery = { q: text };

  if (/\bfor\s+rent\b|\brent\b|\brental\b/i.test(text)) result.operation = 'rent';
  else if (/\bwanted\b|\bto\s+buy\b/i.test(text)) result.operation = 'buy';
  else if (/\bfor\s+sale\b|\bsell\b|\bsale\b/i.test(text)) result.operation = 'sell';

  if (/\bland\b|\bplot\b/i.test(text)) result.usageType = 'land';
  else if (/\bcommercial\b/i.test(text) && !result.propertyKind) result.usageType = 'commercial';
  if (/\bhospitality\b|\bhotel\b|\bhostel\b/i.test(text)) result.usageType = 'rental';
  if (/\bresidential\b/i.test(text)) result.usageType = 'residential';

  for (const alias of KIND_ALIASES) {
    if (alias.pattern.test(text)) {
      result.propertyKind = alias.kind;
      break;
    }
  }

  const beds = text.match(/(\d+)\s*(?:bed|beds|bedroom|bedrooms|br)\b/i);
  if (beds) result.bedroomsMin = Number(beds[1]);
  const baths = text.match(/(\d+)\s*(?:bath|baths|bathroom|bathrooms)\b/i);
  if (baths) result.bathroomsMin = Number(baths[1]);

  const inCity = text.match(/\bin\s+([A-Za-z][A-Za-z\s]{1,40})$/i);
  if (inCity) result.cityHint = inCity[1]!.trim();

  return result;
}
