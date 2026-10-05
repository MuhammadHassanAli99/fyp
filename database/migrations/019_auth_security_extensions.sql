-- =============================================================================
-- 019  Authentication security extensions
--      Forward-only. Does not replace 002_identity_auth or 016_fraud_moderation.
--      Adds installation identity, MFA challenges, OAuth state, contact-change
--      proofs, security events, device IP history, and schema compatibility
--      metadata required by the unified identity / session / device system.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- OAuth-only and passkey-only accounts may not have email or phone yet.
-- Identifier uniqueness remains on email_normalized / phone_e164.
-- -----------------------------------------------------------------------------
ALTER TABLE users DROP CHECK chk_users_identifier;

-- -----------------------------------------------------------------------------
-- Device / installation identity (do not use IMEI)
-- -----------------------------------------------------------------------------
ALTER TABLE user_devices
  ADD COLUMN installation_id CHAR(36)        NULL AFTER uuid,
  ADD COLUMN browser         VARCHAR(96)     NULL AFTER manufacturer,
  ADD COLUMN last_ip         VARBINARY(16)   NULL AFTER timezone,
  ADD COLUMN country_id      SMALLINT UNSIGNED NULL AFTER last_ip,
  ADD COLUMN login_count     INT UNSIGNED    NOT NULL DEFAULT 0 AFTER last_seen_at,
  ADD COLUMN status          ENUM('active','revoked','expired','untrusted') NOT NULL DEFAULT 'active' AFTER login_count,
  ADD COLUMN risk_score      TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER status;

ALTER TABLE user_devices
  ADD KEY idx_devices_installation (installation_id),
  ADD KEY idx_devices_status (status, last_seen_at);

ALTER TABLE user_devices
  ADD CONSTRAINT fk_devices_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Session idle / logout timestamps and app version (access-token activity)
-- -----------------------------------------------------------------------------
ALTER TABLE user_sessions
  ADD COLUMN last_ip          VARBINARY(16) NULL AFTER ip_address,
  ADD COLUMN app_version      VARCHAR(24)   NULL AFTER user_agent,
  ADD COLUMN idle_expires_at  TIMESTAMP     NULL AFTER expires_at,
  ADD COLUMN logged_out_at    TIMESTAMP     NULL AFTER revoked_at;

ALTER TABLE user_sessions
  ADD KEY idx_sessions_idle (idle_expires_at);

-- -----------------------------------------------------------------------------
-- Passkey last-used IP (private key material is never stored)
-- -----------------------------------------------------------------------------
ALTER TABLE user_passkeys
  ADD COLUMN last_ip VARBINARY(16) NULL AFTER last_used_at;

-- -----------------------------------------------------------------------------
-- MFA step-up challenges (short-lived, attempt-limited)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_challenges (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          CHAR(36)        NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  session_id    BIGINT UNSIGNED NULL,
  factor_id     BIGINT UNSIGNED NULL,
  kind          ENUM('totp','sms','email','recovery','passkey') NOT NULL,
  code_hash     CHAR(64)        NULL,
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts  TINYINT UNSIGNED NOT NULL DEFAULT 5,
  expires_at    TIMESTAMP       NOT NULL,
  consumed_at   TIMESTAMP       NULL,
  ip_address    VARBINARY(16)   NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_mfa_challenges_uuid (uuid),
  KEY idx_mfa_challenges_user (user_id, consumed_at, expires_at),
  CONSTRAINT fk_mfa_challenges_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mfa_challenges_session FOREIGN KEY (session_id)
    REFERENCES user_sessions (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_mfa_challenges_factor FOREIGN KEY (factor_id)
    REFERENCES mfa_factors (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- OAuth CSRF state + one-time completion tickets (secrets stay on the server)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_states (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  state          CHAR(64)        NOT NULL,
  nonce          CHAR(64)        NOT NULL,
  provider_code  VARCHAR(32)     NOT NULL,
  platform_code  VARCHAR(32)     NULL,
  code_verifier  VARCHAR(128)    NULL,
  redirect_uri   VARCHAR(512)    NULL,
  user_id        BIGINT UNSIGNED NULL,          -- set when linking to an existing account
  resolved_user_id BIGINT UNSIGNED NULL,        -- set after provider callback
  ticket_hash    CHAR(64)        NULL,
  consumed_at    TIMESTAMP       NULL,
  expires_at     TIMESTAMP       NOT NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_oauth_states_state (state),
  UNIQUE KEY uk_oauth_states_ticket (ticket_hash),
  KEY idx_oauth_states_expiry (expires_at),
  CONSTRAINT fk_oauth_states_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_oauth_states_resolved FOREIGN KEY (resolved_user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Email / phone change requires proof of ownership of the new destination
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_change_requests (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  kind         ENUM('email','phone') NOT NULL,
  new_value    VARCHAR(191)    NOT NULL,
  code_hash    CHAR(64)        NOT NULL,
  attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 5,
  expires_at   TIMESTAMP       NOT NULL,
  consumed_at  TIMESTAMP       NULL,
  ip_address   VARBINARY(16)   NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contact_change_user (user_id, kind, consumed_at),
  CONSTRAINT fk_contact_change_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Auth-specific security events (never stores secrets / OTP / raw tokens)
-- Complements audit_logs; action names are stable for the security UI.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth_security_events (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid         CHAR(36)        NOT NULL,
  user_id      BIGINT UNSIGNED NULL,
  device_id    BIGINT UNSIGNED NULL,
  session_id   BIGINT UNSIGNED NULL,
  event_type   VARCHAR(64)     NOT NULL,
  severity     ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'info',
  ip_address   VARBINARY(16)   NULL,
  country_id   SMALLINT UNSIGNED NULL,
  user_agent   VARCHAR(512)    NULL,
  metadata     JSON            NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_auth_security_uuid (uuid),
  KEY idx_auth_security_user (user_id, created_at),
  KEY idx_auth_security_type (event_type, created_at),
  KEY idx_auth_security_device (device_id, created_at),
  CONSTRAINT fk_auth_security_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_auth_security_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Approximate IP history per device (privacy: no extra hardware identifiers)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_ip_history (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_id   BIGINT UNSIGNED NOT NULL,
  ip_address  VARBINARY(16)   NOT NULL,
  country_id  SMALLINT UNSIGNED NULL,
  seen_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_device_ip_device (device_id, seen_at),
  CONSTRAINT fk_device_ip_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_device_ip_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Compatibility metadata exposed via /system/version (public, non-secret)
-- -----------------------------------------------------------------------------
INSERT INTO app_settings (setting_key, setting_value, scope, description, is_public) VALUES
  ('api.version',                 CAST('"1.1.0"' AS JSON),  'global', 'Public API version', TRUE),
  ('api.min_supported_version',   CAST('"1.0.0"' AS JSON),  'global', 'Oldest API contract the backend still honours', TRUE),
  ('schema.required_version',     CAST('"019"' AS JSON),    'global', 'Minimum schema_migrations.version this backend requires', FALSE),
  ('auth.capabilities', CAST('{"emailPassword":true,"phoneOtp":true,"oauth":["google","apple","facebook","microsoft"],"passkey":true,"mfa":["totp","email","sms","passkey"],"captcha":true}' AS JSON), 'global', 'Auth methods this backend implements', TRUE)
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  description = VALUES(description),
  is_public = VALUES(is_public);
