-- =============================================================================
-- 021  Global profile system extensions
--      Additive only. Reuses users, user_profiles, business_profiles,
--      business_members, verification_*, trust_scores, reviews, rating_summaries.
--      Does not drop data or recreate tables.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Username change tracking (username + unique username_normalized already on users)
-- -----------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN username_changed_at TIMESTAMP NULL AFTER username,
  ADD COLUMN username_change_count SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER username_changed_at;

CREATE TABLE IF NOT EXISTS reserved_usernames (
  username_normalized VARCHAR(64) NOT NULL,
  reason              VARCHAR(96) NOT NULL DEFAULT 'reserved',
  created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (username_normalized)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS username_history (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id             BIGINT UNSIGNED NOT NULL,
  username            VARCHAR(64)     NOT NULL,
  username_normalized VARCHAR(64)     NOT NULL,
  changed_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  held_until          TIMESTAMP       NULL,
  PRIMARY KEY (id),
  KEY idx_username_history_held (username_normalized, held_until),
  KEY idx_username_history_user (user_id, changed_at),
  CONSTRAINT fk_username_history_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Profile image metadata (binaries stay in object storage, never in MySQL)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profile_images (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NOT NULL,
  kind             ENUM('avatar','cover','logo') NOT NULL DEFAULT 'avatar',
  original_path    VARCHAR(512)    NOT NULL,
  profile_path     VARCHAR(512)    NULL,
  thumb_path       VARCHAR(512)    NULL,
  original_url     VARCHAR(512)    NOT NULL,
  profile_url      VARCHAR(512)    NULL,
  thumb_url        VARCHAR(512)    NULL,
  mime_type        VARCHAR(96)     NOT NULL,
  width            SMALLINT UNSIGNED NULL,
  height           SMALLINT UNSIGNED NULL,
  size_bytes       INT UNSIGNED    NULL,
  status           ENUM('pending','ready','rejected','deleted') NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at       TIMESTAMP       NULL,
  PRIMARY KEY (id),
  KEY idx_profile_images_user (user_id, kind, status),
  CONSTRAINT fk_profile_images_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Personal profile: visibility + field-level privacy (email/phone stay on users)
-- -----------------------------------------------------------------------------
ALTER TABLE user_profiles
  ADD COLUMN visibility ENUM('public','registered','private') NOT NULL DEFAULT 'public'
    AFTER profile_completeness,
  ADD COLUMN avatar_image_id BIGINT UNSIGNED NULL AFTER visibility,
  ADD COLUMN cover_image_id BIGINT UNSIGNED NULL AFTER avatar_image_id,
  ADD COLUMN show_location BOOLEAN NOT NULL DEFAULT TRUE AFTER cover_image_id,
  ADD COLUMN show_listings BOOLEAN NOT NULL DEFAULT TRUE AFTER show_location,
  ADD COLUMN show_businesses BOOLEAN NOT NULL DEFAULT TRUE AFTER show_listings,
  ADD COLUMN show_reviews BOOLEAN NOT NULL DEFAULT TRUE AFTER show_businesses,
  ADD COLUMN show_last_active BOOLEAN NOT NULL DEFAULT FALSE AFTER show_reviews;

ALTER TABLE user_profiles
  ADD CONSTRAINT fk_user_profiles_avatar_image FOREIGN KEY (avatar_image_id)
    REFERENCES profile_images (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_user_profiles_cover_image FOREIGN KEY (cover_image_id)
    REFERENCES profile_images (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Business: extra common fields, expanded member roles, invitations, locations
-- -----------------------------------------------------------------------------
ALTER TABLE business_profiles
  ADD COLUMN license_reference VARCHAR(191) NULL AFTER registration_no,
  ADD COLUMN social_links JSON NULL AFTER business_hours;

ALTER TABLE business_members
  MODIFY COLUMN member_role ENUM(
    'owner','admin','manager','agent','staff','salesperson','editor','accountant','support'
  ) NOT NULL DEFAULT 'agent';

CREATE TABLE IF NOT EXISTS business_invitations (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)        NOT NULL,
  business_id      BIGINT UNSIGNED NOT NULL,
  invited_user_id  BIGINT UNSIGNED NULL,
  invited_email    VARCHAR(191)    NULL,
  invited_phone    VARCHAR(24)     NULL,
  member_role      ENUM('admin','manager','agent','staff','salesperson','editor','accountant','support')
                     NOT NULL DEFAULT 'agent',
  token_hash       CHAR(64)        NOT NULL,
  invited_by       BIGINT UNSIGNED NOT NULL,
  expires_at       TIMESTAMP       NOT NULL,
  accepted_at      TIMESTAMP       NULL,
  declined_at      TIMESTAMP       NULL,
  revoked_at       TIMESTAMP       NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_business_invitations_uuid (uuid),
  UNIQUE KEY uk_business_invitations_token (token_hash),
  KEY idx_business_invitations_business (business_id, accepted_at),
  KEY idx_business_invitations_user (invited_user_id, accepted_at),
  CONSTRAINT fk_business_invitations_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_business_invitations_user FOREIGN KEY (invited_user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_business_invitations_inviter FOREIGN KEY (invited_by)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS business_locations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id BIGINT UNSIGNED NOT NULL,
  kind        ENUM('office','showroom','service_center','shop','project','other') NOT NULL DEFAULT 'office',
  name        VARCHAR(191)    NULL,
  country_id  SMALLINT UNSIGNED NULL,
  region_id   INT UNSIGNED    NULL,
  city_id     INT UNSIGNED    NULL,
  address     VARCHAR(255)    NULL,
  phone       VARCHAR(24)     NULL,
  hours       JSON            NULL,
  is_primary  BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_business_locations_business (business_id, kind),
  CONSTRAINT fk_business_locations_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Marketplace-specific business modules (not one giant table)
CREATE TABLE IF NOT EXISTS dealer_profiles (
  business_id        BIGINT UNSIGNED NOT NULL,
  dealer_license     VARCHAR(191)    NULL,
  has_service_center BOOLEAN         NOT NULL DEFAULT FALSE,
  notes              VARCHAR(1000)   NULL,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id),
  CONSTRAINT fk_dealer_profiles_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS dealer_brands (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id BIGINT UNSIGNED NOT NULL,
  brand_name  VARCHAR(96)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dealer_brands (business_id, brand_name),
  CONSTRAINT fk_dealer_brands_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS agency_profiles (
  business_id          BIGINT UNSIGNED NOT NULL,
  agency_license       VARCHAR(191)    NULL,
  property_categories  JSON            NULL,
  notes                VARCHAR(1000)   NULL,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id),
  CONSTRAINT fk_agency_profiles_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS agency_areas (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id BIGINT UNSIGNED NOT NULL,
  city_id     INT UNSIGNED    NULL,
  area_id     INT UNSIGNED    NULL,
  PRIMARY KEY (id),
  KEY idx_agency_areas_business (business_id),
  CONSTRAINT fk_agency_areas_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS builder_profiles (
  business_id            BIGINT UNSIGNED NOT NULL,
  builder_registration   VARCHAR(191)    NULL,
  construction_history   TEXT            NULL,
  notes                  VARCHAR(1000)   NULL,
  updated_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id),
  CONSTRAINT fk_builder_profiles_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS builder_projects (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id     BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(191)    NOT NULL,
  city_id         INT UNSIGNED    NULL,
  status          ENUM('planned','under_construction','completed','on_hold') NOT NULL DEFAULT 'planned',
  completed_year  SMALLINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_builder_projects_business (business_id),
  CONSTRAINT fk_builder_projects_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gold_shop_profiles (
  business_id    BIGINT UNSIGNED NOT NULL,
  certifications JSON            NULL,
  notes          VARCHAR(1000)   NULL,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id),
  CONSTRAINT fk_gold_shop_profiles_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gold_shop_offerings (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id BIGINT UNSIGNED NOT NULL,
  category    VARCHAR(64)     NOT NULL,
  purity      VARCHAR(32)     NULL,
  PRIMARY KEY (id),
  KEY idx_gold_shop_offerings_business (business_id),
  CONSTRAINT fk_gold_shop_offerings_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Verification: extra statuses + private document storage metadata
-- Existing: pending, in_review, approved, rejected, expired
-- Public mapping: NOT_STARTED (no row), PENDING, UNDER_REVIEW, ACTION_REQUIRED,
-- VERIFIED (approved), REJECTED, EXPIRED, REVOKED
-- -----------------------------------------------------------------------------
ALTER TABLE verification_requests
  MODIFY COLUMN status ENUM(
    'pending','in_review','approved','rejected','expired','action_required','revoked'
  ) NOT NULL DEFAULT 'pending';

ALTER TABLE verification_documents
  ADD COLUMN storage_path VARCHAR(512) NULL AFTER file_url,
  ADD COLUMN encryption_kid VARCHAR(32) NULL AFTER file_hash,
  ADD COLUMN is_sensitive BOOLEAN NOT NULL DEFAULT TRUE AFTER encryption_kid;

-- -----------------------------------------------------------------------------
-- Trust events (score is computed, never a freely editable user field)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trust_score_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  event_type     VARCHAR(64)     NOT NULL,
  source         VARCHAR(64)     NOT NULL,
  weight         DECIMAL(6,2)    NOT NULL DEFAULT 0.00,
  delta          DECIMAL(6,2)    NOT NULL DEFAULT 0.00,
  marketplace_id TINYINT UNSIGNED NULL,
  reference_type VARCHAR(64)     NULL,
  reference_id   VARCHAR(64)     NULL,
  explanation    VARCHAR(255)    NULL,
  internal_notes VARCHAR(500)    NULL,
  status         ENUM('applied','reversed','ignored') NOT NULL DEFAULT 'applied',
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_trust_events_user (user_id, created_at),
  KEY idx_trust_events_type (event_type, created_at),
  CONSTRAINT fk_trust_events_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS trust_marketplace_scores (
  user_id        BIGINT UNSIGNED NOT NULL,
  marketplace_id TINYINT UNSIGNED NOT NULL,
  score          DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  band           ENUM('new','bronze','silver','gold','platinum') NOT NULL DEFAULT 'new',
  computed_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, marketplace_id),
  CONSTRAINT fk_trust_mp_scores_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_trust_mp_scores_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Reserved usernames (anti-impersonation). Additional rows can be added by ops.
-- -----------------------------------------------------------------------------
INSERT INTO reserved_usernames (username_normalized, reason) VALUES
  ('admin', 'system'),
  ('administrator', 'system'),
  ('support', 'system'),
  ('official', 'system'),
  ('security', 'system'),
  ('moderator', 'system'),
  ('mod', 'system'),
  ('staff', 'system'),
  ('help', 'system'),
  ('helpdesk', 'system'),
  ('root', 'system'),
  ('system', 'system'),
  ('api', 'system'),
  ('www', 'system'),
  ('mail', 'system'),
  ('noreply', 'system'),
  ('no-reply', 'system'),
  ('gold', 'marketplace'),
  ('property', 'marketplace'),
  ('vehicles', 'marketplace'),
  ('vehicle', 'marketplace'),
  ('marketplace', 'system'),
  ('aurelia', 'brand'),
  ('verified', 'system'),
  ('identity', 'system'),
  ('kyc', 'system'),
  ('aml', 'system'),
  ('police', 'impersonation'),
  ('government', 'impersonation'),
  ('gov', 'impersonation'),
  ('bank', 'impersonation')
ON DUPLICATE KEY UPDATE reason = VALUES(reason);

INSERT INTO app_settings (setting_key, setting_value, scope, description, is_public) VALUES
  ('schema.required_version', CAST('"021"' AS JSON), 'global', 'Minimum schema_migrations.version this backend requires', FALSE),
  ('profile.username_cooldown_days', CAST('14' AS JSON), 'global', 'Minimum days between username changes', FALSE),
  ('profile.username_max_changes_per_year', CAST('3' AS JSON), 'global', 'Username changes allowed per rolling year', FALSE),
  ('profile.username_hold_days', CAST('90' AS JSON), 'global', 'Days a released username stays reserved against impersonation', FALSE),
  ('profile.bio_max_length', CAST('1000' AS JSON), 'global', 'Maximum bio length', TRUE),
  ('profile.avatar_max_bytes', CAST('5242880' AS JSON), 'global', 'Avatar upload size limit', TRUE)
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  description = VALUES(description),
  is_public = VALUES(is_public);
