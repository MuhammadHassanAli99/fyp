import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getMapProvider } from '../../providers/maps';

describe('property map provider abstraction', () => {
  it('is not coupled to a vendor SDK', () => {
    const provider = getMapProvider();
    assert.equal(typeof provider.code, 'string');
    assert.equal(typeof provider.approximate, 'function');
    assert.equal(typeof provider.distanceKm, 'function');
  });

  it('does not expose exact residential coordinates as the public marker', () => {
    const provider = getMapProvider();
    const exact = { lat: 31.5204, lng: 74.3587 };
    const publicPoint = provider.approximate(exact.lat, exact.lng, 7);
    assert.notEqual(publicPoint.latitude, exact.lat);
    assert.notEqual(publicPoint.longitude, exact.lng);
  });

  it('computes distance in kilometres', () => {
    const km = getMapProvider().distanceKm(
      { lat: 31.5204, lng: 74.3587 },
      { lat: 31.5497, lng: 74.3436 },
    );
    assert.equal(km > 2 && km < 5, true);
  });
});
