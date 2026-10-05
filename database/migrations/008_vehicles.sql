-- =============================================================================
-- 008  Vehicle marketplace (§7)
--      Cars, bikes, buses, trucks, vans, taxi, rickshaw, heavy machinery,
--      agriculture equipment, boats, yachts, jet ski.
--      Includes the make/model/variant catalogue that powers comparison (§1-2 of spec).
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Make → Model → Variant catalogue
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_makes (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(96)  NOT NULL,
  slug        VARCHAR(120) NOT NULL,
  logo_url    VARCHAR(512) NULL,
  country_id  SMALLINT UNSIGNED NULL,
  vehicle_types JSON       NULL,        -- ["car","motorcycle","truck"]
  is_popular  BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_makes_slug (slug),
  KEY idx_vehicle_makes_popular (is_popular, sort_order)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_models (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  make_id       INT UNSIGNED NOT NULL,
  name          VARCHAR(128) NOT NULL,
  slug          VARCHAR(160) NOT NULL,
  vehicle_type  ENUM('car','motorcycle','bus','truck','van','taxi','rickshaw','tractor',
                     'heavy_machinery','construction_equipment','agriculture_equipment',
                     'boat','yacht','jet_ski','atv','trailer','other') NOT NULL DEFAULT 'car',
  body_type     ENUM('sedan','hatchback','suv','crossover','coupe','convertible','wagon',
                     'pickup','minivan','micro','mpv','roadster','limousine','other') NULL,
  segment       VARCHAR(48)  NULL,
  production_start SMALLINT UNSIGNED NULL,
  production_end   SMALLINT UNSIGNED NULL,
  is_popular    BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_models_slug (make_id, slug),
  KEY idx_vehicle_models_make (make_id, is_active),
  KEY idx_vehicle_models_type (vehicle_type, is_popular),
  CONSTRAINT fk_vehicle_models_make FOREIGN KEY (make_id)
    REFERENCES vehicle_makes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Variants carry the reference spec sheet used by the comparison feature
CREATE TABLE IF NOT EXISTS vehicle_variants (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  model_id       INT UNSIGNED NOT NULL,
  name           VARCHAR(160) NOT NULL,
  slug           VARCHAR(180) NOT NULL,
  year_from      SMALLINT UNSIGNED NULL,
  year_to        SMALLINT UNSIGNED NULL,
  engine_cc      SMALLINT UNSIGNED NULL,
  engine_type    VARCHAR(64)  NULL,
  cylinders      TINYINT UNSIGNED NULL,
  power_hp       SMALLINT UNSIGNED NULL,
  torque_nm      SMALLINT UNSIGNED NULL,
  fuel_type      ENUM('petrol','diesel','hybrid','plugin_hybrid','electric','cng','lpg','hydrogen','other') NULL,
  transmission   ENUM('manual','automatic','cvt','amt','dct','semi_automatic') NULL,
  drivetrain     ENUM('fwd','rwd','awd','4wd') NULL,
  seats          TINYINT UNSIGNED NULL,
  doors          TINYINT UNSIGNED NULL,
  mileage_city   DECIMAL(8,2) NULL,          -- km/l or km/kWh
  mileage_highway DECIMAL(8,2) NULL,
  fuel_tank_l    DECIMAL(8,2) NULL,
  battery_kwh    DECIMAL(8,2) NULL,
  range_km       SMALLINT UNSIGNED NULL,
  top_speed_kmh  SMALLINT UNSIGNED NULL,
  acceleration_0_100 DECIMAL(6,2) NULL,
  length_mm      SMALLINT UNSIGNED NULL,
  width_mm       SMALLINT UNSIGNED NULL,
  height_mm      SMALLINT UNSIGNED NULL,
  wheelbase_mm   SMALLINT UNSIGNED NULL,
  ground_clearance_mm SMALLINT UNSIGNED NULL,
  kerb_weight_kg SMALLINT UNSIGNED NULL,
  boot_space_l   SMALLINT UNSIGNED NULL,
  payload_kg     INT UNSIGNED NULL,          -- trucks / commercial
  towing_kg      INT UNSIGNED NULL,
  airbags        TINYINT UNSIGNED NULL,
  safety_rating  DECIMAL(3,1) NULL,
  -- Reference launch price, used as the depreciation baseline
  launch_price   DECIMAL(18,2) NULL,
  launch_currency CHAR(3)      NULL,
  spec_sheet     JSON         NULL,          -- everything else, comparable as key/value
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_variants_slug (model_id, slug),
  KEY idx_vehicle_variants_model (model_id, year_from),
  CONSTRAINT fk_vehicle_variants_model FOREIGN KEY (model_id)
    REFERENCES vehicle_models (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Hot-path vehicle specifications (§7 Specifications)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_listing_details (
  listing_id       BIGINT UNSIGNED NOT NULL,

  vehicle_type     ENUM('car','motorcycle','bus','truck','van','taxi','rickshaw','tractor',
                        'heavy_machinery','construction_equipment','agriculture_equipment',
                        'boat','yacht','jet_ski','atv','trailer','other') NOT NULL,

  -- Identity (§7 Make / Model / Year)
  make_id          INT UNSIGNED    NULL,
  model_id         INT UNSIGNED    NULL,
  variant_id       INT UNSIGNED    NULL,
  make_name        VARCHAR(96)     NULL,      -- denormalised for display/search
  model_name       VARCHAR(128)    NULL,
  variant_name     VARCHAR(160)    NULL,
  year             SMALLINT UNSIGNED NULL,
  generation       VARCHAR(64)     NULL,

  -- Usage (§7 Mileage)
  mileage          INT UNSIGNED    NULL,
  mileage_unit     ENUM('km','mi','hours') NOT NULL DEFAULT 'km',
  mileage_km       INT UNSIGNED    NULL,      -- canonical for filtering
  engine_hours     INT UNSIGNED    NULL,      -- heavy machinery / boats

  -- Engine (§7 Engine / Fuel / Transmission)
  engine_cc        SMALLINT UNSIGNED NULL,
  engine_type      VARCHAR(64)     NULL,
  power_hp         SMALLINT UNSIGNED NULL,
  torque_nm        SMALLINT UNSIGNED NULL,
  cylinders        TINYINT UNSIGNED NULL,
  fuel_type        ENUM('petrol','diesel','hybrid','plugin_hybrid','electric','cng','lpg',
                        'hydrogen','other') NULL,
  transmission     ENUM('manual','automatic','cvt','amt','dct','semi_automatic') NULL,
  drivetrain       ENUM('fwd','rwd','awd','4wd') NULL,
  battery_kwh      DECIMAL(8,2)    NULL,
  range_km         SMALLINT UNSIGNED NULL,
  battery_health_pct DECIMAL(5,2)  NULL,

  -- Body (§7 Color)
  body_type        ENUM('sedan','hatchback','suv','crossover','coupe','convertible','wagon',
                        'pickup','minivan','micro','mpv','roadster','limousine','other') NULL,
  color_exterior   VARCHAR(48)     NULL,
  color_interior   VARCHAR(48)     NULL,
  color_family     VARCHAR(32)     NULL,      -- normalised bucket for the colour filter
  doors            TINYINT UNSIGNED NULL,
  seats            TINYINT UNSIGNED NULL,
  axles            TINYINT UNSIGNED NULL,
  wheels           TINYINT UNSIGNED NULL,
  length_ft        DECIMAL(8,2)    NULL,      -- boats / yachts
  capacity_tons    DECIMAL(10,2)   NULL,      -- trucks
  passenger_capacity SMALLINT UNSIGNED NULL,  -- buses

  -- Identifiers (§7 VIN / Registration)
  vin              VARCHAR(32)     NULL,
  chassis_number   VARCHAR(48)     NULL,
  engine_number    VARCHAR(48)     NULL,
  registration_number VARCHAR(32)  NULL,
  registration_city_id INT UNSIGNED NULL,
  registration_year SMALLINT UNSIGNED NULL,
  registration_status ENUM('registered','unregistered','applied','transferred','on_papers') NULL,
  is_imported      BOOLEAN         NOT NULL DEFAULT FALSE,
  import_year      SMALLINT UNSIGNED NULL,
  assembly         ENUM('local','imported','ckd','cbu') NULL,
  hand_drive       ENUM('left','right') NULL,

  -- Condition & history
  condition_grade  ENUM('excellent','very_good','good','fair','poor','salvage') NULL,
  owners_count     TINYINT UNSIGNED NULL,
  accident_history ENUM('none','minor','major','unknown') NULL,
  accident_details VARCHAR(500)    NULL,
  service_history  ENUM('full','partial','none','unknown') NULL,
  last_service_km  INT UNSIGNED    NULL,
  last_service_at  DATE            NULL,
  tyre_condition   ENUM('new','good','average','needs_replacement') NULL,
  has_modifications BOOLEAN        NOT NULL DEFAULT FALSE,
  modification_details VARCHAR(500) NULL,

  -- Inspection (a big trust signal in vehicle marketplaces)
  is_inspected     BOOLEAN         NOT NULL DEFAULT FALSE,
  inspection_score DECIMAL(5,2)    NULL,
  inspection_grade VARCHAR(16)     NULL,
  inspection_report_url VARCHAR(512) NULL,
  inspected_at     TIMESTAMP       NULL,
  inspected_by     VARCHAR(160)    NULL,

  -- Commercial terms
  insurance_status ENUM('valid','expired','none') NULL,
  insurance_expiry DATE            NULL,
  tax_paid_until   DATE            NULL,
  has_warranty     BOOLEAN         NOT NULL DEFAULT FALSE,
  warranty_until   DATE            NULL,
  warranty_km      INT UNSIGNED    NULL,
  exchange_accepted BOOLEAN        NOT NULL DEFAULT FALSE,
  finance_available BOOLEAN        NOT NULL DEFAULT FALSE,
  down_payment     DECIMAL(18,2)   NULL,
  monthly_installment DECIMAL(18,2) NULL,
  installment_months SMALLINT UNSIGNED NULL,

  -- Rental terms (§7 Rent)
  rent_period      ENUM('hourly','daily','weekly','monthly','yearly','per_trip') NULL,
  with_driver      BOOLEAN         NOT NULL DEFAULT FALSE,
  driver_optional  BOOLEAN         NOT NULL DEFAULT FALSE,
  fuel_policy      ENUM('included','excluded','full_to_full','prepaid') NULL,
  km_limit_per_day INT UNSIGNED    NULL,
  extra_km_rate    DECIMAL(12,2)   NULL,
  security_deposit DECIMAL(18,2)   NULL,
  min_rental_period SMALLINT UNSIGNED NULL,
  min_driver_age   TINYINT UNSIGNED NULL,
  license_required BOOLEAN         NOT NULL DEFAULT TRUE,

  -- AI (§18 Vehicle Price Estimation)
  ai_estimate_low  DECIMAL(18,2)   NULL,
  ai_estimate_mid  DECIMAL(18,2)   NULL,
  ai_estimate_high DECIMAL(18,2)   NULL,
  ai_estimate_at   TIMESTAMP       NULL,
  price_vs_market_pct DECIMAL(8,3) NULL,
  depreciation_pct DECIMAL(8,3)    NULL,
  deal_rating      ENUM('great','good','fair','high','overpriced') NULL,

  PRIMARY KEY (listing_id),
  KEY idx_vehicle_make_model (make_id, model_id, year),
  KEY idx_vehicle_type_year (vehicle_type, year),
  KEY idx_vehicle_mileage (mileage_km),
  KEY idx_vehicle_engine (engine_cc),
  KEY idx_vehicle_fuel_trans (fuel_type, transmission),
  KEY idx_vehicle_variant (variant_id),
  KEY idx_vehicle_color (color_family),
  KEY idx_vehicle_registration (registration_number),
  KEY idx_vehicle_vin (vin),
  KEY idx_vehicle_deal (deal_rating, price_vs_market_pct),
  CONSTRAINT fk_vehicle_details_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vehicle_details_make FOREIGN KEY (make_id)
    REFERENCES vehicle_makes (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_vehicle_details_model FOREIGN KEY (model_id)
    REFERENCES vehicle_models (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_vehicle_details_variant FOREIGN KEY (variant_id)
    REFERENCES vehicle_variants (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_vehicle_year CHECK (year IS NULL OR (year >= 1900 AND year <= 2100))
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Feature catalogue + per-listing selection
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_features (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(64)  NOT NULL,
  name       VARCHAR(128) NOT NULL,
  icon       VARCHAR(64)  NULL,
  group_code ENUM('safety','comfort','entertainment','exterior','interior','technology',
                  'assistance','commercial','marine') NOT NULL DEFAULT 'comfort',
  applies_to JSON         NULL,
  is_filterable BOOLEAN   NOT NULL DEFAULT TRUE,
  is_comparable BOOLEAN   NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_features_code (code),
  KEY idx_vehicle_features_group (group_code, sort_order)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_listing_features (
  listing_id BIGINT UNSIGNED NOT NULL,
  feature_id INT UNSIGNED    NOT NULL,
  PRIMARY KEY (listing_id, feature_id),
  KEY idx_vlf_feature (feature_id),
  CONSTRAINT fk_vlf_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vlf_feature FOREIGN KEY (feature_id)
    REFERENCES vehicle_features (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Inspection checklist detail (per-point scores)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_inspections (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          CHAR(36)        NOT NULL,
  listing_id    BIGINT UNSIGNED NOT NULL,
  inspector_id  BIGINT UNSIGNED NULL,
  inspector_name VARCHAR(160)   NULL,
  overall_score DECIMAL(5,2)    NULL,
  grade         VARCHAR(16)      NULL,
  engine_score       DECIMAL(5,2) NULL,
  transmission_score DECIMAL(5,2) NULL,
  suspension_score   DECIMAL(5,2) NULL,
  brakes_score       DECIMAL(5,2) NULL,
  electrical_score   DECIMAL(5,2) NULL,
  interior_score     DECIMAL(5,2) NULL,
  exterior_score     DECIMAL(5,2) NULL,
  ac_score           DECIMAL(5,2) NULL,
  tyres_score        DECIMAL(5,2) NULL,
  checklist     JSON            NULL,
  findings      JSON            NULL,
  report_url    VARCHAR(512)    NULL,
  inspected_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_inspection_uuid (uuid),
  KEY idx_vehicle_inspection_listing (listing_id, inspected_at),
  CONSTRAINT fk_vehicle_inspection_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Market price reference per make/model/year (drives price estimation + deal rating)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_price_index (
  id            BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  country_id    SMALLINT UNSIGNED NOT NULL,
  city_id       INT UNSIGNED      NULL,
  make_id       INT UNSIGNED      NOT NULL,
  model_id      INT UNSIGNED      NULL,
  variant_id    INT UNSIGNED      NULL,
  year          SMALLINT UNSIGNED NULL,
  currency      CHAR(3)           NOT NULL,
  avg_price     DECIMAL(18,2)     NULL,
  median_price  DECIMAL(18,2)     NULL,
  p25_price     DECIMAL(18,2)     NULL,
  p75_price     DECIMAL(18,2)     NULL,
  avg_mileage_km INT UNSIGNED     NULL,
  sample_size   INT UNSIGNED      NOT NULL DEFAULT 0,
  mom_change_pct DECIMAL(8,3)     NULL,
  yoy_change_pct DECIMAL(8,3)     NULL,
  avg_days_to_sell SMALLINT UNSIGNED NULL,
  period_start  DATE              NOT NULL,
  period_end    DATE              NOT NULL,
  computed_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_index (country_id, city_id, make_id, model_id, variant_id, year, currency, period_start),
  KEY idx_vehicle_index_lookup (make_id, model_id, year, period_end),
  CONSTRAINT fk_vehicle_index_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vehicle_index_make FOREIGN KEY (make_id)
    REFERENCES vehicle_makes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_price_estimates (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid         CHAR(36)        NOT NULL,
  listing_id   BIGINT UNSIGNED NULL,
  requested_by BIGINT UNSIGNED NULL,
  inputs       JSON            NOT NULL,
  currency     CHAR(3)         NOT NULL,
  value_low    DECIMAL(18,2)   NOT NULL,
  value_mid    DECIMAL(18,2)   NOT NULL,
  value_high   DECIMAL(18,2)   NOT NULL,
  confidence   DECIMAL(5,2)    NULL,
  method       ENUM('index','depreciation','comparable','ml','manual') NOT NULL DEFAULT 'index',
  comparables  JSON            NULL,
  explanation  TEXT            NULL,
  model        VARCHAR(64)     NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_estimate_uuid (uuid),
  KEY idx_vehicle_estimate_listing (listing_id, created_at),
  CONSTRAINT fk_vehicle_estimate_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
