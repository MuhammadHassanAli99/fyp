-- =============================================================================
-- 009  Search, favorites, comparison
--      (§9 Search, §10 Filters, §15 Favorites — Save / Collections / Folders /
--       Compare / Share, plus spec lines 1-5: AI auto-compare, manual compare
--       for vehicles and property, sort options)
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Saved searches (§9 Saved Search). The whole normalised filter payload is
-- stored as JSON so a saved search survives filter schema changes (§10),
-- and the alert contract lives next to it — alerts are data, not code.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_searches (
  id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id              BIGINT UNSIGNED  NOT NULL,
  marketplace_id       TINYINT UNSIGNED NULL,          -- NULL = global search (§9)
  name                 VARCHAR(128)     NOT NULL,
  query                JSON             NOT NULL,      -- normalised filter payload
  sort_key             VARCHAR(48)      NULL,          -- sort_options.code
  alert_channel        ENUM('none','push','email','sms','all') NOT NULL DEFAULT 'push',
  alert_frequency      ENUM('instant','daily','weekly','never') NOT NULL DEFAULT 'instant',
  result_count_at_save INT UNSIGNED     NOT NULL DEFAULT 0,
  new_result_count     INT UNSIGNED     NOT NULL DEFAULT 0,   -- badge, reset when opened
  last_run_at          TIMESTAMP        NULL,
  last_notified_at     TIMESTAMP        NULL,
  is_active            BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_saved_searches_user (user_id, is_active, updated_at),
  -- The alert worker polls by frequency + staleness
  KEY idx_saved_searches_alert_queue (is_active, alert_frequency, last_run_at),
  CONSTRAINT fk_saved_searches_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_saved_searches_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Which listings a saved search has already matched, so an alert never
-- double-fires when the search is re-run.
CREATE TABLE IF NOT EXISTS saved_search_matches (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  saved_search_id BIGINT UNSIGNED NOT NULL,
  listing_id      BIGINT UNSIGNED NOT NULL,
  matched_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notified_at     TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_saved_search_matches (saved_search_id, listing_id),
  -- Pending-notification sweep
  KEY idx_saved_search_matches_pending (notified_at, matched_at),
  KEY idx_saved_search_matches_listing (listing_id),
  CONSTRAINT fk_saved_search_matches_search FOREIGN KEY (saved_search_id)
    REFERENCES saved_searches (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_saved_search_matches_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Search history (§9 Recent Search). Append-only; also the raw feed for
-- trending aggregation and for "no results" gap analysis.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_history (
  id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id            BIGINT UNSIGNED  NULL,          -- NULL = guest (§1 Guest Mode)
  guest_uuid         CHAR(36)         NULL,
  marketplace_id     TINYINT UNSIGNED NULL,
  query              VARCHAR(255)     NOT NULL,
  normalized_query   VARCHAR(255)     NOT NULL,      -- lowercased, trimmed, de-accented
  search_type        ENUM('text','voice','image','ai','nearby','global') NOT NULL DEFAULT 'text',
  filters            JSON             NULL,
  sort_key           VARCHAR(48)      NULL,
  result_count       INT UNSIGNED     NOT NULL DEFAULT 0,
  clicked_listing_id BIGINT UNSIGNED  NULL,          -- first click, for relevance tuning
  -- Analytics dimensions are denormalised on purpose: this table is hot and
  -- append-only, so it carries no FK to the geo/platform/session reference data.
  country_id         SMALLINT UNSIGNED NULL,
  city_id            INT UNSIGNED     NULL,
  platform_id        TINYINT UNSIGNED NULL,
  session_id         BIGINT UNSIGNED  NULL,
  created_at         TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- "Recent searches" panel
  KEY idx_search_history_user (user_id, created_at),
  KEY idx_search_history_guest (guest_uuid, created_at),
  -- Trending rollup job scans by term + window
  KEY idx_search_history_trending (marketplace_id, normalized_query(64), created_at),
  KEY idx_search_history_empty (result_count, created_at),
  CONSTRAINT fk_search_history_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_search_history_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_search_history_clicked FOREIGN KEY (clicked_listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Trending searches (§9 Trending Search) — precomputed rollup per
-- marketplace × country × city × period so the home screen is a single read.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trending_searches (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  marketplace_id  TINYINT UNSIGNED NULL,          -- NULL = across all marketplaces
  country_id      SMALLINT UNSIGNED NULL,         -- NULL = worldwide
  city_id         INT UNSIGNED     NULL,
  term            VARCHAR(255)     NOT NULL,      -- display form
  normalized_term VARCHAR(255)     NOT NULL,      -- dedupe/grouping key
  search_count    INT UNSIGNED     NOT NULL DEFAULT 0,
  click_count     INT UNSIGNED     NOT NULL DEFAULT 0,
  period          ENUM('hour','day','week','month') NOT NULL DEFAULT 'day',
  period_start    DATE             NOT NULL,
  rank_position   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  computed_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_trending_searches_dimension
    (marketplace_id, country_id, city_id, period, period_start, normalized_term),
  -- Read path: top N for the current window
  KEY idx_trending_searches_top (marketplace_id, country_id, period, period_start, rank_position),
  CONSTRAINT fk_trending_searches_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_trending_searches_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_trending_searches_city FOREIGN KEY (city_id)
    REFERENCES cities (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Autocomplete dictionary (§9). Mixes admin-curated entries with rows
-- generated from the taxonomy and from search_history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_suggestions (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  marketplace_id TINYINT UNSIGNED NULL,
  term           VARCHAR(191)     NOT NULL,
  kind           ENUM('keyword','category','brand','model','location','attribute')
                   NOT NULL DEFAULT 'keyword',
  -- What tapping the suggestion navigates to (categories/brands/cities/...)
  target_type    VARCHAR(32)      NULL,
  target_id      BIGINT UNSIGNED  NULL,
  weight         INT UNSIGNED     NOT NULL DEFAULT 0,   -- ranking score
  is_curated     BOOLEAN          NOT NULL DEFAULT FALSE,
  is_active      BOOLEAN          NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_search_suggestions_term (marketplace_id, kind, term),
  -- Prefix lookup then weight ordering
  KEY idx_search_suggestions_prefix (marketplace_id, is_active, term(32), weight),
  CONSTRAINT fk_search_suggestions_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Voice search (§9 Voice Search) — keeps the audio, the transcript and the
-- filters it resolved to, so bad transcriptions can be diagnosed and replayed.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voice_search_requests (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NULL,
  audio_url         VARCHAR(512)    NULL,
  duration_ms       INT UNSIGNED    NULL,
  detected_language VARCHAR(10)     NULL,       -- provider output, not always in `languages`
  transcript        VARCHAR(500)    NULL,
  confidence        DECIMAL(5,4)    NULL,
  provider          VARCHAR(32)     NULL,
  resolved_query    VARCHAR(255)    NULL,
  resolved_filters  JSON            NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_voice_search_user (user_id, created_at),
  CONSTRAINT fk_voice_search_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Image search (§9 Image Search). perceptual_hash makes repeat lookups cheap
-- and doubles as the join key to §19 duplicate detection.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS image_search_requests (
  id                      BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id                 BIGINT UNSIGNED  NULL,
  image_url               VARCHAR(512)     NOT NULL,
  perceptual_hash         CHAR(64)         NULL,
  embedding_id            BIGINT UNSIGNED  NULL,   -- row in the AI vector store
  detected_labels         JSON             NULL,
  detected_marketplace_id TINYINT UNSIGNED NULL,
  detected_category_id    INT UNSIGNED     NULL,
  resolved_filters        JSON             NULL,
  result_count            INT UNSIGNED     NOT NULL DEFAULT 0,
  provider                VARCHAR(32)      NULL,
  created_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_image_search_user (user_id, created_at),
  KEY idx_image_search_phash (perceptual_hash),
  CONSTRAINT fk_image_search_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_image_search_mp FOREIGN KEY (detected_marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_image_search_category FOREIGN KEY (detected_category_id)
    REFERENCES categories (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Favorite collections (§15 Collections + Folders). parent_id gives real
-- nesting; share_token turns a collection into a public link (§15 Share).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorite_collections (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  parent_id   BIGINT UNSIGNED NULL,           -- folder tree
  name        VARCHAR(128)    NOT NULL,
  description VARCHAR(500)    NULL,
  icon        VARCHAR(64)     NULL,
  color       VARCHAR(16)     NULL,
  is_default  BOOLEAN         NOT NULL DEFAULT FALSE,   -- the implicit "Saved" folder
  is_public   BOOLEAN         NOT NULL DEFAULT FALSE,
  share_token CHAR(36)        NULL,
  item_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  sort_order  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_favorite_collections_share (share_token),
  UNIQUE KEY uk_favorite_collections_name (user_id, parent_id, name),
  KEY idx_favorite_collections_user (user_id, sort_order),
  KEY idx_favorite_collections_parent (parent_id),
  CONSTRAINT fk_favorite_collections_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Deleting a folder deletes its subfolders; the saved items themselves
  -- survive because favorites.collection_id is SET NULL.
  CONSTRAINT fk_favorite_collections_parent FOREIGN KEY (parent_id)
    REFERENCES favorite_collections (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Favorites (§15 Save). price_at_save is what makes "price dropped since you
-- saved it" possible without reading listing_price_history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id              BIGINT UNSIGNED NOT NULL,
  listing_id           BIGINT UNSIGNED NOT NULL,
  collection_id        BIGINT UNSIGNED NULL,      -- NULL = unfiled
  note                 VARCHAR(500)    NULL,
  price_at_save        DECIMAL(18,2)   NULL,
  currency             CHAR(3)         NULL,
  notify_price_drop    BOOLEAN         NOT NULL DEFAULT TRUE,
  notify_status_change BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_favorites_user_listing (user_id, listing_id),
  KEY idx_favorites_user (user_id, created_at),
  KEY idx_favorites_collection (collection_id, created_at),
  KEY idx_favorites_listing (listing_id),
  -- Price-drop watcher polls the opted-in rows for a listing
  KEY idx_favorites_price_watch (listing_id, notify_price_drop),
  CONSTRAINT fk_favorites_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_favorites_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_favorites_collection FOREIGN KEY (collection_id)
    REFERENCES favorite_collections (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_favorites_price CHECK (price_at_save IS NULL OR price_at_save >= 0)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Comparison sets (§15 Compare, spec lines 2 and 4 — manual PakWheels-style
-- compare for vehicles and property). Guests may compare before logging in,
-- so ownership is user_id OR guest_uuid.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comparison_sets (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid           CHAR(36)         NOT NULL,
  user_id        BIGINT UNSIGNED  NULL,
  guest_uuid     CHAR(36)         NULL,
  marketplace_id TINYINT UNSIGNED NOT NULL,     -- compare never crosses modules
  name           VARCHAR(128)     NULL,
  share_token    CHAR(36)         NULL,         -- §15 Share
  item_count     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  is_pinned      BOOLEAN          NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_comparison_sets_uuid (uuid),
  UNIQUE KEY uk_comparison_sets_share (share_token),
  KEY idx_comparison_sets_user (user_id, updated_at),
  KEY idx_comparison_sets_guest (guest_uuid, updated_at),
  CONSTRAINT fk_comparison_sets_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_comparison_sets_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
  -- "user_id OR guest_uuid must be present" is enforced in the service layer:
  -- MySQL forbids a CHECK on a column that also carries a cascading foreign key.
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS comparison_items (
  id                 BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  comparison_set_id  BIGINT UNSIGNED  NOT NULL,
  listing_id         BIGINT UNSIGNED  NOT NULL,
  position           TINYINT UNSIGNED NOT NULL DEFAULT 0,   -- column order in the table
  added_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_comparison_items (comparison_set_id, listing_id),
  KEY idx_comparison_items_set (comparison_set_id, position),
  KEY idx_comparison_items_listing (listing_id),
  CONSTRAINT fk_comparison_items_set FOREIGN KEY (comparison_set_id)
    REFERENCES comparison_sets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_comparison_items_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- AI auto-compare (spec line 1: "when user enter 3 or 4 cars name for compare
-- then should AI automatically compare the car"). Fires when a set reaches the
-- threshold; the structured verdict is cached until expires_at so re-opening a
-- set costs nothing. listing_ids is snapshotted because the set can change.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comparison_ai_results (
  id                        BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid                      CHAR(36)         NOT NULL,
  comparison_set_id         BIGINT UNSIGNED  NOT NULL,
  listing_ids               JSON             NOT NULL,   -- snapshot the verdict applies to
  item_count                TINYINT UNSIGNED NOT NULL DEFAULT 0,
  verdict_summary           TEXT             NULL,
  best_overall_listing_id   BIGINT UNSIGNED  NULL,
  best_value_listing_id     BIGINT UNSIGNED  NULL,
  best_condition_listing_id BIGINT UNSIGNED  NULL,
  criteria_scores           JSON             NULL,       -- {listingId: {criterion: score}}
  pros_cons                 JSON             NULL,       -- {listingId: {pros:[],cons:[]}}
  recommendation            TEXT             NULL,
  differences               JSON             NULL,       -- only the fields that differ
  model                     VARCHAR(64)      NULL,
  tokens_used               INT UNSIGNED     NULL,
  latency_ms                INT UNSIGNED     NULL,
  language                  VARCHAR(10)      NULL,
  generated_at              TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at                TIMESTAMP        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_comparison_ai_uuid (uuid),
  KEY idx_comparison_ai_set (comparison_set_id, generated_at),
  KEY idx_comparison_ai_expiry (expires_at),
  CONSTRAINT fk_comparison_ai_set FOREIGN KEY (comparison_set_id)
    REFERENCES comparison_sets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_comparison_ai_best_overall FOREIGN KEY (best_overall_listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_comparison_ai_best_value FOREIGN KEY (best_value_listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_comparison_ai_best_condition FOREIGN KEY (best_condition_listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Sort options (spec "also add sort option", §9/§10). Admin-configurable per
-- marketplace so 'mileage_asc' exists for vehicles and 'area_desc' for
-- property without a client release.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sort_options (
  id                SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  marketplace_id    TINYINT UNSIGNED  NULL,        -- NULL = available everywhere
  code              VARCHAR(48)       NOT NULL,    -- price_asc | date_desc | relevance
  label             VARCHAR(96)       NOT NULL,
  sort_field        VARCHAR(96)       NOT NULL,    -- column or attribute code
  direction         ENUM('asc','desc') NOT NULL DEFAULT 'asc',
  applies_to        ENUM('listings','search','all') NOT NULL DEFAULT 'all',
  requires_location BOOLEAN           NOT NULL DEFAULT FALSE,  -- e.g. distance_asc
  is_default        BOOLEAN           NOT NULL DEFAULT FALSE,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active         BOOLEAN           NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sort_options_mp_code (marketplace_id, code),
  KEY idx_sort_options_active (marketplace_id, is_active, sort_order),
  CONSTRAINT fk_sort_options_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
