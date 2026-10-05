-- =============================================================================
-- 004  Catalog: marketplaces, categories, dynamic attributes
--      This is the extensibility spine (§4 Marketplace Selection, §30 Future Expansion).
--      A new marketplace = rows here, not a schema change.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Marketplaces
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketplaces (
  id             TINYINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(32)  NOT NULL,       -- gold | property | vehicles | jobs | ...
  name           VARCHAR(96)  NOT NULL,
  tagline        VARCHAR(191) NULL,
  icon           VARCHAR(64)  NULL,
  color          VARCHAR(16)  NULL,
  -- Which operations this marketplace supports (§5/§6/§7 Operations)
  operations     JSON         NOT NULL,       -- ["buy","sell","rent","auction"]
  detail_table   VARCHAR(64)  NULL,           -- gold_listing_details | ...
  -- Module-level behaviour toggles, read by the backend MarketplaceModule
  config         JSON         NULL,           -- {"requiresDocuments":true,"allowsAuction":true,...}
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  is_coming_soon BOOLEAN      NOT NULL DEFAULT FALSE,
  sort_order     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_marketplaces_code (code),
  KEY idx_marketplaces_active (is_active, sort_order)
) ENGINE = InnoDB;

-- Per-country availability: a marketplace can launch country by country
CREATE TABLE IF NOT EXISTS marketplace_countries (
  marketplace_id TINYINT UNSIGNED  NOT NULL,
  country_id     SMALLINT UNSIGNED NOT NULL,
  is_active      BOOLEAN           NOT NULL DEFAULT TRUE,
  launched_at    TIMESTAMP         NULL,
  PRIMARY KEY (marketplace_id, country_id),
  CONSTRAINT fk_mp_countries_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mp_countries_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS marketplace_translations (
  marketplace_id TINYINT UNSIGNED NOT NULL,
  language       VARCHAR(10)      NOT NULL,
  name           VARCHAR(96)      NOT NULL,
  tagline        VARCHAR(191)     NULL,
  PRIMARY KEY (marketplace_id, language),
  CONSTRAINT fk_mp_translations_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_mp_translations_lang FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Categories — hierarchical, scoped to a marketplace
-- materialized `path` keeps subtree queries to a single indexed LIKE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  marketplace_id  TINYINT UNSIGNED NOT NULL,
  parent_id       INT UNSIGNED     NULL,
  code            VARCHAR(64)      NOT NULL,
  name            VARCHAR(128)     NOT NULL,
  slug            VARCHAR(160)     NOT NULL,
  path            VARCHAR(512)     NOT NULL DEFAULT '/',   -- "/1/14/57/"
  depth           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  icon            VARCHAR(64)      NULL,
  image_url       VARCHAR(512)     NULL,
  description     VARCHAR(500)     NULL,
  -- Which operations are valid in this category (subset of the marketplace's)
  operations      JSON             NULL,
  -- Group used by the spec's sub-headings: Residential / Commercial / Rental / Land
  group_code      VARCHAR(48)      NULL,
  is_leaf         BOOLEAN          NOT NULL DEFAULT TRUE,
  is_active       BOOLEAN          NOT NULL DEFAULT TRUE,
  listing_count   INT UNSIGNED     NOT NULL DEFAULT 0,
  sort_order      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  seo_title       VARCHAR(191)     NULL,
  seo_description VARCHAR(500)     NULL,
  created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_categories_mp_code (marketplace_id, code),
  UNIQUE KEY uk_categories_mp_slug (marketplace_id, slug),
  KEY idx_categories_parent (parent_id, sort_order),
  KEY idx_categories_path (path(191)),
  KEY idx_categories_active (marketplace_id, is_active, sort_order),
  KEY idx_categories_group (marketplace_id, group_code),
  CONSTRAINT fk_categories_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id)
    REFERENCES categories (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS category_translations (
  category_id INT UNSIGNED NOT NULL,
  language    VARCHAR(10)  NOT NULL,
  name        VARCHAR(128) NOT NULL,
  description VARCHAR(500) NULL,
  PRIMARY KEY (category_id, language),
  CONSTRAINT fk_category_translations_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_category_translations_lang FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Attributes — the dynamic listing schema.
-- Drives: create-listing form, filters (§10), sort, and the compare table (§15).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attributes (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  marketplace_id  TINYINT UNSIGNED NULL,     -- NULL = global attribute (e.g. condition)
  code            VARCHAR(64)      NOT NULL,
  label           VARCHAR(128)     NOT NULL,
  help_text       VARCHAR(255)     NULL,
  data_type       ENUM('string','text','integer','decimal','boolean','date','enum','multi_enum','json')
                    NOT NULL DEFAULT 'string',
  input_type      ENUM('text','textarea','number','select','multiselect','radio','checkbox',
                       'switch','date','range','chips','autocomplete') NOT NULL DEFAULT 'text',
  unit_code       VARCHAR(24)      NULL,     -- FK-ish to measurement_units.code
  unit_group      ENUM('area','weight','distance','volume','none') NOT NULL DEFAULT 'none',
  -- Behaviour flags
  is_required     BOOLEAN          NOT NULL DEFAULT FALSE,
  is_filterable   BOOLEAN          NOT NULL DEFAULT FALSE,
  is_sortable     BOOLEAN          NOT NULL DEFAULT FALSE,
  is_comparable   BOOLEAN          NOT NULL DEFAULT FALSE,
  is_searchable   BOOLEAN          NOT NULL DEFAULT FALSE,
  show_in_card    BOOLEAN          NOT NULL DEFAULT FALSE,
  -- Validation, e.g. {"min":0,"max":9999,"regex":"^[A-Z0-9]+$"}
  validation      JSON             NULL,
  default_value   VARCHAR(191)     NULL,
  filter_widget   ENUM('none','checkbox_list','range_slider','min_max','toggle','select','search')
                    NOT NULL DEFAULT 'none',
  sort_order      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active       BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_attributes_mp_code (marketplace_id, code),
  KEY idx_attributes_filterable (marketplace_id, is_filterable, sort_order),
  CONSTRAINT fk_attributes_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS attribute_options (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  attribute_id INT UNSIGNED NOT NULL,
  value        VARCHAR(96)  NOT NULL,
  label        VARCHAR(128) NOT NULL,
  icon         VARCHAR(64)  NULL,
  sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_attribute_options (attribute_id, value),
  KEY idx_attribute_options_attr (attribute_id, sort_order),
  CONSTRAINT fk_attribute_options_attr FOREIGN KEY (attribute_id)
    REFERENCES attributes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS attribute_translations (
  attribute_id INT UNSIGNED NOT NULL,
  language     VARCHAR(10)  NOT NULL,
  label        VARCHAR(128) NOT NULL,
  help_text    VARCHAR(255) NULL,
  PRIMARY KEY (attribute_id, language),
  CONSTRAINT fk_attribute_translations_attr FOREIGN KEY (attribute_id)
    REFERENCES attributes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS attribute_option_translations (
  option_id INT UNSIGNED NOT NULL,
  language  VARCHAR(10)  NOT NULL,
  label     VARCHAR(128) NOT NULL,
  PRIMARY KEY (option_id, language),
  CONSTRAINT fk_option_translations_option FOREIGN KEY (option_id)
    REFERENCES attribute_options (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Which attributes apply to which category, with per-category overrides
CREATE TABLE IF NOT EXISTS category_attributes (
  category_id   INT UNSIGNED NOT NULL,
  attribute_id  INT UNSIGNED NOT NULL,
  is_required   BOOLEAN      NULL,      -- NULL = inherit from attribute
  is_filterable BOOLEAN      NULL,
  is_comparable BOOLEAN      NULL,
  sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, attribute_id),
  KEY idx_category_attributes_attr (attribute_id),
  CONSTRAINT fk_category_attributes_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_category_attributes_attr FOREIGN KEY (attribute_id)
    REFERENCES attributes (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Brands (shared: gold brands, vehicle makes surface here too for cross-search)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS brands (
  id             INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  marketplace_id TINYINT UNSIGNED NULL,
  name           VARCHAR(128)     NOT NULL,
  slug           VARCHAR(160)     NOT NULL,
  logo_url       VARCHAR(512)     NULL,
  country_id     SMALLINT UNSIGNED NULL,
  is_popular     BOOLEAN          NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN          NOT NULL DEFAULT TRUE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_brands_mp_slug (marketplace_id, slug),
  KEY idx_brands_popular (marketplace_id, is_popular),
  CONSTRAINT fk_brands_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Taxonomy version — lets clients cache categories/attributes and revalidate cheaply
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS taxonomy_versions (
  marketplace_id TINYINT UNSIGNED NOT NULL,
  version        INT UNSIGNED     NOT NULL DEFAULT 1,
  updated_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (marketplace_id),
  CONSTRAINT fk_taxonomy_versions_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Core marketplaces must exist in the migration chain (not only in seeds) so
-- later marketplace migrations that insert categories can run from zero.
INSERT INTO marketplaces (id, code, name, tagline, icon, color, operations, detail_table, config, is_active, is_coming_soon, sort_order) VALUES
  (1, 'gold',     'Gold',     'Buy, sell and auction gold with confidence', 'gem',        '#D4AF37', '["buy","sell","auction"]', 'gold_listing_details',    '{"allowsAuction":true,"requiresCertificate":false,"liveRates":true}', TRUE, FALSE, 1),
  (2, 'property', 'Property', 'Find your next home, office or plot',        'building-2', '#0EA5E9', '["buy","sell","rent"]',    'property_listing_details','{"requiresDocuments":true,"allowsViewings":true}',                    TRUE, FALSE, 2),
  (3, 'vehicles', 'Vehicles', 'Compare and buy your next vehicle',          'car-front',  '#7C3AED', '["buy","sell","rent"]',    'vehicle_listing_details', '{"requiresInspection":false,"comparison":true}',                     TRUE, FALSE, 3)
ON DUPLICATE KEY UPDATE
  code = VALUES(code), name = VALUES(name), tagline = VALUES(tagline),
  operations = VALUES(operations), detail_table = VALUES(detail_table),
  is_active = VALUES(is_active), sort_order = VALUES(sort_order);
