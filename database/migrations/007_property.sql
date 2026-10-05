-- =============================================================================
-- 007  Property marketplace (§6)
--      Residential / Commercial / Rental / Land, features, documents, valuation.
-- =============================================================================

USE marketplace;

CREATE TABLE IF NOT EXISTS property_listing_details (
  listing_id           BIGINT UNSIGNED NOT NULL,

  property_kind        ENUM('house','apartment','flat','villa','farm_house','penthouse','studio',
                            'townhouse','office','shop','warehouse','factory','building',
                            'plaza','room','hotel','guest_house','hostel','residential_plot',
                            'commercial_plot','agricultural_land','industrial_land','other')
                         NOT NULL,
  usage_type           ENUM('residential','commercial','rental','land','industrial','mixed') NOT NULL,

  -- Rooms (§6 Property Features)
  bedrooms             TINYINT UNSIGNED NULL,
  bathrooms            TINYINT UNSIGNED NULL,
  kitchens             TINYINT UNSIGNED NULL,
  drawing_rooms        TINYINT UNSIGNED NULL,
  dining_rooms         TINYINT UNSIGNED NULL,
  servant_quarters     TINYINT UNSIGNED NULL,
  store_rooms          TINYINT UNSIGNED NULL,
  total_rooms          TINYINT UNSIGNED NULL,

  -- Floors
  floors               TINYINT UNSIGNED NULL,       -- floors in the unit/house
  floor_number         SMALLINT         NULL,       -- which floor the unit is on
  total_floors         TINYINT UNSIGNED NULL,       -- floors in the building
  basements            TINYINT UNSIGNED NULL,

  -- Area (§6 Area) — stored in the seller's unit AND normalised to m² for comparison
  area_value           DECIMAL(14,3)   NULL,
  area_unit            VARCHAR(24)     NULL,        -- sqft | sqm | marla | kanal | acre | hectare | bigha | cent
  area_sqm             DECIMAL(14,3)   NULL,        -- canonical, used by filters/compare
  covered_area_value   DECIMAL(14,3)   NULL,
  covered_area_unit    VARCHAR(24)     NULL,
  covered_area_sqm     DECIMAL(14,3)   NULL,
  plot_dimensions      VARCHAR(64)     NULL,        -- "30 x 60"
  frontage_ft          DECIMAL(10,2)   NULL,
  depth_ft             DECIMAL(10,2)   NULL,
  price_per_sqm        DECIMAL(18,4)   NULL,        -- derived, powers "per unit area" sorting

  -- Parking / outdoor (§6)
  parking_spaces       TINYINT UNSIGNED NULL,
  has_garage           BOOLEAN         NOT NULL DEFAULT FALSE,
  has_garden           BOOLEAN         NOT NULL DEFAULT FALSE,
  garden_area_sqm      DECIMAL(12,3)   NULL,
  balconies            TINYINT UNSIGNED NULL,
  has_terrace          BOOLEAN         NOT NULL DEFAULT FALSE,
  has_lawn             BOOLEAN         NOT NULL DEFAULT FALSE,

  -- Amenities called out in the spec
  has_swimming_pool    BOOLEAN         NOT NULL DEFAULT FALSE,
  has_gym              BOOLEAN         NOT NULL DEFAULT FALSE,
  has_elevator         BOOLEAN         NOT NULL DEFAULT FALSE,
  has_security         BOOLEAN         NOT NULL DEFAULT FALSE,
  has_cctv             BOOLEAN         NOT NULL DEFAULT FALSE,
  has_backup_power     BOOLEAN         NOT NULL DEFAULT FALSE,
  has_central_heating  BOOLEAN         NOT NULL DEFAULT FALSE,
  has_central_cooling  BOOLEAN         NOT NULL DEFAULT FALSE,
  is_gated_community   BOOLEAN         NOT NULL DEFAULT FALSE,
  is_corner            BOOLEAN         NOT NULL DEFAULT FALSE,
  is_park_facing       BOOLEAN         NOT NULL DEFAULT FALSE,
  wheelchair_accessible BOOLEAN        NOT NULL DEFAULT FALSE,

  -- Furnishing (§6 Furnished)
  furnishing           ENUM('unfurnished','semi_furnished','furnished','fully_furnished') NULL,
  furnishing_details   JSON            NULL,

  -- Building
  year_built           SMALLINT UNSIGNED NULL,
  age_years            TINYINT UNSIGNED NULL,
  construction_status  ENUM('ready','under_construction','off_plan','grey_structure','renovated') NULL,
  facing               ENUM('north','south','east','west','north_east','north_west',
                            'south_east','south_west') NULL,
  road_width_ft        DECIMAL(8,2)    NULL,
  building_name        VARCHAR(160)    NULL,
  unit_number          VARCHAR(48)     NULL,
  plot_number          VARCHAR(48)     NULL,
  block_sector         VARCHAR(96)     NULL,
  phase                VARCHAR(96)     NULL,
  society_name         VARCHAR(160)    NULL,

  -- Ownership & legal (§6 Documents)
  ownership_type       ENUM('freehold','leasehold','power_of_attorney','allotment','shared','other') NULL,
  possession_status    ENUM('vacant','occupied','tenanted','immediate','on_transfer') NULL,
  possession_date      DATE            NULL,
  is_approved          BOOLEAN         NOT NULL DEFAULT FALSE,
  approval_authority   VARCHAR(160)    NULL,
  has_ownership_papers BOOLEAN         NOT NULL DEFAULT FALSE,
  has_map              BOOLEAN         NOT NULL DEFAULT FALSE,
  has_noc              BOOLEAN         NOT NULL DEFAULT FALSE,
  is_disputed          BOOLEAN         NOT NULL DEFAULT FALSE,

  -- Rental terms (§6 Rent, §6 Rental categories)
  rent_period          ENUM('monthly','weekly','daily','nightly','yearly','per_semester') NULL,
  security_deposit     DECIMAL(18,2)   NULL,
  advance_months       TINYINT UNSIGNED NULL,
  maintenance_charges  DECIMAL(18,2)   NULL,
  maintenance_period   ENUM('monthly','quarterly','yearly') NULL,
  utilities_included   BOOLEAN         NOT NULL DEFAULT FALSE,
  utilities_details    JSON            NULL,
  min_stay_days        SMALLINT UNSIGNED NULL,
  max_stay_days        SMALLINT UNSIGNED NULL,
  available_from       DATE            NULL,
  -- Room / hostel / guest-house specifics
  occupancy_type       ENUM('single','double','triple','shared','dormitory','entire_place') NULL,
  beds                 TINYINT UNSIGNED NULL,
  attached_bathroom    BOOLEAN         NOT NULL DEFAULT FALSE,
  tenant_preference    ENUM('any','family','bachelor','female','male','student','corporate') NULL,
  pets_allowed         BOOLEAN         NOT NULL DEFAULT FALSE,
  smoking_allowed      BOOLEAN         NOT NULL DEFAULT FALSE,
  meals_included       BOOLEAN         NOT NULL DEFAULT FALSE,
  -- Commercial specifics
  floor_load_capacity  DECIMAL(12,2)   NULL,
  ceiling_height_ft    DECIMAL(8,2)    NULL,
  loading_docks        TINYINT UNSIGNED NULL,
  three_phase_power    BOOLEAN         NOT NULL DEFAULT FALSE,
  -- Agricultural specifics
  water_source         ENUM('tubewell','canal','rain','well','none') NULL,
  soil_type            VARCHAR(96)     NULL,
  is_cultivated        BOOLEAN         NOT NULL DEFAULT FALSE,

  -- AI (§18 Property Valuation)
  ai_valuation_low     DECIMAL(18,2)   NULL,
  ai_valuation_mid     DECIMAL(18,2)   NULL,
  ai_valuation_high    DECIMAL(18,2)   NULL,
  ai_valuation_at      TIMESTAMP       NULL,
  price_vs_area_avg_pct DECIMAL(8,3)   NULL,
  investment_score     DECIMAL(5,2)    NULL,

  PRIMARY KEY (listing_id),
  KEY idx_property_kind (property_kind, usage_type),
  KEY idx_property_rooms (bedrooms, bathrooms),
  KEY idx_property_area (area_sqm),
  KEY idx_property_price_area (price_per_sqm),
  KEY idx_property_furnishing (furnishing),
  KEY idx_property_society (society_name(64)),
  KEY idx_property_available (available_from),
  CONSTRAINT fk_property_details_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_property_area CHECK (area_sqm IS NULL OR area_sqm >= 0)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Amenity catalogue + many-to-many (extensible without schema change)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_amenities (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(64)  NOT NULL,
  name       VARCHAR(128) NOT NULL,
  icon       VARCHAR(64)  NULL,
  group_code ENUM('main','indoor','outdoor','utilities','security','community','nearby','business')
               NOT NULL DEFAULT 'main',
  applies_to JSON         NULL,        -- ["residential","commercial",...]
  is_filterable BOOLEAN   NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_amenities_code (code),
  KEY idx_property_amenities_group (group_code, sort_order)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_listing_amenities (
  listing_id BIGINT UNSIGNED NOT NULL,
  amenity_id INT UNSIGNED    NOT NULL,
  value      VARCHAR(96)     NULL,      -- e.g. distance to the amenity
  PRIMARY KEY (listing_id, amenity_id),
  KEY idx_pla_amenity (amenity_id),
  CONSTRAINT fk_pla_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pla_amenity FOREIGN KEY (amenity_id)
    REFERENCES property_amenities (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Nearby places (§11 Nearby Places) — schools, hospitals, transit
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_nearby_places (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id  BIGINT UNSIGNED NOT NULL,
  place_type  ENUM('school','university','hospital','clinic','pharmacy','mosque','church','temple',
                   'park','mall','supermarket','restaurant','bank','atm','bus_stop','metro',
                   'train_station','airport','highway','gym','police','fire_station') NOT NULL,
  name        VARCHAR(160)    NULL,
  distance_m  INT UNSIGNED    NULL,
  walk_minutes SMALLINT UNSIGNED NULL,
  drive_minutes SMALLINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_nearby_listing (listing_id, place_type),
  CONSTRAINT fk_nearby_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Area price index — the reference data behind valuation & "above/below market"
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_price_index (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  country_id     SMALLINT UNSIGNED NOT NULL,
  city_id        INT UNSIGNED      NULL,
  area_id        INT UNSIGNED      NULL,
  property_kind  VARCHAR(48)       NOT NULL,
  operation      ENUM('sell','rent') NOT NULL,
  currency       CHAR(3)           NOT NULL,
  avg_price_per_sqm    DECIMAL(18,4) NULL,
  median_price_per_sqm DECIMAL(18,4) NULL,
  p25_price_per_sqm    DECIMAL(18,4) NULL,
  p75_price_per_sqm    DECIMAL(18,4) NULL,
  sample_size    INT UNSIGNED      NOT NULL DEFAULT 0,
  yoy_change_pct DECIMAL(8,3)      NULL,
  mom_change_pct DECIMAL(8,3)      NULL,
  rental_yield_pct DECIMAL(8,3)    NULL,
  period_start   DATE              NOT NULL,
  period_end     DATE              NOT NULL,
  computed_at    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_index (country_id, city_id, area_id, property_kind, operation, currency, period_start),
  KEY idx_property_index_lookup (city_id, property_kind, operation, period_end),
  CONSTRAINT fk_property_index_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Valuation runs (§18 Property Valuation)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_valuations (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          CHAR(36)        NOT NULL,
  listing_id    BIGINT UNSIGNED NULL,
  requested_by  BIGINT UNSIGNED NULL,
  -- Snapshot of the inputs, so a valuation stays reproducible
  inputs        JSON            NOT NULL,
  currency      CHAR(3)         NOT NULL,
  value_low     DECIMAL(18,2)   NOT NULL,
  value_mid     DECIMAL(18,2)   NOT NULL,
  value_high    DECIMAL(18,2)   NOT NULL,
  confidence    DECIMAL(5,2)    NULL,
  method        ENUM('comparable','index','hedonic','ml','manual') NOT NULL DEFAULT 'comparable',
  comparables   JSON            NULL,          -- listing ids + weights used
  explanation   TEXT            NULL,
  model         VARCHAR(64)     NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_valuation_uuid (uuid),
  KEY idx_property_valuation_listing (listing_id, created_at),
  CONSTRAINT fk_property_valuation_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Viewing / site-visit appointments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_viewings (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id   BIGINT UNSIGNED NOT NULL,
  visitor_id   BIGINT UNSIGNED NOT NULL,
  agent_id     BIGINT UNSIGNED NULL,
  scheduled_at TIMESTAMP       NOT NULL,
  duration_min SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  mode         ENUM('in_person','video_call','virtual_tour') NOT NULL DEFAULT 'in_person',
  status       ENUM('requested','confirmed','rescheduled','completed','cancelled','no_show')
                 NOT NULL DEFAULT 'requested',
  notes        VARCHAR(500)    NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_viewings_listing (listing_id, scheduled_at),
  KEY idx_viewings_visitor (visitor_id, status),
  CONSTRAINT fk_viewings_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_viewings_visitor FOREIGN KEY (visitor_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
