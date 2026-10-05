import type { FilterDefinition, FilterMarketplace, FilterOption } from './filters.types';

const opt = (value: string, label = value.replace(/_/g, ' ')): FilterOption => ({ value, label });

function def(
  key: string,
  label: string,
  type: FilterDefinition['type'],
  extra: Partial<FilterDefinition> = {},
): FilterDefinition {
  return {
    key,
    label,
    type,
    marketplace: extra.marketplace ?? null,
    category: extra.category ?? null,
    subcategory: extra.subcategory ?? null,
    dataSource: extra.dataSource ?? null,
    allowedValues: extra.allowedValues ?? [],
    min: extra.min ?? null,
    max: extra.max ?? null,
    step: extra.step ?? (type === 'rating' ? 0.5 : type === 'range' || type === 'year_range' ? 1 : null),
    unit: extra.unit ?? null,
    currency: extra.currency ?? null,
    dependsOn: extra.dependsOn ?? null,
    visibility: extra.visibility ?? (extra.dependsOn ? 'when_parent' : 'always'),
    sortOrder: extra.sortOrder ?? 100,
  };
}

const COMMON: FilterDefinition[] = [
  def('location', 'Location', 'location', { dataSource: 'geo.hierarchy', sortOrder: 10 }),
  def('regionId', 'Province / state', 'searchable_select', {
    dataSource: 'geo.region',
    sortOrder: 11,
  }),
  def('cityId', 'City', 'searchable_select', {
    dataSource: 'geo.city',
    sortOrder: 12,
  }),
  def('areaId', 'Area', 'searchable_select', {
    dataSource: 'geo.area',
    dependsOn: 'cityId',
    sortOrder: 13,
  }),
  def('radiusKm', 'Distance', 'radius', {
    dataSource: 'geo.radius',
    allowedValues: [1, 5, 10, 25, 50, 100].map((km) => opt(String(km), `${km} km`)),
    min: 0.1,
    max: 100,
    step: 0.5,
    unit: 'km',
    sortOrder: 20,
  }),
  def('price', 'Price', 'currency_range', { min: 0, step: 100, sortOrder: 30 }),
  def('operation', 'Availability / purpose', 'single_select', {
    allowedValues: [opt('buy'), opt('sell'), opt('rent'), opt('auction'), opt('exchange')],
    sortOrder: 40,
  }),
  def('category', 'Category', 'searchable_select', {
    dataSource: 'catalog.category',
    sortOrder: 50,
  }),
  def('subcategory', 'Subcategory', 'searchable_select', {
    dataSource: 'catalog.subcategory',
    dependsOn: 'category',
    sortOrder: 55,
  }),
  def('minRating', 'Rating', 'rating', { min: 1, max: 5, step: 0.5, sortOrder: 60 }),
  def('condition', 'Condition', 'enum', {
    allowedValues: [
      opt('new'),
      opt('like_new', 'Like new'),
      opt('excellent'),
      opt('good'),
      opt('fair'),
      opt('used'),
      opt('refurbished'),
      opt('for_parts', 'For parts'),
    ],
    sortOrder: 70,
  }),
  def('availability', 'Listing status', 'single_select', {
    allowedValues: [opt('available'), opt('sold'), opt('rented'), opt('upcoming'), opt('auction')],
    sortOrder: 80,
  }),
  def('verifiedSeller', 'Verified seller', 'boolean', { sortOrder: 90 }),
  def('premiumSeller', 'Premium seller', 'boolean', { sortOrder: 91 }),
  def('sellerType', 'Seller type', 'single_select', {
    allowedValues: [
      opt('individual'),
      opt('business', 'Business seller'),
      opt('dealer'),
      opt('agency'),
    ],
    sortOrder: 92,
  }),
  def('withPhotos', 'With photos', 'boolean', { sortOrder: 93 }),
  def('featuredOnly', 'Featured only', 'boolean', { sortOrder: 94 }),
];

const GOLD: FilterDefinition[] = [
  def('karat', 'Karat / purity', 'multi_select', {
    marketplace: 'gold',
    allowedValues: [opt('24', '24K'), opt('22', '22K'), opt('21', '21K'), opt('18', '18K'), opt('14', '14K'), opt('9', '9K')],
    sortOrder: 110,
  }),
  def('form', 'Gold type', 'single_select', {
    marketplace: 'gold',
    allowedValues: [opt('jewellery'), opt('bar'), opt('coin'), opt('biscuit'), opt('scrap')],
    sortOrder: 120,
  }),
  def('weightMin', 'Weight', 'range', {
    marketplace: 'gold',
    min: 0,
    max: 5000,
    step: 0.1,
    unit: 'g',
    sortOrder: 130,
  }),
  def('brandId', 'Brand', 'searchable_select', {
    marketplace: 'gold',
    dataSource: 'gold.brands',
    sortOrder: 140,
  }),
  def('certified', 'Certificate', 'boolean', { marketplace: 'gold', sortOrder: 150 }),
  def('hallmarked', 'Hallmark', 'boolean', { marketplace: 'gold', sortOrder: 151 }),
  def('certificateAuthority', 'Certificate authority', 'searchable_select', {
    marketplace: 'gold',
    dataSource: 'gold.certificateAuthorities',
    sortOrder: 152,
  }),
  def('makingChargeMax', 'Making charges (max)', 'number', {
    marketplace: 'gold',
    min: 0,
    unit: 'amount',
    sortOrder: 160,
  }),
  def('jewelleryType', 'Jewellery type', 'single_select', {
    marketplace: 'gold',
    allowedValues: [opt('ring'), opt('necklace'), opt('bracelet'), opt('earring'), opt('bangle'), opt('set'), opt('other')],
    sortOrder: 170,
  }),
  def('investmentGrade', 'Investment grade', 'boolean', { marketplace: 'gold', sortOrder: 180 }),
  def('antique', 'Antique', 'boolean', { marketplace: 'gold', sortOrder: 181 }),
  def('scrap', 'Scrap gold', 'boolean', { marketplace: 'gold', sortOrder: 182 }),
];

const PROPERTY: FilterDefinition[] = [
  def('usageType', 'Property type', 'single_select', {
    marketplace: 'property',
    allowedValues: [opt('residential'), opt('commercial'), opt('land'), opt('hospitality')],
    sortOrder: 110,
  }),
  def('propertyKind', 'Subtype', 'searchable_select', {
    marketplace: 'property',
    dataSource: 'property.types',
    dependsOn: 'usageType',
    sortOrder: 120,
  }),
  def('bedroomsMin', 'Bedrooms', 'number', { marketplace: 'property', min: 0, max: 20, step: 1, sortOrder: 130 }),
  def('bathroomsMin', 'Bathrooms', 'number', { marketplace: 'property', min: 0, max: 20, step: 1, sortOrder: 140 }),
  def('areaMin', 'Area', 'range', { marketplace: 'property', min: 0, max: 100000, step: 1, unit: 'sqm', sortOrder: 150 }),
  def('areaUnit', 'Area unit', 'enum', {
    marketplace: 'property',
    allowedValues: [opt('sqm', 'Sq. m'), opt('sqft', 'Sq. ft'), opt('marla', 'Marla'), opt('kanal', 'Kanal')],
    sortOrder: 151,
  }),
  def('floorsMin', 'Floors', 'range', { marketplace: 'property', min: 0, max: 200, step: 1, sortOrder: 160 }),
  def('parkingMin', 'Parking', 'number', { marketplace: 'property', min: 0, max: 20, step: 1, sortOrder: 170 }),
  def('furnishing', 'Furnished', 'single_select', {
    marketplace: 'property',
    allowedValues: [opt('unfurnished'), opt('semi_furnished', 'Semi furnished'), opt('furnished'), opt('fully_furnished', 'Fully furnished')],
    sortOrder: 180,
  }),
  def('garden', 'Garden', 'boolean', { marketplace: 'property', sortOrder: 190 }),
  def('balcony', 'Balcony', 'boolean', { marketplace: 'property', sortOrder: 191 }),
  def('swimmingPool', 'Swimming pool', 'boolean', { marketplace: 'property', sortOrder: 192 }),
  def('gym', 'Gym', 'boolean', { marketplace: 'property', sortOrder: 193 }),
  def('elevator', 'Elevator', 'boolean', { marketplace: 'property', sortOrder: 194 }),
  def('gatedCommunity', 'Gated community', 'boolean', { marketplace: 'property', sortOrder: 195 }),
];

const VEHICLES: FilterDefinition[] = [
  def('vehicleType', 'Vehicle type', 'single_select', {
    marketplace: 'vehicles',
    dataSource: 'vehicles.types',
    allowedValues: [
      opt('car'), opt('motorcycle'), opt('van'), opt('truck'), opt('bus'),
      opt('taxi'), opt('rickshaw'), opt('boat'), opt('yacht'), opt('jet_ski'),
    ],
    sortOrder: 110,
  }),
  def('makeId', 'Make', 'searchable_select', {
    marketplace: 'vehicles',
    dataSource: 'vehicles.makes',
    sortOrder: 120,
  }),
  def('modelId', 'Model', 'searchable_select', {
    marketplace: 'vehicles',
    dataSource: 'vehicles.models',
    dependsOn: 'makeId',
    sortOrder: 130,
  }),
  def('variantId', 'Variant', 'searchable_select', {
    marketplace: 'vehicles',
    dataSource: 'vehicles.variants',
    dependsOn: 'modelId',
    sortOrder: 140,
  }),
  def('yearMin', 'Year', 'year_range', {
    marketplace: 'vehicles',
    min: 1950,
    max: new Date().getFullYear() + 1,
    step: 1,
    sortOrder: 150,
  }),
  def('mileageMax', 'Mileage', 'range', { marketplace: 'vehicles', min: 0, max: 1_000_000, step: 1000, unit: 'km', sortOrder: 160 }),
  def('engineMin', 'Engine (cc)', 'range', { marketplace: 'vehicles', min: 0, max: 10000, step: 50, unit: 'cc', sortOrder: 170 }),
  def('fuelType', 'Fuel', 'multi_select', {
    marketplace: 'vehicles',
    allowedValues: [opt('petrol'), opt('diesel'), opt('hybrid'), opt('electric'), opt('cng'), opt('lpg')],
    sortOrder: 180,
  }),
  def('transmission', 'Transmission', 'multi_select', {
    marketplace: 'vehicles',
    allowedValues: [opt('automatic'), opt('manual'), opt('cvt', 'CVT'), opt('amt', 'AMT')],
    sortOrder: 190,
  }),
  def('colorFamily', 'Color', 'single_select', {
    marketplace: 'vehicles',
    allowedValues: [
      opt('white'), opt('black'), opt('silver'), opt('grey'), opt('red'),
      opt('blue'), opt('green'), opt('other'),
    ],
    sortOrder: 200,
  }),
  def('bodyType', 'Body type', 'single_select', {
    marketplace: 'vehicles',
    allowedValues: [opt('sedan'), opt('hatchback'), opt('suv', 'SUV'), opt('coupe'), opt('pickup'), opt('van'), opt('convertible')],
    sortOrder: 210,
  }),
  def('conditionGrade', 'Condition', 'enum', {
    marketplace: 'vehicles',
    allowedValues: [opt('excellent'), opt('good'), opt('fair'), opt('poor')],
    sortOrder: 220,
  }),
  def('registrationStatus', 'Registration', 'single_select', {
    marketplace: 'vehicles',
    allowedValues: [opt('registered'), opt('unregistered'), opt('expired')],
    sortOrder: 230,
  }),
  def('assembly', 'Import status', 'single_select', {
    marketplace: 'vehicles',
    allowedValues: [opt('local'), opt('imported'), opt('reconditioned')],
    sortOrder: 240,
  }),
  def('inspected', 'Inspected', 'boolean', { marketplace: 'vehicles', sortOrder: 250 }),
  def('financeAvailable', 'Finance available', 'boolean', { marketplace: 'vehicles', sortOrder: 251 }),
];

const PARTS: FilterDefinition[] = [
  def('partCategory', 'Part category', 'searchable_select', {
    marketplace: 'parts',
    dataSource: 'vehicles.partCategories',
    sortOrder: 110,
  }),
  def('partBrand', 'Part brand', 'searchable_select', {
    marketplace: 'parts',
    dataSource: 'vehicles.partBrands',
    sortOrder: 120,
  }),
  def('oem', 'OEM / aftermarket', 'single_select', {
    marketplace: 'parts',
    allowedValues: [opt('oem', 'OEM'), opt('aftermarket', 'Aftermarket')],
    sortOrder: 130,
  }),
  def('makeId', 'Compatible make', 'searchable_select', {
    marketplace: 'parts',
    dataSource: 'vehicles.makes',
    sortOrder: 140,
  }),
  def('modelId', 'Compatible model', 'searchable_select', {
    marketplace: 'parts',
    dataSource: 'vehicles.models',
    dependsOn: 'makeId',
    sortOrder: 150,
  }),
  def('yearMin', 'Compatible year', 'year_range', {
    marketplace: 'parts',
    min: 1950,
    max: new Date().getFullYear() + 1,
    sortOrder: 160,
  }),
  def('condition', 'Condition', 'enum', {
    marketplace: 'parts',
    allowedValues: [opt('new'), opt('used'), opt('refurbished')],
    sortOrder: 170,
  }),
];

const ALL: FilterDefinition[] = [...COMMON, ...GOLD, ...PROPERTY, ...VEHICLES, ...PARTS];

export function builtInFilterDefinitions(): FilterDefinition[] {
  return ALL.map((item) => ({ ...item, allowedValues: [...item.allowedValues] }));
}

export function definitionsFor(params: {
  marketplace?: string | null;
  category?: string | null;
  subcategory?: string | null;
}): FilterDefinition[] {
  const marketplace = params.marketplace ?? null;
  const category = params.category ?? null;
  const subcategory = params.subcategory ?? null;
  return builtInFilterDefinitions()
    .filter((item) => {
      if (item.marketplace === null) return marketplace !== 'parts';
      if (marketplace === 'parts') return item.marketplace === 'parts';
      if (item.marketplace === 'parts') return false;
      if (item.marketplace !== marketplace) return false;
      if (item.category && category && item.category !== category) return false;
      if (item.subcategory && subcategory && item.subcategory !== subcategory) return false;
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

export function definitionByKey(key: string, marketplace?: string | null): FilterDefinition | undefined {
  const scoped = definitionsFor({ marketplace });
  return scoped.find((item) => item.key === key) ?? builtInFilterDefinitions().find((item) => item.key === key);
}

export function isKnownFilterMarketplace(value: string | null | undefined): value is FilterMarketplace {
  return value === 'gold' || value === 'property' || value === 'vehicles' || value === 'parts';
}
