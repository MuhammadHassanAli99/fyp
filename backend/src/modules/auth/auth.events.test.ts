import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCode } from '../../core/errors';
import { AuthEvent } from './auth.security';

describe('auth contracts', () => {
  it('defines the security event catalogue', () => {
    const required = [
      'LOGIN_SUCCESS',
      'LOGIN_FAILED',
      'LOGOUT',
      'LOGOUT_ALL',
      'PASSWORD_CHANGED',
      'EMAIL_CHANGED',
      'PHONE_CHANGED',
      'MFA_ENABLED',
      'MFA_DISABLED',
      'PASSKEY_ADDED',
      'PASSKEY_REMOVED',
      'DEVICE_ADDED',
      'DEVICE_REMOVED',
      'SESSION_CREATED',
      'SESSION_REVOKED',
      'SUSPICIOUS_LOGIN',
      'CAPTCHA_REQUIRED',
      'ACCOUNT_LOCKED',
      'ACCOUNT_UNLOCKED',
      'OAUTH_LINKED',
      'OAUTH_UNLINKED',
    ];
    for (const name of required) {
      assert.equal((AuthEvent as Record<string, string>)[name], name);
    }
  });

  it('exposes auth error codes the client maps', () => {
    assert.equal(ErrorCode.MFA_REQUIRED, 'MFA_REQUIRED');
    assert.equal(ErrorCode.CAPTCHA_REQUIRED, 'CAPTCHA_REQUIRED');
    assert.equal(ErrorCode.SCHEMA_INCOMPATIBLE, 'SCHEMA_INCOMPATIBLE');
    assert.equal(ErrorCode.APP_VERSION_UNSUPPORTED, 'APP_VERSION_UNSUPPORTED');
    assert.equal(ErrorCode.OTP_REQUIRED, 'OTP_REQUIRED');
    assert.equal(ErrorCode.OAUTH_INVALID, 'OAUTH_INVALID');
    assert.equal(ErrorCode.PASSKEY_INVALID, 'PASSKEY_INVALID');
    assert.equal(ErrorCode.LINKING_REQUIRED, 'LINKING_REQUIRED');
  });
});
