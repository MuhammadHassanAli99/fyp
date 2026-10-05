-- =============================================================================
-- 023  Property marketplace domain completion
--      Separates the real-world PROPERTY asset from LISTING (offer) and
--      TRANSACTION (snapshot). Extends 007 without dropping tables or
--      rewriting existing listing rows. Reuses listings, listing_offers,
--      listing_documents, payments, saved_searches, notifications, fraud.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Global enumerations needed by Property commerce (additive).
-- -----------------------------------------------------------------------------
ALTER TABLE listing_offers
  MODIFY COLUMN status ENUM(
    'pending','countered','accepted','rejected','withdrawn','expired','cancelled'
  ) NOT NULL DEFAULT 'pending',
  ADD COLUMN conditions VARCHAR(1000) NULL AFTER message,
  ADD COLUMN deposit_amount DECIMAL(18,2) NULL AFTER conditions,
  ADD COLUMN deposit_currency CHAR(3) NULL AFTER deposit_amount;

ALTER TABLE listing_documents
  MODIFY COLUMN doc_type ENUM(
    'ownership','title_deed','title_registry','map','site_plan','approval','noc',
    'tax_receipt','registration','transfer_letter','inspection','certificate',
    'assay','invoice','insurance','building_approval','completion_certificate','other'
  ) NOT NULL,
  ADD COLUMN verification_status ENUM(
    'unverified','pending','processing','needs_review','verified','rejected','expired'
  ) NOT NULL DEFAULT 'unverified' AFTER is_public,
  ADD COLUMN rejection_reason VARCHAR(500) NULL AFTER verified_by,
  ADD COLUMN processing_status ENUM(
    'uploaded','validating','scanning','ocr','classified','extracted','review','complete','failed'
  ) NOT NULL DEFAULT 'uploaded' AFTER rejection_reason,
  ADD COLUMN ocr_text MEDIUMTEXT NULL AFTER processing_status,
  ADD COLUMN extracted_data JSON NULL AFTER ocr_text,
  ADD COLUMN scan_status ENUM('pending','clean','blocked','skipped_no_scanner')
    NOT NULL DEFAULT 'pending' AFTER extracted_data;

ALTER TABLE orders
  MODIFY COLUMN kind ENUM(
    'subscription','promotion','advertisement','verification','inspection','service',
    'wallet_topup','auction_deposit','listing_purchase','escrow',
    'rental_deposit','rental_payment','booking_payment'
  ) NOT NULL;

ALTER TABLE order_items
  MODIFY COLUMN kind ENUM(
    'subscription','promotion','advertisement','verification','inspection','service',
    'wallet_topup','auction_deposit','tax','fee','listing_purchase','escrow',
    'rental_deposit','rental_payment','booking_payment'
  ) NOT NULL;

-- -----------------------------------------------------------------------------
-- Config-driven property types + allowed transaction types.
-- Categories remain the public taxonomy; this table is the validation source.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_type_rules (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_kind      VARCHAR(48)  NOT NULL,
  usage_group        ENUM('residential','commercial','hospitality','rental','land','industrial','mixed')
                       NOT NULL,
  category_code      VARCHAR(64)  NULL,
  allowed_operations JSON         NOT NULL,   -- ["buy","sell","rent"]
  requires_bedrooms  BOOLEAN      NOT NULL DEFAULT FALSE,
  requires_covered_area BOOLEAN   NOT NULL DEFAULT FALSE,
  is_land            BOOLEAN      NOT NULL DEFAULT FALSE,
  is_hospitality     BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_type_kind (property_kind)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_area_units (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  code           VARCHAR(24)      NOT NULL,
  name           VARCHAR(64)      NOT NULL,
  symbol         VARCHAR(24)      NOT NULL,
  to_sqm         DECIMAL(18,10)   NOT NULL,
  country_id     SMALLINT UNSIGNED NULL,
  is_default     BOOLEAN          NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN          NOT NULL DEFAULT TRUE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_area_unit (code, country_id),
  KEY idx_property_area_unit_country (country_id, is_active),
  CONSTRAINT fk_property_area_unit_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_property_area_unit_factor CHECK (to_sqm > 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_rental_durations (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(32)  NOT NULL,
  name           VARCHAR(64)  NOT NULL,
  stay_kind      ENUM('short_term','long_term','either') NOT NULL DEFAULT 'either',
  duration_days  INT UNSIGNED NULL,          -- NULL = custom
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_rental_duration (code)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_attributes (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(64)  NOT NULL,
  name           VARCHAR(128) NOT NULL,
  data_type      ENUM('boolean','number','enum','text','json') NOT NULL DEFAULT 'boolean',
  unit_code      VARCHAR(24)  NULL,
  applies_to     JSON         NULL,
  is_filterable  BOOLEAN      NOT NULL DEFAULT TRUE,
  is_required    BOOLEAN      NOT NULL DEFAULT FALSE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_attr_code (code)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- PROPERTY — the real-world asset. Listings offer it for sale or rent.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  owner_user_id        BIGINT UNSIGNED NOT NULL,
  business_id          BIGINT UNSIGNED NULL,
  property_kind        VARCHAR(48)     NOT NULL,
  usage_type           ENUM('residential','commercial','rental','hospitality','land','industrial','mixed')
                         NOT NULL DEFAULT 'residential',
  title                VARCHAR(191)    NULL,
  country_id           SMALLINT UNSIGNED NOT NULL,
  region_id            INT UNSIGNED    NULL,
  city_id              INT UNSIGNED    NULL,
  area_id              INT UNSIGNED    NULL,
  neighborhood         VARCHAR(160)    NULL,
  street               VARCHAR(160)    NULL,
  building_name        VARCHAR(160)    NULL,
  postal_code          VARCHAR(24)     NULL,
  latitude             DECIMAL(10,7)   NULL,
  longitude            DECIMAL(10,7)   NULL,
  public_latitude      DECIMAL(10,7)   NULL,
  public_longitude     DECIMAL(10,7)   NULL,
  location_privacy     ENUM('public_exact','approximate','private') NOT NULL DEFAULT 'approximate',
  boundary_geojson     JSON            NULL,
  project_id           BIGINT UNSIGNED NULL,
  unit_id              BIGINT UNSIGNED NULL,
  seed_listing_id      BIGINT UNSIGNED NULL,
  status               ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at           TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_properties_uuid (uuid),
  KEY idx_properties_owner (owner_user_id, status),
  KEY idx_properties_business (business_id, status),
  KEY idx_properties_kind (property_kind, usage_type),
  KEY idx_properties_geo (country_id, city_id, area_id),
  CONSTRAINT fk_properties_owner FOREIGN KEY (owner_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_properties_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_properties_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_areas (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id    BIGINT UNSIGNED NOT NULL,
  area_type      ENUM('covered','plot','land','carpet','built_up','super','other') NOT NULL,
  value          DECIMAL(14,4)   NOT NULL,
  unit           VARCHAR(24)     NOT NULL,
  value_sqm      DECIMAL(14,4)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_area_type (property_id, area_type),
  KEY idx_property_areas_sqm (value_sqm),
  CONSTRAINT fk_property_areas_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_property_areas_value CHECK (value >= 0 AND value_sqm >= 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_attribute_values (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id    BIGINT UNSIGNED NOT NULL,
  attribute_id   INT UNSIGNED    NOT NULL,
  value_text     VARCHAR(500)    NULL,
  value_number   DECIMAL(20,4)   NULL,
  value_bool     BOOLEAN         NULL,
  value_json     JSON            NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pav_property_attr (property_id, attribute_id),
  KEY idx_pav_attr (attribute_id, value_number),
  CONSTRAINT fk_pav_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_pav_attribute FOREIGN KEY (attribute_id)
    REFERENCES property_attributes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_parking (
  property_id        BIGINT UNSIGNED NOT NULL,
  available          BOOLEAN         NOT NULL DEFAULT FALSE,
  covered_spaces     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  open_spaces        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  basement_spaces    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  total_spaces       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id),
  CONSTRAINT fk_property_parking_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Builder / project hierarchy: Project → Building → Floor → Unit
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_projects (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)        NOT NULL,
  business_id      BIGINT UNSIGNED NOT NULL,
  owner_user_id    BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(191)    NOT NULL,
  slug             VARCHAR(220)    NOT NULL,
  description      MEDIUMTEXT      NULL,
  country_id       SMALLINT UNSIGNED NOT NULL,
  city_id          INT UNSIGNED    NULL,
  area_id          INT UNSIGNED    NULL,
  status           ENUM('draft','selling','under_construction','completed','archived')
                     NOT NULL DEFAULT 'draft',
  expected_completion DATE         NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_projects_uuid (uuid),
  UNIQUE KEY uk_property_projects_slug (business_id, slug),
  KEY idx_property_projects_business (business_id, status),
  CONSTRAINT fk_property_projects_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_projects_owner FOREIGN KEY (owner_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_buildings (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id       BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(128)    NOT NULL,
  total_floors     SMALLINT UNSIGNED NULL,
  sort_order       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_property_buildings_project (project_id),
  CONSTRAINT fk_property_buildings_project FOREIGN KEY (project_id)
    REFERENCES property_projects (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_floors (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  building_id      BIGINT UNSIGNED NOT NULL,
  floor_number     SMALLINT        NOT NULL,
  name             VARCHAR(64)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_floor (building_id, floor_number),
  CONSTRAINT fk_property_floors_building FOREIGN KEY (building_id)
    REFERENCES property_buildings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_units (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  floor_id         BIGINT UNSIGNED NOT NULL,
  property_id      BIGINT UNSIGNED NULL,
  unit_number      VARCHAR(48)     NOT NULL,
  unit_type        VARCHAR(48)     NULL,
  status           ENUM('available','reserved','sold','rented','held') NOT NULL DEFAULT 'available',
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_unit (floor_id, unit_number),
  KEY idx_property_units_property (property_id),
  CONSTRAINT fk_property_units_floor FOREIGN KEY (floor_id)
    REFERENCES property_floors (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_units_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Ownership (high-trust). Clients cannot write verification_status = verified.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_ownership (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id          BIGINT UNSIGNED NOT NULL,
  owner_user_id        BIGINT UNSIGNED NOT NULL,
  ownership_type       ENUM('freehold','leasehold','power_of_attorney','allotment','shared','other')
                         NOT NULL DEFAULT 'freehold',
  share_percent        DECIMAL(5,2)    NULL,
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
  KEY idx_property_ownership_property (property_id, status),
  KEY idx_property_ownership_owner (owner_user_id),
  CONSTRAINT fk_property_ownership_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_ownership_user FOREIGN KEY (owner_user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_verifications (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  property_id          BIGINT UNSIGNED NOT NULL,
  listing_id           BIGINT UNSIGNED NULL,
  dimension            ENUM('seller_identity','business_identity','ownership','documents',
                            'location','listing_information','property_inspection') NOT NULL,
  status               ENUM('unverified','pending','verified','rejected','expired')
                         NOT NULL DEFAULT 'unverified',
  verified_by          BIGINT UNSIGNED NULL,
  verified_at          TIMESTAMP       NULL,
  rejection_reason     VARCHAR(500)    NULL,
  notes                VARCHAR(500)    NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_verification_dim (property_id, listing_id, dimension),
  KEY idx_property_verification_listing (listing_id, dimension),
  CONSTRAINT fk_property_verification_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_verification_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_documents (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  property_id          BIGINT UNSIGNED NOT NULL,
  listing_document_id  BIGINT UNSIGNED NULL,
  doc_type             ENUM('ownership','title_registry','map','approval','noc','tax',
                            'building_approval','completion_certificate','other') NOT NULL,
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
  UNIQUE KEY uk_property_documents_uuid (uuid),
  KEY idx_property_documents_property (property_id, doc_type),
  KEY idx_property_documents_status (verification_status, processing_status),
  CONSTRAINT fk_property_documents_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_documents_listing_doc FOREIGN KEY (listing_document_id)
    REFERENCES listing_documents (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_property_documents_uploader FOREIGN KEY (uploaded_by)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Offer audit (listing_offers is the spine).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_offer_events (
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
  KEY idx_property_offer_events (offer_id, created_at),
  CONSTRAINT fk_property_offer_events_offer FOREIGN KEY (offer_id)
    REFERENCES listing_offers (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Availability, hospitality inventory, applications, bookings, leases
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_availability (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id         BIGINT UNSIGNED NOT NULL,
  property_id        BIGINT UNSIGNED NULL,
  available_from     DATE            NULL,
  available_until    DATE            NULL,
  min_stay_days      SMALLINT UNSIGNED NULL,
  max_stay_days      SMALLINT UNSIGNED NULL,
  occupancy_max      SMALLINT UNSIGNED NULL,
  check_in_time      CHAR(5)         NULL,
  check_out_time     CHAR(5)         NULL,
  instant_book       BOOLEAN         NOT NULL DEFAULT FALSE,
  status             ENUM('available','limited','unavailable') NOT NULL DEFAULT 'available',
  updated_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_availability_listing (listing_id),
  KEY idx_property_availability_from (available_from),
  CONSTRAINT fk_property_avail_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_avail_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_availability_blocks (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  start_date     DATE            NOT NULL,
  end_date       DATE            NOT NULL,
  reason         ENUM('booked','blocked','maintenance','owner_use','other') NOT NULL DEFAULT 'blocked',
  notes          VARCHAR(255)    NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_property_blocks_listing (listing_id, start_date, end_date),
  CONSTRAINT fk_property_blocks_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_property_block_range CHECK (end_date >= start_date)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_room_types (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id     BIGINT UNSIGNED NOT NULL,
  property_id    BIGINT UNSIGNED NULL,
  code           VARCHAR(48)     NOT NULL,
  name           VARCHAR(128)    NOT NULL,
  occupancy      TINYINT UNSIGNED NOT NULL DEFAULT 1,
  bed_count      TINYINT UNSIGNED NULL,
  privacy        ENUM('private','shared','mixed') NOT NULL DEFAULT 'private',
  quantity       SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  amenities      JSON            NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_room_type (listing_id, code),
  CONSTRAINT fk_property_room_types_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_applications (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  listing_id           BIGINT UNSIGNED NOT NULL,
  property_id          BIGINT UNSIGNED NULL,
  applicant_id         BIGINT UNSIGNED NOT NULL,
  landlord_id          BIGINT UNSIGNED NOT NULL,
  message              VARCHAR(1000)   NULL,
  occupants            TINYINT UNSIGNED NULL,
  desired_start        DATE            NULL,
  desired_end          DATE            NULL,
  status               ENUM('draft','submitted','under_review','accepted','rejected','withdrawn','expired')
                         NOT NULL DEFAULT 'submitted',
  identity_verified    BOOLEAN         NOT NULL DEFAULT FALSE,
  rejection_reason     VARCHAR(500)    NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_applications_uuid (uuid),
  KEY idx_property_applications_listing (listing_id, status),
  KEY idx_property_applications_applicant (applicant_id, status),
  CONSTRAINT fk_property_app_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_app_applicant FOREIGN KEY (applicant_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_app_landlord FOREIGN KEY (landlord_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_bookings (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  listing_id           BIGINT UNSIGNED NOT NULL,
  property_id          BIGINT UNSIGNED NULL,
  room_type_id         BIGINT UNSIGNED NULL,
  guest_id             BIGINT UNSIGNED NOT NULL,
  host_id              BIGINT UNSIGNED NOT NULL,
  check_in             DATE            NOT NULL,
  check_out            DATE            NOT NULL,
  guests               TINYINT UNSIGNED NOT NULL DEFAULT 1,
  amount               DECIMAL(18,2)   NOT NULL,
  currency             CHAR(3)         NOT NULL,
  deposit_amount       DECIMAL(18,2)   NULL,
  order_id             BIGINT UNSIGNED NULL,
  status               ENUM('pending','confirmed','checked_in','checked_out','cancelled','expired','no_show')
                         NOT NULL DEFAULT 'pending',
  legal_status         ENUM('not_applicable','pending','complete') NOT NULL DEFAULT 'not_applicable',
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_bookings_uuid (uuid),
  KEY idx_property_bookings_listing (listing_id, check_in, status),
  KEY idx_property_bookings_guest (guest_id, status),
  CONSTRAINT fk_property_bookings_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_bookings_guest FOREIGN KEY (guest_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_bookings_host FOREIGN KEY (host_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_bookings_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_property_booking_dates CHECK (check_out > check_in),
  CONSTRAINT chk_property_booking_amount CHECK (amount >= 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_leases (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  property_id          BIGINT UNSIGNED NOT NULL,
  listing_id           BIGINT UNSIGNED NOT NULL,
  landlord_id          BIGINT UNSIGNED NOT NULL,
  tenant_id            BIGINT UNSIGNED NOT NULL,
  application_id       BIGINT UNSIGNED NULL,
  start_date           DATE            NOT NULL,
  end_date             DATE            NULL,
  rent_amount          DECIMAL(18,2)   NOT NULL,
  currency             CHAR(3)         NOT NULL,
  deposit_amount       DECIMAL(18,2)   NULL,
  payment_frequency    ENUM('weekly','monthly','custom') NOT NULL DEFAULT 'monthly',
  custom_interval_days SMALLINT UNSIGNED NULL,
  utilities            JSON            NULL,
  conditions           VARCHAR(2000)   NULL,
  status               ENUM('draft','pending_signature','active','expired','terminated','cancelled')
                         NOT NULL DEFAULT 'draft',
  next_due_date        DATE            NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_leases_uuid (uuid),
  KEY idx_property_leases_listing (listing_id, status),
  KEY idx_property_leases_tenant (tenant_id, status),
  KEY idx_property_leases_due (status, next_due_date),
  CONSTRAINT fk_property_leases_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_property_leases_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_property_leases_landlord FOREIGN KEY (landlord_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_property_leases_tenant FOREIGN KEY (tenant_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_property_lease_rent CHECK (rent_amount >= 0)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_lease_payments (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lease_id       BIGINT UNSIGNED NOT NULL,
  due_date       DATE            NOT NULL,
  amount         DECIMAL(18,2)   NOT NULL,
  currency       CHAR(3)         NOT NULL,
  order_id       BIGINT UNSIGNED NULL,
  status         ENUM('scheduled','due','paid','overdue','waived','failed') NOT NULL DEFAULT 'scheduled',
  paid_at        TIMESTAMP       NULL,
  receipt_ref    VARCHAR(64)     NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_property_lease_pay_lease (lease_id, due_date),
  KEY idx_property_lease_pay_due (status, due_date),
  CONSTRAINT fk_property_lease_pay_lease FOREIGN KEY (lease_id)
    REFERENCES property_leases (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_property_lease_pay_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_property_lease_pay_amount CHECK (amount >= 0)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Transaction snapshot — listing edits after a deal must not rewrite history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_transaction_snapshots (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id             BIGINT UNSIGNED NULL,
  offer_id             BIGINT UNSIGNED NULL,
  lease_id             BIGINT UNSIGNED NULL,
  booking_id           BIGINT UNSIGNED NULL,
  property_id          BIGINT UNSIGNED NOT NULL,
  listing_id           BIGINT UNSIGNED NOT NULL,
  property_kind        VARCHAR(48)     NOT NULL,
  transaction_type     ENUM('sale','rent','booking') NOT NULL,
  area_value           DECIMAL(14,4)   NULL,
  area_unit            VARCHAR(24)     NULL,
  area_sqm             DECIMAL(14,4)   NULL,
  location_label       VARCHAR(255)    NULL,
  country_id           SMALLINT UNSIGNED NULL,
  city_id              INT UNSIGNED    NULL,
  price                DECIMAL(18,2)   NOT NULL,
  currency             CHAR(3)         NOT NULL,
  seller_id            BIGINT UNSIGNED NOT NULL,
  buyer_id             BIGINT UNSIGNED NOT NULL,
  verification_state   JSON            NULL,
  payment_status       VARCHAR(32)     NULL,
  legal_status         VARCHAR(32)     NULL,
  snapshot_json        JSON            NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_property_tx_listing (listing_id),
  KEY idx_property_tx_order (order_id),
  CONSTRAINT fk_property_tx_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_property_tx_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- AI assessments + risk events (assistance only — never legal proof).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS property_ai_assessments (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)        NOT NULL,
  listing_id       BIGINT UNSIGNED NULL,
  property_id      BIGINT UNSIGNED NULL,
  user_id          BIGINT UNSIGNED NULL,
  kind             ENUM('valuation','listing_quality','image_analysis','duplicate','fraud_assist','search_assist')
                     NOT NULL,
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
  UNIQUE KEY uk_property_ai_uuid (uuid),
  KEY idx_property_ai_listing (listing_id, kind, created_at),
  CONSTRAINT fk_property_ai_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_risk_events (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id       BIGINT UNSIGNED NULL,
  property_id      BIGINT UNSIGNED NULL,
  user_id          BIGINT UNSIGNED NULL,
  signal_code      VARCHAR(64)     NOT NULL,
  severity         ENUM('info','low','medium','high') NOT NULL DEFAULT 'low',
  score_delta      DECIMAL(6,2)    NOT NULL DEFAULT 0,
  detail           VARCHAR(500)    NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_property_risk_listing (listing_id, created_at),
  KEY idx_property_risk_user (user_id, created_at)
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_analytics_daily (
  listing_id       BIGINT UNSIGNED NOT NULL,
  day              DATE            NOT NULL,
  views            INT UNSIGNED    NOT NULL DEFAULT 0,
  unique_visitors  INT UNSIGNED    NOT NULL DEFAULT 0,
  favorites        INT UNSIGNED    NOT NULL DEFAULT 0,
  messages         INT UNSIGNED    NOT NULL DEFAULT 0,
  calls            INT UNSIGNED    NOT NULL DEFAULT 0,
  leads            INT UNSIGNED    NOT NULL DEFAULT 0,
  offers           INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (listing_id, day),
  CONSTRAINT fk_property_analytics_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS property_map_providers (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(32)  NOT NULL,
  name           VARCHAR(64)  NOT NULL,
  is_default     BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  config         JSON         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_property_map_provider (code)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Extend hot-path listing details (007) with Property asset link + extras.
-- Existing rows stay valid; new columns are nullable / defaulted.
-- -----------------------------------------------------------------------------
ALTER TABLE property_listing_details
  ADD COLUMN property_id BIGINT UNSIGNED NULL AFTER listing_id,
  ADD COLUMN parking_available BOOLEAN NOT NULL DEFAULT FALSE AFTER parking_spaces,
  ADD COLUMN parking_covered TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER parking_available,
  ADD COLUMN parking_open TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER parking_covered,
  ADD COLUMN parking_basement TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER parking_open,
  ADD COLUMN plot_area_value DECIMAL(14,3) NULL AFTER covered_area_sqm,
  ADD COLUMN plot_area_unit VARCHAR(24) NULL AFTER plot_area_value,
  ADD COLUMN plot_area_sqm DECIMAL(14,3) NULL AFTER plot_area_unit,
  ADD COLUMN land_area_value DECIMAL(14,3) NULL AFTER plot_area_sqm,
  ADD COLUMN land_area_unit VARCHAR(24) NULL AFTER land_area_value,
  ADD COLUMN land_area_sqm DECIMAL(14,3) NULL AFTER land_area_unit,
  ADD COLUMN length_m DECIMAL(12,3) NULL AFTER depth_ft,
  ADD COLUMN width_m DECIMAL(12,3) NULL AFTER length_m,
  ADD COLUMN development_status ENUM('raw','semi_developed','developed','other') NULL AFTER is_cultivated,
  ADD COLUMN irrigation VARCHAR(96) NULL AFTER development_status,
  ADD COLUMN land_use VARCHAR(96) NULL AFTER irrigation,
  ADD COLUMN warehouse_capacity DECIMAL(14,3) NULL AFTER loading_docks,
  ADD COLUMN power_capacity_kva DECIMAL(12,2) NULL AFTER warehouse_capacity,
  ADD COLUMN has_generator BOOLEAN NOT NULL DEFAULT FALSE AFTER power_capacity_kva,
  ADD COLUMN has_loading_area BOOLEAN NOT NULL DEFAULT FALSE AFTER has_generator,
  ADD COLUMN office_rooms TINYINT UNSIGNED NULL AFTER has_loading_area,
  ADD COLUMN meeting_rooms TINYINT UNSIGNED NULL AFTER office_rooms,
  ADD COLUMN has_reception BOOLEAN NOT NULL DEFAULT FALSE AFTER meeting_rooms,
  ADD COLUMN access_hours VARCHAR(64) NULL AFTER has_reception,
  ADD COLUMN check_in_time CHAR(5) NULL AFTER meals_included,
  ADD COLUMN check_out_time CHAR(5) NULL AFTER check_in_time,
  ADD COLUMN occupancy_max TINYINT UNSIGNED NULL AFTER check_out_time,
  ADD COLUMN lease_min_months TINYINT UNSIGNED NULL AFTER occupancy_max,
  ADD COLUMN lease_max_months SMALLINT UNSIGNED NULL AFTER lease_min_months,
  ADD COLUMN public_latitude DECIMAL(10,7) NULL AFTER society_name,
  ADD COLUMN public_longitude DECIMAL(10,7) NULL AFTER public_latitude,
  ADD COLUMN location_privacy ENUM('public_exact','approximate','private')
    NOT NULL DEFAULT 'approximate' AFTER public_longitude,
  ADD COLUMN project_id BIGINT UNSIGNED NULL AFTER location_privacy,
  ADD COLUMN unit_id BIGINT UNSIGNED NULL AFTER project_id,
  ADD KEY idx_property_details_property (property_id),
  ADD CONSTRAINT fk_property_details_property FOREIGN KEY (property_id)
    REFERENCES properties (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE property_valuations
  ADD COLUMN model_id VARCHAR(64) NULL AFTER model,
  ADD COLUMN model_version VARCHAR(32) NULL AFTER model_id,
  ADD COLUMN feature_version VARCHAR(32) NOT NULL DEFAULT '1' AFTER model_version,
  ADD COLUMN result_status ENUM('ready','partial','failed') NOT NULL DEFAULT 'ready' AFTER feature_version,
  ADD COLUMN disclaimer VARCHAR(500) NULL AFTER explanation;

-- Backfill a Property asset for every existing property listing.
INSERT INTO properties (
  uuid, owner_user_id, business_id, property_kind, usage_type, title,
  country_id, region_id, city_id, area_id, neighborhood, street, building_name,
  postal_code, latitude, longitude, public_latitude, public_longitude,
  location_privacy, seed_listing_id, status, created_at
)
SELECT
  UUID(),
  l.user_id,
  l.business_id,
  pd.property_kind,
  CASE
    WHEN pd.usage_type = 'rental' AND pd.property_kind IN ('hotel','guest_house','hostel','room')
      THEN 'hospitality'
    ELSE pd.usage_type
  END,
  l.title,
  l.country_id,
  l.region_id,
  l.city_id,
  l.area_id,
  pd.society_name,
  NULL,
  pd.building_name,
  l.postal_code,
  l.latitude,
  l.longitude,
  CASE WHEN l.hide_exact_location = 1 THEN NULL ELSE l.latitude END,
  CASE WHEN l.hide_exact_location = 1 THEN NULL ELSE l.longitude END,
  CASE WHEN l.hide_exact_location = 1 THEN 'approximate' ELSE 'public_exact' END,
  l.id,
  'active',
  l.created_at
FROM property_listing_details pd
JOIN listings l ON l.id = pd.listing_id
WHERE pd.property_id IS NULL;

UPDATE property_listing_details pd
  JOIN properties p ON p.seed_listing_id = pd.listing_id
   SET pd.property_id = p.id
 WHERE pd.property_id IS NULL;

ALTER TABLE properties DROP COLUMN seed_listing_id;
