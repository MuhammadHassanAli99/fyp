-- =============================================================================
-- 026  Global Search Platform
--      Extends the derived listing search index, saved/recent/trending search,
--      and adds cache, analytics, evaluation, and embedding linkage.
--
--      Additive only. Does not drop tables, reset data, or introduce a second
--      transactional database. MySQL remains the source of truth; search
--      documents stay a public projection of listings.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Richer public search documents. Private fields (fraud scores, moderation
-- notes, exact hidden coordinates, VIN, private seller data) are never stored.
-- -----------------------------------------------------------------------------
ALTER TABLE listing_search_index
  ADD COLUMN marketplace_code   VARCHAR(32)       NULL AFTER marketplace_id,
  ADD COLUMN category_code      VARCHAR(64)       NULL AFTER category_id,
  ADD COLUMN availability       VARCHAR(24)       NULL AFTER expiration_status,
  ADD COLUMN keywords           VARCHAR(512)      NULL AFTER description,
  ADD COLUMN attributes         JSON              NULL AFTER facets,
  ADD COLUMN published_at       TIMESTAMP         NULL AFTER indexed_at,
  ADD COLUMN quality_score      DECIMAL(8,4)      NOT NULL DEFAULT 0 AFTER search_rank,
  ADD COLUMN public_trust_band  VARCHAR(24)       NULL AFTER quality_score,
  ADD COLUMN content_hash       CHAR(64)          NULL AFTER public_trust_band,
  ADD COLUMN embedding_id       BIGINT UNSIGNED   NULL AFTER content_hash,
  ADD COLUMN hide_exact_location BOOLEAN          NOT NULL DEFAULT FALSE AFTER longitude;

ALTER TABLE listing_search_index
  ADD KEY idx_lsi_category_code (marketplace_id, category_code),
  ADD KEY idx_lsi_content_hash (content_hash),
  ADD KEY idx_lsi_embedding (embedding_id),
  ADD KEY idx_lsi_published (marketplace_id, published_at);

ALTER TABLE listing_search_index
  ADD CONSTRAINT fk_lsi_embedding FOREIGN KEY (embedding_id)
    REFERENCES ai_embeddings (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE listing_search_index ADD FULLTEXT KEY ft_lsi_keywords (keywords);

-- -----------------------------------------------------------------------------
-- Saved searches store both the raw query and the normalised Search DSL.
-- `query` already holds JSON; original_query keeps what the user typed.
-- -----------------------------------------------------------------------------
ALTER TABLE saved_searches
  ADD COLUMN original_query VARCHAR(500) NULL AFTER name,
  ADD COLUMN dsl_hash       CHAR(64)     NULL AFTER query,
  ADD COLUMN language       VARCHAR(10)  NULL AFTER dsl_hash;

ALTER TABLE saved_searches
  ADD KEY idx_saved_searches_dsl (user_id, dsl_hash);

-- -----------------------------------------------------------------------------
-- Recent search: persist the validated DSL next to the raw/normalised text.
-- -----------------------------------------------------------------------------
ALTER TABLE search_history
  ADD COLUMN dsl      JSON         NULL AFTER filters,
  ADD COLUMN language VARCHAR(10)  NULL AFTER search_type,
  ADD COLUMN query_hash CHAR(64)   NULL AFTER normalized_query;

ALTER TABLE search_history
  ADD KEY idx_search_history_hash (query_hash, created_at);

-- -----------------------------------------------------------------------------
-- Trending quality signals beyond raw search count.
-- -----------------------------------------------------------------------------
ALTER TABLE trending_searches
  ADD COLUMN region_id    INT UNSIGNED     NULL AFTER country_id,
  ADD COLUMN unique_users INT UNSIGNED     NOT NULL DEFAULT 0 AFTER search_count,
  ADD COLUMN growth_rate  DECIMAL(8,4)     NOT NULL DEFAULT 0 AFTER click_count,
  ADD COLUMN ctr          DECIMAL(8,4)     NOT NULL DEFAULT 0 AFTER growth_rate;

ALTER TABLE trending_searches
  ADD KEY idx_trending_searches_region (region_id, period, period_start, rank_position);

-- -----------------------------------------------------------------------------
-- Autocomplete: extra kinds used by gold / property / vehicles / parts.
-- -----------------------------------------------------------------------------
ALTER TABLE search_suggestions
  MODIFY COLUMN kind ENUM(
    'keyword','category','brand','model','location','attribute',
    'gold_term','property_kind','vehicle_type','vehicle_part','make'
  ) NOT NULL DEFAULT 'keyword';

-- -----------------------------------------------------------------------------
-- Non-personalized search result cache. Personalized results are never stored.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_result_cache (
  cache_key      CHAR(64)         NOT NULL,
  marketplace_id TINYINT UNSIGNED NULL,
  country_id     SMALLINT UNSIGNED NULL,
  payload        MEDIUMTEXT       NOT NULL,
  hit_count      INT UNSIGNED     NOT NULL DEFAULT 0,
  expires_at     TIMESTAMP        NOT NULL,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (cache_key),
  KEY idx_search_result_cache_expires (expires_at),
  KEY idx_search_result_cache_mp (marketplace_id, country_id)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Search analytics events (impressions, clicks, conversions). Sensitive user
-- fields are not stored here — only ids and coarse geo.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_analytics_events (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  event_type     ENUM(
                   'search','search_success','search_zero_result',
                   'impression','click','favorite','contact','call',
                   'message','share','conversion'
                 ) NOT NULL,
  user_id        BIGINT UNSIGNED  NULL,
  guest_uuid     CHAR(36)         NULL,
  marketplace_id TINYINT UNSIGNED NULL,
  query_hash     CHAR(64)         NULL,
  listing_id     BIGINT UNSIGNED  NULL,
  position       SMALLINT UNSIGNED NULL,
  metadata       JSON             NULL,
  country_id     SMALLINT UNSIGNED NULL,
  city_id        INT UNSIGNED     NULL,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sae_type_time (event_type, created_at),
  KEY idx_sae_query (query_hash, created_at),
  KEY idx_sae_listing (listing_id, event_type, created_at),
  KEY idx_sae_user (user_id, created_at),
  CONSTRAINT fk_sae_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_sae_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_sae_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Offline search-quality evaluation sets (gold / property / vehicle / multilingual).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_evaluation_queries (
  id                   INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  suite                VARCHAR(48)   NOT NULL,
  query_text           VARCHAR(500)  NOT NULL,
  language             VARCHAR(10)   NOT NULL DEFAULT 'en',
  expected_marketplace VARCHAR(32)   NULL,
  expected_operation   VARCHAR(24)   NULL,
  expected_dsl         JSON          NULL,
  notes                VARCHAR(500)  NULL,
  is_active            BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_seq_suite_query (suite, query_text(191)),
  KEY idx_seq_suite (suite, is_active)
) ENGINE = InnoDB;
