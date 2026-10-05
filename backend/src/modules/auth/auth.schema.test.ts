import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loginSchema, oauthSchema, registerSchema, requestOtpSchema } from './auth.schema';

describe('auth schemas', () => {
  it('requires email or phone for registration', () => {
    const missing = registerSchema.safeParse({ acceptedTerms: true });
    assert.equal(missing.success, false);
    const ok = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'Correct-Horse-9!',
      acceptedTerms: true,
    });
    assert.equal(ok.success, true);
  });

  it('normalises phones to E.164', () => {
    const parsed = registerSchema.safeParse({
      phone: '923001234567',
      password: 'Correct-Horse-9!',
      acceptedTerms: true,
    });
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.phone, '+923001234567');
  });

  it('accepts oauth providers and rejects unknown ones', () => {
    const ok = oauthSchema.safeParse({ provider: 'google', token: 'x'.repeat(20) });
    assert.equal(ok.success, true);
    const bad = oauthSchema.safeParse({ provider: 'twitter', token: 'x'.repeat(20) });
    assert.equal(bad.success, false);
  });

  it('limits OTP purpose values', () => {
    const ok = requestOtpSchema.safeParse({ destination: '+923001234567', channel: 'sms', purpose: 'login' });
    assert.equal(ok.success, true);
    const bad = requestOtpSchema.safeParse({ destination: '+923001234567', purpose: 'pwn' });
    assert.equal(bad.success, false);
  });

  it('requires a login identifier', () => {
    const bad = loginSchema.safeParse({ identifier: 'ab', password: 'x' });
    assert.equal(bad.success, false);
  });

  it('accepts phone-only registration and empty email', () => {
    const parsed = registerSchema.safeParse({
      email: '',
      phone: '+923001234567',
      password: 'Correct-Horse-9!',
      displayName: 'Ada',
      acceptedTerms: true,
    });
    assert.equal(parsed.success, true);
  });
});
