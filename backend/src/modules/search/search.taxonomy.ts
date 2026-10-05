import type { FilterKey, MarketplaceCode, PreferenceKey, SearchOperation } from './search.dsl';

export interface TermRule {
  value: string;
  aliases: string[];
}

const uniq = (values: string[]): string[] => [...new Set(values.map((value) => value.toLowerCase()))];

export const MARKETPLACE_ALIASES: Record<MarketplaceCode, string[]> = {
  gold: uniq([
    'gold', 'jewellery', 'jewelry', 'bullion', 'karat', 'carat', 'tola', 'bangle', 'necklace',
    'ring', 'earring', 'coin', 'bar', 'scrap gold', 'sona', 'zewar', 'zewar', 'سونا', 'زیور',
    'ذهب', 'ذهبى', 'or ', 'bijou', 'goldbar', 'hallmark', '18k', '21k', '22k', '24k',
    'सोना', 'गहन', 'ゴールド', '黄金', 'золото', 'altın', 'altin',
  ]),
  property: uniq([
    'house', 'home', 'flat', 'apartment', 'villa', 'farmhouse', 'office', 'shop', 'warehouse',
    'factory', 'plot', 'land', 'room', 'hotel', 'hostel', 'guest house', 'makan', 'ghar', 'kiraya',
    'rent', 'marla', 'kanal', 'bedroom', 'بیت', 'منزل', 'عقار', 'شقة', 'گھر', 'مکان',
    'maison', 'appartement', 'haus', 'wohnung', 'casa', 'departamento', '家', 'アパート', 'дом',
    'ev', 'villa', 'farm house', 'agricultural',
  ]),
  vehicles: uniq([
    'car', 'bike', 'motorcycle', 'truck', 'bus', 'van', 'suv', 'sedan', 'taxi', 'rickshaw',
    'tractor', 'boat', 'yacht', 'jet ski', 'mileage', 'automatic', 'manual', 'petrol', 'diesel',
    'toyota', 'honda', 'suzuki', 'corolla', 'civic', 'gari', 'gaari', 'gaadi', 'سيارة', 'گاڑی',
    'گاڑی', 'voiture', 'auto', 'wagen', 'coche', 'carro', '車', '汽车', 'машина', 'araba',
    'parts', 'tyre', 'tire', 'battery', 'brake',
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

export const PROPERTY_KINDS: TermRule[] = [
  { value: 'house', aliases: ['house', 'home', 'makan', 'ghar', 'گھر', 'منزل', 'maison', 'haus', 'casa', 'дом', 'ev'] },
  { value: 'apartment', aliases: ['apartment', 'apartments', 'شقة', 'appartement', 'wohnung'] },
  { value: 'flat', aliases: ['flat', 'flats'] },
  { value: 'villa', aliases: ['villa', 'villas'] },
  { value: 'farm_house', aliases: ['farmhouse', 'farm house', 'farm-house'] },
  { value: 'office', aliases: ['office', 'offices', 'bureau'] },
  { value: 'shop', aliases: ['shop', 'shops', 'store', 'retail'] },
  { value: 'warehouse', aliases: ['warehouse', 'godown'] },
  { value: 'factory', aliases: ['factory', 'factories', 'industrial'] },
  { value: 'room', aliases: ['room', 'rooms'] },
  { value: 'hotel', aliases: ['hotel', 'hotels'] },
  { value: 'guest_house', aliases: ['guest house', 'guesthouse'] },
  { value: 'hostel', aliases: ['hostel', 'hostels'] },
  { value: 'residential_plot', aliases: ['plot', 'plots', 'residential plot'] },
  { value: 'commercial_plot', aliases: ['commercial plot'] },
  { value: 'agricultural_land', aliases: ['agricultural land', 'farmland', 'zameen'] },
];

export const VEHICLE_TYPES: TermRule[] = [
  { value: 'car', aliases: ['car', 'cars', 'sedan', 'suv', 'hatchback', 'gari', 'gaari', 'سيارة'] },
  { value: 'motorcycle', aliases: ['motorcycle', 'motorcycles', 'bike', 'bikes'] },
  { value: 'bus', aliases: ['bus', 'buses'] },
  { value: 'truck', aliases: ['truck', 'trucks'] },
  { value: 'van', aliases: ['van', 'vans'] },
  { value: 'taxi', aliases: ['taxi', 'cabs'] },
  { value: 'rickshaw', aliases: ['rickshaw', 'qingqi'] },
  { value: 'heavy_machinery', aliases: ['excavator', 'machinery', 'heavy machinery', 'construction equipment'] },
  { value: 'agriculture_equipment', aliases: ['tractor', 'agriculture', 'agriculture equipment'] },
  { value: 'boat', aliases: ['boat', 'boats'] },
  { value: 'yacht', aliases: ['yacht', 'yachts'] },
  { value: 'jet_ski', aliases: ['jet ski', 'jetski'] },
];

export const VEHICLE_MAKES: TermRule[] = [
  { value: 'Toyota', aliases: ['toyota', 'toyta'] },
  { value: 'Honda', aliases: ['honda'] },
  { value: 'Suzuki', aliases: ['suzuki'] },
  { value: 'Hyundai', aliases: ['hyundai'] },
  { value: 'Kia', aliases: ['kia'] },
  { value: 'Nissan', aliases: ['nissan'] },
  { value: 'Mitsubishi', aliases: ['mitsubishi'] },
  { value: 'Mercedes', aliases: ['mercedes', 'mercedes-benz', 'benz'] },
  { value: 'BMW', aliases: ['bmw'] },
  { value: 'Audi', aliases: ['audi'] },
  { value: 'Volkswagen', aliases: ['volkswagen', 'vw'] },
  { value: 'Ford', aliases: ['ford'] },
  { value: 'Chevrolet', aliases: ['chevrolet', 'chevy'] },
  { value: 'Changan', aliases: ['changan'] },
  { value: 'MG', aliases: ['mg'] },
  { value: 'Daihatsu', aliases: ['daihatsu'] },
  { value: 'Yamaha', aliases: ['yamaha'] },
  { value: 'Kawasaki', aliases: ['kawasaki'] },
  { value: 'United', aliases: ['united'] },
  { value: 'Road Prince', aliases: ['road prince'] },
];

export const VEHICLE_MODELS: TermRule[] = [
  { value: 'Corolla', aliases: ['corolla', 'corola'] },
  { value: 'Civic', aliases: ['civic'] },
  { value: 'City', aliases: ['city'] },
  { value: 'Yaris', aliases: ['yaris'] },
  { value: 'Fortuner', aliases: ['fortuner'] },
  { value: 'Land Cruiser', aliases: ['land cruiser', 'landcruiser'] },
  { value: 'Alto', aliases: ['alto'] },
  { value: 'Cultus', aliases: ['cultus'] },
  { value: 'Swift', aliases: ['swift'] },
  { value: 'Sportage', aliases: ['sportage'] },
  { value: 'Tucson', aliases: ['tucson'] },
  { value: 'Elantra', aliases: ['elantra'] },
  { value: 'Accord', aliases: ['accord'] },
  { value: 'Mehran', aliases: ['mehran'] },
  { value: 'Wagon R', aliases: ['wagon r', 'wagonr'] },
];

export const PART_TERMS = uniq([
  'parts', 'spare', 'spare parts', 'tyre', 'tyres', 'tire', 'battery', 'brake', 'brakes',
  'bumper', 'headlight', 'filter', 'engine part', 'oem',
]);

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

export function looksLikePartsQuery(text: string): boolean {
  const haystack = text.toLowerCase();
  return PART_TERMS.some((term) => haystack.includes(term));
}

export function extractHardFilter(text: string, key: FilterKey, value: string | number | boolean): boolean {
  if (SOFT_MODIFIERS.test(text) && new RegExp(String(value), 'i').test(text.slice(text.search(SOFT_MODIFIERS)))) {
    return false;
  }
  void key;
  return true;
}
