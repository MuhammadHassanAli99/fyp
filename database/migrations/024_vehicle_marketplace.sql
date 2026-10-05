-- =============================================================================
-- 024  Vehicle marketplace domain completion
--      Separates the physical VEHICLE from LISTING (offer) and TRANSACTION.
--      Extends 008 without dropping tables or rewriting listing rows.
--      Reuses listings, listing_offers, listing_documents, listing_media,
--      auctions, auction_bids, payments/orders, saved_searches, notifications,
--      fraud, businesses, and global search.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Additive enumerations on shared tables.
-- -----------------------------------------------------------------------------
ALTER TABLE listings
  MODIFY COLUMN condition_code ENUM(
    'new','like_new','excellent','good','fair','used','refurbished','for_parts',
    'under_construction','certified_used','damaged','salvage','restored',
    'classic','antique','rebuilt'
  ) NULL;

ALTER TABLE listing_documents
  MODIFY COLUMN doc_type ENUM(
    'ownership','title_deed','title_registry','map','site_plan','approval','noc',
    'tax_receipt','registration','transfer_letter','inspection','certificate',
    'assay','invoice','insurance','building_approval','completion_certificate',
    'title','bill_of_sale','certificate_of_origin','export_certificate',
    'import_permit','customs_declaration','inspection_certificate',
    'bill_of_lading','commercial_invoice','shipping','vin_photo','other'
  ) NOT NULL;

ALTER TABLE orders
  MODIFY COLUMN kind ENUM(
    'subscription','promotion','advertisement','verification','inspection','service',
    'wallet_topup','auction_deposit','listing_purchase','escrow',
    'rental_deposit','rental_payment','booking_payment','parts_purchase'
  ) NOT NULL;

ALTER TABLE order_items
  MODIFY COLUMN kind ENUM(
    'subscription','promotion','advertisement','verification','inspection','service',
    'wallet_topup','auction_deposit','tax','fee','listing_purchase','escrow',
    'rental_deposit','rental_payment','booking_payment','parts_purchase'
  ) NOT NULL;

-- -----------------------------------------------------------------------------
-- Config-driven catalogues. Flutter must not hardcode these lists.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_category_rules (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_type         VARCHAR(48)  NOT NULL,
  category_code        VARCHAR(64)  NULL,
  group_code           VARCHAR(48)  NOT NULL DEFAULT 'passenger',
  allowed_operations   JSON         NOT NULL,
  requires_make_model  BOOLEAN      NOT NULL DEFAULT TRUE,
  requires_mileage     BOOLEAN      NOT NULL DEFAULT TRUE,
  uses_engine_hours    BOOLEAN      NOT NULL DEFAULT FALSE,
  is_marine            BOOLEAN      NOT NULL DEFAULT FALSE,
  is_machinery         BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_category_type (vehicle_type)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_fuel_types (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(32)  NOT NULL,
  name        VARCHAR(64)  NOT NULL,
  is_electric BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_fuel_code (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_transmission_types (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(32)  NOT NULL,
  name       VARCHAR(64)  NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_transmission_code (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_drive_types (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(16)  NOT NULL,
  name       VARCHAR(64)  NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_drive_code (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_condition_codes (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(32)  NOT NULL,
  name           VARCHAR(64)  NOT NULL,
  is_legal_sale  BOOLEAN      NOT NULL DEFAULT TRUE,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_condition_code (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_mileage_units (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(16)  NOT NULL,
  name       VARCHAR(64)  NOT NULL,
  to_km      DECIMAL(18,10) NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_mileage_unit (code),
  CONSTRAINT chk_vehicle_mileage_unit_factor CHECK (to_km > 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_rental_durations (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(32)  NOT NULL,
  name           VARCHAR(64)  NOT NULL,
  duration_days  INT UNSIGNED NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_rental_duration (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_document_types (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(48)  NOT NULL,
  name           VARCHAR(128) NOT NULL,
  is_private     BOOLEAN      NOT NULL DEFAULT TRUE,
  applies_to     JSON         NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_document_type (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_inspection_checklists (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(48)  NOT NULL,
  name        VARCHAR(128) NOT NULL,
  applies_to  JSON         NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_insp_checklist (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_inspection_checklist_items (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  checklist_code VARCHAR(48)  NOT NULL,
  item_code      VARCHAR(64)  NOT NULL,
  name           VARCHAR(128) NOT NULL,
  group_code     VARCHAR(48)  NOT NULL DEFAULT 'general',
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_insp_item (checklist_code, item_code),
  KEY idx_vehicle_insp_item_list (checklist_code, sort_order)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_shipping_modes (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(32)  NOT NULL,
  name       VARCHAR(96)  NOT NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_shipping_mode (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_part_categories (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       VARCHAR(48)  NOT NULL,
  name       VARCHAR(128) NOT NULL,
  parent_code VARCHAR(48) NULL,
  is_active  BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_part_category (code)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- VEHICLE — the physical asset. Listings offer it for sale, rent, or auction.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                     CHAR(36)        NOT NULL,
  owner_user_id            BIGINT UNSIGNED NOT NULL,
  business_id              BIGINT UNSIGNED NULL,
  vehicle_type             VARCHAR(48)     NOT NULL,
  make_id                  INT UNSIGNED    NULL,
  model_id                 INT UNSIGNED    NULL,
  variant_id               INT UNSIGNED    NULL,
  make_name                VARCHAR(96)     NULL,
  model_name               VARCHAR(128)    NULL,
  variant_name             VARCHAR(160)    NULL,
  trim                     VARCHAR(96)     NULL,
  generation               VARCHAR(64)     NULL,
  year                     SMALLINT UNSIGNED NULL,
  model_year               SMALLINT UNSIGNED NULL,
  manufacturing_date       DATE            NULL,
  country_of_manufacture   SMALLINT UNSIGNED NULL,
  body_type                VARCHAR(48)     NULL,
  color_exterior           VARCHAR(48)     NULL,
  color_interior           VARCHAR(48)     NULL,
  color_family             VARCHAR(32)     NULL,
  vehicle_condition        VARCHAR(32)     NULL,
  engine_type              VARCHAR(64)     NULL,
  engine_cc                SMALLINT UNSIGNED NULL,
  cylinders                TINYINT UNSIGNED NULL,
  power_hp                 SMALLINT UNSIGNED NULL,
  torque_nm                SMALLINT UNSIGNED NULL,
  engine_number            VARCHAR(48)     NULL,
  fuel_type                VARCHAR(32)     NULL,
  transmission             VARCHAR(32)     NULL,
  drivetrain               VARCHAR(16)     NULL,
  battery_kwh              DECIMAL(8,2)    NULL,
  battery_health_pct       DECIMAL(5,2)    NULL,
  range_km                 SMALLINT UNSIGNED NULL,
  charging_type            VARCHAR(48)     NULL,
  charging_time_hours      DECIMAL(6,2)    NULL,
  ac_charging              BOOLEAN         NOT NULL DEFAULT FALSE,
  dc_charging              BOOLEAN         NOT NULL DEFAULT FALSE,
  fast_charging            BOOLEAN         NOT NULL DEFAULT FALSE,
  battery_warranty_months  SMALLINT UNSIGNED NULL,
  doors                    TINYINT UNSIGNED NULL,
  seats                    TINYINT UNSIGNED NULL,
  country_id               SMALLINT UNSIGNED NOT NULL,
  region_id                INT UNSIGNED    NULL,
  city_id                  INT UNSIGNED    NULL,
  latitude                 DECIMAL(10,7)   NULL,
  longitude                DECIMAL(10,7)   NULL,
  availability_status      ENUM('available','reserved','rented','maintenance','sold','unavailable')
                             NOT NULL DEFAULT 'available',
  seed_listing_id          BIGINT UNSIGNED NULL,
  status                   ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
  created_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at               TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicles_uuid (uuid),
  KEY idx_vehicles_owner (owner_user_id, status),
  KEY idx_vehicles_business (business_id, status),
  KEY idx_vehicles_identity (make_id, model_id, year),
  KEY idx_vehicles_type (vehicle_type, status),
  KEY idx_vehicles_geo (country_id, city_id),
  KEY idx_vehicles_seed (seed_listing_id),
  CONSTRAINT fk_vehicles_owner FOREIGN KEY (owner_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_vehicles_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_vehicles_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_vehicles_make FOREIGN KEY (make_id)
    REFERENCES vehicle_makes (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_vehicles_model FOREIGN KEY (model_id)
    REFERENCES vehicle_models (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_vehicles_variant FOREIGN KEY (variant_id)
    REFERENCES vehicle_variants (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_feature_values (
  vehicle_id   BIGINT UNSIGNED NOT NULL,
  feature_id   INT UNSIGNED    NOT NULL,
  PRIMARY KEY (vehicle_id, feature_id),
  KEY idx_vfv_feature (feature_id),
  CONSTRAINT fk_vfv_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vfv_feature FOREIGN KEY (feature_id)
    REFERENCES vehicle_features (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_mileage_readings (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id           BIGINT UNSIGNED NOT NULL,
  value                INT UNSIGNED    NOT NULL,
  unit                 VARCHAR(16)     NOT NULL DEFAULT 'km',
  value_km             INT UNSIGNED    NULL,
  source               ENUM('owner','inspection','service','import','odometer_photo','system')
                         NOT NULL DEFAULT 'owner',
  verification_status  ENUM('unverified','pending','verified','rejected','expired')
                         NOT NULL DEFAULT 'unverified',
  recorded_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes                VARCHAR(255)    NULL,
  created_by           BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_vmr_vehicle (vehicle_id, recorded_at),
  CONSTRAINT fk_vmr_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_vin_records (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id           BIGINT UNSIGNED NOT NULL,
  vin                  VARCHAR(32)     NOT NULL,
  verification_status  ENUM('unverified','pending','partially_verified','verified','rejected','expired')
                         NOT NULL DEFAULT 'unverified',
  decoded_manufacturer VARCHAR(128)    NULL,
  decoded_model        VARCHAR(128)    NULL,
  decoded_year         SMALLINT UNSIGNED NULL,
  decoded_country      VARCHAR(64)     NULL,
  decode_json          JSON            NULL,
  verified_by          BIGINT UNSIGNED NULL,
  verified_at          TIMESTAMP       NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_vin_vehicle (vehicle_id),
  KEY idx_vehicle_vin_value (vin),
  CONSTRAINT fk_vehicle_vin_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_registrations (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id           BIGINT UNSIGNED NOT NULL,
  registration_number  VARCHAR(32)     NULL,
  country_id           SMALLINT UNSIGNED NULL,
  region_id            INT UNSIGNED    NULL,
  authority            VARCHAR(160)    NULL,
  registered_at        DATE            NULL,
  expires_at           DATE            NULL,
  status               ENUM('unregistered','registered','applied','transferred','expired','on_papers')
                         NOT NULL DEFAULT 'unregistered',
  verification_status  ENUM('unverified','pending','partially_verified','verified','rejected','expired')
                         NOT NULL DEFAULT 'unverified',
  verified_by          BIGINT UNSIGNED NULL,
  verified_at          TIMESTAMP       NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vreg_vehicle (vehicle_id, status),
  KEY idx_vreg_number (registration_number),
  CONSTRAINT fk_vreg_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_ownership (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id           BIGINT UNSIGNED NOT NULL,
  owner_user_id        BIGINT UNSIGNED NOT NULL,
  ownership_type       ENUM('registered_owner','title_holder','importer','dealer','other')
                         NOT NULL DEFAULT 'registered_owner',
  status               ENUM('unverified','pending','partially_verified','verified','rejected','expired')
                         NOT NULL DEFAULT 'unverified',
  submitted_at         TIMESTAMP       NULL,
  verified_at          TIMESTAMP       NULL,
  verified_by          BIGINT UNSIGNED NULL,
  rejection_reason     VARCHAR(500)    NULL,
  expires_at           TIMESTAMP       NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vown_vehicle (vehicle_id, status),
  KEY idx_vown_owner (owner_user_id),
  CONSTRAINT fk_vown_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vown_user FOREIGN KEY (owner_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_ownership_history (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id     BIGINT UNSIGNED NOT NULL,
  owner_label    VARCHAR(191)    NULL,
  country_id     SMALLINT UNSIGNED NULL,
  recorded_from  DATE            NULL,
  recorded_to    DATE            NULL,
  source         VARCHAR(64)     NOT NULL DEFAULT 'owner_declared',
  is_verified    BOOLEAN         NOT NULL DEFAULT FALSE,
  notes          VARCHAR(500)    NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_voh_vehicle (vehicle_id, recorded_from),
  CONSTRAINT fk_voh_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_media (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id     BIGINT UNSIGNED NOT NULL,
  listing_media_id BIGINT UNSIGNED NULL,
  kind           ENUM('exterior','interior','engine','tire','damage','vin','document','video','tour_360','other')
                   NOT NULL DEFAULT 'exterior',
  url            VARCHAR(512)    NOT NULL,
  thumb_url      VARCHAR(512)    NULL,
  card_url       VARCHAR(512)    NULL,
  mime_type      VARCHAR(96)     NULL,
  size_bytes     INT UNSIGNED    NULL,
  perceptual_hash CHAR(64)       NULL,
  is_primary     BOOLEAN         NOT NULL DEFAULT FALSE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status         ENUM('uploading','processing','ready','failed','rejected') NOT NULL DEFAULT 'ready',
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vmedia_vehicle (vehicle_id, kind, sort_order),
  KEY idx_vmedia_phash (perceptual_hash),
  CONSTRAINT fk_vmedia_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  vehicle_id           BIGINT UNSIGNED NOT NULL,
  listing_document_id  BIGINT UNSIGNED NULL,
  doc_type             VARCHAR(48)     NOT NULL,
  title                VARCHAR(191)    NULL,
  storage_path         VARCHAR(512)    NOT NULL,
  uploaded_by          BIGINT UNSIGNED NOT NULL,
  verification_status  ENUM('unverified','pending','needs_review','verified','rejected','expired')
                         NOT NULL DEFAULT 'unverified',
  verified_by          BIGINT UNSIGNED NULL,
  verified_at          TIMESTAMP       NULL,
  rejection_reason     VARCHAR(500)    NULL,
  processing_status    ENUM('uploaded','validating','scanning','ocr','classified','extracted','review','complete','failed')
                         NOT NULL DEFAULT 'uploaded',
  scan_status          ENUM('pending','clean','blocked','skipped_no_scanner') NOT NULL DEFAULT 'pending',
  ocr_text             MEDIUMTEXT      NULL,
  extracted_data       JSON            NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_documents_uuid (uuid),
  KEY idx_vdoc_vehicle (vehicle_id, doc_type),
  KEY idx_vdoc_status (verification_status, processing_status),
  CONSTRAINT fk_vdoc_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vdoc_listing_doc FOREIGN KEY (listing_document_id)
    REFERENCES listing_documents (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_vdoc_uploader FOREIGN KEY (uploaded_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_history_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id     BIGINT UNSIGNED NOT NULL,
  event_type     ENUM('ownership','registration','accident','mileage','service','inspection',
                      'import','export','damage','auction','recall','other') NOT NULL,
  occurred_at    DATE            NULL,
  source         VARCHAR(64)     NOT NULL DEFAULT 'declared',
  is_verified    BOOLEAN         NOT NULL DEFAULT FALSE,
  summary        VARCHAR(500)    NULL,
  payload        JSON            NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vhe_vehicle (vehicle_id, event_type, occurred_at),
  CONSTRAINT fk_vhe_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_service_records (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           CHAR(36)        NOT NULL,
  vehicle_id     BIGINT UNSIGNED NOT NULL,
  serviced_at    DATE            NOT NULL,
  mileage_value  INT UNSIGNED    NULL,
  mileage_unit   VARCHAR(16)     NULL,
  workshop       VARCHAR(191)    NULL,
  service_type   VARCHAR(96)     NULL,
  parts          VARCHAR(500)    NULL,
  cost_amount    DECIMAL(18,2)   NULL,
  cost_currency  CHAR(3)         NULL,
  invoice_path   VARCHAR(512)    NULL,
  notes          VARCHAR(1000)   NULL,
  visibility     ENUM('private','authorized','public') NOT NULL DEFAULT 'private',
  created_by     BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vsr_uuid (uuid),
  KEY idx_vsr_vehicle (vehicle_id, serviced_at),
  CONSTRAINT fk_vsr_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Listing details: attach the asset. Existing rows stay valid.
-- -----------------------------------------------------------------------------
ALTER TABLE vehicle_listing_details
  ADD COLUMN vehicle_id BIGINT UNSIGNED NULL AFTER listing_id,
  ADD COLUMN trim VARCHAR(96) NULL AFTER variant_name,
  ADD COLUMN model_year SMALLINT UNSIGNED NULL AFTER year,
  ADD COLUMN manufacturing_date DATE NULL AFTER model_year,
  ADD COLUMN country_of_manufacture SMALLINT UNSIGNED NULL AFTER manufacturing_date,
  ADD COLUMN vehicle_condition VARCHAR(32) NULL AFTER condition_grade,
  ADD COLUMN charging_type VARCHAR(48) NULL AFTER battery_health_pct,
  ADD COLUMN charging_time_hours DECIMAL(6,2) NULL AFTER charging_type,
  ADD COLUMN ac_charging BOOLEAN NOT NULL DEFAULT FALSE AFTER charging_time_hours,
  ADD COLUMN dc_charging BOOLEAN NOT NULL DEFAULT FALSE AFTER ac_charging,
  ADD COLUMN fast_charging BOOLEAN NOT NULL DEFAULT FALSE AFTER dc_charging,
  ADD COLUMN battery_warranty_months SMALLINT UNSIGNED NULL AFTER fast_charging,
  ADD COLUMN mileage_source VARCHAR(32) NULL AFTER mileage_km,
  ADD COLUMN mileage_recorded_at TIMESTAMP NULL AFTER mileage_source,
  ADD COLUMN availability_status ENUM('available','reserved','rented','maintenance','sold','unavailable')
    NULL AFTER license_required,
  ADD KEY idx_vld_vehicle (vehicle_id);

ALTER TABLE vehicle_inspections
  ADD COLUMN vehicle_id BIGINT UNSIGNED NULL AFTER listing_id,
  ADD COLUMN checklist_code VARCHAR(48) NULL AFTER inspector_name,
  ADD COLUMN result ENUM('pass','pass_with_warnings','requires_repair','fail') NULL AFTER grade,
  ADD KEY idx_vinspection_vehicle (vehicle_id);

CREATE TABLE IF NOT EXISTS vehicle_inspection_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  inspection_id  BIGINT UNSIGNED NOT NULL,
  item_code      VARCHAR(64)     NOT NULL,
  name           VARCHAR(128)    NULL,
  group_code     VARCHAR(48)     NULL,
  score          DECIMAL(5,2)    NULL,
  result         ENUM('pass','warning','fail','not_checked') NOT NULL DEFAULT 'not_checked',
  measurement    VARCHAR(64)     NULL,
  notes          VARCHAR(500)    NULL,
  photo_url      VARCHAR(512)    NULL,
  PRIMARY KEY (id),
  KEY idx_vii_inspection (inspection_id),
  CONSTRAINT fk_vii_inspection FOREIGN KEY (inspection_id)
    REFERENCES vehicle_inspections (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Offer audit (listing_offers is the spine).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_offer_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  offer_id       BIGINT UNSIGNED NOT NULL,
  actor_id       BIGINT UNSIGNED NULL,
  action         VARCHAR(48)     NOT NULL,
  from_status    VARCHAR(24)     NULL,
  to_status      VARCHAR(24)     NOT NULL,
  amount         DECIMAL(18,2)   NULL,
  currency       CHAR(3)         NULL,
  message        VARCHAR(500)    NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vehicle_offer_events (offer_id, created_at),
  CONSTRAINT fk_vehicle_offer_events_offer FOREIGN KEY (offer_id)
    REFERENCES listing_offers (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Rental availability and bookings.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_availability (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id         BIGINT UNSIGNED NOT NULL,
  vehicle_id         BIGINT UNSIGNED NULL,
  available_from     DATE            NULL,
  available_until    DATE            NULL,
  status             ENUM('available','reserved','rented','maintenance','sold','unavailable')
                       NOT NULL DEFAULT 'available',
  pickup_location    VARCHAR(191)    NULL,
  return_location    VARCHAR(191)    NULL,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vehicle_availability_listing (listing_id),
  KEY idx_vehicle_avail_from (available_from),
  CONSTRAINT fk_vehicle_avail_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vehicle_avail_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_availability_blocks (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  start_date     DATE            NOT NULL,
  end_date       DATE            NOT NULL,
  reason         ENUM('booked','blocked','maintenance','owner_use','other') NOT NULL DEFAULT 'blocked',
  notes          VARCHAR(255)    NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vehicle_blocks_listing (listing_id, start_date, end_date),
  CONSTRAINT fk_vehicle_blocks_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_vehicle_block_range CHECK (end_date >= start_date)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_rental_bookings (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  listing_id           BIGINT UNSIGNED NOT NULL,
  vehicle_id           BIGINT UNSIGNED NULL,
  renter_id            BIGINT UNSIGNED NOT NULL,
  owner_id             BIGINT UNSIGNED NOT NULL,
  start_date           DATE            NOT NULL,
  end_date             DATE            NOT NULL,
  duration_code        VARCHAR(32)     NULL,
  amount               DECIMAL(18,2)   NOT NULL,
  currency             CHAR(3)         NOT NULL,
  deposit_amount       DECIMAL(18,2)   NULL,
  mileage_allowance    INT UNSIGNED    NULL,
  extra_mileage_rate   DECIMAL(12,2)   NULL,
  insurance_included   BOOLEAN         NOT NULL DEFAULT FALSE,
  order_id             BIGINT UNSIGNED NULL,
  status               ENUM('pending','confirmed','active','completed','cancelled','expired')
                         NOT NULL DEFAULT 'pending',
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vrb_uuid (uuid),
  KEY idx_vrb_listing (listing_id, start_date, status),
  KEY idx_vrb_renter (renter_id, status),
  CONSTRAINT fk_vrb_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vrb_renter FOREIGN KEY (renter_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vrb_owner FOREIGN KEY (owner_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vrb_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_vrb_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_vrb_amount CHECK (amount >= 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_transaction_snapshots (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id             BIGINT UNSIGNED NULL,
  offer_id             BIGINT UNSIGNED NULL,
  booking_id           BIGINT UNSIGNED NULL,
  vehicle_id           BIGINT UNSIGNED NOT NULL,
  listing_id           BIGINT UNSIGNED NOT NULL,
  vehicle_type         VARCHAR(48)     NOT NULL,
  transaction_type     ENUM('sale','rent','auction','parts') NOT NULL,
  make_name            VARCHAR(96)     NULL,
  model_name           VARCHAR(128)    NULL,
  year                 SMALLINT UNSIGNED NULL,
  mileage_km           INT UNSIGNED    NULL,
  vin                  VARCHAR(32)     NULL,
  price                DECIMAL(18,2)   NOT NULL,
  currency             CHAR(3)         NOT NULL,
  fx_rate              DECIMAL(18,8)   NULL,
  converted_amount     DECIMAL(18,2)   NULL,
  fx_timestamp         TIMESTAMP       NULL,
  seller_id            BIGINT UNSIGNED NOT NULL,
  buyer_id             BIGINT UNSIGNED NOT NULL,
  snapshot_json        JSON            NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vtx_listing (listing_id),
  KEY idx_vtx_order (order_id),
  CONSTRAINT fk_vtx_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_vtx_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Parts marketplace.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_parts (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                     CHAR(36)        NOT NULL,
  seller_user_id           BIGINT UNSIGNED NOT NULL,
  business_id              BIGINT UNSIGNED NULL,
  category_code            VARCHAR(48)     NOT NULL,
  name                     VARCHAR(191)    NOT NULL,
  sku                      VARCHAR(64)     NULL,
  oem_part_number          VARCHAR(64)     NULL,
  manufacturer_part_number VARCHAR(64)     NULL,
  barcode                  VARCHAR(64)     NULL,
  brand                    VARCHAR(96)     NULL,
  condition_code           VARCHAR(32)     NOT NULL DEFAULT 'new',
  warranty                 VARCHAR(128)    NULL,
  price                    DECIMAL(18,2)   NOT NULL,
  currency                 CHAR(3)         NOT NULL,
  listing_id               BIGINT UNSIGNED NULL,
  status                   ENUM('draft','active','reserved','sold','archived') NOT NULL DEFAULT 'active',
  created_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at               TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vparts_uuid (uuid),
  KEY idx_vparts_seller (seller_user_id, status),
  KEY idx_vparts_sku (sku),
  KEY idx_vparts_oem (oem_part_number),
  KEY idx_vparts_category (category_code, status),
  CONSTRAINT fk_vparts_seller FOREIGN KEY (seller_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_vparts_price CHECK (price >= 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_part_compatibility (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  part_id        BIGINT UNSIGNED NOT NULL,
  make_id        INT UNSIGNED    NULL,
  model_id       INT UNSIGNED    NULL,
  variant_id     INT UNSIGNED    NULL,
  year_from      SMALLINT UNSIGNED NULL,
  year_to        SMALLINT UNSIGNED NULL,
  engine_cc      SMALLINT UNSIGNED NULL,
  transmission   VARCHAR(32)     NULL,
  notes          VARCHAR(255)    NULL,
  PRIMARY KEY (id),
  KEY idx_vpc_part (part_id),
  KEY idx_vpc_identity (make_id, model_id, year_from, year_to),
  CONSTRAINT fk_vpc_part FOREIGN KEY (part_id)
    REFERENCES vehicle_parts (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_part_inventory (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  part_id            BIGINT UNSIGNED NOT NULL,
  warehouse          VARCHAR(128)    NULL,
  location_label     VARCHAR(128)    NULL,
  quantity           INT UNSIGNED    NOT NULL DEFAULT 0,
  reserved_quantity  INT UNSIGNED    NOT NULL DEFAULT 0,
  reorder_threshold  INT UNSIGNED    NULL,
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vpi_part_wh (part_id, warehouse),
  CONSTRAINT fk_vpi_part FOREIGN KEY (part_id)
    REFERENCES vehicle_parts (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_vpi_qty CHECK (quantity >= reserved_quantity)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Dealer inventory + CRM leads (business_profiles is the dealer).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_dealer_inventory (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id    BIGINT UNSIGNED NOT NULL,
  vehicle_id     BIGINT UNSIGNED NOT NULL,
  listing_id     BIGINT UNSIGNED NULL,
  status         ENUM('available','reserved','sold','rented','service','archived')
                   NOT NULL DEFAULT 'available',
  asking_price   DECIMAL(18,2)   NULL,
  currency       CHAR(3)         NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vdi_business_vehicle (business_id, vehicle_id),
  KEY idx_vdi_status (business_id, status),
  CONSTRAINT fk_vdi_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vdi_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_leads (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           CHAR(36)        NOT NULL,
  listing_id     BIGINT UNSIGNED NULL,
  vehicle_id     BIGINT UNSIGNED NULL,
  part_id        BIGINT UNSIGNED NULL,
  business_id    BIGINT UNSIGNED NULL,
  assignee_id    BIGINT UNSIGNED NULL,
  buyer_id       BIGINT UNSIGNED NOT NULL,
  seller_id      BIGINT UNSIGNED NOT NULL,
  status         ENUM('new','contacted','qualified','negotiating','converted','lost')
                   NOT NULL DEFAULT 'new',
  source         VARCHAR(48)     NULL,
  message        VARCHAR(1000)   NULL,
  follow_up_at   TIMESTAMP       NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vleads_uuid (uuid),
  KEY idx_vleads_seller (seller_id, status),
  KEY idx_vleads_business (business_id, status),
  KEY idx_vleads_buyer (buyer_id),
  CONSTRAINT fk_vleads_buyer FOREIGN KEY (buyer_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_vleads_seller FOREIGN KEY (seller_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Country/versioned trade rules + import/export/customs/shipping.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_trade_rules (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  origin_country_id    SMALLINT UNSIGNED NOT NULL,
  destination_country_id SMALLINT UNSIGNED NOT NULL,
  version              INT UNSIGNED    NOT NULL DEFAULT 1,
  effective_from       DATE            NOT NULL,
  effective_to         DATE            NULL,
  max_vehicle_age_years SMALLINT UNSIGNED NULL,
  emission_requirement VARCHAR(128)    NULL,
  safety_requirement   VARCHAR(128)    NULL,
  hand_drive           ENUM('left','right','either') NOT NULL DEFAULT 'either',
  inspection_required  BOOLEAN         NOT NULL DEFAULT TRUE,
  registration_required BOOLEAN        NOT NULL DEFAULT TRUE,
  duty_rate_pct        DECIMAL(8,4)    NULL,
  import_tax_pct       DECIMAL(8,4)    NULL,
  required_documents   JSON            NULL,
  restrictions         JSON            NULL,
  notes                VARCHAR(1000)   NULL,
  is_active            BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vtr_corridor_version (origin_country_id, destination_country_id, version, effective_from),
  KEY idx_vtr_lookup (origin_country_id, destination_country_id, effective_from),
  CONSTRAINT fk_vtr_origin FOREIGN KEY (origin_country_id)
    REFERENCES countries (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_vtr_dest FOREIGN KEY (destination_country_id)
    REFERENCES countries (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_trade_cases (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  listing_id           BIGINT UNSIGNED NOT NULL,
  vehicle_id           BIGINT UNSIGNED NOT NULL,
  buyer_id             BIGINT UNSIGNED NOT NULL,
  seller_id            BIGINT UNSIGNED NOT NULL,
  origin_country_id    SMALLINT UNSIGNED NOT NULL,
  destination_country_id SMALLINT UNSIGNED NOT NULL,
  rule_id              BIGINT UNSIGNED NULL,
  status               ENUM(
                         'draft','seller_confirmed','verification','inspection',
                         'origin_eligibility','destination_eligibility','documents',
                         'agreement','payment','export_docs','shipping_booked',
                         'origin_customs','in_transit','destination_customs',
                         'cleared','released','local_transport','registration',
                         'delivered','completed','held','cancelled'
                       ) NOT NULL DEFAULT 'draft',
  order_id             BIGINT UNSIGNED NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vtc_uuid (uuid),
  KEY idx_vtc_buyer (buyer_id, status),
  KEY idx_vtc_listing (listing_id),
  CONSTRAINT fk_vtc_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_vtc_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_vtc_buyer FOREIGN KEY (buyer_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_vtc_seller FOREIGN KEY (seller_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_trade_documents (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_id        BIGINT UNSIGNED NOT NULL,
  document_id    BIGINT UNSIGNED NULL,
  doc_type       VARCHAR(48)     NOT NULL,
  required       BOOLEAN         NOT NULL DEFAULT TRUE,
  status         ENUM('missing','uploaded','review','accepted','rejected') NOT NULL DEFAULT 'missing',
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vtd_case (case_id, doc_type),
  CONSTRAINT fk_vtd_case FOREIGN KEY (case_id)
    REFERENCES vehicle_trade_cases (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_shipments (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  case_id              BIGINT UNSIGNED NOT NULL,
  mode                 VARCHAR(32)     NOT NULL,
  provider_code        VARCHAR(48)     NOT NULL DEFAULT 'stub',
  tracking_number      VARCHAR(96)     NULL,
  origin_port          VARCHAR(128)    NULL,
  destination_port     VARCHAR(128)    NULL,
  status               ENUM(
                         'booked','pickup_scheduled','picked_up','at_origin_port','loaded',
                         'in_transit','at_destination_port','customs_processing','customs_hold',
                         'cleared','released','out_for_delivery','delivered','cancelled'
                       ) NOT NULL DEFAULT 'booked',
  booked_at            TIMESTAMP       NULL,
  delivered_at         TIMESTAMP       NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vship_uuid (uuid),
  KEY idx_vship_case (case_id),
  KEY idx_vship_track (tracking_number),
  CONSTRAINT fk_vship_case FOREIGN KEY (case_id)
    REFERENCES vehicle_trade_cases (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_shipment_events (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  shipment_id    BIGINT UNSIGNED NOT NULL,
  status         VARCHAR(48)     NOT NULL,
  location_label VARCHAR(191)    NULL,
  notes          VARCHAR(500)    NULL,
  occurred_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vse_shipment (shipment_id, occurred_at),
  CONSTRAINT fk_vse_shipment FOREIGN KEY (shipment_id)
    REFERENCES vehicle_shipments (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_customs_declarations (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_id              BIGINT UNSIGNED NOT NULL,
  shipment_id          BIGINT UNSIGNED NULL,
  direction            ENUM('export','import') NOT NULL,
  status               ENUM('draft','submitted','review','held','cleared','released','rejected')
                         NOT NULL DEFAULT 'draft',
  duty_amount          DECIMAL(18,2)   NULL,
  tax_amount           DECIMAL(18,2)   NULL,
  currency             CHAR(3)         NULL,
  calculation_source   ENUM('rule_table','broker','manual') NOT NULL DEFAULT 'rule_table',
  notes                VARCHAR(1000)   NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vcd_case (case_id, direction),
  CONSTRAINT fk_vcd_case FOREIGN KEY (case_id)
    REFERENCES vehicle_trade_cases (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_landed_cost_quotes (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  listing_id           BIGINT UNSIGNED NULL,
  case_id              BIGINT UNSIGNED NULL,
  origin_country_id    SMALLINT UNSIGNED NOT NULL,
  destination_country_id SMALLINT UNSIGNED NOT NULL,
  currency             CHAR(3)         NOT NULL,
  status               ENUM('estimated','confirmed') NOT NULL DEFAULT 'estimated',
  vehicle_price        DECIMAL(18,2)   NOT NULL DEFAULT 0,
  shipping             DECIMAL(18,2)   NOT NULL DEFAULT 0,
  insurance            DECIMAL(18,2)   NOT NULL DEFAULT 0,
  customs_duty         DECIMAL(18,2)   NOT NULL DEFAULT 0,
  import_tax           DECIMAL(18,2)   NOT NULL DEFAULT 0,
  port_fees            DECIMAL(18,2)   NOT NULL DEFAULT 0,
  inspection_fees      DECIMAL(18,2)   NOT NULL DEFAULT 0,
  registration_fees    DECIMAL(18,2)   NOT NULL DEFAULT 0,
  broker_fees          DECIMAL(18,2)   NOT NULL DEFAULT 0,
  local_delivery       DECIMAL(18,2)   NOT NULL DEFAULT 0,
  total                DECIMAL(18,2)   NOT NULL DEFAULT 0,
  disclaimer           VARCHAR(500)    NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vlc_uuid (uuid),
  KEY idx_vlc_listing (listing_id)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Financing + insurance abstractions (quotes, not lender/insurer systems).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_financing_quotes (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  listing_id           BIGINT UNSIGNED NULL,
  user_id              BIGINT UNSIGNED NULL,
  vehicle_price        DECIMAL(18,2)   NOT NULL,
  down_payment         DECIMAL(18,2)   NOT NULL,
  loan_amount          DECIMAL(18,2)   NOT NULL,
  term_months          SMALLINT UNSIGNED NOT NULL,
  annual_rate_pct      DECIMAL(8,4)    NOT NULL,
  estimated_monthly    DECIMAL(18,2)   NOT NULL,
  currency             CHAR(3)         NOT NULL,
  is_estimate          BOOLEAN         NOT NULL DEFAULT TRUE,
  provider_code        VARCHAR(48)     NULL,
  disclaimer           VARCHAR(500)    NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vfq_uuid (uuid),
  KEY idx_vfq_listing (listing_id)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_insurance_quotes (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  listing_id           BIGINT UNSIGNED NULL,
  user_id              BIGINT UNSIGNED NULL,
  provider_code        VARCHAR(48)     NOT NULL DEFAULT 'stub',
  coverage             VARCHAR(128)    NULL,
  premium              DECIMAL(18,2)   NULL,
  currency             CHAR(3)         NULL,
  is_estimate          BOOLEAN         NOT NULL DEFAULT TRUE,
  disclaimer           VARCHAR(500)    NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_viq_uuid (uuid),
  KEY idx_viq_listing (listing_id)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- AI + fraud + analytics (assistance only).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicle_ai_assessments (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)        NOT NULL,
  listing_id       BIGINT UNSIGNED NULL,
  vehicle_id       BIGINT UNSIGNED NULL,
  user_id          BIGINT UNSIGNED NULL,
  kind             ENUM('valuation','listing_quality','image_analysis','duplicate','fraud_assist',
                        'search_assist','parts_compat','document_class') NOT NULL,
  model_id         VARCHAR(64)     NOT NULL,
  model_version    VARCHAR(32)     NOT NULL,
  feature_version  VARCHAR(32)     NOT NULL DEFAULT '1',
  confidence       DECIMAL(5,2)    NULL,
  score            DECIMAL(5,2)    NULL,
  result           JSON            NULL,
  result_status    ENUM('ready','partial','failed') NOT NULL DEFAULT 'ready',
  disclaimer       VARCHAR(500)    NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vai_uuid (uuid),
  KEY idx_vai_listing (listing_id, kind, created_at)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_risk_events (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id       BIGINT UNSIGNED NULL,
  vehicle_id       BIGINT UNSIGNED NULL,
  user_id          BIGINT UNSIGNED NULL,
  signal_code      VARCHAR(64)     NOT NULL,
  severity         ENUM('info','low','medium','high') NOT NULL DEFAULT 'low',
  score_delta      DECIMAL(6,2)    NOT NULL DEFAULT 0,
  detail           VARCHAR(500)    NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_vrisk_listing (listing_id, created_at),
  KEY idx_vrisk_user (user_id, created_at)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_analytics_daily (
  listing_id       BIGINT UNSIGNED NOT NULL,
  day              DATE            NOT NULL,
  views            INT UNSIGNED    NOT NULL DEFAULT 0,
  unique_visitors  INT UNSIGNED    NOT NULL DEFAULT 0,
  favorites        INT UNSIGNED    NOT NULL DEFAULT 0,
  leads            INT UNSIGNED    NOT NULL DEFAULT 0,
  offers           INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (listing_id, day)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS vehicle_content (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           CHAR(36)        NOT NULL,
  kind           ENUM('review','news','buying_guide','maintenance_guide','discussion','model_info')
                   NOT NULL,
  title          VARCHAR(191)    NOT NULL,
  body           MEDIUMTEXT      NULL,
  make_id        INT UNSIGNED    NULL,
  model_id       INT UNSIGNED    NULL,
  author_id      BIGINT UNSIGNED NULL,
  is_published   BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_vcontent_uuid (uuid),
  KEY idx_vcontent_kind (kind, is_published)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Backfill: one vehicle asset per existing vehicle listing.
-- -----------------------------------------------------------------------------
INSERT INTO vehicles (
  uuid, owner_user_id, business_id, vehicle_type, make_id, model_id, variant_id,
  make_name, model_name, variant_name, generation, year, body_type, color_exterior,
  color_interior, color_family, engine_type, engine_cc, cylinders, power_hp, torque_nm,
  engine_number, fuel_type, transmission, drivetrain, battery_kwh, battery_health_pct,
  range_km, doors, seats, country_id, region_id, city_id, latitude, longitude,
  seed_listing_id, status
)
SELECT
  UUID(), l.user_id, l.business_id, vd.vehicle_type, vd.make_id, vd.model_id, vd.variant_id,
  vd.make_name, vd.model_name, vd.variant_name, vd.generation, vd.year, vd.body_type,
  vd.color_exterior, vd.color_interior, vd.color_family, vd.engine_type, vd.engine_cc,
  vd.cylinders, vd.power_hp, vd.torque_nm, vd.engine_number, vd.fuel_type, vd.transmission,
  vd.drivetrain, vd.battery_kwh, vd.battery_health_pct, vd.range_km, vd.doors, vd.seats,
  l.country_id, l.region_id, l.city_id, l.latitude, l.longitude, l.id, 'active'
FROM vehicle_listing_details vd
JOIN listings l ON l.id = vd.listing_id
LEFT JOIN vehicles existing ON existing.seed_listing_id = l.id
WHERE existing.id IS NULL;

UPDATE vehicle_listing_details vd
JOIN vehicles v ON v.seed_listing_id = vd.listing_id
SET vd.vehicle_id = v.id
WHERE vd.vehicle_id IS NULL;

ALTER TABLE vehicle_listing_details
  ADD CONSTRAINT fk_vld_vehicle FOREIGN KEY (vehicle_id)
    REFERENCES vehicles (id) ON DELETE SET NULL ON UPDATE CASCADE;
