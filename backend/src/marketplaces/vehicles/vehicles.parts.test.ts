import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canReservePart } from './vehicles.parts';

describe('parts inventory reservation', () => {
  it('prevents overselling when reserved quantity consumes stock', () => {
    assert.equal(canReservePart(10, 8, 3), false);
    assert.equal(canReservePart(10, 8, 2), true);
    assert.equal(canReservePart(1, 0, 1), true);
    assert.equal(canReservePart(0, 0, 1), false);
  });
});
