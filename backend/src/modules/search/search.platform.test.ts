import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  emptySearchQuery,
  searchQueryHash,
  validateSearchQuery,
} from './search.dsl';
import { parsePriceRange, parseWeightGrams, currencyForCountry } from './search.currency';
import { understandQuery } from './search.understand';
import { applySponsoredPlacement, MIN_SPONSORED_RELEVANCE, organicScore, type RankableHit } from './search.rank';
import { zeroResultHelp } from './search.zero';
import { toBooleanModeQuery } from '../../db/sql';

const ctx = { currency: 'PKR', language: 'en', countryCode: 'PK' };

describe('search DSL validation', () => {
  it('strips forbidden internal fields from AI/client payloads', () => {
    const dsl = validateSearchQuery(
      {
        originalQuery: 'toyota',
        marketplace: 'vehicles',
        filters: {
          make: 'Toyota',
          ownerId: 99,
          fraudScore: 0.9,
          moderationStatus: 'rejected',
          vin: 'SECRET',
          sellerId: 12,
        },
        preferences: { lowMileage: true, unknownPref: true },
      },
      ctx,
    );
    assert.equal(dsl.filters.make, 'Toyota');
    assert.equal('ownerId' in dsl.filters, false);
    assert.equal('fraudScore' in dsl.filters, false);
    assert.equal('vin' in dsl.filters, false);
    assert.equal('sellerId' in dsl.filters, false);
    assert.equal(dsl.preferences.lowMileage, true);
    assert.equal('unknownPref' in dsl.preferences, false);
  });

  it('clamps pagination and ignores unknown marketplaces', () => {
    const dsl = validateSearchQuery(
      {
        originalQuery: 'x',
        marketplace: 'electronics' as never,
        pagination: { page: 999, perPage: 500 },
      },
      ctx,
    );
    assert.equal(dsl.marketplace, null);
    assert.equal(dsl.pagination.page, 40);
    assert.equal(dsl.pagination.perPage, 50);
  });

  it('normalises cache keys so equivalent queries collide', () => {
    const a = validateSearchQuery({ originalQuery: 'Toyota', keywords: 'Toyota', marketplace: 'vehicles' }, ctx);
    const b = validateSearchQuery({ originalQuery: 'toyota', keywords: 'toyota', marketplace: 'vehicles' }, ctx);
    assert.equal(searchQueryHash(a), searchQueryHash({ ...b, originalQuery: a.originalQuery, keywords: a.keywords }));
  });
});

describe('currency and price parsing', () => {
  it('interprets lakh in the active country currency without silent conversion', () => {
    const parsed = parsePriceRange('under 50 lakh', 'USD', 'PK');
    assert.ok(parsed);
    assert.equal(parsed?.max, 5_000_000);
    assert.equal(parsed?.originalCurrency, 'PKR');
    assert.equal(parsed?.originalAmount, 5_000_000);
    assert.equal(parsed?.currency, 'PKR');
  });

  it('honours an explicit currency word over country context', () => {
    const parsed = parsePriceRange('under 20000 usd', 'PKR', 'PK');
    assert.equal(parsed?.currency, 'USD');
    assert.equal(parsed?.max, 20_000);
  });

  it('parses crore and grams', () => {
    assert.equal(parsePriceRange('house under 2 crore', 'PKR', 'PK')?.max, 20_000_000);
    assert.equal(parseWeightGrams('24k gold 10 gram chahiye'), 10);
    assert.equal(currencyForCountry('AE', 'USD'), 'AED');
  });
});

describe('query understanding', () => {
  it('maps a natural language vehicle query into filters vs preferences', () => {
    const result = understandQuery(
      'Toyota automatic under 50 lakh, preferably low mileage',
      { language: 'en', currency: 'PKR', countryCode: 'PK', marketplaceCode: 'vehicles', searchType: 'ai' },
    );
    const query = result.queries[0]!;
    assert.equal(query.marketplace, 'vehicles');
    assert.equal(query.filters.make, 'Toyota');
    assert.equal(query.filters.transmission, 'automatic');
    assert.equal(query.price?.max, 5_000_000);
    assert.equal(query.filters.mileageMax, undefined);
    assert.equal(query.preferences.lowMileage, true);
  });

  it('asks only for buy vs rent when a house query is ambiguous', () => {
    const result = understandQuery('Find me a cheap house', {
      language: 'en',
      currency: 'PKR',
      countryCode: 'PK',
      marketplaceCode: null,
      searchType: 'ai',
    });
    const query = result.queries[0]!;
    assert.equal(query.marketplace, 'property');
    assert.equal(query.clarification.needed, true);
    assert.ok(query.clarification.questions[0]?.toLowerCase().includes('rent'));
    assert.equal(query.preferences.budgetSensitive, true);
    assert.equal(query.price, null);
  });

  it('does not ask when rent is already specified', () => {
    const result = understandQuery('3 bedroom house rent Lahore', {
      language: 'en',
      currency: 'PKR',
      countryCode: 'PK',
      marketplaceCode: 'property',
      searchType: 'text',
    });
    const query = result.queries[0]!;
    assert.equal(query.clarification.needed, false);
    assert.equal(query.operation, 'rent');
    assert.equal(query.filters.bedroomsMin, 3);
    assert.equal(query.location?.cityName, 'Lahore');
  });

  it('understands mixed-language gold and vehicle queries', () => {
    const gold = understandQuery('24k gold 10 gram chahiye', {
      language: 'en',
      currency: 'PKR',
      countryCode: 'PK',
      marketplaceCode: null,
      searchType: 'text',
    }).queries[0]!;
    assert.equal(gold.marketplace, 'gold');
    assert.equal(gold.filters.karat, '24');
    assert.equal(gold.filters.weightMin, 10);

    const vehicle = understandQuery('Islamabad mein 50 lakh se kam automatic Corolla', {
      language: 'en',
      currency: 'PKR',
      countryCode: 'PK',
      marketplaceCode: null,
      searchType: 'text',
    }).queries[0]!;
    assert.equal(vehicle.marketplace, 'vehicles');
    assert.equal(vehicle.filters.transmission, 'automatic');
    assert.equal(vehicle.filters.model, 'Corolla');
    assert.equal(vehicle.price?.max, 5_000_000);
  });

  it('splits a global multi-marketplace query', () => {
    const result = understandQuery('Toyota under 50 lakh, house under 2 crore, 24K gold', {
      language: 'en',
      currency: 'PKR',
      countryCode: 'PK',
      marketplaceCode: null,
      searchType: 'global',
    });
    const codes = new Set(result.queries.map((query) => query.marketplace));
    assert.ok(codes.has('vehicles'));
    assert.ok(codes.has('property'));
    assert.ok(codes.has('gold'));
  });

  it('treats family use as a preference not a hard filter', () => {
    const query = understandQuery(
      'I need an automatic Toyota for family use under 50 lakh near Islamabad',
      { language: 'en', currency: 'PKR', countryCode: 'PK', marketplaceCode: null, searchType: 'ai' },
    ).queries[0]!;
    assert.equal(query.filters.transmission, 'automatic');
    assert.equal(query.filters.make, 'Toyota');
    assert.equal(query.preferences.familyUse, true);
    assert.equal(query.location?.cityName, 'Islamabad');
  });
});

describe('ranking and zero results', () => {
  it('does not let an irrelevant sponsored listing outrank a relevant organic one', () => {
    const base = (id: number, organic: number, sponsored: boolean): RankableHit => ({
      listingId: id,
      marketplaceCode: 'vehicles',
      isFeatured: sponsored,
      isBoosted: sponsored,
      isSponsoredEligible: sponsored,
      publishedAt: new Date().toISOString(),
      distanceKm: 5,
      price: 100,
      currency: 'PKR',
      publicTrustBand: 'good',
      qualityScore: 0.5,
      attributes: {},
      signals: {
        text: organic,
        semantic: 0,
        filterMatch: organic,
        location: 0.5,
        price: 0.5,
        availability: 1,
        quality: 0.5,
        trust: 0.5,
        freshness: 0.5,
        preference: 0.5,
      },
      organicScore: organic,
      finalScore: organic,
      placement: 'organic',
      matchReasons: [],
    });
    const ranked = applySponsoredPlacement([
      base(1, 0.9, false),
      base(2, 0.1, true),
      base(3, 0.5, true),
    ]);
    assert.equal(ranked[0]?.listingId, 1);
    assert.ok((ranked.find((hit) => hit.listingId === 2)?.organicScore ?? 0) < MIN_SPONSORED_RELEVANCE);
    assert.equal(ranked.find((hit) => hit.listingId === 2)?.placement, 'organic');
    const sponsored = ranked.find((hit) => hit.listingId === 3);
    assert.equal(sponsored?.placement, 'sponsored');
  });

  it('organic score stays in 0-1 for typical signals', () => {
    const score = organicScore({
      text: 1,
      semantic: 1,
      filterMatch: 1,
      location: 1,
      price: 1,
      availability: 1,
      quality: 1,
      trust: 1,
      freshness: 1,
      preference: 1,
    });
    assert.ok(score > 0.9 && score <= 1.0001);
  });

  it('zero results suggest radius and budget expansions from the actual DSL', () => {
    const help = zeroResultHelp({
      ...emptySearchQuery({ originalQuery: 'Toyota Corolla' }),
      marketplace: 'vehicles',
      filters: { make: 'Toyota', model: 'Corolla' },
      price: { max: 3_000_000, currency: 'PKR', originalAmount: 3_000_000, originalCurrency: 'PKR' },
      location: { cityName: 'Islamabad', radiusKm: 10 },
    });
    assert.match(help.message, /Toyota/);
    assert.ok(help.suggestions.some((item) => /radius|50 km/i.test(item)));
    assert.ok(help.suggestions.some((item) => /budget/i.test(item)));
  });
});

describe('search security', () => {
  it('strips boolean-mode operators from untrusted query text', () => {
    const sanitized = toBooleanModeQuery('toyota") OR 1=1 --');
    assert.equal(sanitized.includes('1=1'), false);
    assert.equal(sanitized.includes('+'), true);
  });

  it('rejects extremely long queries at validation', () => {
    const dsl = validateSearchQuery({ originalQuery: 'a'.repeat(5000), keywords: 'a'.repeat(5000) }, ctx);
    assert.ok(dsl.originalQuery.length <= 500);
    assert.ok(dsl.keywords.length <= 191);
  });
});
