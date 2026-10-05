-- =============================================================================
-- 006  Gold marketplace (§5)
--      Specifications, live rates, purity, making charges, price prediction,
--      fake-gold detection support.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Hot-path gold specifications (§5 Specifications)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_listing_details (
  listing_id          BIGINT UNSIGNED NOT NULL,

  -- Purity (§5 Purity / Karat)
  karat               DECIMAL(5,2)    NULL,        -- 24, 22, 21, 18, 14, 10, 9
  fineness            SMALLINT UNSIGNED NULL,      -- millesimal: 999, 916, 875, 750
  purity_percent      DECIMAL(6,3)    NULL,
  metal_type          ENUM('gold','white_gold','rose_gold','silver','platinum','palladium','mixed')
                        NOT NULL DEFAULT 'gold',

  -- Weight (§5 Weight)
  gross_weight_g      DECIMAL(12,3)   NULL,
  net_weight_g        DECIMAL(12,3)   NULL,        -- pure metal content
  stone_weight_g      DECIMAL(12,3)   NULL,
  weight_unit         VARCHAR(16)     NOT NULL DEFAULT 'gram',   -- display unit: gram|tola|ounce
  weight_display      DECIMAL(12,3)   NULL,        -- weight expressed in weight_unit
  quantity            INT UNSIGNED    NOT NULL DEFAULT 1,
  piece_count         INT UNSIGNED    NULL,

  -- Brand & certification (§5 Brand / Certificate / Hallmark)
  brand_id            INT UNSIGNED    NULL,
  brand_name          VARCHAR(128)    NULL,
  is_hallmarked       BOOLEAN         NOT NULL DEFAULT FALSE,
  hallmark_authority  VARCHAR(128)    NULL,
  hallmark_code       VARCHAR(64)      NULL,
  has_certificate     BOOLEAN         NOT NULL DEFAULT FALSE,
  certificate_number  VARCHAR(96)     NULL,
  certificate_authority ENUM('bis','pgji','sgl','igi','gia','hallmark_uk','assay_office',
                             'lbma','local_shop','other') NULL,
  certificate_url     VARCHAR(512)    NULL,
  assay_report_url    VARCHAR(512)    NULL,

  -- Pricing model (§5 Making Charges)
  rate_per_gram       DECIMAL(18,4)   NULL,        -- metal rate used at listing time
  rate_currency       CHAR(3)         NULL,
  metal_value         DECIMAL(18,2)   NULL,        -- net_weight × rate
  making_charges      DECIMAL(18,2)   NULL,
  making_charge_type  ENUM('flat','per_gram','percent') NULL,
  wastage_percent     DECIMAL(6,3)    NULL,
  stone_charges       DECIMAL(18,2)   NULL,
  other_charges       DECIMAL(18,2)   NULL,
  tax_amount          DECIMAL(18,2)   NULL,
  buyback_percent     DECIMAL(6,3)    NULL,        -- what the shop offers on return

  -- Form factor
  form                ENUM('bar','coin','biscuit','jewellery','ornament','scrap','nugget','dust','other')
                        NOT NULL DEFAULT 'jewellery',
  jewellery_type      ENUM('ring','bangle','bracelet','necklace','earring','pendant','chain',
                           'anklet','nosepin','tikka','set','watch','other') NULL,
  gender_target       ENUM('women','men','unisex','kids') NULL,
  size_label          VARCHAR(48)     NULL,        -- ring size, chain length
  design_style        VARCHAR(96)     NULL,
  gemstones           JSON            NULL,        -- [{"type":"diamond","carat":0.5,"count":4}]
  has_gemstones       BOOLEAN         NOT NULL DEFAULT FALSE,

  -- Investment / antique flags (§5 Antique Gold / Investment Gold / Scrap Gold)
  is_investment_grade BOOLEAN         NOT NULL DEFAULT FALSE,
  is_antique          BOOLEAN         NOT NULL DEFAULT FALSE,
  antique_period      VARCHAR(96)     NULL,
  is_scrap            BOOLEAN         NOT NULL DEFAULT FALSE,
  year_of_manufacture SMALLINT UNSIGNED NULL,
  origin_country_id   SMALLINT UNSIGNED NULL,

  -- Trade terms
  exchange_accepted   BOOLEAN         NOT NULL DEFAULT FALSE,
  buyback_available   BOOLEAN         NOT NULL DEFAULT FALSE,
  delivery_available  BOOLEAN         NOT NULL DEFAULT FALSE,
  insured_shipping    BOOLEAN         NOT NULL DEFAULT FALSE,
  inspection_allowed  BOOLEAN         NOT NULL DEFAULT TRUE,
  escrow_available    BOOLEAN         NOT NULL DEFAULT FALSE,

  -- AI (§5 Fake gold detection support / Price prediction)
  authenticity_score  DECIMAL(5,2)    NULL,        -- 0..100 confidence it is genuine
  authenticity_checks JSON            NULL,        -- {"hallmarkOcr":true,"densityPlausible":true,...}
  authenticity_verdict ENUM('unverified','likely_genuine','inconclusive','suspicious') NULL,
  ai_fair_price_low   DECIMAL(18,2)   NULL,
  ai_fair_price_high  DECIMAL(18,2)   NULL,
  price_vs_market_pct DECIMAL(8,3)    NULL,        -- negative = below market

  PRIMARY KEY (listing_id),
  KEY idx_gold_karat (karat, net_weight_g),
  KEY idx_gold_form (form, karat),
  KEY idx_gold_weight (net_weight_g),
  KEY idx_gold_brand (brand_id),
  KEY idx_gold_investment (is_investment_grade, karat),
  KEY idx_gold_authenticity (authenticity_verdict, authenticity_score),
  CONSTRAINT fk_gold_details_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_gold_details_brand FOREIGN KEY (brand_id)
    REFERENCES brands (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_gold_karat CHECK (karat IS NULL OR (karat > 0 AND karat <= 24))
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Live gold rates per country/currency/karat (§5 Live gold rates)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_rates (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  country_id     SMALLINT UNSIGNED NULL,          -- NULL = international spot
  city_id        INT UNSIGNED      NULL,          -- local market rate where it differs
  currency       CHAR(3)           NOT NULL,
  metal          ENUM('gold','silver','platinum','palladium') NOT NULL DEFAULT 'gold',
  karat          DECIMAL(5,2)      NOT NULL,
  rate_per_gram  DECIMAL(18,4)     NOT NULL,
  rate_per_tola  DECIMAL(18,4)     NULL,
  rate_per_ounce DECIMAL(18,4)     NULL,
  rate_per_10g   DECIMAL(18,4)     NULL,
  buy_rate       DECIMAL(18,4)     NULL,
  sell_rate      DECIMAL(18,4)     NULL,
  change_amount  DECIMAL(18,4)     NULL,
  change_percent DECIMAL(8,3)      NULL,
  source         VARCHAR(48)       NOT NULL DEFAULT 'manual',
  as_of          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_rates_current (country_id, city_id, currency, metal, karat),
  KEY idx_gold_rates_lookup (country_id, metal, karat, as_of),
  CONSTRAINT fk_gold_rates_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_gold_rates_city FOREIGN KEY (city_id)
    REFERENCES cities (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_gold_rate_positive CHECK (rate_per_gram > 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS gold_rate_history (
  id            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  country_id    SMALLINT UNSIGNED NULL,
  currency      CHAR(3)           NOT NULL,
  metal         ENUM('gold','silver','platinum','palladium') NOT NULL DEFAULT 'gold',
  karat         DECIMAL(5,2)      NOT NULL,
  rate_per_gram DECIMAL(18,4)     NOT NULL,
  open_rate     DECIMAL(18,4)     NULL,
  high_rate     DECIMAL(18,4)     NULL,
  low_rate      DECIMAL(18,4)     NULL,
  close_rate    DECIMAL(18,4)     NULL,
  source        VARCHAR(48)       NOT NULL,
  as_of_date    DATE              NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_rate_history (country_id, currency, metal, karat, as_of_date),
  KEY idx_gold_rate_history_date (as_of_date)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Gold trend prediction (§5 Price prediction, §18 Gold Trend Prediction)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_price_predictions (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  country_id     SMALLINT UNSIGNED NULL,
  currency       CHAR(3)           NOT NULL,
  karat          DECIMAL(5,2)      NOT NULL,
  horizon        ENUM('1d','7d','30d','90d','180d','1y') NOT NULL,
  predicted_rate DECIMAL(18,4)     NOT NULL,
  lower_bound    DECIMAL(18,4)     NULL,
  upper_bound    DECIMAL(18,4)     NULL,
  confidence     DECIMAL(5,2)      NULL,
  direction      ENUM('up','down','flat')  NULL,
  drivers        JSON              NULL,          -- explanatory factors for the UI
  model          VARCHAR(64)       NOT NULL,
  generated_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  target_date    DATE              NOT NULL,
  actual_rate    DECIMAL(18,4)     NULL,          -- back-filled for accuracy tracking
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_prediction (country_id, currency, karat, horizon, target_date, model),
  KEY idx_gold_prediction_lookup (country_id, karat, horizon, generated_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Gold purity reference table (karat ⇄ fineness ⇄ percent), used for validation
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_purity_standards (
  karat          DECIMAL(5,2)      NOT NULL,
  fineness       SMALLINT UNSIGNED NOT NULL,
  purity_percent DECIMAL(6,3)      NOT NULL,
  label          VARCHAR(48)       NOT NULL,
  common_regions JSON              NULL,
  sort_order     TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  PRIMARY KEY (karat)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Fake-gold detection runs (§5 Fake gold detection support)
-- Stores each analysis attempt so results are auditable and disputable.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gold_authenticity_checks (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          CHAR(36)        NOT NULL,
  listing_id    BIGINT UNSIGNED NULL,
  user_id       BIGINT UNSIGNED NULL,
  method        ENUM('hallmark_ocr','image_analysis','density','magnet_test','acid_test',
                     'xrf_report','certificate_lookup','seller_history','composite') NOT NULL,
  input_media_id BIGINT UNSIGNED NULL,
  declared_karat DECIMAL(5,2)   NULL,
  declared_weight_g DECIMAL(12,3) NULL,
  measured_value DECIMAL(18,4)  NULL,
  score         DECIMAL(5,2)    NULL,
  verdict       ENUM('likely_genuine','inconclusive','suspicious','fake') NULL,
  signals       JSON            NULL,
  model         VARCHAR(64)     NULL,
  notes         VARCHAR(500)    NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_gold_auth_uuid (uuid),
  KEY idx_gold_auth_listing (listing_id, created_at),
  KEY idx_gold_auth_verdict (verdict, score),
  CONSTRAINT fk_gold_auth_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
