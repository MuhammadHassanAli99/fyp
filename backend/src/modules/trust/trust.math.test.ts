import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyEvents, bandFromScore, clampEventDelta, levelFromBand, MAX_NEGATIVE_EVENT } from './trust.math';

describe('trust math', () => {
  it('caps a single negative event so one signal cannot destroy the score', () => {
    assert.equal(clampEventDelta(-80), MAX_NEGATIVE_EVENT);
    const score = applyEvents([
      { delta: 40, status: 'applied' },
      { delta: -80, status: 'applied' },
    ]);
    assert.ok(score >= 20);
  });

  it('maps bands to user-facing levels without exposing internals', () => {
    assert.equal(levelFromBand('new'), 'new');
    assert.equal(levelFromBand('bronze'), 'building');
    assert.equal(levelFromBand('silver'), 'established');
    assert.equal(levelFromBand(bandFromScore(90)), 'trusted');
  });

  it('ignores reversed events', () => {
    const score = applyEvents([
      { delta: 20, status: 'applied' },
      { delta: -20, status: 'reversed' },
    ]);
    assert.equal(score, 20);
  });
});
