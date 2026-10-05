import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PUBLIC_STATUS, toPublicStatus } from './verification.schema';

describe('verification public status', () => {
  it('never lets a client invent VERIFIED — only approved maps to it', () => {
    assert.equal(toPublicStatus(null), 'NOT_STARTED');
    assert.equal(toPublicStatus('pending'), 'PENDING');
    assert.equal(toPublicStatus('in_review'), 'UNDER_REVIEW');
    assert.equal(toPublicStatus('action_required'), 'ACTION_REQUIRED');
    assert.equal(toPublicStatus('approved'), 'VERIFIED');
    assert.equal(toPublicStatus('rejected'), 'REJECTED');
    assert.equal(toPublicStatus('expired'), 'EXPIRED');
    assert.equal(toPublicStatus('revoked'), 'REVOKED');
    assert.equal(PUBLIC_STATUS.approved, 'VERIFIED');
    assert.equal(PUBLIC_STATUS.pending, 'PENDING');
  });
});
