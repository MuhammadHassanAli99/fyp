-- =============================================================================
-- 025  Global Listing Engine
--      Separates lifecycle / transaction / moderation / expiration dimensions
--      on the existing `listings` spine. Adds versioning, immutable events,
--      rejection history, renewal history, promotion packages, derived search
--      index, analytics event queue, shares, grants, and generic availability.
--
--      Additive only. Does not drop tables, rewrite listing rows, or duplicate
--      gold/property/vehicle detail tables, bookings, fraud, or payments.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Independent status dimensions on the listing spine.
-- `status` remains as a denormalised compatibility column for existing feeds
-- and marketplace modules (gold/property/vehicle). The engine keeps it in sync.
-- -----------------------------------------------------------------------------
ALTER TABLE listings
  ADD COLUMN lifecycle_status ENUM(
      'draft','pending_review','published','rejected','expired','archived'
    ) NOT NULL DEFAULT 'draft' AFTER status,
  ADD COLUMN transaction_status ENUM(
      'available','reserved','sold','rented'
    ) NOT NULL DEFAULT 'available' AFTER lifecycle_status,
  ADD COLUMN moderation_status ENUM(
      'not_reviewed','in_review','approved','rejected'
    ) NOT NULL DEFAULT 'not_reviewed' AFTER transaction_status,
  ADD COLUMN expiration_status ENUM(
      'active','expiring','expired'
    ) NOT NULL DEFAULT 'active' AFTER moderation_status,
  ADD COLUMN seller_id BIGINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN created_by BIGINT UNSIGNED NULL AFTER seller_id,
  ADD COLUMN current_version INT UNSIGNED NOT NULL DEFAULT 1 AFTER created_by,
  ADD COLUMN price_fx_rate DECIMAL(18,6) NULL AFTER price_base,
  ADD COLUMN price_fx_at TIMESTAMP NULL AFTER price_fx_rate,
  ADD COLUMN last_submitted_at TIMESTAMP NULL AFTER published_at,
  ADD COLUMN restored_at TIMESTAMP NULL AFTER archived_at,
  ADD COLUMN archived_by BIGINT UNSIGNED NULL AFTER restored_at,
  ADD COLUMN archived_reason VARCHAR(500) NULL AFTER archived_by,
  ADD KEY idx_listings_lifecycle (marketplace_id, lifecycle_status, transaction_status, expiration_status),
  ADD KEY idx_listings_seller (seller_id, lifecycle_status),
  ADD KEY idx_listings_created_by (created_by),
  ADD KEY idx_listings_expiring (lifecycle_status, expiration_status, expires_at);

ALTER TABLE listings
  ADD CONSTRAINT fk_listings_seller FOREIGN KEY (seller_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_listings_created_by FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_listings_archived_by FOREIGN KEY (archived_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill dimensions from the legacy mixed `status` column. Sold/rented/reserved
-- become transaction states on a published (or archived) lifecycle.
UPDATE listings
   SET lifecycle_status = CASE status
         WHEN 'draft' THEN 'draft'
         WHEN 'validating' THEN 'pending_review'
         WHEN 'pending_review' THEN 'pending_review'
         WHEN 'published' THEN 'published'
         WHEN 'rejected' THEN 'rejected'
         WHEN 'expired' THEN 'expired'
         WHEN 'sold' THEN 'published'
         WHEN 'rented' THEN 'published'
         WHEN 'reserved' THEN 'published'
         WHEN 'archived' THEN 'archived'
         WHEN 'removed' THEN 'archived'
         WHEN 'suspended' THEN 'archived'
         WHEN 'cancelled' THEN 'archived'
         WHEN 'completed' THEN 'published'
         ELSE 'draft'
       END,
       transaction_status = CASE status
         WHEN 'sold' THEN 'sold'
         WHEN 'completed' THEN 'sold'
         WHEN 'rented' THEN 'rented'
         WHEN 'reserved' THEN 'reserved'
         ELSE 'available'
       END,
       moderation_status = CASE
         WHEN status IN ('published','sold','rented','reserved','completed','expired') THEN 'approved'
         WHEN status IN ('rejected') THEN 'rejected'
         WHEN status IN ('pending_review','validating') THEN 'in_review'
         ELSE 'not_reviewed'
       END,
       expiration_status = CASE
         WHEN status = 'expired' THEN 'expired'
         WHEN expires_at IS NOT NULL AND expires_at <= DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 3 DAY)
              AND status = 'published' THEN 'expiring'
         ELSE 'active'
       END,
       seller_id = COALESCE(seller_id, user_id),
       created_by = COALESCE(created_by, user_id)
 WHERE deleted_at IS NULL OR deleted_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Promotion kinds: keep legacy values and add the package catalogue types.
-- -----------------------------------------------------------------------------
ALTER TABLE listing_promotions
  MODIFY COLUMN kind ENUM(
    'feature','boost','urgent','bump','top_of_search','homepage','story',
    'featured','boosted','top_search','category_top','location_top','premium'
  ) NOT NULL;

ALTER TABLE listing_promotions
  ADD COLUMN package_id INT UNSIGNED NULL AFTER kind,
  ADD COLUMN priority SMALLINT NOT NULL DEFAULT 0 AFTER package_id,
  ADD COLUMN payment_id BIGINT UNSIGNED NULL AFTER order_id,
  ADD COLUMN activated_at TIMESTAMP NULL AFTER starts_at,
  ADD COLUMN idempotency_key VARCHAR(64) NULL AFTER status,
  ADD KEY idx_promotions_package (package_id, status),
  ADD UNIQUE KEY uk_promotions_idempotency (listing_id, idempotency_key);

-- -----------------------------------------------------------------------------
-- Configurable promotion packages. Pricing lives here, never in Flutter.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_promotion_packages (
  id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  code             VARCHAR(48)      NOT NULL,
  name             VARCHAR(128)     NOT NULL,
  description      VARCHAR(500)     NULL,
  promotion_type   ENUM(
                     'featured','boosted','top_search','homepage',
                     'category_top','location_top','premium','urgent','bump'
                   ) NOT NULL,
  duration_days    SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  price            DECIMAL(18,2)    NOT NULL,
  currency         CHAR(3)          NOT NULL DEFAULT 'USD',
  priority         SMALLINT         NOT NULL DEFAULT 0,
  marketplace_id   TINYINT UNSIGNED NULL,
  quota_feature    VARCHAR(64)      NULL,
  is_stackable     BOOLEAN          NOT NULL DEFAULT TRUE,
  is_active        BOOLEAN          NOT NULL DEFAULT TRUE,
  sort_order       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_listing_promo_packages_code (code),
  KEY idx_listing_promo_packages_type (promotion_type, is_active),
  CONSTRAINT fk_listing_promo_packages_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_listing_promo_packages_price CHECK (price >= 0)
) ENGINE = InnoDB;

ALTER TABLE listing_promotions
  ADD CONSTRAINT fk_promotions_package FOREIGN KEY (package_id)
    REFERENCES listing_promotion_packages (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Immutable listing event log (audit). Never updated in place.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  event_type     VARCHAR(48)     NOT NULL,
  actor_id       BIGINT UNSIGNED NULL,
  actor_type     ENUM('owner','business','moderator','admin','system','job','ai','buyer')
                   NOT NULL DEFAULT 'system',
  payload        JSON            NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_listing_events_listing (listing_id, created_at),
  KEY idx_listing_events_type (event_type, created_at),
  CONSTRAINT fk_listing_events_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Version snapshots for auditability and price history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_versions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  version        INT UNSIGNED    NOT NULL,
  snapshot       JSON            NOT NULL,
  changed_fields JSON            NULL,
  changed_by     BIGINT UNSIGNED NULL,
  reason         VARCHAR(500)    NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_listing_versions (listing_id, version),
  KEY idx_listing_versions_listing (listing_id, created_at),
  CONSTRAINT fk_listing_versions_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Rejection history. `rejected = true` is never the only record.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_rejections (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  reason_code    VARCHAR(64)     NOT NULL,
  reason         VARCHAR(500)    NOT NULL,
  details        TEXT            NULL,
  reviewer_id    BIGINT UNSIGNED NULL,
  review_type    ENUM('automated','manual','appeal') NOT NULL DEFAULT 'manual',
  appeal_status  ENUM('none','open','upheld','overturned') NOT NULL DEFAULT 'none',
  appeal_note    VARCHAR(1000)   NULL,
  appealed_at    TIMESTAMP       NULL,
  resolved_at    TIMESTAMP       NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_listing_rejections_listing (listing_id, created_at),
  KEY idx_listing_rejections_code (reason_code, created_at),
  CONSTRAINT fk_listing_rejections_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Renewal history. RENEWED is never a listing status.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_renewals (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id       BIGINT UNSIGNED NOT NULL,
  previous_expires_at TIMESTAMP    NULL,
  new_expires_at   TIMESTAMP       NOT NULL,
  days             SMALLINT UNSIGNED NOT NULL,
  source           ENUM('owner','subscription','payment','admin','system') NOT NULL DEFAULT 'owner',
  order_id         BIGINT UNSIGNED NULL,
  amount           DECIMAL(18,2)   NULL,
  currency         CHAR(3)         NULL,
  actor_id         BIGINT UNSIGNED NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_listing_renewals_listing (listing_id, created_at),
  CONSTRAINT fk_listing_renewals_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_listing_renewals_days CHECK (days > 0)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Derived search index. Database listings remain the source of truth.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_search_index (
  listing_id         BIGINT UNSIGNED NOT NULL,
  marketplace_id     TINYINT UNSIGNED NOT NULL,
  category_id        INT UNSIGNED     NOT NULL,
  operation          VARCHAR(24)      NOT NULL,
  lifecycle_status   VARCHAR(24)      NOT NULL,
  transaction_status VARCHAR(24)      NOT NULL,
  expiration_status  VARCHAR(24)      NOT NULL,
  title              VARCHAR(191)     NOT NULL,
  description        MEDIUMTEXT       NULL,
  price              DECIMAL(18,2)    NULL,
  currency           CHAR(3)          NULL,
  price_base         DECIMAL(18,2)    NULL,
  country_id         SMALLINT UNSIGNED NOT NULL,
  region_id          INT UNSIGNED     NULL,
  city_id            INT UNSIGNED     NULL,
  area_id            INT UNSIGNED     NULL,
  latitude           DECIMAL(10,7)    NULL,
  longitude          DECIMAL(10,7)    NULL,
  is_featured        BOOLEAN          NOT NULL DEFAULT FALSE,
  is_boosted         BOOLEAN          NOT NULL DEFAULT FALSE,
  search_rank        DECIMAL(8,4)     NOT NULL DEFAULT 1.0000,
  facets             JSON             NULL,
  indexed_at         TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (listing_id),
  KEY idx_lsi_feed (marketplace_id, lifecycle_status, transaction_status, search_rank),
  KEY idx_lsi_location (country_id, city_id, lifecycle_status),
  KEY idx_lsi_price (marketplace_id, price_base),
  CONSTRAINT fk_lsi_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

ALTER TABLE listing_search_index ADD FULLTEXT KEY ft_lsi_text (title, description);

-- -----------------------------------------------------------------------------
-- Analytics event queue. Counters on `listings` and `listing_metrics_daily`
-- are derived by a job, not updated on the request path.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_analytics_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  event_type     VARCHAR(48)     NOT NULL,
  actor_user_id  BIGINT UNSIGNED NULL,
  guest_uuid     CHAR(36)        NULL,
  source         VARCHAR(48)     NULL,
  metadata       JSON            NULL,
  processed_at   TIMESTAMP       NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lae_listing (listing_id, created_at),
  KEY idx_lae_unprocessed (processed_at, created_at),
  KEY idx_lae_type (event_type, created_at),
  CONSTRAINT fk_lae_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Shares (favorites already exist in 009).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_shares (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED NULL,
  channel        ENUM('link','whatsapp','sms','email','other') NOT NULL DEFAULT 'link',
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_listing_shares_listing (listing_id, created_at),
  CONSTRAINT fk_listing_shares_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Per-listing grants on top of owner + business_members RBAC.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_grants (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED NOT NULL,
  role           ENUM('viewer','editor','agent','manager') NOT NULL DEFAULT 'editor',
  granted_by     BIGINT UNSIGNED NOT NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at     TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_listing_grants_user (listing_id, user_id),
  KEY idx_listing_grants_user (user_id, revoked_at),
  CONSTRAINT fk_listing_grants_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_listing_grants_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Generic availability overlay. Property/vehicle keep their domain booking
-- tables; this engine table covers listing-level blocks that any marketplace
-- can write (maintenance, owner blocks, reserved windows).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_availability_blocks (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  kind           ENUM('booking','reserved','rented','blocked','maintenance') NOT NULL,
  starts_at      DATETIME        NOT NULL,
  ends_at        DATETIME        NOT NULL,
  source         ENUM('listing','property','vehicle','owner','admin','system') NOT NULL DEFAULT 'listing',
  source_id      BIGINT UNSIGNED NULL,
  note           VARCHAR(255)    NULL,
  created_by     BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lab_listing (listing_id, starts_at, ends_at),
  KEY idx_lab_kind (listing_id, kind, starts_at),
  CONSTRAINT fk_lab_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_lab_range CHECK (ends_at > starts_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Drafts: track validation progress so resume is not a black box.
-- -----------------------------------------------------------------------------
ALTER TABLE listing_drafts
  ADD COLUMN completeness_score TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER step,
  ADD COLUMN missing_fields JSON NULL AFTER completeness_score;
