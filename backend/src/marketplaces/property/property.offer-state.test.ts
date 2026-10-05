import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertOfferTransition, canTransitionOffer } from './property.offer-state';

describe('property offer state machine', () => {
  it('allows buyer/seller negotiation', () => {
    assert.equal(canTransitionOffer('pending', 'countered'), true);
    assert.equal(canTransitionOffer('countered', 'accepted'), true);
    assert.equal(canTransitionOffer('pending', 'rejected'), true);
    assert.equal(canTransitionOffer('pending', 'cancelled'), true);
  });

  it('forbids mutating a terminal offer', () => {
    assert.equal(canTransitionOffer('accepted', 'rejected'), false);
    assert.equal(canTransitionOffer('expired', 'pending'), false);
    assert.throws(() => assertOfferTransition('rejected', 'accepted'));
    assert.throws(() => assertOfferTransition('cancelled', 'countered'));
  });

  it('allows counter-offer chains', () => {
    assert.equal(canTransitionOffer('pending', 'countered'), true);
    assert.equal(canTransitionOffer('countered', 'countered'), true);
    assert.equal(canTransitionOffer('countered', 'rejected'), true);
  });
});
