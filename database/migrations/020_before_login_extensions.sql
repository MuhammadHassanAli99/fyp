-- =============================================================================
-- 020  Before-login: browsing location, guest preference carry-over, config versions
-- Additive only. Does not drop data or recreate tables.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Authenticated browsing location (country/region/city already exist on users).
-- Area, approximate coordinates, source and timestamp were missing.
-- theme was NOT NULL DEFAULT 'system', which made "unset" indistinguishable
-- from an explicit System choice during guest→account preference merge.
-- -----------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN area_id INT UNSIGNED NULL AFTER city_id,
  ADD COLUMN approx_latitude DECIMAL(10,7) NULL AFTER area_id,
  ADD COLUMN approx_longitude DECIMAL(10,7) NULL AFTER approx_latitude,
  ADD COLUMN location_source ENUM('manual','gps','ip','profile','listing','device') NULL AFTER approx_longitude,
  ADD COLUMN location_updated_at TIMESTAMP NULL AFTER location_source,
  MODIFY COLUMN theme ENUM('light','dark','system') NULL DEFAULT NULL;

ALTER TABLE users
  ADD CONSTRAINT fk_users_region FOREIGN KEY (region_id)
    REFERENCES regions (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_users_area FOREIGN KEY (area_id)
    REFERENCES areas (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Guest sessions already store country/language/currency. Carry theme, units
-- and a coarse location so login can merge without inventing a second prefs table.
-- -----------------------------------------------------------------------------
ALTER TABLE guest_sessions
  ADD COLUMN theme ENUM('light','dark','system') NULL AFTER currency,
  ADD COLUMN measurement_system ENUM('metric','imperial') NULL AFTER theme,
  ADD COLUMN region_id INT UNSIGNED NULL AFTER measurement_system,
  ADD COLUMN city_id INT UNSIGNED NULL AFTER region_id,
  ADD COLUMN area_id INT UNSIGNED NULL AFTER city_id,
  ADD COLUMN converted_at TIMESTAMP NULL AFTER converted_user_id;

-- -----------------------------------------------------------------------------
-- Version stamps for incremental config sync. Live in app_settings (already
-- the runtime configuration table) rather than a parallel versions table.
-- Integers are bumped by operators / FX upsert; clients compare before refetch.
-- -----------------------------------------------------------------------------
INSERT INTO app_settings (setting_key, setting_value, scope, description, is_public) VALUES
  (
    'config.versions',
    CAST('{"configuration":1,"countries":1,"languages":1,"currencies":1,"exchangeRates":1,"features":1}' AS JSON),
    'global',
    'Monotonic version stamps for before-login configuration sync',
    TRUE
  )
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  is_public = VALUES(is_public);
