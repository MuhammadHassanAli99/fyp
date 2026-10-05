import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { roleAllows } from './business.schema';

describe('business RBAC', () => {
  it('does not grant every function to every member', () => {
    assert.equal(roleAllows('agent', 'listing.post'), true);
    assert.equal(roleAllows('agent', 'billing'), false);
    assert.equal(roleAllows('accountant', 'listing.post'), false);
    assert.equal(roleAllows('accountant', 'billing'), true);
    assert.equal(roleAllows('support', 'business.invite'), false);
    assert.equal(roleAllows('owner', 'business.change_role'), true);
  });

  it('keeps ownership transfer exclusive to owner via wildcard', () => {
    assert.equal(roleAllows('admin', '*') || roleAllows('admin', 'business.transfer'), false);
    assert.equal(roleAllows('owner', 'business.transfer'), true);
  });
});
