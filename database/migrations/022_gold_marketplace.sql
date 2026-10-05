-- =============================================================================
-- 022  Gold marketplace domain completion
--      Extends the global listing spine with Gold-only aggregates:
--      certificates, hallmarks, physical verification, AI assessments,
--      compliance rules, order snapshots, auction/order enumerations,
--      and listing weight/purity fields that 006 did not store separately.
--      Does not duplicate users, payments, listings, or auctions.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Listing lifecycle: Gold (and later others) need validating / suspended /
-- cancelled / completed. Additive ENUM change — existing rows stay valid.
-- -----------------------------------------------------------------------------
ALTER TABLE listings
  MODIFY COLUMN status ENUM(
    'draft','validating','pending_review','published','rejected','expired',
    'sold','rented','reserved','archived','removed','suspended','cancelled','completed'
  ) NOT NULL DEFAULT 'draft';

-- -----------------------------------------------------------------------------
-- Auctions: Gold bidding needs pause, settlement, and failed states.
-- Existing scheduled/live/ended/sold/unsold/cancelled rows stay valid.
-- -----------------------------------------------------------------------------
ALTER TABLE auctions
  MODIFY COLUMN status ENUM(
    'draft','scheduled','live','paused','ended','sold','unsold','cancelled',
    'settlement_pending','completed','failed'
  ) NOT NULL DEFAULT 'scheduled';

ALTER TABLE auctions
  ADD COLUMN settlement_status ENUM('none','pending','escrow','paid','released','refunded','disputed')
    NOT NULL DEFAULT 'none' AFTER winner_id,
  ADD COLUMN paused_at TIMESTAMP NULL AFTER settlement_status,
  ADD COLUMN ended_at TIMESTAMP NULL AFTER paused_at,
  ADD COLUMN last_bid_at TIMESTAMP NULL AFTER ended_at;

ALTER TABLE auction_bids
  ADD COLUMN idempotency_key VARCHAR(64) NULL AFTER ip_address,
  ADD COLUMN currency CHAR(3) NULL AFTER amount,
  ADD UNIQUE KEY uk_auction_bid_idempotency (auction_id, user_id, idempotency_key);

-- -----------------------------------------------------------------------------
-- Orders: marketplace listing purchases and escrow, reused by Gold buy-flow.
-- -----------------------------------------------------------------------------
ALTER TABLE orders
  MODIFY COLUMN kind ENUM(
    'subscription','promotion','advertisement','verification','inspection','service',
    'wallet_topup','auction_deposit','listing_purchase','escrow'
  ) NOT NULL;

ALTER TABLE order_items
  MODIFY COLUMN kind ENUM(
    'subscription','promotion','advertisement','verification','inspection','service',
    'wallet_topup','auction_deposit','tax','fee','listing_purchase','escrow'
  ) NOT NULL;

-- -----------------------------------------------------------------------------
-- Brands: verification status is catalog-driven, not hardcoded in Flutter.
-- -----------------------------------------------------------------------------
ALTER TABLE brands
  ADD COLUMN verification_status ENUM('unverified','pending','verified','rejected')
    NOT NULL DEFAULT 'unverified' AFTER is_popular,
  ADD COLUMN verified_at TIMESTAMP NULL AFTER verification_status;

-- -----------------------------------------------------------------------------
-- Country-specific purity standards (karat ≠ identical fineness everywhere).
-- Global defaults remain in gold_purity_standards.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_purity_country_standards (
  id                   INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  country_id           SMALLINT UNSIGNED NOT NULL,
  karat                DECIMAL(5,2)     NOT NULL,
  fineness             SMALLINT UNSIGNED NOT NULL,
  purity_percent       DECIMAL(6,3)     NOT NULL,
  standard_code        VARCHAR(64)      NOT NULL,
  verification_method  VARCHAR(64)      NULL,
  label                VARCHAR(96)      NOT NULL,
  is_default           BOOLEAN          NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN          NOT NULL DEFAULT TRUE,
  sort_order           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_purity_country (country_id, karat, standard_code),
  KEY idx_gold_purity_country_lookup (country_id, karat, is_active),
  CONSTRAINT fk_gold_purity_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_gold_purity_country_karat CHECK (karat > 0 AND karat <= 24),
  CONSTRAINT chk_gold_purity_country_fineness CHECK (fineness > 0 AND fineness <= 1000)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Hallmark authorities (country-specific). Separate from certificates.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_hallmark_authorities (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  code           VARCHAR(64)      NOT NULL,
  name           VARCHAR(128)     NOT NULL,
  country_id     SMALLINT UNSIGNED NULL,
  website_url    VARCHAR(512)     NULL,
  verification_source VARCHAR(128) NULL,
  is_active      BOOLEAN          NOT NULL DEFAULT TRUE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_hallmark_auth_code (code),
  KEY idx_gold_hallmark_auth_country (country_id, is_active),
  CONSTRAINT fk_gold_hallmark_auth_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gold_hallmarks (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id           BIGINT UNSIGNED NOT NULL,
  authority_id         INT UNSIGNED    NULL,
  authority_name       VARCHAR(128)    NULL,
  country_id           SMALLINT UNSIGNED NULL,
  hallmark_code        VARCHAR(64)     NOT NULL,
  purity_karat         DECIMAL(5,2)    NULL,
  fineness             SMALLINT UNSIGNED NULL,
  verification_status  ENUM('unverified','pending','verified','rejected','inconclusive')
                         NOT NULL DEFAULT 'unverified',
  verification_source  VARCHAR(128)    NULL,
  verified_at          TIMESTAMP       NULL,
  verified_by          BIGINT UNSIGNED NULL,
  notes                VARCHAR(500)    NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gold_hallmarks_listing (listing_id, verification_status),
  KEY idx_gold_hallmarks_code (hallmark_code),
  CONSTRAINT fk_gold_hallmarks_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_gold_hallmarks_authority FOREIGN KEY (authority_id)
    REFERENCES gold_hallmark_authorities (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_gold_hallmarks_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Certificates: document URLs are never stored as public CDN links here.
-- document_id points at listing_documents (is_public must stay false).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_certificates (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id           BIGINT UNSIGNED NOT NULL,
  certificate_number   VARCHAR(96)     NOT NULL,
  issuer               VARCHAR(128)    NOT NULL,
  issuer_code          VARCHAR(48)     NULL,
  issue_date           DATE            NULL,
  expiry_date          DATE            NULL,
  declared_karat       DECIMAL(5,2)    NULL,
  declared_fineness    SMALLINT UNSIGNED NULL,
  declared_weight_g    DECIMAL(12,3)   NULL,
  document_id          BIGINT UNSIGNED NULL,
  verification_status  ENUM('unverified','pending','verified','rejected','expired','inconclusive')
                         NOT NULL DEFAULT 'unverified',
  verified_at          TIMESTAMP       NULL,
  verified_by          BIGINT UNSIGNED NULL,
  verification_source  VARCHAR(128)    NULL,
  created_by           BIGINT UNSIGNED NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_cert_listing_number (listing_id, certificate_number),
  KEY idx_gold_cert_status (verification_status, listing_id),
  CONSTRAINT fk_gold_cert_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_gold_cert_document FOREIGN KEY (document_id)
    REFERENCES listing_documents (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Gold listing extension columns (fine weight, serial, packaging, AI risk).
-- Certificate/hallmark FKs are optional pointers; fields on 006 remain for
-- denormalised search filters.
-- -----------------------------------------------------------------------------
ALTER TABLE gold_listing_details
  ADD COLUMN fine_gold_weight_g DECIMAL(12,3) NULL AFTER net_weight_g,
  ADD COLUMN serial_number VARCHAR(96) NULL AFTER assay_report_url,
  ADD COLUMN packaging VARCHAR(64) NULL AFTER serial_number,
  ADD COLUMN certificate_id BIGINT UNSIGNED NULL AFTER packaging,
  ADD COLUMN hallmark_id BIGINT UNSIGNED NULL AFTER certificate_id,
  ADD COLUMN authenticity_risk ENUM('low','medium','high') NULL AFTER authenticity_verdict,
  ADD COLUMN authenticity_confidence DECIMAL(5,2) NULL AFTER authenticity_risk,
  ADD COLUMN authenticity_model_id VARCHAR(64) NULL AFTER authenticity_confidence,
  ADD COLUMN authenticity_model_version VARCHAR(32) NULL AFTER authenticity_model_id,
  ADD KEY idx_gold_fine_weight (fine_gold_weight_g),
  ADD KEY idx_gold_serial (serial_number),
  ADD CONSTRAINT fk_gold_details_certificate FOREIGN KEY (certificate_id)
    REFERENCES gold_certificates (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_gold_details_hallmark FOREIGN KEY (hallmark_id)
    REFERENCES gold_hallmarks (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Rate service: unit, purity, status. History already exists.
-- -----------------------------------------------------------------------------
ALTER TABLE gold_rates
  ADD COLUMN unit VARCHAR(16) NOT NULL DEFAULT 'gram' AFTER karat,
  ADD COLUMN purity_percent DECIMAL(6,3) NULL AFTER unit,
  ADD COLUMN status ENUM('active','stale','disabled') NOT NULL DEFAULT 'active' AFTER source,
  ADD KEY idx_gold_rates_status (status, metal, karat);

ALTER TABLE gold_rate_history
  ADD COLUMN unit VARCHAR(16) NOT NULL DEFAULT 'gram' AFTER karat;

ALTER TABLE gold_price_predictions
  ADD COLUMN model_id VARCHAR(64) NULL AFTER model,
  ADD COLUMN model_version VARCHAR(32) NULL AFTER model_id,
  ADD COLUMN feature_version VARCHAR(32) NULL AFTER model_version,
  ADD COLUMN result_status ENUM('ready','stale','failed') NOT NULL DEFAULT 'ready' AFTER feature_version;

ALTER TABLE gold_authenticity_checks
  ADD COLUMN risk_level ENUM('low','medium','high') NULL AFTER verdict,
  ADD COLUMN confidence DECIMAL(5,2) NULL AFTER risk_level,
  ADD COLUMN model_id VARCHAR(64) NULL AFTER model,
  ADD COLUMN model_version VARCHAR(32) NULL AFTER model_id,
  ADD COLUMN feature_version VARCHAR(32) NULL AFTER model_version,
  ADD COLUMN result_status ENUM('ready','partial','failed') NOT NULL DEFAULT 'ready' AFTER feature_version;

-- -----------------------------------------------------------------------------
-- Versioned AI assessments (risk support — never an authenticity certificate).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_ai_assessments (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)        NOT NULL,
  listing_id       BIGINT UNSIGNED NULL,
  user_id          BIGINT UNSIGNED NULL,
  kind             ENUM('authenticity_risk','price_forecast','listing_risk','image_assist') NOT NULL,
  model_id         VARCHAR(64)     NOT NULL,
  model_version    VARCHAR(32)     NOT NULL,
  feature_version  VARCHAR(32)     NOT NULL DEFAULT '1',
  input_timestamp  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  risk_level       ENUM('low','medium','high') NULL,
  confidence       DECIMAL(5,2)    NULL,
  score            DECIMAL(5,2)    NULL,
  prediction       JSON            NULL,
  reasons          JSON            NULL,
  recommendation   VARCHAR(500)    NULL,
  result_status    ENUM('ready','partial','failed') NOT NULL DEFAULT 'ready',
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_ai_uuid (uuid),
  KEY idx_gold_ai_listing (listing_id, kind, created_at),
  KEY idx_gold_ai_model (model_id, model_version),
  CONSTRAINT fk_gold_ai_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Physical verification (authoritative for high-value authenticity).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_verification_requests (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)        NOT NULL,
  listing_id       BIGINT UNSIGNED NOT NULL,
  order_id         BIGINT UNSIGNED NULL,
  requested_by     BIGINT UNSIGNED NOT NULL,
  method           ENUM('laboratory','authorized_dealer','physical_inspection','xrf','hallmark','certificate')
                     NOT NULL,
  provider_name    VARCHAR(128)    NULL,
  status           ENUM('requested','scheduled','in_progress','completed','failed','cancelled')
                     NOT NULL DEFAULT 'requested',
  scheduled_at     TIMESTAMP       NULL,
  completed_at     TIMESTAMP       NULL,
  notes            VARCHAR(500)    NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_verify_uuid (uuid),
  KEY idx_gold_verify_listing (listing_id, status),
  KEY idx_gold_verify_order (order_id),
  CONSTRAINT fk_gold_verify_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_gold_verify_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_gold_verify_user FOREIGN KEY (requested_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gold_verification_results (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id       BIGINT UNSIGNED NOT NULL,
  measured_karat   DECIMAL(5,2)    NULL,
  measured_fineness SMALLINT UNSIGNED NULL,
  measured_weight_g DECIMAL(12,3)  NULL,
  method_detail    VARCHAR(128)    NULL,
  outcome          ENUM('pass','fail','inconclusive') NOT NULL,
  report_document_id BIGINT UNSIGNED NULL,
  performed_by     VARCHAR(128)    NULL,
  performed_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes            VARCHAR(500)    NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gold_verify_result_request (request_id),
  CONSTRAINT fk_gold_verify_result_request FOREIGN KEY (request_id)
    REFERENCES gold_verification_requests (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_gold_verify_result_doc FOREIGN KEY (report_document_id)
    REFERENCES listing_documents (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Order snapshot: Gold facts at transaction time. Later listing edits must not
-- rewrite history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_order_snapshots (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id             BIGINT UNSIGNED NOT NULL,
  listing_id           BIGINT UNSIGNED NOT NULL,
  category_id          INT UNSIGNED    NOT NULL,
  category_code        VARCHAR(64)     NULL,
  karat                DECIMAL(5,2)    NULL,
  fineness             SMALLINT UNSIGNED NULL,
  purity_percent       DECIMAL(6,3)    NULL,
  gross_weight_g       DECIMAL(12,3)   NULL,
  stone_weight_g       DECIMAL(12,3)   NULL,
  net_weight_g         DECIMAL(12,3)   NULL,
  fine_gold_weight_g   DECIMAL(12,3)   NULL,
  brand_id             INT UNSIGNED    NULL,
  brand_name           VARCHAR(128)    NULL,
  certificate_id       BIGINT UNSIGNED NULL,
  certificate_number   VARCHAR(96)     NULL,
  hallmark_id          BIGINT UNSIGNED NULL,
  hallmark_code        VARCHAR(64)     NULL,
  making_charge_type   ENUM('flat','per_gram','percent') NULL,
  making_charge_value  DECIMAL(18,4)   NULL,
  making_charge_amount DECIMAL(18,2)   NULL,
  original_price       DECIMAL(18,2)   NOT NULL,
  original_currency    CHAR(3)         NOT NULL,
  reference_metal_value DECIMAL(18,2)  NULL,
  reference_rate_per_gram DECIMAL(18,4) NULL,
  snapshot_json        JSON            NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_order_snapshot (order_id),
  KEY idx_gold_snapshot_listing (listing_id),
  CONSTRAINT fk_gold_snapshot_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_gold_snapshot_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Configurable regional compliance. Never hardcode one country's law.
-- Amounts are in the rule's currency; NULL threshold means "not required".
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_compliance_rules (
  id                         INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  country_id                 SMALLINT UNSIGNED NOT NULL,
  is_active                  BOOLEAN          NOT NULL DEFAULT TRUE,
  kyc_required_above         DECIMAL(18,2)    NULL,
  aml_required_above         DECIMAL(18,2)    NULL,
  physical_verify_above      DECIMAL(18,2)    NULL,
  escrow_required_above      DECIMAL(18,2)    NULL,
  currency                   CHAR(3)          NOT NULL,
  min_kyc_level              ENUM('none','basic','standard','enhanced') NOT NULL DEFAULT 'none',
  seller_verification_required BOOLEAN        NOT NULL DEFAULT FALSE,
  import_export_restricted   BOOLEAN          NOT NULL DEFAULT FALSE,
  tax_code                   VARCHAR(64)      NULL,
  record_retention_days      INT UNSIGNED     NOT NULL DEFAULT 2555,
  notes                      VARCHAR(500)     NULL,
  created_at                 TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                 TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_compliance_country (country_id),
  CONSTRAINT fk_gold_compliance_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Gold category grouping (Investment / Jewelry / Other) without duplicating
-- the global categories table. Existing leaf ids are preserved.
-- -----------------------------------------------------------------------------
INSERT INTO categories (id, marketplace_id, parent_id, code, name, slug, path, depth, icon, operations, group_code, is_leaf, is_active, sort_order) VALUES
  (90, 1, NULL, 'investment',      'Investment', 'investment',      '/90/',      0, 'trending-up', '["buy","sell","auction"]', 'bullion',   FALSE, TRUE, 1),
  (92, 1, NULL, 'other_gold',      'Other',      'other-gold',      '/92/',      0, 'layers',      '["buy","sell","auction"]', 'other',     FALSE, TRUE, 4),
  (109, 1, NULL, 'jewelry_general', 'Jewelry',    'jewelry-general', '/109/', 0, 'gem',         '["buy","sell","auction"]', 'jewellery', TRUE,  TRUE, 0)
ON DUPLICATE KEY UPDATE
  parent_id = VALUES(parent_id), code = VALUES(code), name = VALUES(name), slug = VALUES(slug),
  path = VALUES(path), depth = VALUES(depth), icon = VALUES(icon), operations = VALUES(operations),
  group_code = VALUES(group_code), is_leaf = VALUES(is_leaf), is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);

UPDATE categories c
JOIN categories p ON p.id = 102
   SET c.parent_id = 102, c.path = '/102/109/', c.depth = 1
 WHERE c.id = 109 AND c.marketplace_id = 1;

UPDATE categories SET parent_id = 90, path = '/90/100/', depth = 1, sort_order = 1, group_code = 'bullion' WHERE id = 100 AND marketplace_id = 1;
UPDATE categories SET parent_id = 90, path = '/90/101/', depth = 1, sort_order = 2, group_code = 'bullion' WHERE id = 101 AND marketplace_id = 1;
UPDATE categories SET parent_id = 90, path = '/90/105/', depth = 1, sort_order = 3, group_code = 'bullion' WHERE id = 105 AND marketplace_id = 1;
UPDATE categories SET parent_id = 92, path = '/92/103/', depth = 1, sort_order = 1, group_code = 'collectible' WHERE id = 103 AND marketplace_id = 1;
UPDATE categories SET parent_id = 92, path = '/92/104/', depth = 1, sort_order = 2, group_code = 'scrap' WHERE id = 104 AND marketplace_id = 1;
UPDATE categories SET sort_order = 2, group_code = 'jewellery' WHERE id = 102 AND marketplace_id = 1;
UPDATE categories SET sort_order = 3 WHERE id = 92 AND marketplace_id = 1;

INSERT INTO category_translations (category_id, language, name) VALUES
  (90,  'ar', 'استثمار'),     (90,  'ur', 'سرمایہ کاری'),
  (92,  'ar', 'أخرى'),        (92,  'ur', 'دیگر'),
  (109, 'ar', 'مجوهرات'),     (109, 'ur', 'زیورات')
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO taxonomy_versions (marketplace_id, version) VALUES (1, 2)
ON DUPLICATE KEY UPDATE version = version + 1;

-- -----------------------------------------------------------------------------
-- International 24K spot (country_id NULL) so the rate job has an anchor.
-- Seed 05 only stored per-country rows.
-- -----------------------------------------------------------------------------
INSERT INTO gold_rates (
  id, country_id, city_id, currency, metal, karat, unit, purity_percent,
  rate_per_gram, rate_per_tola, rate_per_ounce, rate_per_10g,
  buy_rate, sell_rate, change_amount, change_percent, source, status
) VALUES (
  100, NULL, NULL, 'USD', 'gold', 24.00, 'gram', 99.900,
  85.0000, 85.0000 * 11.6638, 85.0000 * 31.1035, 850.0000,
  85.0000 * 0.985, 85.0000 * 1.015, 0.3315, 0.390, 'static', 'active'
)
ON DUPLICATE KEY UPDATE
  rate_per_gram = VALUES(rate_per_gram),
  rate_per_tola = VALUES(rate_per_tola),
  rate_per_ounce = VALUES(rate_per_ounce),
  rate_per_10g = VALUES(rate_per_10g),
  status = VALUES(status),
  as_of = CURRENT_TIMESTAMP;
