import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isRateStale, FX_STALE_AFTER_MS } from './config-versions';

describe('isRateStale', () => {
  it('treats missing timestamps as stale', () => {
    assert.equal(isRateStale(null), true);
    assert.equal(isRateStale(undefined), true);
    assert.equal(isRateStale('not-a-date'), true);
  });

  it('keeps a fresh rate live', () => {
    const now = Date.parse('2026-08-14T00:00:00.000Z');
    assert.equal(isRateStale('2026-08-13T12:00:00.000Z', now), false);
  });

  it('flags rates older than 24 hours', () => {
    const now = Date.parse('2026-08-14T00:00:00.000Z');
    assert.equal(isRateStale(new Date(now - FX_STALE_AFTER_MS - 1).toISOString(), now), true);
  });
});
