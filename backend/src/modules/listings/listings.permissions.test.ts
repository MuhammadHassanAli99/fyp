import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STAFF_ONLY_LIFECYCLE, canTransitionLifecycle } from './listings.lifecycle';
import { assignedListingAllows } from './listings.permissions';

describe('listing RBAC rules', () => {
  it('restricts publish and reject to staff-only lifecycle targets', () => {
    assert.equal(STAFF_ONLY_LIFECYCLE.has('published'), true);
    assert.equal(STAFF_ONLY_LIFECYCLE.has('rejected'), true);
    assert.equal(STAFF_ONLY_LIFECYCLE.has('draft'), false);
    assert.equal(STAFF_ONLY_LIFECYCLE.has('archived'), false);
  });

  it('lets owners archive or resubmit without publishing themselves', () => {
    assert.equal(canTransitionLifecycle('draft', 'pending_review'), true);
    assert.equal(canTransitionLifecycle('draft', 'archived'), true);
    assert.equal(canTransitionLifecycle('rejected', 'pending_review'), true);
    assert.equal(canTransitionLifecycle('draft', 'published'), false);
    assert.equal(canTransitionLifecycle('pending_review', 'rejected'), true);
  });

  it('denies listing view by default and only allows assigned sales actions', () => {
    assert.equal(assignedListingAllows('view'), true);
    assert.equal(assignedListingAllows('view_analytics'), true);
    assert.equal(assignedListingAllows('edit'), true);
    assert.equal(assignedListingAllows('submit'), true);
    assert.equal(assignedListingAllows('delete'), false);
    assert.equal(assignedListingAllows('archive'), false);
    assert.equal(assignedListingAllows('promote'), false);
    assert.equal(assignedListingAllows('approve'), false);
  });
});
