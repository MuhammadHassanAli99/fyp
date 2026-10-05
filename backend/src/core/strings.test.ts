import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clip } from './strings';

describe('clip', () => {
  it('truncates a fingerprint so it fits CHAR(36) installation_id', () => {
    const fingerprint = 'a'.repeat(64);
    assert.equal(clip(fingerprint, 36)?.length, 36);
  });

  it('returns null for empty values', () => {
    assert.equal(clip('  ', 10), null);
    assert.equal(clip(undefined, 10), null);
  });
});
