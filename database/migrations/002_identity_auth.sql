-- =============================================================================
-- 002  Identity & authentication (§1 guest mode, §2 login, §25 sessions)
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Users — the single account shared by all marketplaces
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                CHAR(36)        NOT NULL,
  email               VARCHAR(191)    NULL,
  email_normalized    VARCHAR(191)    GENERATED ALWAYS AS (LOWER(email)) STORED,
  email_verified_at   TIMESTAMP       NULL,
  phone_country_code  VARCHAR(8)      NULL,
  phone_number        VARCHAR(32)     NULL,
  phone_e164          VARCHAR(24)     NULL,
  phone_verified_at   TIMESTAMP       NULL,
  username            VARCHAR(64)     NULL,
  username_normalized VARCHAR(64)     GENERATED ALWAYS AS (LOWER(username)) STORED,
  password_hash       VARCHAR(255)    NULL,          -- argon2id; NULL for social-only accounts
  password_changed_at TIMESTAMP       NULL,
  account_type        ENUM('individual','business') NOT NULL DEFAULT 'individual',
  status              ENUM('pending','active','suspended','banned','deactivated','deleted')
                        NOT NULL DEFAULT 'pending',
  status_reason       VARCHAR(255)    NULL,
  -- Preferences (§1 / §5 global settings)
  country_id          SMALLINT UNSIGNED NULL,
  region_id           INT UNSIGNED    NULL,
  city_id             INT UNSIGNED    NULL,
  language            VARCHAR(10)     NULL,
  currency            CHAR(3)         NULL,
  timezone            VARCHAR(64)     NULL,
  theme               ENUM('light','dark','system') NOT NULL DEFAULT 'system',
  measurement_system  ENUM('metric','imperial') NULL,
  last_marketplace_id TINYINT UNSIGNED NULL,          -- §4 remember last selection
  -- Security posture
  mfa_enabled         BOOLEAN         NOT NULL DEFAULT FALSE,
  failed_login_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until        TIMESTAMP       NULL,
  last_login_at       TIMESTAMP       NULL,
  last_login_ip       VARBINARY(16)   NULL,
  last_active_at      TIMESTAMP       NULL,
  risk_band           ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  -- Lifecycle
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at          TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_uuid (uuid),
  UNIQUE KEY uk_users_email (email_normalized),
  UNIQUE KEY uk_users_phone (phone_e164),
  UNIQUE KEY uk_users_username (username_normalized),
  KEY idx_users_status (status, created_at),
  KEY idx_users_country (country_id),
  KEY idx_users_active (last_active_at),
  CONSTRAINT fk_users_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_users_city FOREIGN KEY (city_id)
    REFERENCES cities (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_users_identifier CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Identity providers (§2 Google / Apple / Facebook / Microsoft)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity_providers (
  id          TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(32)  NOT NULL,
  name        VARCHAR(64)  NOT NULL,
  kind        ENUM('oauth2','oidc','saml','apple','passkey') NOT NULL DEFAULT 'oidc',
  issuer      VARCHAR(191) NULL,
  authorize_url VARCHAR(255) NULL,
  token_url   VARCHAR(255) NULL,
  userinfo_url VARCHAR(255) NULL,
  jwks_url    VARCHAR(255) NULL,
  scopes      VARCHAR(255) NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_idp_code (code)
) ENGINE = InnoDB;

-- Client credentials kept out of the provider row so they can be rotated/encrypted
CREATE TABLE IF NOT EXISTS identity_provider_credentials (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  provider_id   TINYINT UNSIGNED NOT NULL,
  platform_id   TINYINT UNSIGNED NULL,     -- different client ids per platform (iOS/Android/Web)
  client_id     VARCHAR(255)     NOT NULL,
  client_secret VARBINARY(2048)  NULL,     -- encrypted at rest by the app layer
  redirect_uri  VARCHAR(255)     NULL,
  is_active     BOOLEAN          NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_idp_creds (provider_id, platform_id),
  CONSTRAINT fk_idp_creds_provider FOREIGN KEY (provider_id)
    REFERENCES identity_providers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_idp_creds_platform FOREIGN KEY (platform_id)
    REFERENCES platforms (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS user_identities (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED  NOT NULL,
  provider_id      TINYINT UNSIGNED NOT NULL,
  provider_user_id VARCHAR(191)     NOT NULL,
  email            VARCHAR(191)     NULL,
  display_name     VARCHAR(191)     NULL,
  given_name       VARCHAR(96)      NULL,
  family_name      VARCHAR(96)      NULL,
  picture_url      VARCHAR(512)     NULL,
  raw_profile      JSON             NULL,
  linked_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at     TIMESTAMP        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_identities_provider (provider_id, provider_user_id),
  KEY idx_user_identities_user (user_id),
  CONSTRAINT fk_user_identities_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_identities_provider FOREIGN KEY (provider_id)
    REFERENCES identity_providers (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- WebAuthn passkeys (§2 Passkey)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_passkeys (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  credential_id  VARBINARY(512)  NOT NULL,
  public_key     VARBINARY(1024) NOT NULL,
  sign_count     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  aaguid         CHAR(36)        NULL,
  transports     VARCHAR(96)     NULL,
  device_label   VARCHAR(96)     NULL,
  backed_up      BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at   TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_passkeys_credential (credential_id(255)),
  KEY idx_passkeys_user (user_id),
  CONSTRAINT fk_passkeys_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NULL,
  challenge  VARBINARY(255)  NOT NULL,
  purpose    ENUM('register','authenticate') NOT NULL,
  expires_at TIMESTAMP       NOT NULL,
  consumed_at TIMESTAMP      NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_webauthn_expiry (expires_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- OTP codes (§2 OTP, email/phone verification)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otp_codes (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NULL,
  channel      ENUM('email','sms','whatsapp','voice') NOT NULL,
  destination  VARCHAR(191)    NOT NULL,
  purpose      ENUM('login','register','verify_email','verify_phone','reset_password',
                    'mfa','device_verify','contact_reveal','payout') NOT NULL,
  code_hash    CHAR(64)        NOT NULL,
  attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 5,
  expires_at   TIMESTAMP       NOT NULL,
  consumed_at  TIMESTAMP       NULL,
  ip_address   VARBINARY(16)   NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_otp_lookup (destination, purpose, consumed_at),
  KEY idx_otp_expiry (expires_at),
  KEY idx_otp_user (user_id)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- MFA factors + recovery codes (§2 MFA)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mfa_factors (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  kind        ENUM('totp','sms','email','push','passkey') NOT NULL,
  label       VARCHAR(96)     NULL,
  secret      VARBINARY(512)  NULL,
  destination VARCHAR(191)    NULL,
  is_primary  BOOLEAN         NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMP       NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_mfa_user_kind (user_id, kind, destination),
  CONSTRAINT fk_mfa_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id   BIGINT UNSIGNED NOT NULL,
  code_hash CHAR(64)        NOT NULL,
  used_at   TIMESTAMP       NULL,
  created_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mfa_recovery_user (user_id, used_at),
  CONSTRAINT fk_mfa_recovery_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Devices (§19 device fingerprinting, §14 push tokens)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_devices (
  id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)         NOT NULL,
  user_id           BIGINT UNSIGNED  NULL,           -- NULL while in guest mode
  platform_id       TINYINT UNSIGNED NOT NULL,
  fingerprint_hash  CHAR(64)         NOT NULL,
  device_name       VARCHAR(128)     NULL,
  device_model      VARCHAR(128)     NULL,
  manufacturer      VARCHAR(96)      NULL,
  os_version        VARCHAR(48)      NULL,
  app_version       VARCHAR(24)      NULL,
  locale            VARCHAR(24)      NULL,
  timezone          VARCHAR(64)      NULL,
  push_token        VARCHAR(512)     NULL,
  push_provider     ENUM('fcm','apns','webpush','none') NOT NULL DEFAULT 'none',
  -- Integrity signals (§19)
  is_rooted         BOOLEAN          NOT NULL DEFAULT FALSE,
  is_jailbroken     BOOLEAN          NOT NULL DEFAULT FALSE,
  is_emulator       BOOLEAN          NOT NULL DEFAULT FALSE,
  is_trusted        BOOLEAN          NOT NULL DEFAULT FALSE,
  trusted_at        TIMESTAMP        NULL,
  first_seen_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_devices_uuid (uuid),
  UNIQUE KEY uk_devices_user_fingerprint (user_id, fingerprint_hash),
  KEY idx_devices_fingerprint (fingerprint_hash),
  KEY idx_devices_push (push_token(191)),
  CONSTRAINT fk_devices_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_devices_platform FOREIGN KEY (platform_id)
    REFERENCES platforms (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Sessions: rotating refresh tokens, device-bound, reuse detection
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid               CHAR(36)        NOT NULL,
  user_id            BIGINT UNSIGNED NOT NULL,
  device_id          BIGINT UNSIGNED NULL,
  family_id          CHAR(36)        NOT NULL,       -- rotation family; reuse ⇒ revoke family
  refresh_token_hash CHAR(64)        NOT NULL,
  parent_id          BIGINT UNSIGNED NULL,
  ip_address         VARBINARY(16)   NULL,
  user_agent         VARCHAR(512)    NULL,
  country_id         SMALLINT UNSIGNED NULL,
  login_method       ENUM('password','otp','oauth','passkey','refresh','impersonation') NOT NULL,
  mfa_satisfied      BOOLEAN         NOT NULL DEFAULT FALSE,
  expires_at         TIMESTAMP       NOT NULL,
  revoked_at         TIMESTAMP       NULL,
  revoked_reason     VARCHAR(96)     NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at       TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sessions_uuid (uuid),
  UNIQUE KEY uk_sessions_refresh (refresh_token_hash),
  KEY idx_sessions_user (user_id, revoked_at),
  KEY idx_sessions_family (family_id),
  KEY idx_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sessions_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Guest sessions (§1 Guest Mode)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guest_sessions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid         CHAR(36)        NOT NULL,
  device_id    BIGINT UNSIGNED NULL,
  country_id   SMALLINT UNSIGNED NULL,
  language     VARCHAR(10)     NULL,
  currency     CHAR(3)         NULL,
  ip_address   VARBINARY(16)   NULL,
  converted_user_id BIGINT UNSIGNED NULL,   -- set when the guest signs up
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  expires_at   TIMESTAMP       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_guest_uuid (uuid),
  KEY idx_guest_expiry (expires_at),
  CONSTRAINT fk_guest_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Login attempts + password resets (§19 suspicious login detection)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  identifier  VARCHAR(191)    NOT NULL,
  user_id     BIGINT UNSIGNED NULL,
  method      ENUM('password','otp','oauth','passkey','refresh') NOT NULL,
  succeeded   BOOLEAN         NOT NULL,
  failure_reason VARCHAR(96)  NULL,
  risk_score  TINYINT UNSIGNED NULL,
  ip_address  VARBINARY(16)   NULL,
  user_agent  VARCHAR(512)    NULL,
  device_hash CHAR(64)        NULL,
  country_id  SMALLINT UNSIGNED NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_login_attempts_identifier (identifier, created_at),
  KEY idx_login_attempts_ip (ip_address, created_at),
  KEY idx_login_attempts_user (user_id, created_at)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64)        NOT NULL,
  expires_at TIMESTAMP       NOT NULL,
  consumed_at TIMESTAMP      NULL,
  ip_address VARBINARY(16)   NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_password_reset_token (token_hash),
  KEY idx_password_reset_user (user_id),
  CONSTRAINT fk_password_reset_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Captcha challenges (§2 CAPTCHA)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captcha_challenges (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token      CHAR(36)        NOT NULL,
  provider   VARCHAR(32)     NOT NULL DEFAULT 'internal',
  action     VARCHAR(64)     NOT NULL,
  ip_address VARBINARY(16)   NULL,
  solved_at  TIMESTAMP       NULL,
  expires_at TIMESTAMP       NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_captcha_token (token),
  KEY idx_captcha_expiry (expires_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- API keys for partner / server-to-server access (§25 API Security)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NULL,
  name        VARCHAR(128)    NOT NULL,
  key_prefix  VARCHAR(16)     NOT NULL,
  key_hash    CHAR(64)        NOT NULL,
  scopes      JSON            NOT NULL,
  rate_limit_per_min INT UNSIGNED NOT NULL DEFAULT 600,
  allowed_ips JSON            NULL,
  expires_at  TIMESTAMP       NULL,
  revoked_at  TIMESTAMP       NULL,
  last_used_at TIMESTAMP      NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_api_keys_hash (key_hash),
  KEY idx_api_keys_prefix (key_prefix),
  CONSTRAINT fk_api_keys_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
