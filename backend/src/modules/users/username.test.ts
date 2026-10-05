import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateUsername, normalizeUsername, BUILTIN_RESERVED } from './username';

describe('username validation', () => {
  it('accepts a normal unique-looking name', () => {
    const result = validateUsername('Mohsen_Ali');
    assert.equal(result.ok, true);
    assert.equal(result.normalized, 'mohsen_ali');
    assert.equal(normalizeUsername('Mohsen_Ali'), normalizeUsername('mohsen_ali'));
  });

  it('rejects reserved system names case-insensitively', () => {
    for (const name of ['admin', 'ADMIN', 'Support', 'official', 'security', 'gold', 'property', 'vehicles']) {
      const result = validateUsername(name);
      assert.equal(result.ok, false, name);
      assert.ok(result.issues.some((issue) => issue.code === 'reserved' || issue.code === 'impersonation'));
    }
  });

  it('rejects impersonation variants of reserved names', () => {
    const result = validateUsername('adm1n');
    assert.equal(result.ok, false);
    const official = validateUsername('official_1');
    assert.equal(official.ok, false);
  });

  it('rejects invalid format', () => {
    assert.equal(validateUsername('ab').ok, false);
    assert.equal(validateUsername('1start').ok, false);
    assert.equal(validateUsername('has space').ok, false);
    assert.equal(validateUsername('ends.').ok, false);
    assert.equal(validateUsername('double__under').ok, false);
  });

  it('rejects profanity', () => {
    assert.equal(validateUsername('fuckyou').ok, false);
  });

  it('honours extra reserved names from the database', () => {
    const result = validateUsername('acmebrand', ['acmebrand']);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === 'reserved'));
  });

  it('keeps the built-in reserved catalogue', () => {
    assert.ok(BUILTIN_RESERVED.has('admin'));
    assert.ok(BUILTIN_RESERVED.has('support'));
  });
});
