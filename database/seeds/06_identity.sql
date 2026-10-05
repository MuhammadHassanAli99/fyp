-- =============================================================================
-- 06  Identity providers (Google / Apple / Facebook / Microsoft / passkey)
--     Client secrets are NOT stored here — they live in env / identity_provider_credentials.
--     Idempotent.
-- =============================================================================

USE marketplace;

INSERT INTO identity_providers
  (code, name, kind, issuer, authorize_url, token_url, userinfo_url, jwks_url, scopes, is_active, sort_order)
VALUES
  ('google', 'Google', 'oidc', 'https://accounts.google.com',
   'https://accounts.google.com/o/oauth2/v2/auth',
   'https://oauth2.googleapis.com/token',
   'https://openidconnect.googleapis.com/v1/userinfo',
   'https://www.googleapis.com/oauth2/v3/certs',
   'openid email profile', TRUE, 10),
  ('apple', 'Apple', 'apple', 'https://appleid.apple.com',
   'https://appleid.apple.com/auth/authorize',
   'https://appleid.apple.com/auth/token',
   NULL,
   'https://appleid.apple.com/auth/keys',
   'openid email name', TRUE, 20),
  ('facebook', 'Facebook', 'oauth2', 'https://www.facebook.com',
   'https://www.facebook.com/v19.0/dialog/oauth',
   'https://graph.facebook.com/v19.0/oauth/access_token',
   'https://graph.facebook.com/me',
   NULL,
   'email public_profile', TRUE, 30),
  ('microsoft', 'Microsoft', 'oidc', 'https://login.microsoftonline.com/common/v2.0',
   'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
   'https://login.microsoftonline.com/common/oauth2/v2.0/token',
   'https://graph.microsoft.com/oidc/userinfo',
   'https://login.microsoftonline.com/common/discovery/v2.0/keys',
   'openid email profile', TRUE, 40),
  ('passkey', 'Passkey', 'passkey', NULL, NULL, NULL, NULL, NULL, NULL, TRUE, 50)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  kind = VALUES(kind),
  issuer = VALUES(issuer),
  authorize_url = VALUES(authorize_url),
  token_url = VALUES(token_url),
  userinfo_url = VALUES(userinfo_url),
  jwks_url = VALUES(jwks_url),
  scopes = VALUES(scopes),
  is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);
