-- =============================================================================
-- 015  AI: provider registry, universal job ledger, generated content,
--      embeddings, price recommendation, market analysis, translation cache,
--      moderation results, recommendations, search interpretation, chatbot
--      (§18 AI Features, plus the AI hooks in §5 gold trends, §6 property
--       valuation, §7 vehicle estimates, §9 smart search, §12 translation)
--
-- Every AI call lands in ai_jobs first; the specialised tables below store the
-- typed result and point back at the job for cost, latency and audit.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Provider registry (§18). One row per (vendor, capability) so the failover
-- chain can be ordered independently per capability — e.g. vision falls back
-- differently than the LLM.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_providers (
  id                  SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                VARCHAR(48)       NOT NULL,
  name                VARCHAR(96)       NOT NULL,
  capability          ENUM('llm','vision','embedding','translation','speech_to_text',
                           'text_to_speech','moderation','ocr','image_generation',
                           'image_enhancement') NOT NULL,
  base_url            VARCHAR(255)      NULL,
  model_default       VARCHAR(96)       NULL,
  is_active           BOOLEAN           NOT NULL DEFAULT TRUE,
  priority            TINYINT UNSIGNED  NOT NULL DEFAULT 100,   -- lower = tried first
  max_rpm             INT UNSIGNED      NULL,
  max_tokens          INT UNSIGNED      NULL,
  cost_per_1k_input   DECIMAL(12,6)     NULL,
  cost_per_1k_output  DECIMAL(12,6)     NULL,
  currency            CHAR(3)           NULL,
  config              JSON              NULL,   -- vendor-specific knobs, secrets by reference only
  health_status       ENUM('healthy','degraded','down') NOT NULL DEFAULT 'healthy',
  last_health_check_at TIMESTAMP        NULL,
  created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_providers_code_capability (code, capability),
  -- The failover lookup: "healthy, active providers for this capability, in order"
  KEY idx_ai_providers_failover (capability, is_active, health_status, priority),
  CONSTRAINT fk_ai_providers_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Universal record of every AI invocation: the single place to answer
-- "what did AI cost us", "which calls failed" and "what did the model see".
-- provider_code is denormalised text, not an FK, so retiring a provider row
-- never rewrites or blocks the history.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_jobs (
  id                BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)         NOT NULL,
  task              ENUM('description_generate','title_generate','image_enhance','image_moderate',
                         'duplicate_detect','spam_detect','fraud_detect','price_recommend',
                         'market_analysis','property_valuation','vehicle_estimate','gold_trend',
                         'translate','smart_search','recommend','chat_support','compare','ocr',
                         'embed','speech_to_text','review_authenticity') NOT NULL,
  status            ENUM('queued','running','succeeded','failed','cancelled','rate_limited')
                      NOT NULL DEFAULT 'queued',
  provider_code     VARCHAR(48)      NULL,
  model             VARCHAR(96)      NULL,
  user_id           BIGINT UNSIGNED  NULL,
  entity_type       VARCHAR(48)      NULL,      -- listing | review | user | message | media
  entity_id         BIGINT UNSIGNED  NULL,
  marketplace_id    TINYINT UNSIGNED NULL,
  language          VARCHAR(10)      NULL,
  input_payload     JSON             NULL,
  output_payload    JSON             NULL,
  prompt_tokens     INT UNSIGNED     NULL,
  completion_tokens INT UNSIGNED     NULL,
  total_tokens      INT UNSIGNED     NULL,
  cost              DECIMAL(12,6)    NULL,
  currency          CHAR(3)          NULL,
  latency_ms        INT UNSIGNED     NULL,
  attempts          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error_code        VARCHAR(64)      NULL,
  error_message     TEXT             NULL,
  cache_hit         BOOLEAN          NOT NULL DEFAULT FALSE,
  -- Lets a retried request (mobile flakiness, outbox replay) reuse the result
  idempotency_key   VARCHAR(128)     NULL,
  created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at        TIMESTAMP        NULL,
  finished_at       TIMESTAMP        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_jobs_uuid (uuid),
  UNIQUE KEY uk_ai_jobs_idempotency (idempotency_key),
  -- Worker queue polling
  KEY idx_ai_jobs_queue (task, status, created_at),
  KEY idx_ai_jobs_entity (entity_type, entity_id),
  KEY idx_ai_jobs_user (user_id, created_at),
  -- Cost reporting per provider/day
  KEY idx_ai_jobs_cost (provider_code, created_at),
  CONSTRAINT fk_ai_jobs_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ai_jobs_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §18 AI Description Generator. was_accepted / was_edited / edit_distance are
-- the training signal: they tell us whether users actually keep the output.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_generated_content (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type   VARCHAR(48)     NOT NULL,
  entity_id     BIGINT UNSIGNED NOT NULL,
  kind          ENUM('title','description','summary','highlights','seo_title',
                     'seo_description','translation') NOT NULL,
  language      VARCHAR(10)     NULL,
  content       MEDIUMTEXT      NOT NULL,
  model         VARCHAR(96)     NULL,
  job_id        BIGINT UNSIGNED NULL,
  was_accepted  BOOLEAN         NOT NULL DEFAULT FALSE,
  was_edited    BOOLEAN         NOT NULL DEFAULT FALSE,
  edit_distance INT UNSIGNED    NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ai_generated_content_entity (entity_type, entity_id, kind, language),
  KEY idx_ai_generated_content_job (job_id),
  CONSTRAINT fk_ai_generated_content_job FOREIGN KEY (job_id)
    REFERENCES ai_jobs (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Vector store for similar-listings, image search and §9 AI search.
-- vector_data holds the raw float32 array; MySQL 9 reserves the word VECTOR, so
-- the column is named vector_data to keep this DDL valid on 8.0 and 9.x alike.
-- vector_norm is precomputed so cosine similarity is a dot product at query time.
-- content_hash short-circuits re-embedding unchanged content.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_embeddings (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  entity_type    VARCHAR(48)       NOT NULL,
  entity_id      BIGINT UNSIGNED   NOT NULL,
  embedding_kind ENUM('text','image','multimodal') NOT NULL DEFAULT 'text',
  model          VARCHAR(96)       NOT NULL,
  dimensions     SMALLINT UNSIGNED NOT NULL,
  vector_data    BLOB              NOT NULL,
  vector_norm    DECIMAL(20,10)    NULL,
  content_hash   CHAR(64)          NULL,
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_embeddings_entity (entity_type, entity_id, embedding_kind, model),
  KEY idx_ai_embeddings_content_hash (content_hash),
  -- Batch re-embedding after a model upgrade
  KEY idx_ai_embeddings_model (model, embedding_kind, created_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §18 Price Recommendation. Kept as an immutable record rather than a column on
-- listings so we can measure suggestion quality (was_applied) and replay
-- comparables when a seller disputes the number.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_price_recommendations (
  id                    BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid                  CHAR(36)         NOT NULL,
  marketplace_id        TINYINT UNSIGNED NOT NULL,
  listing_id            BIGINT UNSIGNED  NULL,      -- NULL while still a draft
  user_id               BIGINT UNSIGNED  NULL,
  category_id           INT UNSIGNED     NULL,
  inputs                JSON             NULL,      -- normalised attributes fed to the model
  currency              CHAR(3)          NOT NULL,
  recommended_price     DECIMAL(18,2)    NOT NULL,
  price_low             DECIMAL(18,2)    NULL,
  price_high            DECIMAL(18,2)    NULL,
  confidence            DECIMAL(5,2)     NULL,
  rationale             TEXT             NULL,
  comparable_count      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  comparables           JSON             NULL,      -- [{listingId, price, distanceKm, soldAt}]
  expected_days_to_sell SMALLINT UNSIGNED NULL,
  demand_level          ENUM('very_low','low','moderate','high','very_high') NULL,
  model                 VARCHAR(96)      NULL,
  job_id                BIGINT UNSIGNED  NULL,
  was_applied           BOOLEAN          NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_price_rec_uuid (uuid),
  KEY idx_ai_price_rec_listing (listing_id, created_at),
  KEY idx_ai_price_rec_user (user_id, created_at),
  KEY idx_ai_price_rec_category (marketplace_id, category_id, created_at),
  KEY idx_ai_price_rec_job (job_id),
  CONSTRAINT fk_ai_price_rec_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ai_price_rec_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ai_price_rec_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ai_price_rec_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ai_price_rec_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_ai_price_rec_job FOREIGN KEY (job_id)
    REFERENCES ai_jobs (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §18 Market Analysis — one row per (dimension, period), regenerated by a job.
-- city_id / category_id use 0 rather than NULL for "all", so the UNIQUE key
-- makes the rollup idempotent; those two therefore carry no FK.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_market_analysis (
  id                 BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid               CHAR(36)          NOT NULL,
  marketplace_id     TINYINT UNSIGNED  NOT NULL,
  country_id         SMALLINT UNSIGNED NOT NULL,
  city_id            INT UNSIGNED      NOT NULL DEFAULT 0,
  category_id        INT UNSIGNED      NOT NULL DEFAULT 0,
  period             ENUM('week','month','quarter','year') NOT NULL,
  period_start       DATE              NOT NULL,
  period_end         DATE              NOT NULL,
  currency           CHAR(3)           NOT NULL,
  total_listings     INT UNSIGNED      NOT NULL DEFAULT 0,
  new_listings       INT UNSIGNED      NOT NULL DEFAULT 0,
  sold_listings      INT UNSIGNED      NOT NULL DEFAULT 0,
  avg_price          DECIMAL(18,2)     NULL,
  median_price       DECIMAL(18,2)     NULL,
  avg_days_on_market SMALLINT UNSIGNED NULL,
  demand_index       DECIMAL(8,3)      NULL,
  supply_index       DECIMAL(8,3)      NULL,
  price_trend_pct    DECIMAL(8,3)      NULL,
  hot_categories     JSON              NULL,
  hot_locations      JSON              NULL,
  insights           JSON              NULL,   -- the bullet points rendered in the UI
  summary            TEXT              NULL,
  model              VARCHAR(96)       NULL,
  generated_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_market_analysis_uuid (uuid),
  UNIQUE KEY uk_ai_market_analysis_dim (marketplace_id, country_id, city_id, category_id,
                                        period, period_start),
  KEY idx_ai_market_analysis_lookup (marketplace_id, country_id, period, period_end),
  CONSTRAINT fk_ai_market_analysis_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ai_market_analysis_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ai_market_analysis_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §12/§18 Auto Translation cache. Translation is the single most repeated AI
-- call on the platform (every listing × every language), so it is cached on the
-- source hash. No FK on the language columns: provider locale codes can be
-- finer-grained than languages.code.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_translation_cache (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source_hash     CHAR(64)        NOT NULL,   -- SHA-256 of the normalised source text
  source_language VARCHAR(10)     NOT NULL,
  target_language VARCHAR(10)     NOT NULL,
  source_text     TEXT            NOT NULL,
  translated_text TEXT            NOT NULL,
  provider        VARCHAR(48)     NULL,
  quality_score   DECIMAL(5,2)    NULL,
  hit_count       INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_translation_cache_key (source_hash, source_language, target_language),
  -- LRU eviction sweep
  KEY idx_ai_translation_cache_lru (last_used_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Machine verdict on a piece of content. Separate from the human decision in
-- moderation_actions (016) so we can measure AI precision against moderators.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_moderation_results (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type     VARCHAR(48)     NOT NULL,   -- listing | review | message | media | user
  entity_id       BIGINT UNSIGNED NOT NULL,
  media_id        BIGINT UNSIGNED NULL,       -- set when the subject is one listing image
  decision        ENUM('approve','flag','reject','escalate') NOT NULL,
  categories      JSON            NULL,       -- per-label scores from the provider
  max_score       DECIMAL(5,4)    NULL,
  nsfw_score      DECIMAL(5,4)    NULL,
  violence_score  DECIMAL(5,4)    NULL,
  hate_score      DECIMAL(5,4)    NULL,
  spam_score      DECIMAL(5,4)    NULL,
  scam_score      DECIMAL(5,4)    NULL,
  pii_detected    BOOLEAN         NOT NULL DEFAULT FALSE,
  pii_types       JSON            NULL,       -- ["phone","email","iban"]
  banned_terms    JSON            NULL,
  provider        VARCHAR(48)     NULL,
  model           VARCHAR(96)     NULL,
  job_id          BIGINT UNSIGNED NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ai_moderation_results_entity (entity_type, entity_id),
  KEY idx_ai_moderation_results_decision (decision, created_at),
  KEY idx_ai_moderation_results_media (media_id),
  KEY idx_ai_moderation_results_job (job_id),
  CONSTRAINT fk_ai_moderation_results_media FOREIGN KEY (media_id)
    REFERENCES listing_media (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ai_moderation_results_job FOREIGN KEY (job_id)
    REFERENCES ai_jobs (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §18 Recommendation Engine. Precomputed slates with an expiry, so the feed is
-- a single-row read; served_count/click_count measure strategy performance.
-- guest_uuid mirrors guest_sessions.uuid for pre-login personalisation.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_recommendations (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED  NULL,
  guest_uuid     CHAR(36)         NULL,
  marketplace_id TINYINT UNSIGNED NULL,
  strategy       ENUM('collaborative','content_based','hybrid','trending','recently_viewed',
                      'similar_to_saved','price_drop') NOT NULL,
  listing_ids    JSON             NOT NULL,   -- ordered slate
  scores         JSON             NULL,
  context        JSON             NULL,
  served_count   INT UNSIGNED     NOT NULL DEFAULT 0,
  click_count    INT UNSIGNED     NOT NULL DEFAULT 0,
  generated_at   TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at     TIMESTAMP        NULL,
  PRIMARY KEY (id),
  KEY idx_ai_recommendations_user (user_id, marketplace_id, expires_at),
  KEY idx_ai_recommendations_guest (guest_uuid, marketplace_id, expires_at),
  KEY idx_ai_recommendations_strategy (strategy, generated_at),
  CONSTRAINT fk_ai_recommendations_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ai_recommendations_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §9 AI Search / Smart Search: what the model understood from a free-text
-- query. Stored so we can tune intent detection and replay bad searches.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_search_interpretations (
  id                     BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid                   CHAR(36)         NOT NULL,
  raw_query              VARCHAR(500)     NOT NULL,
  language               VARCHAR(10)      NULL,
  detected_intent        ENUM('buy','sell','rent','compare','valuate','browse','support','unknown')
                           NOT NULL DEFAULT 'unknown',
  detected_marketplace_id TINYINT UNSIGNED NULL,
  detected_category_id   INT UNSIGNED     NULL,
  extracted_filters      JSON             NULL,   -- {"karat":22,"bedrooms":3}
  extracted_location     JSON             NULL,
  extracted_price_range  JSON             NULL,
  rewritten_query        VARCHAR(500)     NULL,
  confidence             DECIMAL(5,2)     NULL,
  model                  VARCHAR(96)      NULL,
  job_id                 BIGINT UNSIGNED  NULL,
  result_count           INT UNSIGNED     NULL,   -- 0 results = a gap in taxonomy or supply
  user_id                BIGINT UNSIGNED  NULL,
  created_at             TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_search_interp_uuid (uuid),
  KEY idx_ai_search_interp_query (raw_query(96), created_at),
  KEY idx_ai_search_interp_intent (detected_intent, created_at),
  KEY idx_ai_search_interp_zero (result_count, created_at),
  KEY idx_ai_search_interp_user (user_id, created_at),
  KEY idx_ai_search_interp_job (job_id),
  CONSTRAINT fk_ai_search_interp_mp FOREIGN KEY (detected_marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ai_search_interp_category FOREIGN KEY (detected_category_id)
    REFERENCES categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ai_search_interp_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ai_search_interp_job FOREIGN KEY (job_id)
    REFERENCES ai_jobs (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §18 AI Customer Support / §29 AI Chatbot. resolved_by_ai is the deflection
-- metric that justifies the feature; escalated_ticket_id is the handoff.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)         NOT NULL,
  user_id              BIGINT UNSIGNED  NULL,
  guest_uuid           CHAR(36)         NULL,
  language             VARCHAR(10)      NULL,
  channel              ENUM('in_app','web','whatsapp','email') NOT NULL DEFAULT 'in_app',
  status               ENUM('active','resolved','escalated','abandoned','closed')
                         NOT NULL DEFAULT 'active',
  topic                VARCHAR(128)     NULL,
  satisfaction_rating  TINYINT UNSIGNED NULL,   -- 1..5
  -- forward reference: no FK, resolved in application layer (support_tickets, 018)
  escalated_ticket_id  BIGINT UNSIGNED  NULL,
  message_count        INT UNSIGNED     NOT NULL DEFAULT 0,
  resolved_by_ai       BOOLEAN          NOT NULL DEFAULT FALSE,
  started_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at             TIMESTAMP        NULL,
  created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_chatbot_sessions_uuid (uuid),
  KEY idx_chatbot_sessions_user (user_id, created_at),
  KEY idx_chatbot_sessions_guest (guest_uuid),
  KEY idx_chatbot_sessions_status (status, created_at),
  KEY idx_chatbot_sessions_ticket (escalated_ticket_id),
  CONSTRAINT fk_chatbot_sessions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Turn-by-turn transcript. citations lets the UI show which knowledge-base
-- article the answer came from (§29 Knowledge Base).
CREATE TABLE IF NOT EXISTS chatbot_messages (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id  BIGINT UNSIGNED NOT NULL,
  role        ENUM('user','assistant','system','tool') NOT NULL,
  content     MEDIUMTEXT      NULL,
  tool_name   VARCHAR(64)     NULL,
  tool_payload JSON           NULL,
  citations   JSON            NULL,   -- [kb_articles.id, ...]
  tokens      INT UNSIGNED    NULL,
  latency_ms  INT UNSIGNED    NULL,
  was_helpful BOOLEAN         NULL,   -- NULL = user did not rate the turn
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_chatbot_messages_session (session_id, created_at),
  CONSTRAINT fk_chatbot_messages_session FOREIGN KEY (session_id)
    REFERENCES chatbot_sessions (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Closes the loop on model quality: thumbs on any AI output, joined back to the
-- job so a bad model or prompt version is identifiable.
CREATE TABLE IF NOT EXISTS ai_feedback (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id      BIGINT UNSIGNED NULL,
  entity_type VARCHAR(48)     NULL,
  entity_id   BIGINT UNSIGNED NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  feedback    ENUM('helpful','not_helpful','inaccurate','offensive','report') NOT NULL,
  comment     VARCHAR(500)    NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ai_feedback_job (job_id),
  KEY idx_ai_feedback_entity (entity_type, entity_id),
  KEY idx_ai_feedback_user (user_id, created_at),
  KEY idx_ai_feedback_kind (feedback, created_at),
  CONSTRAINT fk_ai_feedback_job FOREIGN KEY (job_id)
    REFERENCES ai_jobs (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ai_feedback_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
