-- =============================================================================
-- 003  Profiles, business accounts, RBAC/ABAC, verification, KYC, trust score
--      (§3 User Profile, §19 KYC/AML, §25 RBAC/ABAC)
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Personal profile
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id       BIGINT UNSIGNED NOT NULL,
  display_name  VARCHAR(128)    NULL,
  first_name    VARCHAR(96)     NULL,
  last_name     VARCHAR(96)     NULL,
  bio           VARCHAR(1000)   NULL,
  avatar_url    VARCHAR(512)    NULL,
  cover_url     VARCHAR(512)    NULL,
  date_of_birth DATE            NULL,
  gender        ENUM('male','female','other','undisclosed') NULL,
  address_line1 VARCHAR(191)    NULL,
  address_line2 VARCHAR(191)    NULL,
  postal_code   VARCHAR(24)     NULL,
  website       VARCHAR(255)    NULL,
  whatsapp      VARCHAR(24)     NULL,
  show_phone    BOOLEAN         NOT NULL DEFAULT TRUE,
  show_email    BOOLEAN         NOT NULL DEFAULT FALSE,
  show_whatsapp BOOLEAN         NOT NULL DEFAULT TRUE,
  profile_completeness TINYINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_profiles_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Business profile (§3 Company / Dealer / Agency / Builder / Gold Shop)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_profiles (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  kind              ENUM('company','dealer','agency','builder','gold_shop','showroom','broker')
                      NOT NULL,
  legal_name        VARCHAR(191)    NOT NULL,
  trade_name        VARCHAR(191)    NULL,
  slug              VARCHAR(200)    NOT NULL,
  registration_no   VARCHAR(96)     NULL,
  tax_id            VARCHAR(96)     NULL,
  description       TEXT            NULL,
  logo_url          VARCHAR(512)    NULL,
  banner_url        VARCHAR(512)    NULL,
  website           VARCHAR(255)    NULL,
  established_year  SMALLINT UNSIGNED NULL,
  employee_count    INT UNSIGNED    NULL,
  country_id        SMALLINT UNSIGNED NULL,
  region_id         INT UNSIGNED    NULL,
  city_id           INT UNSIGNED    NULL,
  address           VARCHAR(255)    NULL,
  latitude          DECIMAL(10,7)   NULL,
  longitude         DECIMAL(10,7)   NULL,
  contact_phone     VARCHAR(24)     NULL,
  contact_email     VARCHAR(191)    NULL,
  business_hours    JSON            NULL,
  -- Which marketplaces this business operates in
  marketplaces      JSON            NULL,
  verified_at       TIMESTAMP       NULL,
  verified_by       BIGINT UNSIGNED NULL,
  status            ENUM('draft','pending','active','suspended','rejected') NOT NULL DEFAULT 'draft',
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_business_slug (slug),
  KEY idx_business_user (user_id),
  KEY idx_business_kind (kind, status),
  KEY idx_business_city (city_id),
  CONSTRAINT fk_business_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_business_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_business_city FOREIGN KEY (city_id)
    REFERENCES cities (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Staff seats under a business (agency agents, showroom staff)
CREATE TABLE IF NOT EXISTS business_members (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id  BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  member_role  ENUM('owner','admin','manager','agent','staff') NOT NULL DEFAULT 'agent',
  can_post     BOOLEAN         NOT NULL DEFAULT TRUE,
  can_reply    BOOLEAN         NOT NULL DEFAULT TRUE,
  can_billing  BOOLEAN         NOT NULL DEFAULT FALSE,
  invited_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at  TIMESTAMP       NULL,
  removed_at   TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_business_members (business_id, user_id),
  KEY idx_business_members_user (user_id),
  CONSTRAINT fk_business_members_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_business_members_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- RBAC: roles / permissions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(64)  NOT NULL,
  name        VARCHAR(96)  NOT NULL,
  description VARCHAR(255) NULL,
  is_staff    BOOLEAN      NOT NULL DEFAULT FALSE,   -- staff roles reach the admin panel
  is_system   BOOLEAN      NOT NULL DEFAULT FALSE,   -- cannot be deleted
  PRIMARY KEY (id),
  UNIQUE KEY uk_roles_code (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(96)  NOT NULL,     -- "listing.publish", "user.suspend"
  resource    VARCHAR(48)  NOT NULL,
  action      VARCHAR(48)  NOT NULL,
  description VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_permissions_code (code),
  KEY idx_permissions_resource (resource)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       SMALLINT UNSIGNED NOT NULL,
  permission_id SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id)
    REFERENCES permissions (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    BIGINT UNSIGNED   NOT NULL,
  role_id    SMALLINT UNSIGNED NOT NULL,
  -- Scope a role to one marketplace (e.g. moderator for Vehicles only)
  marketplace_id TINYINT UNSIGNED NULL,
  granted_by BIGINT UNSIGNED   NULL,
  granted_at TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP         NULL,
  PRIMARY KEY (user_id, role_id),
  KEY idx_user_roles_role (role_id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- ABAC: attribute-based policies evaluated against the resource + principal
CREATE TABLE IF NOT EXISTS access_policies (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(96)  NOT NULL,
  resource    VARCHAR(48)  NOT NULL,
  action      VARCHAR(48)  NOT NULL,
  effect      ENUM('allow','deny') NOT NULL DEFAULT 'allow',
  -- `condition` is reserved in MySQL 8, hence the suffix.
  condition_json JSON      NOT NULL,     -- {"owner": true} | {"subscription_tier": ["business"]}
  priority    SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  description VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_access_policies_code (code),
  KEY idx_access_policies_lookup (resource, action, is_active, priority)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Identity verification (§3 Government ID / Passport / Driving License / Business License)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verification_requests (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          CHAR(36)        NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  business_id   BIGINT UNSIGNED NULL,
  doc_type      ENUM('government_id','passport','driving_license','business_license',
                     'tax_certificate','utility_bill','selfie','ownership_proof') NOT NULL,
  doc_number    VARCHAR(96)     NULL,
  issuing_country_id SMALLINT UNSIGNED NULL,
  issued_on     DATE            NULL,
  expires_on    DATE            NULL,
  status        ENUM('pending','in_review','approved','rejected','expired') NOT NULL DEFAULT 'pending',
  reviewer_id   BIGINT UNSIGNED NULL,
  reviewed_at   TIMESTAMP       NULL,
  rejection_reason VARCHAR(255) NULL,
  ai_check_score DECIMAL(5,2)   NULL,          -- automated document authenticity score
  ai_check_result JSON          NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_verification_uuid (uuid),
  KEY idx_verification_user (user_id, status),
  KEY idx_verification_queue (status, created_at),
  CONSTRAINT fk_verification_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_verification_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS verification_documents (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id  BIGINT UNSIGNED NOT NULL,
  side        ENUM('front','back','selfie','page','other') NOT NULL DEFAULT 'front',
  file_url    VARCHAR(512)    NOT NULL,
  file_hash   CHAR(64)        NULL,
  mime_type   VARCHAR(96)     NULL,
  size_bytes  INT UNSIGNED    NULL,
  uploaded_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_verification_docs_request (request_id),
  CONSTRAINT fk_verification_docs_request FOREIGN KEY (request_id)
    REFERENCES verification_requests (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- KYC / AML (§19)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_records (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED NOT NULL,
  level          ENUM('none','basic','standard','enhanced') NOT NULL DEFAULT 'none',
  status         ENUM('not_started','pending','verified','rejected','expired') NOT NULL DEFAULT 'not_started',
  provider       VARCHAR(48)     NULL,
  provider_ref   VARCHAR(128)    NULL,
  full_legal_name VARCHAR(191)   NULL,
  date_of_birth  DATE            NULL,
  nationality_country_id SMALLINT UNSIGNED NULL,
  residence_country_id   SMALLINT UNSIGNED NULL,
  verified_at    TIMESTAMP       NULL,
  expires_at     TIMESTAMP       NULL,
  notes          VARCHAR(500)    NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_kyc_user (user_id),
  KEY idx_kyc_status (status, level),
  CONSTRAINT fk_kyc_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS aml_screenings (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  screening_type ENUM('sanctions','pep','adverse_media','watchlist') NOT NULL,
  provider      VARCHAR(48)     NULL,
  result        ENUM('clear','potential_match','match','error') NOT NULL,
  match_score   DECIMAL(5,2)    NULL,
  details       JSON            NULL,
  reviewed_by   BIGINT UNSIGNED NULL,
  reviewed_at   TIMESTAMP       NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_aml_user (user_id, created_at),
  KEY idx_aml_result (result),
  CONSTRAINT fk_aml_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Trust score + badges (§3 Trust Score / Verified Badge / Rating)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trust_scores (
  user_id        BIGINT UNSIGNED NOT NULL,
  score          DECIMAL(5,2)    NOT NULL DEFAULT 0.00,   -- 0..100
  band           ENUM('new','bronze','silver','gold','platinum') NOT NULL DEFAULT 'new',
  identity_points DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  activity_points DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  review_points   DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  response_points DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  penalty_points  DECIMAL(5,2)   NOT NULL DEFAULT 0.00,
  breakdown      JSON            NULL,
  computed_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_trust_band (band, score),
  CONSTRAINT fk_trust_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS badges (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(48)  NOT NULL,
  name        VARCHAR(96)  NOT NULL,
  description VARCHAR(255) NULL,
  icon        VARCHAR(96)  NULL,
  color       VARCHAR(16)  NULL,
  kind        ENUM('verification','subscription','performance','tenure','manual') NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_badges_code (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS user_badges (
  user_id    BIGINT UNSIGNED   NOT NULL,
  badge_id   SMALLINT UNSIGNED NOT NULL,
  awarded_at TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP         NULL,
  awarded_by BIGINT UNSIGNED   NULL,
  PRIMARY KEY (user_id, badge_id),
  CONSTRAINT fk_user_badges_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_badges_badge FOREIGN KEY (badge_id)
    REFERENCES badges (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Follows (§23 Followers)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_follows (
  follower_id BIGINT UNSIGNED NOT NULL,
  followee_id BIGINT UNSIGNED NOT NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (follower_id, followee_id),
  KEY idx_follows_followee (followee_id),
  CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_follows_followee FOREIGN KEY (followee_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
  -- Self-follow is rejected in the service layer: MySQL forbids a CHECK on a
  -- column that also carries a cascading foreign key.
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- GDPR / CCPA consent + data subject requests (§25)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_consents (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NULL,
  guest_uuid  CHAR(36)        NULL,
  consent_type ENUM('terms','privacy','marketing_email','marketing_sms','marketing_push',
                    'cookies_analytics','cookies_ads','data_processing','location') NOT NULL,
  granted     BOOLEAN         NOT NULL,
  document_version VARCHAR(24) NULL,
  ip_address  VARBINARY(16)   NULL,
  user_agent  VARCHAR(512)    NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_consents_user (user_id, consent_type, created_at),
  CONSTRAINT fk_consents_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS data_subject_requests (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid         CHAR(36)        NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  kind         ENUM('export','erasure','rectification','restriction','portability') NOT NULL,
  regulation   ENUM('gdpr','ccpa','other') NOT NULL DEFAULT 'gdpr',
  status       ENUM('pending','in_progress','completed','rejected') NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_at       TIMESTAMP       NULL,
  completed_at TIMESTAMP       NULL,
  export_url   VARCHAR(512)    NULL,
  handled_by   BIGINT UNSIGNED NULL,
  notes        VARCHAR(500)    NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_dsr_uuid (uuid),
  KEY idx_dsr_user (user_id, status),
  CONSTRAINT fk_dsr_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Audit trail (§22 / §25 Audit Logs)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id     BIGINT UNSIGNED NULL,
  actor_type   ENUM('user','admin','system','api_key','job') NOT NULL DEFAULT 'user',
  action       VARCHAR(96)     NOT NULL,
  entity_type  VARCHAR(64)     NOT NULL,
  entity_id    VARCHAR(64)     NULL,
  before_state JSON            NULL,
  after_state  JSON            NULL,
  ip_address   VARBINARY(16)   NULL,
  user_agent   VARCHAR(512)    NULL,
  request_id   CHAR(36)        NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_actor (actor_id, created_at),
  KEY idx_audit_entity (entity_type, entity_id, created_at),
  KEY idx_audit_action (action, created_at)
) ENGINE = InnoDB;
