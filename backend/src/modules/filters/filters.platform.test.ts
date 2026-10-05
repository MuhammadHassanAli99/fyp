import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { definitionsFor } from './filters.definitions';
import { validateFilterState, sanitizeFilterValue, emptyFilterState } from './filters.validate';
import { filterStateToSearchDsl, publicQueryParams, searchDslToFilterState, filterStateFromQueryParams } from './filters.state';
import { definitionByKey } from './filters.definitions';
import { clampRadiusKm, validateSearchQuery } from '../search/search.dsl';
import { encodeGeohash, decodeGeohashCenter, geohashPrecisionForZoom } from '../geo/geohash';
import { formatDistance, haversineMeters } from '../geo/distance';
import { capabilitiesFor, getMapProvider, getMapProviderByCode } from '../../providers/maps';
import { directionsFor, streetViewFor, distanceBetween } from '../maps/maps.service';

const ctx = { currency: 'PKR', language: 'en', countryCode: 'PK' };

describe('filter definitions', () => {
  it('returns common plus gold filters and hides vehicle keys', () => {
    const gold = definitionsFor({ marketplace: 'gold' });
    assert.ok(gold.some((item) => item.key === 'karat'));
    assert.ok(gold.some((item) => item.key === 'price'));
    assert.equal(gold.some((item) => item.key === 'bedroomsMin'), false);
    assert.equal(gold.some((item) => item.key === 'makeId'), false);
  });

  it('returns property and vehicle specific filters only for that marketplace', () => {
    const property = definitionsFor({ marketplace: 'property' });
    const vehicles = definitionsFor({ marketplace: 'vehicles' });
    const parts = definitionsFor({ marketplace: 'parts' });
    assert.ok(property.some((item) => item.key === 'bedroomsMin'));
    assert.ok(property.some((item) => item.key === 'swimmingPool'));
    assert.ok(vehicles.some((item) => item.key === 'makeId'));
    assert.ok(vehicles.some((item) => item.key === 'transmission'));
    assert.ok(parts.some((item) => item.key === 'partCategory'));
    assert.ok(parts.some((item) => item.key === 'oem'));
    assert.equal(property.some((item) => item.key === 'karat'), false);
  });

  it('marks make → model → variant as dependent', () => {
    const model = definitionByKey('modelId', 'vehicles');
    const variant = definitionByKey('variantId', 'vehicles');
    assert.equal(model?.dependsOn, 'makeId');
    assert.equal(variant?.dependsOn, 'modelId');
  });

  it('exposes worldwide region/city/area lookups without hard-coding a country', () => {
    const common = definitionsFor({});
    assert.ok(common.some((item) => item.key === 'cityId'));
    assert.ok(common.some((item) => item.key === 'regionId'));
    assert.equal(definitionByKey('areaId')?.dependsOn, 'cityId');
  });
});

describe('filter validation', () => {
  it('drops private and unknown keys', () => {
    const result = validateFilterState(
      {
        marketplace: 'vehicles',
        makeId: 4,
        ownerId: 99,
        fraudScore: 0.2,
        vin: 'SECRET',
        email: 'a@b.c',
      },
      { marketplace: 'vehicles', currency: 'PKR' },
    );
    assert.equal(result.state.values.makeId, '4');
    assert.ok(result.dropped.includes('ownerId'));
    assert.ok(result.dropped.includes('fraudScore'));
    assert.ok(result.dropped.includes('vin'));
    assert.equal('ownerId' in result.state.values, false);
  });

  it('clamps ranges and ignores empty booleans', () => {
    const bedrooms = sanitizeFilterValue(definitionByKey('bedroomsMin', 'property')!, 99);
    assert.equal(bedrooms, 20);
    const verified = sanitizeFilterValue(definitionByKey('verifiedSeller')!, false);
    assert.equal(verified, null);
    const on = sanitizeFilterValue(definitionByKey('verifiedSeller')!, true);
    assert.equal(on, true);
  });

  it('hides dependent filters until the parent is set', () => {
    const empty = validateFilterState({ marketplace: 'vehicles', modelId: 9 }, { marketplace: 'vehicles' });
    assert.equal(empty.state.values.modelId, undefined);
    const withParent = validateFilterState(
      { marketplace: 'vehicles', makeId: 1, modelId: 9 },
      { marketplace: 'vehicles' },
    );
    assert.equal(withParent.state.values.modelId, '9');
  });
});

describe('filter state to search DSL', () => {
  it('converts a vehicle filter state into the existing search DSL', () => {
    const validated = validateFilterState(
      {
        marketplace: 'vehicles',
        operation: 'buy',
        makeId: 'toyota-id',
        transmission: 'automatic',
        yearMin: { min: 2018, max: 2024 },
        price: { min: 0, max: 5_000_000, currency: 'PKR' },
        location: { cityId: 12, radiusKm: 20, label: 'Islamabad' },
      },
      { marketplace: 'vehicles', currency: 'PKR' },
    );
    const dsl = filterStateToSearchDsl(validated.state, ctx);
    assert.equal(dsl.marketplace, 'vehicles');
    assert.deepEqual(dsl.filters.transmission, ['automatic']);
    assert.equal(dsl.price?.max, 5_000_000);
    assert.equal(dsl.price?.currency, 'PKR');
    assert.equal(dsl.location?.cityId, 12);
    assert.equal(dsl.location?.radiusKm, 20);
    assert.equal('ownerId' in dsl.filters, false);
  });

  it('round-trips public query params without private fields', () => {
    const state = emptyFilterState({
      marketplace: 'property',
      operation: 'rent',
      price: { max: 150000, currency: 'PKR' },
      values: { bedroomsMin: 3, swimmingPool: true },
    });
    const params = publicQueryParams(state);
    assert.equal(params.marketplace, 'property');
    assert.equal(params.bedroomsMin, '3');
    assert.equal('ownerId' in params, false);
    const restored = filterStateFromQueryParams(params, { marketplace: 'property', currency: 'PKR' });
    assert.equal(restored.marketplace, 'property');
    assert.equal(restored.values.bedroomsMin, 3);
  });

  it('maps gold, property, vehicle and parts filters into DSL allowlist keys', () => {
    const gold = filterStateToSearchDsl(
      validateFilterState({ marketplace: 'gold', karat: ['22', '24'], hallmarked: true }, { marketplace: 'gold' }).state,
      ctx,
    );
    assert.deepEqual(gold.filters.karat, ['22', '24']);
    assert.equal(gold.filters.hallmarked, true);

    const property = filterStateToSearchDsl(
      validateFilterState({ marketplace: 'property', bedroomsMin: 3, gym: true }, { marketplace: 'property' }).state,
      ctx,
    );
    assert.equal(property.filters.bedroomsMin, 3);
    assert.equal(property.filters.gym, true);

    const parts = filterStateToSearchDsl(
      validateFilterState({ marketplace: 'parts', partCategory: 'engine', oem: 'oem' }, { marketplace: 'parts' }).state,
      ctx,
    );
    assert.equal(parts.intent, 'parts');
    assert.equal(parts.marketplace, 'vehicles');
    assert.equal(parts.filters.partCategory, 'engine');
  });
});

describe('radius and geo helpers', () => {
  it('allows 1 km and custom radii without snapping to 5 km', () => {
    assert.equal(clampRadiusKm(1), 1);
    assert.equal(clampRadiusKm(20), 20);
    assert.equal(clampRadiusKm(5), 5);
    assert.equal(clampRadiusKm(250), 100);
  });

  it('encodes geohash stably for clustering', () => {
    const hash = encodeGeohash(31.5204, 74.3587, 6);
    assert.equal(hash.length, 6);
    const center = decodeGeohashCenter(hash);
    assert.equal(Math.abs(center.lat - 31.5204) < 0.1, true);
    assert.equal(geohashPrecisionForZoom(10), 4);
    assert.equal(geohashPrecisionForZoom(16), 8);
  });

  it('formats distance in locale units', () => {
    const meters = haversineMeters({ lat: 31.52, lng: 74.35 }, { lat: 31.53, lng: 74.36 });
    const km = formatDistance(meters, 'km');
    assert.equal(km.unit === 'km' || km.unit === 'm', true);
    assert.equal(km.meters > 0, true);
    const miles = formatDistance(1609.344, 'mi');
    assert.equal(miles.unit, 'mi');
    assert.equal(Math.abs(miles.value - 1) < 0.05, true);
  });
});

describe('map provider capabilities', () => {
  it('does not couple callers to a vendor SDK', () => {
    const provider = getMapProvider();
    assert.equal(typeof provider.approximate, 'function');
    assert.equal(provider.capabilities.map, true);
    assert.equal(typeof provider.directionsUrl, 'function');
  });

  it('hides Street View on OpenStreetMap and desktop Google', () => {
    const osm = getMapProviderByCode('openstreetmap');
    assert.equal(capabilitiesFor(osm, 'windows').streetView, false);
    assert.equal(streetViewFor({ lat: 31.52, lng: 74.35, provider: 'openstreetmap' }).supported, false);
    const google = getMapProviderByCode('google');
    assert.equal(capabilitiesFor(google, 'android').streetView, true);
    assert.equal(capabilitiesFor(google, 'windows').map, false);
    assert.equal(streetViewFor({ lat: 31.52, lng: 74.35, provider: 'google', platform: 'android' }).supported, true);
  });

  it('returns provider directions URLs instead of a custom router', () => {
    const google = directionsFor({ destination: { lat: 31.52, lng: 74.35 }, provider: 'google', platform: 'android' });
    assert.equal(google.supported, true);
    assert.ok(google.url?.includes('google.com/maps'));
    const apple = directionsFor({ destination: { lat: 31.52, lng: 74.35 }, provider: 'apple', platform: 'ios' });
    assert.ok(apple.url?.includes('maps.apple.com'));
    const osm = directionsFor({ destination: { lat: 31.52, lng: 74.35 }, provider: 'openstreetmap', platform: 'linux' });
    assert.ok(osm.url?.includes('openstreetmap.org'));
  });

  it('jitters private coordinates and computes distance', () => {
    const provider = getMapProvider();
    const exact = { lat: 31.5204, lng: 74.3587 };
    const publicPoint = provider.approximate(exact.lat, exact.lng, 7);
    assert.notEqual(publicPoint.latitude, exact.lat);
    const km = distanceBetween(exact, { lat: 31.5497, lng: 74.3436 }, 'km');
    assert.equal(km.value > 2 && km.value < 5, true);
  });
});

describe('search DSL still strips internals after filter conversion', () => {
  it('cannot inject seller or fraud fields through filter state', () => {
    const dsl = validateSearchQuery(
      filterStateToSearchDsl(
        validateFilterState(
          { marketplace: 'vehicles', makeId: '1', sellerId: 4, fraudScore: 1 },
          { marketplace: 'vehicles' },
        ).state,
        ctx,
      ),
      ctx,
    );
    assert.equal('sellerId' in dsl.filters, false);
    assert.equal('fraudScore' in dsl.filters, false);
  });
});

void searchDslToFilterState;
