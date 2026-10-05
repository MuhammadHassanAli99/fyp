-- =============================================================================
-- 034  Trust & Risk Platform (additive on 016 / 003 / 019)
--      One Risk Engine for Gold, Property, Vehicles, auth, payments, chat,
--      reviews and KYC. Does NOT create GoldFraud / PropertyFraud / VehicleFraud
--      systems, a graph database, or duplicate of risk_events / risk_scores /
--      access_lists / device_fingerprints / fraud_cases / kyc_records.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Configurable decision bands. Application code must not hard-code 90/65/40.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_policy_thresholds (
  code                     VARCHAR(64)    NOT NULL,
  name                     VARCHAR(128)   NOT NULL,
  allow_max                DECIMAL(5,2)   NOT NULL DEFAULT 29.99,
  monitor_max              DECIMAL(5,2)   NOT NULL DEFAULT 44.99,
  step_up_max              DECIMAL(5,2)   NOT NULL DEFAULT 64.99,
  review_max               DECIMAL(5,2)   NOT NULL DEFAULT 79.99,
  restriction_max          DECIMAL(5,2)   NOT NULL DEFAULT 89.99,
  whitelist_score_reduction DECIMAL(5,2)  NOT NULL DEFAULT 20.00,
  is_active                BOOLEAN        NOT NULL DEFAULT TRUE,
  notes                    VARCHAR(255)   NULL,
  updated_at               TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (code)
) ENGINE = InnoDB;

-- Canonical evaluation record. risk_events remain the per-signal audit trail.
CREATE TABLE IF NOT EXISTS risk_decisions (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)        NOT NULL,
  event_type        VARCHAR(64)     NOT NULL,
  subject_kind      ENUM('user','device','listing','payment','session','message','review','ip') NOT NULL,
  subject_id        BIGINT UNSIGNED NOT NULL DEFAULT 0,
  user_id           BIGINT UNSIGNED NULL,
  device_id         BIGINT UNSIGNED NULL,
  listing_id        BIGINT UNSIGNED NULL,
  review_id         BIGINT UNSIGNED NULL,
  request_id        CHAR(36)        NULL,
  risk_score        DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  risk_level        ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  decision          ENUM('allow','allow_with_monitoring','step_up_verification','review','temporary_restriction','block')
                      NOT NULL DEFAULT 'allow',
  confidence        DECIMAL(5,2)    NOT NULL DEFAULT 40.00,
  signals           JSON            NULL,
  rules_triggered   JSON            NULL,
  model_id          VARCHAR(64)     NULL,
  model_version     VARCHAR(32)     NULL,
  policy_code       VARCHAR(64)     NOT NULL DEFAULT 'default',
  requires_review   BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_risk_decisions_uuid (uuid),
  KEY idx_risk_decisions_user (user_id, created_at),
  KEY idx_risk_decisions_event (event_type, created_at),
  KEY idx_risk_decisions_decision (decision, risk_level, created_at),
  KEY idx_risk_decisions_listing (listing_id, created_at),
  KEY idx_risk_decisions_review (review_id),
  KEY idx_risk_decisions_device (device_id, created_at),
  CONSTRAINT fk_risk_decisions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_risk_decisions_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_risk_decisions_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- ML / heuristic model versioning. Never silently swap the production model.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_models (
  id              SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_id        VARCHAR(64)       NOT NULL,
  name            VARCHAR(128)      NOT NULL,
  feature_version VARCHAR(32)       NOT NULL DEFAULT 'v1',
  status          ENUM('active','shadow','disabled','retired') NOT NULL DEFAULT 'disabled',
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_risk_models_code (model_id)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS risk_model_versions (
  id              INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  model_id        VARCHAR(64)       NOT NULL,
  version         VARCHAR(32)       NOT NULL,
  status          ENUM('active','shadow','disabled','retired') NOT NULL DEFAULT 'shadow',
  metrics         JSON              NULL,
  feature_version VARCHAR(32)       NOT NULL DEFAULT 'v1',
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_risk_model_versions (model_id, version),
  KEY idx_risk_model_versions_status (status, created_at),
  CONSTRAINT fk_risk_model_versions_model FOREIGN KEY (model_id)
    REFERENCES risk_models (model_id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Relationship graph in MySQL (no graph DB). Strength is 0..1, never "fraud".
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_relationships (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  from_kind   ENUM('user','device','ip','account','listing','review','payment','vin','property','gold_certificate','email','phone')
                NOT NULL,
  from_key    VARCHAR(128)    NOT NULL,
  to_kind     ENUM('user','device','ip','account','listing','review','payment','vin','property','gold_certificate','email','phone')
                NOT NULL,
  to_key      VARCHAR(128)    NOT NULL,
  rel_type    VARCHAR(48)     NOT NULL,
  strength    DECIMAL(5,4)    NOT NULL DEFAULT 0.2500,
  evidence    JSON            NULL,
  first_seen  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_risk_relationships (from_kind, from_key, to_kind, to_key, rel_type),
  KEY idx_risk_relationships_to (to_kind, to_key, rel_type),
  KEY idx_risk_relationships_type (rel_type, last_seen)
) ENGINE = InnoDB;

-- Async work: IP lookup, image hash, graph refresh, document OCR, risk recalc.
CREATE TABLE IF NOT EXISTS risk_jobs (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid         CHAR(36)        NOT NULL,
  kind         ENUM('ip_reputation','image_hash','duplicate','document','behavior','recalculate','graph','ai_analysis','kyc_sync','aml_screen')
                 NOT NULL,
  payload      JSON            NOT NULL,
  status       ENUM('queued','running','succeeded','failed','cancelled') NOT NULL DEFAULT 'queued',
  attempts     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  available_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at   TIMESTAMP       NULL,
  finished_at  TIMESTAMP       NULL,
  last_error   VARCHAR(500)    NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_risk_jobs_uuid (uuid),
  KEY idx_risk_jobs_poll (status, available_at, id)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS fraud_case_events (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_id    BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(64)     NOT NULL,
  actor_id   BIGINT UNSIGNED NULL,
  payload    JSON            NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fraud_case_events_case (case_id, created_at),
  CONSTRAINT fk_fraud_case_events_case FOREIGN KEY (case_id)
    REFERENCES fraud_cases (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fraud_case_events_actor FOREIGN KEY (actor_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Forward-compatible enums. Existing values are preserved.
-- -----------------------------------------------------------------------------
ALTER TABLE risk_events
  MODIFY COLUMN decision ENUM(
    'allow','allow_with_monitoring','challenge','step_up_verification',
    'review','temporary_restriction','block','ban'
  ) NOT NULL DEFAULT 'allow';

ALTER TABLE user_devices
  MODIFY COLUMN status ENUM(
    'first_seen','active','trusted','suspicious','blocked','retired',
    'revoked','expired','untrusted'
  ) NOT NULL DEFAULT 'active';

ALTER TABLE kyc_records
  MODIFY COLUMN status ENUM(
    'not_started','pending','in_review','verified','rejected','expired','requires_update'
  ) NOT NULL DEFAULT 'not_started';

ALTER TABLE fraud_cases
  MODIFY COLUMN status ENUM(
    'open','investigating','pending_info','escalated','confirmed',
    'false_positive','resolved','closed','appealed'
  ) NOT NULL DEFAULT 'open';

ALTER TABLE access_lists
  MODIFY COLUMN entry_kind ENUM(
    'ip','ip_range','email','email_domain','phone','device','user','country',
    'asn','keyword','url','iban','card_fingerprint','listing','vin',
    'property_id','document','fingerprint','gold_certificate'
  ) NOT NULL;

ALTER TABLE user_devices
  ADD COLUMN is_debugging  BOOLEAN NOT NULL DEFAULT FALSE AFTER is_emulator,
  ADD COLUMN is_automation BOOLEAN NOT NULL DEFAULT FALSE AFTER is_debugging;

ALTER TABLE device_fingerprints
  ADD COLUMN is_debugging  BOOLEAN NOT NULL DEFAULT FALSE AFTER is_bot,
  ADD COLUMN is_automation BOOLEAN NOT NULL DEFAULT FALSE AFTER is_debugging;

-- Appeal + expiry on access lists (temporary / permanent / until-review).
ALTER TABLE access_lists
  ADD COLUMN appeal_status ENUM('none','submitted','under_review','granted','denied')
    NOT NULL DEFAULT 'none' AFTER expires_at,
  ADD COLUMN until_review BOOLEAN NOT NULL DEFAULT FALSE AFTER appeal_status;

INSERT INTO app_settings (setting_key, setting_value, scope, description, is_public) VALUES
  ('schema.required_version', CAST('"034"' AS JSON), 'global', 'Minimum schema_migrations.version this backend requires', FALSE),
  ('risk.platform', CAST('{"engine":"central","llmSoleAuthority":false}' AS JSON), 'global', 'Trust & Risk platform flags', FALSE)
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  description = VALUES(description);
