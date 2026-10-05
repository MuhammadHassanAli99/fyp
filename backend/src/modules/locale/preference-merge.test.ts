import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyPreferences, mergePreferences, type PreferenceSnapshot } from './preference-merge';

const local: PreferenceSnapshot = {
  ...emptyPreferences(),
  countryId: 1,
  language: 'ur',
  currency: 'PKR',
  theme: 'dark',
  cityId: 10,
};

const authenticatedExplicit: PreferenceSnapshot = {
  ...emptyPreferences(),
  countryId: 5,
  language: 'en',
  currency: 'USD',
  theme: 'light',
};

describe('mergePreferences', () => {
  it('keeps explicit authenticated preferences over guest/local', () => {
    const merged = mergePreferences({ authenticated: authenticatedExplicit, local });
    assert.equal(merged.countryId, 5);
    assert.equal(merged.language, 'en');
    assert.equal(merged.currency, 'USD');
    assert.equal(merged.theme, 'light');
    assert.equal(merged.cityId, 10);
  });

  it('fills null authenticated fields from local guest prefs', () => {
    const merged = mergePreferences({ authenticated: emptyPreferences(), local });
    assert.equal(merged.countryId, 1);
    assert.equal(merged.language, 'ur');
    assert.equal(merged.currency, 'PKR');
    assert.equal(merged.theme, 'dark');
    assert.equal(merged.cityId, 10);
  });

  it('falls back to country then application defaults', () => {
    const merged = mergePreferences({
      authenticated: emptyPreferences(),
      local: emptyPreferences(),
      countryDefault: { language: 'ar', currency: 'SAR', countryId: 9 },
    });
    assert.equal(merged.countryId, 9);
    assert.equal(merged.language, 'ar');
    assert.equal(merged.currency, 'SAR');
    assert.equal(merged.theme, 'system');
    assert.equal(merged.measurementSystem, 'metric');
  });

  it('does not treat empty string as an explicit preference', () => {
    const merged = mergePreferences({
      authenticated: { ...emptyPreferences(), language: '' as unknown as string },
      local: { ...emptyPreferences(), language: 'fr' },
    });
    assert.equal(merged.language, 'fr');
  });
});
