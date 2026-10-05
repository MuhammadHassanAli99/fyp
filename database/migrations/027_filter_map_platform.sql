-- =============================================================================
-- 027  Filter Platform + Map Platform
--      Additive only. Does not drop tables, reset data, or replace Search.
--      MySQL remains the transactional source of truth.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Metadata-driven filter catalogue. Code remains the default source of truth;
-- rows here override or extend definitions without a deploy.
-- Empty marketplace_code / category_code means "common / all".
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS filter_definitions (
  id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  filter_key         VARCHAR(64)      NOT NULL,
  marketplace_code   VARCHAR(32)      NOT NULL DEFAULT '',
  category_code      VARCHAR(64)      NOT NULL DEFAULT '',
  subcategory_code   VARCHAR(64)      NOT NULL DEFAULT '',
  label              VARCHAR(128)     NOT NULL,
  filter_type        VARCHAR(32)      NOT NULL,
  data_source        VARCHAR(64)      NULL,
  allowed_values     JSON             NULL,
  min_value          DECIMAL(18,4)    NULL,
  max_value          DECIMAL(18,4)    NULL,
  step_value         DECIMAL(18,4)    NULL,
  unit               VARCHAR(24)      NULL,
  currency           CHAR(3)          NULL,
  depends_on         VARCHAR(64)      NULL,
  visibility         ENUM('always','when_parent','hidden') NOT NULL DEFAULT 'always',
  sort_order         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active          BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_filter_definitions (filter_key, marketplace_code, category_code, subcategory_code),
  KEY idx_filter_definitions_mp (marketplace_code, is_active, sort_order)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Worldwide postal codes. Not a dump of every country — populated as geocoding
-- resolves places, and used as a canonical lookup rather than free text.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS postal_codes (
  id           INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  country_id   SMALLINT UNSIGNED NOT NULL,
  postal_code  VARCHAR(24)       NOT NULL,
  city_id      INT UNSIGNED      NULL,
  area_id      INT UNSIGNED      NULL,
  latitude     DECIMAL(10,7)     NULL,
  longitude    DECIMAL(10,7)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_postal_codes (country_id, postal_code),
  KEY idx_postal_codes_city (city_id),
  CONSTRAINT fk_postal_codes_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_postal_codes_city FOREIGN KEY (city_id)
    REFERENCES cities (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_postal_codes_area FOREIGN KEY (area_id)
    REFERENCES areas (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Forward / reverse geocoding cache. Provider responses are stored, never
-- private user GPS traces.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geocoding_cache (
  id            BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  direction     ENUM('forward','reverse') NOT NULL,
  query_hash    CHAR(64)         NOT NULL,
  query_text    VARCHAR(255)     NULL,
  latitude      DECIMAL(10,7)    NULL,
  longitude     DECIMAL(10,7)    NULL,
  country_id    SMALLINT UNSIGNED NULL,
  region_id     INT UNSIGNED     NULL,
  city_id       INT UNSIGNED     NULL,
  area_id       INT UNSIGNED     NULL,
  postal_code   VARCHAR(24)      NULL,
  provider      VARCHAR(32)      NOT NULL,
  payload       JSON             NULL,
  created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    TIMESTAMP        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_geocoding_cache (direction, query_hash),
  KEY idx_geocoding_cache_expires (expires_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Platform map providers (not property-only). property_map_providers stays.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS map_providers (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                VARCHAR(32)  NOT NULL,
  name                VARCHAR(64)  NOT NULL,
  is_default          BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  capabilities        JSON         NULL,
  tile_url            VARCHAR(512) NULL,
  satellite_tile_url  VARCHAR(512) NULL,
  hybrid_tile_url     VARCHAR(512) NULL,
  attribution         VARCHAR(255) NULL,
  platforms           JSON         NULL,
  config              JSON         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_map_providers (code)
) ENGINE = InnoDB;

INSERT INTO map_providers
  (code, name, is_default, is_active, capabilities, tile_url, satellite_tile_url, attribution, platforms)
VALUES
  (
    'openstreetmap',
    'OpenStreetMap',
    TRUE,
    TRUE,
    JSON_OBJECT(
      'map', TRUE, 'satellite', TRUE, 'hybrid', TRUE,
      'streetView', FALSE, 'directions', TRUE, 'places', TRUE,
      'geocoding', TRUE, 'reverseGeocoding', TRUE,
      'distance', TRUE, 'radiusSearch', TRUE
    ),
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    '© OpenStreetMap contributors. Satellite © Esri.',
    JSON_ARRAY('android','ios','web','windows','macos','linux')
  ),
  (
    'google',
    'Google Maps',
    FALSE,
    TRUE,
    JSON_OBJECT(
      'map', TRUE, 'satellite', TRUE, 'hybrid', TRUE,
      'streetView', TRUE, 'directions', TRUE, 'places', TRUE,
      'geocoding', TRUE, 'reverseGeocoding', TRUE,
      'distance', TRUE, 'radiusSearch', TRUE
    ),
    NULL,
    NULL,
    '© Google',
    JSON_ARRAY('android','ios','web')
  ),
  (
    'apple',
    'Apple Maps',
    FALSE,
    TRUE,
    JSON_OBJECT(
      'map', TRUE, 'satellite', TRUE, 'hybrid', TRUE,
      'streetView', FALSE, 'directions', TRUE, 'places', TRUE,
      'geocoding', TRUE, 'reverseGeocoding', TRUE,
      'distance', TRUE, 'radiusSearch', TRUE
    ),
    NULL,
    NULL,
    '© Apple',
    JSON_ARRAY('ios','macos')
  )
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  capabilities = VALUES(capabilities),
  tile_url = VALUES(tile_url),
  satellite_tile_url = VALUES(satellite_tile_url),
  attribution = VALUES(attribution),
  platforms = VALUES(platforms);

-- -----------------------------------------------------------------------------
-- Nearby places / POIs. Provider results are cached; curated rows can be seeded.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS places (
  id           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  country_id   SMALLINT UNSIGNED NOT NULL,
  city_id      INT UNSIGNED     NULL,
  place_type   VARCHAR(48)      NOT NULL,
  name         VARCHAR(160)     NOT NULL,
  latitude     DECIMAL(10,7)    NOT NULL,
  longitude    DECIMAL(10,7)    NOT NULL,
  provider     VARCHAR(32)      NOT NULL DEFAULT 'local',
  external_id  VARCHAR(128)     NULL,
  is_active    BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_places_geo (latitude, longitude),
  KEY idx_places_type (country_id, place_type, is_active),
  KEY idx_places_city (city_id, place_type),
  CONSTRAINT fk_places_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_places_city FOREIGN KEY (city_id)
    REFERENCES cities (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS places_cache (
  cache_key    CHAR(64)         NOT NULL,
  latitude     DECIMAL(10,7)    NOT NULL,
  longitude    DECIMAL(10,7)    NOT NULL,
  radius_m     INT UNSIGNED     NOT NULL,
  place_type   VARCHAR(48)      NOT NULL,
  provider     VARCHAR(32)      NOT NULL,
  payload      JSON             NOT NULL,
  expires_at   TIMESTAMP        NOT NULL,
  created_at   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cache_key),
  KEY idx_places_cache_expires (expires_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Geohash on the public search projection for server-side marker clustering.
-- Private coordinates stay null when hide_exact_location is set.
-- -----------------------------------------------------------------------------
ALTER TABLE listing_search_index
  ADD COLUMN geohash CHAR(12) NULL AFTER hide_exact_location;

ALTER TABLE listing_search_index
  ADD KEY idx_lsi_geohash (marketplace_id, geohash);

-- -----------------------------------------------------------------------------
-- Filter / map analytics. Extends the existing search analytics enum.
-- -----------------------------------------------------------------------------
ALTER TABLE search_analytics_events
  MODIFY COLUMN event_type ENUM(
    'search','search_success','search_zero_result',
    'impression','click','favorite','contact','call',
    'message','share','conversion',
    'filter_apply','filter_clear','filter_chip_remove','save_search',
    'map_open','map_move','nearby_search','marker_click','listing_click',
    'directions_click','street_view','satellite','poi_click'
  ) NOT NULL;
