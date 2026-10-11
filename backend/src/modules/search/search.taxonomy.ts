import type { FilterKey, MarketplaceCode, PreferenceKey, SearchOperation } from './search.dsl';

export interface TermRule {
  value: string;
  aliases: string[];
}

const uniq = (values: string[]): string[] => [...new Set(values.map((value) => value.toLowerCase()))];

// Property and Vehicles marketplace detection aliases were removed along
// with those marketplace modules (API is Gold-only). `detectMarketplaces`
// now only ever returns ['gold'] or [].
export const MARKETPLACE_ALIASES: Record<MarketplaceCode, string[]> = {
  gold: uniq([
    'gold', 'jewellery', 'jewelry', 'bullion', 'karat', 'carat', 'tola', 'bangle', 'necklace',
    'ring', 'earring', 'coin', 'bar', 'scrap gold', 'sona', 'zewar', 'zewar', 'سونا', 'زیور',
    'ذهب', 'ذهبى', 'or ', 'bijou', 'goldbar', 'hallmark', '18k', '21k', '22k', '24k',
    'सोना', 'गहन', 'ゴールド', '黄金', 'золото', 'altın', 'altin',
  ]),
};

export const GOLD_FORMS: TermRule[] = [
  { value: 'bar', aliases: ['bar', 'bars', 'bullion', 'ingot', 'sikka bar'] },
  { value: 'coin', aliases: ['coin', 'coins', 'guinea', 'sovereign'] },
  { value: 'jewellery', aliases: ['jewellery', 'jewelry', 'zewar', 'زیور', 'ornament'] },
  { value: 'ring', aliases: ['ring', 'rings', 'anguthi', 'انگھوٹھی'] },
  { value: 'bangle', aliases: ['bangle', 'bangles', 'kara', 'kangan'] },
  { value: 'necklace', aliases: ['necklace', 'chain', 'haar', 'set'] },
  { value: 'earring', aliases: ['earring', 'earrings', 'bali', 'jhumka'] },
  { value: 'scrap', aliases: ['scrap', 'broken gold', 'old gold'] },
  { value: 'antique', aliases: ['antique', 'heritage'] },
];

// PROPERTY_KINDS / VEHICLE_TYPES / VEHICLE_MAKES / VEHICLE_MODELS / PART_TERMS
// and looksLikePartsQuery() were removed with the Property and Vehicles
// marketplaces (parts was vehicle-only).

export const OPERATION_ALIASES: Array<{ value: SearchOperation; aliases: string[] }> = [
  { value: 'rent', aliases: ['rent', 'rental', 'kiraya', 'to rent', 'for rent', 'للإيجار', 'louer', 'mieten', 'alquiler'] },
  { value: 'sell', aliases: ['for sale', 'sale', 'sell', 'bech', 'للبيع', 'vendre', 'kaufen', 'venta'] },
  { value: 'buy', aliases: ['to buy', 'wanted', 'purchase', 'buy'] },
  { value: 'auction', aliases: ['auction', 'bid', 'bidding'] },
];

export const LOCATION_PARTICLES = uniq([
  'in', 'near', 'around', 'at', 'mein', 'me', 'mai', 'میں', 'في', 'près', 'bei', 'cerca', '附近',
]);

export const UNDER_PARTICLES = uniq([
  'under', 'below', 'less than', 'upto', 'up to', 'max', 'se kam', 'se kam', 'سے کم', 'chahiye budget',
]);

export const PREFERENCE_PATTERNS: Array<{ key: PreferenceKey; pattern: RegExp }> = [
  { key: 'lowMileage', pattern: /\b(preferably\s+)?(low|less)\s+mileage\b|\bpreferably low mileage\b/i },
  { key: 'reliability', pattern: /\b(reliable|reliability|dependable)\b/i },
  { key: 'fuelEconomy', pattern: /\b(fuel\s+(average|economy|efficient)|mileage\s+car|economical)\b/i },
  { key: 'familyUse', pattern: /\b(family|daily use|for family)\b/i },
  { key: 'budgetSensitive', pattern: /\b(cheap|affordable|budget|sasta)\b/i },
  { key: 'newer', pattern: /\b(newer|latest model|recent model)\b/i },
  { key: 'spacious', pattern: /\b(spacious|roomy|big family)\b/i },
  { key: 'investment', pattern: /\b(investment|invest)\b/i },
];

export const SOFT_MODIFIERS = /\b(preferably|prefer|if possible|nice to have|would be nice)\b/i;

export function detectLanguageHint(text: string): string | null {
  if (/[\u0600-\u06FF]/.test(text)) return /[ےڑں]/.test(text) ? 'ur' : 'ar';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  if (/\b(mein|chahiye|se kam|gari|gaari|sona|ghar|kiraya)\b/i.test(text)) return 'ur';
  return null;
}

export function firstMatchingRule(text: string, rules: TermRule[]): string | null {
  const haystack = text.toLowerCase();
  for (const rule of rules) {
    for (const alias of rule.aliases) {
      if (haystack.includes(alias.toLowerCase())) return rule.value;
    }
  }
  return null;
}

export function detectMarketplaces(text: string): MarketplaceCode[] {
  const haystack = text.toLowerCase();
  const hits: Array<{ code: MarketplaceCode; score: number }> = [];
  for (const [code, aliases] of Object.entries(MARKETPLACE_ALIASES) as Array<[MarketplaceCode, string[]]>) {
    const score = aliases.reduce((sum, alias) => (haystack.includes(alias) ? sum + Math.min(alias.length, 8) : sum), 0);
    if (score > 0) hits.push({ code, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.filter((hit) => hit.score >= 3 || hits.length === 1).map((hit) => hit.code);
}

export function extractHardFilter(text: string, key: FilterKey, value: string | number | boolean): boolean {
  if (SOFT_MODIFIERS.test(text) && new RegExp(String(value), 'i').test(text.slice(text.search(SOFT_MODIFIERS)))) {
    return false;
  }
  void key;
  return true;
}
