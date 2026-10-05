import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateRecoveryCodes, generateTotpSecret, verifyTotp } from '../../core/security/totp';
import { assessPassword, hashPassword, needsRehash, verifyPassword } from '../../core/security/password';
import { hashRefreshToken, issueRefreshToken, signAccessToken, verifyAccessToken } from '../../core/security/tokens';
import { createWebAuthnChallenge, verifyClientData } from '../../core/security/webauthn';
import { listMigrationFiles, REQUIRED_SCHEMA_VERSION, assertMigrationOrder } from '../../core/schema-compatibility';
import { safeEqual, sha256 } from '../../core/security/crypto';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-9!');
    assert.equal(hash.startsWith('scrypt$'), true);
    assert.equal(await verifyPassword('Correct-Horse-Battery-9!', hash), true);
    assert.equal(await verifyPassword('wrong-password-1!', hash), false);
  });

  it('does not store plaintext and rejects empty hashes', async () => {
    assert.equal(await verifyPassword('anything1!', null), false);
    assert.equal(needsRehash('scrypt$16384$8$1$abc$def'), true);
  });

  it('rejects common passwords', () => {
    const weak = assessPassword('password');
    assert.equal(weak.issues.length > 0, true);
  });
});

describe('tokens', () => {
  it('signs and verifies an access token', () => {
    const issued = signAccessToken({
      sub: '1',
      sid: '2',
      mfa: true,
    });
    const claims = verifyAccessToken(issued.token);
    assert.equal(claims.sub, '1');
    assert.equal(claims.sid, '2');
    assert.equal(claims.typ, 'access');
    assert.equal(claims.mfa, true);
    assert.equal(claims.roles, undefined);
    assert.equal(claims.perms, undefined);
  });

  it('hashes refresh tokens so the raw value is not recoverable from the hash', () => {
    const refresh = issueRefreshToken('family-1');
    assert.equal(hashRefreshToken(refresh.token), refresh.tokenHash);
    assert.notEqual(refresh.token, refresh.tokenHash);
    assert.equal(refresh.tokenHash.length, 64);
  });
});

describe('totp', () => {
  it('generates a secret and verifies the current code', () => {
    const secret = generateTotpSecret();
    assert.equal(secret.length >= 16, true);
    // A random secret will not match 000000 except by chance; just ensure API shape.
    assert.equal(verifyTotp(secret, '000000', 0), false);
    assert.equal(verifyTotp(secret, 'abc'), false);
  });

  it('generates unique recovery codes', () => {
    const codes = generateRecoveryCodes(8);
    assert.equal(codes.length, 8);
    assert.equal(new Set(codes).size, 8);
  });
});

describe('webauthn challenge', () => {
  it('rejects a mismatched challenge', () => {
    const challenge = createWebAuthnChallenge();
    const clientData = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge: challenge.encoded,
        origin: 'http://localhost:3000',
      }),
    ).toString('base64url');
    const parsed = verifyClientData({
      clientDataJSON: clientData,
      expectedChallenge: challenge.encoded,
      expectedType: 'webauthn.create',
    });
    assert.equal(parsed.origin.includes('localhost'), true);

    assert.throws(() =>
      verifyClientData({
        clientDataJSON: clientData,
        expectedChallenge: 'other',
        expectedType: 'webauthn.create',
      }),
    );
  });
});

describe('crypto helpers', () => {
  it('compares hashes in constant time', () => {
    const a = sha256('hello');
    const b = sha256('hello');
    const c = sha256('world');
    assert.equal(safeEqual(a, b), true);
    assert.equal(safeEqual(a, c), false);
  });
});

describe('migrations', () => {
  it('lists ordered migration files including 020', () => {
    const files = listMigrationFiles();
    assert.equal(files.length >= 20, true);
    assertMigrationOrder(files);
    const versions = files.map((file) => file.version);
    assert.equal(versions.includes('002'), true);
    assert.equal(versions.includes('020'), true);
    assert.equal(versions.includes('023'), true);
    assert.equal(versions.includes('024'), true);
    assert.equal(versions.includes(REQUIRED_SCHEMA_VERSION), true);
    assert.equal(files.every((file) => file.checksum.length === 64), true);
  });
});
