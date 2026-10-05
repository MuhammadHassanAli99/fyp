import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeBio, escapeForDisplay } from './bio';

describe('bio sanitization', () => {
  it('strips HTML and scripts', () => {
    const result = sanitizeBio('<script>alert(1)</script>Hello <b>world</b>');
    assert.equal(result.text, 'Hello world');
    assert.equal(result.flagged, false);
  });

  it('returns null for empty / whitespace', () => {
    assert.equal(sanitizeBio('   ').text, null);
    assert.equal(sanitizeBio(null).text, null);
  });

  it('enforces length', () => {
    const result = sanitizeBio('x'.repeat(1200), 1000);
    assert.equal(result.text?.length, 1000);
  });

  it('flags profanity without storing HTML', () => {
    const result = sanitizeBio('this is shit');
    assert.equal(result.flagged, true);
    assert.equal(result.text, 'this is shit');
  });

  it('escapes untrusted text for safe rendering', () => {
    assert.equal(escapeForDisplay('<img src=x>'), '&lt;img src=x&gt;');
  });
});
