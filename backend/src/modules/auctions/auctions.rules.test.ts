import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSelfBid, minimumNextBid } from './auctions.rules';

describe('auction bid rules', () => {
  it('uses the start price when there is no current bid', () => {
    assert.equal(minimumNextBid(null, '100.00', '5.00'), '100.00');
  });

  it('adds the increment in decimal arithmetic', () => {
    assert.equal(minimumNextBid('100.10', '100.00', '0.10'), '100.20');
  });

  it('rejects self bidding', () => {
    assert.equal(isSelfBid(7, 7), true);
    assert.equal(isSelfBid(7, 8), false);
  });
});
