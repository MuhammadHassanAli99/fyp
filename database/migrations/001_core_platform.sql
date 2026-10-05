-- =============================================================================
-- 001  Core platform: migration tracking, reference data, localisation
-- MySQL 8.0+ / 9.x
-- =============================================================================

CREATE DATABASE IF NOT EXISTS marketplace
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE marketplace;

-- -----------------------------------------------------------------------------
-- Migration bookkeeping
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     VARCHAR(64)  NOT NULL,
  name        VARCHAR(255) NOT NULL,
  checksum    CHAR(64)     NULL,
  applied_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INT UNSIGNED NULL,
  PRIMARY KEY (version)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Client platforms
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platforms (
  id         TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(32)  NOT NULL,
  name       VARCHAR(64)  NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_platforms_code (code)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Currencies
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS currencies (
  code            CHAR(3)          NOT NULL,
  numeric_code    SMALLINT UNSIGNED NULL,
  name            VARCHAR(64)      NOT NULL,
  symbol          VARCHAR(8)       NOT NULL,
  symbol_position ENUM('prefix','suffix') NOT NULL DEFAULT 'prefix',
  decimal_digits  TINYINT UNSIGNED NOT NULL DEFAULT 2,
  thousands_sep   VARCHAR(2)       NOT NULL DEFAULT ',',
  decimal_sep     VARCHAR(2)       NOT NULL DEFAULT '.',
  is_active       BOOLEAN          NOT NULL DEFAULT TRUE,
  PRIMARY KEY (code)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Languages (incl. RTL support)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS languages (
  code        VARCHAR(10)  NOT NULL,           -- BCP-47: en, ar, ur, zh-Hans
  name        VARCHAR(64)  NOT NULL,
  native_name VARCHAR(64)  NOT NULL,
  direction   ENUM('ltr','rtl') NOT NULL DEFAULT 'ltr',
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Countries: currency, language, units, formats, tax, regulation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS countries (
  id                  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  iso2                CHAR(2)      NOT NULL,
  iso3                CHAR(3)      NOT NULL,
  name                VARCHAR(128) NOT NULL,
  native_name         VARCHAR(128) NULL,
  dial_code           VARCHAR(8)   NOT NULL,
  flag_emoji          VARCHAR(16)  NULL,
  default_currency    CHAR(3)      NOT NULL,
  default_language    VARCHAR(10)  NOT NULL,
  default_timezone    VARCHAR(64)  NOT NULL DEFAULT 'UTC',
  measurement_system  ENUM('metric','imperial') NOT NULL DEFAULT 'metric',
  area_unit           VARCHAR(16)  NOT NULL DEFAULT 'sqft',
  weight_unit         VARCHAR(16)  NOT NULL DEFAULT 'gram',
  distance_unit       VARCHAR(16)  NOT NULL DEFAULT 'km',
  gold_weight_unit    VARCHAR(16)  NOT NULL DEFAULT 'gram',   -- gram | tola | ounce
  address_format      JSON         NULL,                      -- ordered field list
  phone_format        VARCHAR(64)  NULL,                      -- e.g. "### #######"
  postal_code_regex   VARCHAR(128) NULL,
  date_format         VARCHAR(32)  NOT NULL DEFAULT 'dd/MM/yyyy',
  time_format         VARCHAR(16)  NOT NULL DEFAULT 'HH:mm',
  first_day_of_week   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  vat_rate            DECIMAL(6,3) NOT NULL DEFAULT 0.000,
  requires_kyc        BOOLEAN      NOT NULL DEFAULT FALSE,
  requires_aml        BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_countries_iso2 (iso2),
  UNIQUE KEY uk_countries_iso3 (iso3),
  KEY idx_countries_active (is_active, sort_order),
  CONSTRAINT fk_countries_currency FOREIGN KEY (default_currency)
    REFERENCES currencies (code) ON UPDATE CASCADE,
  CONSTRAINT fk_countries_language FOREIGN KEY (default_language)
    REFERENCES languages (code) ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS country_languages (
  country_id  SMALLINT UNSIGNED NOT NULL,
  language    VARCHAR(10)       NOT NULL,
  is_primary  BOOLEAN           NOT NULL DEFAULT FALSE,
  PRIMARY KEY (country_id, language),
  CONSTRAINT fk_country_languages_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_country_languages_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS country_currencies (
  country_id SMALLINT UNSIGNED NOT NULL,
  currency   CHAR(3)           NOT NULL,
  PRIMARY KEY (country_id, currency),
  CONSTRAINT fk_country_currencies_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_country_currencies_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Live FX rates + history
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_rates (
  base_currency  CHAR(3)        NOT NULL,
  quote_currency CHAR(3)        NOT NULL,
  rate           DECIMAL(20,10) NOT NULL,
  provider       VARCHAR(32)    NOT NULL DEFAULT 'manual',
  fetched_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (base_currency, quote_currency),
  KEY idx_exchange_rates_fetched (fetched_at),
  CONSTRAINT chk_exchange_rate_positive CHECK (rate > 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS exchange_rate_history (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  base_currency  CHAR(3)         NOT NULL,
  quote_currency CHAR(3)         NOT NULL,
  rate           DECIMAL(20,10)  NOT NULL,
  provider       VARCHAR(32)     NOT NULL,
  as_of_date     DATE            NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fx_history (base_currency, quote_currency, as_of_date, provider),
  KEY idx_fx_history_date (as_of_date)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Geography: regions (province/state) → cities → areas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS regions (
  id          INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  country_id  SMALLINT UNSIGNED NOT NULL,
  parent_id   INT UNSIGNED      NULL,
  code        VARCHAR(16)       NULL,
  name        VARCHAR(128)      NOT NULL,
  type        ENUM('province','state','region','territory','district','division') NOT NULL DEFAULT 'province',
  latitude    DECIMAL(10,7)     NULL,
  longitude   DECIMAL(10,7)     NULL,
  is_active   BOOLEAN           NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  KEY idx_regions_country (country_id, is_active),
  KEY idx_regions_parent (parent_id),
  CONSTRAINT fk_regions_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_regions_parent FOREIGN KEY (parent_id)
    REFERENCES regions (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS cities (
  id          INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  country_id  SMALLINT UNSIGNED NOT NULL,
  region_id   INT UNSIGNED      NULL,
  name        VARCHAR(128)      NOT NULL,
  slug        VARCHAR(160)      NOT NULL,
  latitude    DECIMAL(10,7)     NULL,
  longitude   DECIMAL(10,7)     NULL,
  population  INT UNSIGNED      NULL,
  timezone    VARCHAR(64)       NULL,
  is_popular  BOOLEAN           NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN           NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cities_country_slug (country_id, slug),
  KEY idx_cities_region (region_id),
  KEY idx_cities_popular (country_id, is_popular),
  KEY idx_cities_geo (latitude, longitude),
  CONSTRAINT fk_cities_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cities_region FOREIGN KEY (region_id)
    REFERENCES regions (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Neighbourhoods / societies / sectors — matters a lot for property search
CREATE TABLE IF NOT EXISTS areas (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  city_id    INT UNSIGNED  NOT NULL,
  parent_id  INT UNSIGNED  NULL,
  name       VARCHAR(160)  NOT NULL,
  slug       VARCHAR(180)  NOT NULL,
  latitude   DECIMAL(10,7) NULL,
  longitude  DECIMAL(10,7) NULL,
  is_active  BOOLEAN       NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_areas_city_slug (city_id, slug),
  KEY idx_areas_parent (parent_id),
  CONSTRAINT fk_areas_city FOREIGN KEY (city_id)
    REFERENCES cities (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_areas_parent FOREIGN KEY (parent_id)
    REFERENCES areas (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- UI translation catalogue (admin-manageable, per §22 Language Management)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS translations (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  language   VARCHAR(10)     NOT NULL,
  namespace  VARCHAR(64)     NOT NULL DEFAULT 'common',
  trans_key  VARCHAR(191)    NOT NULL,
  value      TEXT            NOT NULL,
  is_machine BOOLEAN         NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_translations (language, namespace, trans_key),
  CONSTRAINT fk_translations_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Measurement units + conversion (area, weight, distance)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS measurement_units (
  code           VARCHAR(24) NOT NULL,
  dimension      ENUM('area','weight','distance','volume') NOT NULL,
  name           VARCHAR(64) NOT NULL,
  symbol         VARCHAR(16) NOT NULL,
  to_base_factor DECIMAL(24,10) NOT NULL,   -- base: sqm | gram | metre | litre
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  PRIMARY KEY (code),
  KEY idx_units_dimension (dimension, is_active)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Country tax rules
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tax_rules (
  id           INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  country_id   SMALLINT UNSIGNED NOT NULL,
  region_id    INT UNSIGNED      NULL,
  code         VARCHAR(32)       NOT NULL,
  name         VARCHAR(128)      NOT NULL,
  kind         ENUM('vat','gst','sales_tax','service_tax','withholding','stamp_duty') NOT NULL,
  rate         DECIMAL(6,3)      NOT NULL,
  applies_to   ENUM('subscription','promotion','advertisement','commission','all') NOT NULL DEFAULT 'all',
  is_inclusive BOOLEAN           NOT NULL DEFAULT FALSE,
  effective_from DATE            NULL,
  effective_to   DATE            NULL,
  is_active    BOOLEAN           NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  KEY idx_tax_rules_country (country_id, is_active),
  CONSTRAINT fk_tax_rules_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Holiday calendars (§28)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS holidays (
  id          INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  country_id  SMALLINT UNSIGNED NOT NULL,
  name        VARCHAR(128)      NOT NULL,
  holiday_date DATE             NOT NULL,
  is_recurring BOOLEAN          NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_holidays (country_id, holiday_date, name),
  CONSTRAINT fk_holidays_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Legal documents, versioned per country/language (§28)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS legal_documents (
  id           INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  kind         ENUM('terms','privacy','cookies','refund','listing_policy','aml','dsa','eula') NOT NULL,
  country_id   SMALLINT UNSIGNED NULL,          -- NULL = global fallback
  language     VARCHAR(10)       NOT NULL,
  version      VARCHAR(24)       NOT NULL,
  title        VARCHAR(191)      NOT NULL,
  body         MEDIUMTEXT        NOT NULL,
  is_current   BOOLEAN           NOT NULL DEFAULT FALSE,
  published_at TIMESTAMP         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_legal_docs (kind, country_id, language, version),
  KEY idx_legal_docs_current (kind, is_current),
  CONSTRAINT fk_legal_docs_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Runtime configuration + feature flags
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key  VARCHAR(128) NOT NULL,
  setting_value JSON        NOT NULL,
  scope        VARCHAR(64)  NOT NULL DEFAULT 'global',
  description  VARCHAR(255) NULL,
  is_public    BOOLEAN      NOT NULL DEFAULT FALSE,  -- exposed to clients via /bootstrap
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key, scope)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS feature_flags (
  code             VARCHAR(96) NOT NULL,
  description      VARCHAR(255) NULL,
  is_enabled       BOOLEAN     NOT NULL DEFAULT FALSE,
  rollout_percent  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  target_countries JSON        NULL,
  target_platforms JSON        NULL,
  min_app_version  VARCHAR(24) NULL,
  updated_at       TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (code)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Transactional outbox — guarantees domain events survive a crash (§3.2)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS outbox_events (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id      CHAR(36)        NOT NULL,
  event_name    VARCHAR(96)     NOT NULL,
  aggregate_type VARCHAR(64)    NOT NULL,
  aggregate_id  VARCHAR(64)     NOT NULL,
  payload       JSON            NOT NULL,
  status        ENUM('pending','processing','done','failed') NOT NULL DEFAULT 'pending',
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error    TEXT            NULL,
  available_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at  TIMESTAMP       NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_outbox_event_id (event_id),
  KEY idx_outbox_dispatch (status, available_at),
  KEY idx_outbox_aggregate (aggregate_type, aggregate_id)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Background job registry + run log (§22 System Health)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  code           VARCHAR(96) NOT NULL,
  name           VARCHAR(160) NOT NULL,
  cron           VARCHAR(64) NOT NULL,
  is_enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  last_run_at    TIMESTAMP   NULL,
  last_status    ENUM('success','failed','running','skipped') NULL,
  last_duration_ms INT UNSIGNED NULL,
  next_run_at    TIMESTAMP   NULL,
  PRIMARY KEY (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS job_runs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_code    VARCHAR(96)     NOT NULL,
  status      ENUM('running','success','failed') NOT NULL,
  started_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP       NULL,
  duration_ms INT UNSIGNED    NULL,
  processed   INT UNSIGNED    NOT NULL DEFAULT 0,
  error       TEXT            NULL,
  PRIMARY KEY (id),
  KEY idx_job_runs_job (job_code, started_at)
) ENGINE = InnoDB;

-- Core reference rows must exist in the migration chain (not only in seeds)
-- so later marketplace migrations can satisfy language/currency FKs from zero.
INSERT INTO currencies (code, numeric_code, name, symbol, symbol_position, decimal_digits, thousands_sep, decimal_sep, is_active) VALUES
  ('USD', 840, 'US Dollar',       '$',  'prefix', 2, ',', '.', TRUE),
  ('EUR', 978, 'Euro',            '€',  'prefix', 2, '.', ',', TRUE),
  ('GBP', 826, 'British Pound',   '£',  'prefix', 2, ',', '.', TRUE),
  ('PKR', 586, 'Pakistani Rupee', '₨',  'prefix', 2, ',', '.', TRUE)
ON DUPLICATE KEY UPDATE
  numeric_code = VALUES(numeric_code), name = VALUES(name), symbol = VALUES(symbol),
  is_active = VALUES(is_active);

INSERT INTO languages (code, name, native_name, direction, is_active, is_default, sort_order) VALUES
  ('en', 'English', 'English',  'ltr', TRUE, TRUE,  1),
  ('ar', 'Arabic',  'العربية',   'rtl', TRUE, FALSE, 2),
  ('ur', 'Urdu',    'اردو',      'rtl', TRUE, FALSE, 3)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), native_name = VALUES(native_name), direction = VALUES(direction),
  is_active = VALUES(is_active), is_default = VALUES(is_default), sort_order = VALUES(sort_order);

INSERT INTO platforms (id, code, name, is_active) VALUES
  (1, 'web',     'Web',     TRUE),
  (2, 'android', 'Android', TRUE),
  (3, 'ios',     'iOS',     TRUE),
  (4, 'windows', 'Windows', TRUE),
  (5, 'macos',   'macOS',   TRUE),
  (6, 'linux',   'Linux',   TRUE)
ON DUPLICATE KEY UPDATE
  code = VALUES(code), name = VALUES(name), is_active = VALUES(is_active);
