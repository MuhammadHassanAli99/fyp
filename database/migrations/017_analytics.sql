-- =============================================================================
-- 017  Analytics: event firehose, sessions, generic and purpose-built daily
--      rollups, funnels, retention, growth, heatmaps, traffic, AI insights,
--      system health, sampled API logs
--      (§24 Analytics & Reporting, §23 Seller Dashboard, §22 System Health)
--
-- Two rules shape this file:
--   1. Firehose tables (analytics_events, analytics_sessions, heatmap_events,
--      api_request_logs) carry no foreign keys and the minimum viable index set,
--      so ingest stays cheap and retention pruning never touches parent tables.
--      Same choice as listing_views in 005.
--   2. Rollup tables use 0 / '' rather than NULL for an "all values" dimension.
--      MySQL treats NULLs as distinct inside a UNIQUE key, so a nullable
--      dimension would let a re-run of a rollup job duplicate every global row.
--      Sentinel columns therefore carry no FK.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- The raw firehose. Everything else in this file is derived from it.
-- properties JSON keeps the event contract open so a new marketplace can emit
-- its own payload without a migration (§30 Future Expansion).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_events (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid           CHAR(36)          NOT NULL,
  event_name     VARCHAR(64)       NOT NULL,
  user_id        BIGINT UNSIGNED   NULL,
  guest_uuid     CHAR(36)          NULL,
  session_id     VARCHAR(64)       NULL,
  device_id      BIGINT UNSIGNED   NULL,
  platform_id    TINYINT UNSIGNED  NULL,
  marketplace_id TINYINT UNSIGNED  NULL,
  entity_type    VARCHAR(48)       NULL,
  entity_id      BIGINT UNSIGNED   NULL,
  properties     JSON              NULL,
  country_id     SMALLINT UNSIGNED NULL,
  city_id        INT UNSIGNED      NULL,
  os_name        VARCHAR(32)       NULL,
  os_version     VARCHAR(24)       NULL,
  app_version    VARCHAR(24)       NULL,
  browser        VARCHAR(32)       NULL,
  device_kind    ENUM('phone','tablet','desktop','tv','other') NULL,
  referrer       VARCHAR(255)      NULL,
  utm_source     VARCHAR(96)       NULL,
  utm_medium     VARCHAR(96)       NULL,
  utm_campaign   VARCHAR(96)       NULL,
  ip_hash        CHAR(64)          NULL,   -- hashed, never raw: §25 data minimisation
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_analytics_events_uuid (uuid),   -- client-generated: makes retry idempotent
  KEY idx_analytics_events_name (event_name, created_at),
  KEY idx_analytics_events_user (user_id, created_at),
  KEY idx_analytics_events_session (session_id)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Session-level roll-up of the firehose, written on session close. Keyed on the
-- client session id so the ingest worker can upsert it without a lookup.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics_sessions (
  session_id      VARCHAR(64)       NOT NULL,
  user_id         BIGINT UNSIGNED   NULL,
  guest_uuid      CHAR(36)          NULL,
  device_id       BIGINT UNSIGNED   NULL,
  platform_id     TINYINT UNSIGNED  NULL,
  country_id      SMALLINT UNSIGNED NULL,
  city_id         INT UNSIGNED      NULL,
  entry_page      VARCHAR(191)      NULL,
  exit_page       VARCHAR(191)      NULL,
  referrer        VARCHAR(255)      NULL,
  utm_source      VARCHAR(96)       NULL,
  utm_medium      VARCHAR(96)       NULL,
  utm_campaign    VARCHAR(96)       NULL,
  event_count     INT UNSIGNED      NOT NULL DEFAULT 0,
  page_view_count INT UNSIGNED      NOT NULL DEFAULT 0,
  duration_secs   INT UNSIGNED      NULL,
  is_bounce       BOOLEAN           NOT NULL DEFAULT FALSE,
  converted       BOOLEAN           NOT NULL DEFAULT FALSE,
  conversion_kind VARCHAR(48)       NULL,   -- signup | listing_posted | lead | purchase
  started_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at        TIMESTAMP         NULL,
  PRIMARY KEY (session_id),
  KEY idx_analytics_sessions_user (user_id, started_at),
  KEY idx_analytics_sessions_guest (guest_uuid),
  KEY idx_analytics_sessions_attribution (utm_source, utm_campaign, started_at),
  KEY idx_analytics_sessions_conversion (converted, conversion_kind, started_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- The generic rollup every dashboard reads. One table instead of dozens of
-- metric-specific ones: a new chart is a new metric_key, not a migration.
-- 0 / '' in a dimension column means "all", which keeps the UNIQUE key — and
-- therefore the INSERT ... ON DUPLICATE KEY UPDATE the rollup job runs — sound.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_metrics (
  id              BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  metric_date     DATE              NOT NULL,
  metric_key      VARCHAR(64)       NOT NULL,   -- listings.published | leads.created | ...
  marketplace_id  TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  country_id      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  city_id         INT UNSIGNED      NOT NULL DEFAULT 0,
  platform_id     TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  category_id     INT UNSIGNED      NOT NULL DEFAULT 0,
  -- Optional free-form breakdown, e.g. dimension_key='status', dimension_value='sold'
  dimension_key   VARCHAR(64)       NOT NULL DEFAULT '',
  dimension_value VARCHAR(96)       NOT NULL DEFAULT '',
  value_count     BIGINT            NOT NULL DEFAULT 0,
  value_sum       DECIMAL(20,4)     NULL,
  value_avg       DECIMAL(20,4)     NULL,
  currency        CHAR(3)           NULL,   -- set only when value_sum is money
  computed_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_daily_metrics_dim (metric_date, metric_key, marketplace_id, country_id, city_id,
                                   platform_id, category_id, dimension_key, dimension_value),
  -- Chart query: one metric over a date range
  KEY idx_daily_metrics_series (metric_key, metric_date)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §24 Revenue Reports. Split by source so subscription vs promotion vs ads
-- revenue is separable without joining the payments tables.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revenue_daily (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  revenue_date      DATE              NOT NULL,
  marketplace_id    TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  country_id        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  currency          CHAR(3)           NOT NULL,
  source            ENUM('subscription','promotion','advertisement','verification','inspection',
                         'commission','other') NOT NULL,
  gross_amount      DECIMAL(18,2)     NOT NULL DEFAULT 0.00,
  discount_amount   DECIMAL(18,2)     NOT NULL DEFAULT 0.00,
  tax_amount        DECIMAL(18,2)     NOT NULL DEFAULT 0.00,
  refund_amount     DECIMAL(18,2)     NOT NULL DEFAULT 0.00,
  net_amount        DECIMAL(18,2)     NOT NULL DEFAULT 0.00,
  transaction_count INT UNSIGNED      NOT NULL DEFAULT 0,
  paying_user_count INT UNSIGNED      NOT NULL DEFAULT 0,
  arpu              DECIMAL(18,4)     NULL,
  computed_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_revenue_daily_dim (revenue_date, marketplace_id, country_id, currency, source),
  KEY idx_revenue_daily_series (revenue_date, source),
  CONSTRAINT fk_revenue_daily_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §23 Seller Dashboard. Precomputed per seller per day: the dashboard is a
-- range scan on one index, never an aggregation over listing_views/leads.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seller_metrics_daily (
  id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  metric_date          DATE             NOT NULL,
  user_id              BIGINT UNSIGNED  NOT NULL,
  business_id          BIGINT UNSIGNED  NULL,
  marketplace_id       TINYINT UNSIGNED NOT NULL DEFAULT 0,
  active_listings      INT UNSIGNED     NOT NULL DEFAULT 0,
  new_listings         INT UNSIGNED     NOT NULL DEFAULT 0,
  expired_listings     INT UNSIGNED     NOT NULL DEFAULT 0,
  sold_listings        INT UNSIGNED     NOT NULL DEFAULT 0,
  impressions          INT UNSIGNED     NOT NULL DEFAULT 0,
  views                INT UNSIGNED     NOT NULL DEFAULT 0,
  unique_views         INT UNSIGNED     NOT NULL DEFAULT 0,
  favorites            INT UNSIGNED     NOT NULL DEFAULT 0,
  leads                INT UNSIGNED     NOT NULL DEFAULT 0,
  calls                INT UNSIGNED     NOT NULL DEFAULT 0,
  chats                INT UNSIGNED     NOT NULL DEFAULT 0,
  contact_reveals      INT UNSIGNED     NOT NULL DEFAULT 0,
  offers_received      INT UNSIGNED     NOT NULL DEFAULT 0,
  avg_response_minutes INT UNSIGNED     NULL,
  response_rate        DECIMAL(5,2)     NULL,
  revenue              DECIMAL(18,2)    NULL,   -- seller's own sales value
  currency             CHAR(3)          NULL,
  spend                DECIMAL(18,2)    NULL,   -- what the seller paid us that day
  followers_gained     INT              NOT NULL DEFAULT 0,   -- signed: follows can be lost
  computed_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_seller_metrics_daily_dim (metric_date, user_id, marketplace_id),
  KEY idx_seller_metrics_daily_seller (user_id, metric_date),
  KEY idx_seller_metrics_daily_business (business_id, metric_date),
  CONSTRAINT fk_seller_metrics_daily_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_seller_metrics_daily_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Per-listing performance strip shown on the listing management screen (§23)
CREATE TABLE IF NOT EXISTS listing_metrics_daily (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  metric_date        DATE            NOT NULL,
  listing_id         BIGINT UNSIGNED NOT NULL,
  impressions        INT UNSIGNED    NOT NULL DEFAULT 0,
  views              INT UNSIGNED    NOT NULL DEFAULT 0,
  unique_views       INT UNSIGNED    NOT NULL DEFAULT 0,
  favorites          INT UNSIGNED    NOT NULL DEFAULT 0,
  shares             INT UNSIGNED    NOT NULL DEFAULT 0,
  leads              INT UNSIGNED    NOT NULL DEFAULT 0,
  calls              INT UNSIGNED    NOT NULL DEFAULT 0,
  chats              INT UNSIGNED    NOT NULL DEFAULT 0,
  contact_reveals    INT UNSIGNED    NOT NULL DEFAULT 0,
  search_appearances INT UNSIGNED    NOT NULL DEFAULT 0,
  avg_position       DECIMAL(8,2)    NULL,   -- mean rank in search results
  ctr                DECIMAL(8,4)    NULL,
  computed_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_listing_metrics_daily_dim (metric_date, listing_id),
  KEY idx_listing_metrics_daily_listing (listing_id, metric_date),
  CONSTRAINT fk_listing_metrics_daily_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §24 Conversion Funnels. steps is an ordered list of event_name values, so a
-- new funnel is a row, not code.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS funnel_definitions (
  id             SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(64)       NOT NULL,
  name           VARCHAR(160)      NOT NULL,
  marketplace_id TINYINT UNSIGNED  NULL,
  steps          JSON              NOT NULL,   -- ["search","listing_view","contact","lead"]
  window_hours   INT UNSIGNED      NOT NULL DEFAULT 168,
  is_active      BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_funnel_definitions_code (code),
  KEY idx_funnel_definitions_active (is_active, marketplace_id),
  CONSTRAINT fk_funnel_definitions_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- One row per funnel step per day: the whole chart is a single indexed read.
CREATE TABLE IF NOT EXISTS funnel_daily (
  id                           BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  funnel_code                  VARCHAR(64)      NOT NULL,
  metric_date                  DATE             NOT NULL,
  step_index                   TINYINT UNSIGNED NOT NULL,
  step_name                    VARCHAR(64)      NOT NULL,
  user_count                   INT UNSIGNED     NOT NULL DEFAULT 0,
  conversion_from_previous     DECIMAL(5,2)     NULL,
  conversion_from_start        DECIMAL(5,2)     NULL,
  median_seconds_from_previous INT UNSIGNED     NULL,
  computed_at                  TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_funnel_daily_step (funnel_code, metric_date, step_index),
  KEY idx_funnel_daily_series (funnel_code, metric_date),
  CONSTRAINT fk_funnel_daily_funnel FOREIGN KEY (funnel_code)
    REFERENCES funnel_definitions (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §24 Retention. Long format (one row per cohort per period) rather than a wide
-- table, so day/week/month grids all come from the same rows.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS retention_cohorts (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  cohort_date    DATE              NOT NULL,
  cohort_kind    ENUM('signup','first_listing','first_purchase') NOT NULL,
  marketplace_id TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  country_id     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  period_number  SMALLINT UNSIGNED NOT NULL,   -- periods elapsed since cohort_date
  period_unit    ENUM('day','week','month') NOT NULL DEFAULT 'day',
  cohort_size    INT UNSIGNED      NOT NULL DEFAULT 0,
  retained_count INT UNSIGNED      NOT NULL DEFAULT 0,
  retention_pct  DECIMAL(5,2)      NULL,
  computed_at    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_retention_cohorts_dim (cohort_date, cohort_kind, marketplace_id, country_id,
                                       period_unit, period_number),
  KEY idx_retention_cohorts_grid (cohort_kind, period_unit, cohort_date, period_number)
) ENGINE = InnoDB;

-- §24 User Growth. dau/wau/mau are stored, not derived, because the distinct
-- counts behind them are too expensive to compute at read time.
CREATE TABLE IF NOT EXISTS user_growth_daily (
  id                        BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  metric_date               DATE              NOT NULL,
  marketplace_id            TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  country_id                SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  new_signups               INT UNSIGNED      NOT NULL DEFAULT 0,
  activated_users           INT UNSIGNED      NOT NULL DEFAULT 0,
  dau                       INT UNSIGNED      NOT NULL DEFAULT 0,
  wau                       INT UNSIGNED      NOT NULL DEFAULT 0,
  mau                       INT UNSIGNED      NOT NULL DEFAULT 0,
  churned_users             INT UNSIGNED      NOT NULL DEFAULT 0,
  reactivated_users         INT UNSIGNED      NOT NULL DEFAULT 0,
  guest_sessions            INT UNSIGNED      NOT NULL DEFAULT 0,
  guest_to_user_conversions INT UNSIGNED      NOT NULL DEFAULT 0,
  computed_at               TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_growth_daily_dim (metric_date, marketplace_id, country_id),
  KEY idx_user_growth_daily_series (metric_date)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §24 Heatmaps. Coordinates are percentages, not pixels, so one recording
-- replays across every viewport. rage_click / dead_click are the UX signals
-- worth acting on.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS heatmap_events (
  id                   BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  page_key             VARCHAR(96)       NOT NULL,   -- route key, e.g. "listing.detail"
  session_id           VARCHAR(64)       NULL,
  user_id              BIGINT UNSIGNED   NULL,
  platform_id          TINYINT UNSIGNED  NULL,
  interaction          ENUM('click','tap','scroll','hover','rage_click','dead_click') NOT NULL,
  x_percent            DECIMAL(6,3)      NULL,
  y_percent            DECIMAL(6,3)      NULL,
  scroll_depth_percent DECIMAL(6,3)      NULL,
  viewport_width       SMALLINT UNSIGNED NULL,
  viewport_height      SMALLINT UNSIGNED NULL,
  element_selector     VARCHAR(191)      NULL,
  created_at           TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_heatmap_events_page (page_key, created_at),
  KEY idx_heatmap_events_friction (interaction, page_key, created_at)
) ENGINE = InnoDB;

-- §24 Traffic Sources. utm_campaign uses '' for "none" to keep the UNIQUE key
-- enforceable, same reason as the other rollups.
CREATE TABLE IF NOT EXISTS traffic_daily (
  id               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  metric_date      DATE              NOT NULL,
  marketplace_id   TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  country_id       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  city_id          INT UNSIGNED      NOT NULL DEFAULT 0,
  platform_id      TINYINT UNSIGNED  NOT NULL DEFAULT 0,
  source           ENUM('direct','organic','paid','social','referral','email','push','affiliate')
                     NOT NULL,
  utm_campaign     VARCHAR(96)       NOT NULL DEFAULT '',
  sessions         INT UNSIGNED      NOT NULL DEFAULT 0,
  users            INT UNSIGNED      NOT NULL DEFAULT 0,
  new_users        INT UNSIGNED      NOT NULL DEFAULT 0,
  page_views       INT UNSIGNED      NOT NULL DEFAULT 0,
  avg_session_secs INT UNSIGNED      NULL,
  bounce_rate      DECIMAL(5,2)      NULL,
  computed_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_traffic_daily_dim (metric_date, marketplace_id, country_id, city_id,
                                   platform_id, source, utm_campaign),
  KEY idx_traffic_daily_series (metric_date, source)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §24 AI Insights: the narrative layer over the rollups. scope_id is text
-- because the scope may be a marketplace id, a country iso2 or a user id, so it
-- carries no FK. was_dismissed stops a dismissed card from reappearing.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_insights (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)         NOT NULL,
  scope            ENUM('platform','marketplace','country','seller','listing') NOT NULL,
  scope_id         VARCHAR(64)      NULL,
  marketplace_id   TINYINT UNSIGNED NULL,
  period_start     DATE             NULL,
  period_end       DATE             NULL,
  headline         VARCHAR(255)     NOT NULL,
  body             TEXT             NULL,
  insight_kind     ENUM('trend','anomaly','opportunity','risk','recommendation') NOT NULL,
  severity         ENUM('info','notable','important','critical') NOT NULL DEFAULT 'info',
  metrics          JSON             NULL,   -- the numbers the headline is based on
  suggested_actions JSON            NULL,
  model            VARCHAR(96)      NULL,
  confidence       DECIMAL(5,2)     NULL,
  generated_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at       TIMESTAMP        NULL,
  was_dismissed    BOOLEAN          NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ai_insights_uuid (uuid),
  KEY idx_ai_insights_scope (scope, scope_id, generated_at),
  -- The insight feed: live, undismissed cards worst-first
  KEY idx_ai_insights_feed (was_dismissed, severity, expires_at),
  KEY idx_ai_insights_mp (marketplace_id, generated_at),
  CONSTRAINT fk_ai_insights_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §22 System Health. Written by the probe scheduler; the status page reads the
-- latest row per (component, check_name).
CREATE TABLE IF NOT EXISTS system_health_checks (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  component  VARCHAR(64)     NOT NULL,   -- db | cache | queue | storage | ai:openai | payments:stripe
  check_name VARCHAR(96)     NOT NULL,
  status     ENUM('healthy','degraded','down') NOT NULL,
  latency_ms INT UNSIGNED    NULL,
  details    JSON            NULL,
  error      TEXT            NULL,
  checked_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_system_health_checks_component (component, checked_at),
  KEY idx_system_health_checks_failing (status, checked_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Sampled request log (§22 performance monitoring, §25 API auditing).
-- db_query_count / db_time_ms are here because N+1 regressions are the most
-- common cause of latency creep, and they are invisible in duration_ms alone.
-- Sampled, not exhaustive: no FKs, prune by created_at.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_request_logs (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  request_id     CHAR(36)          NOT NULL,
  method         VARCHAR(8)        NOT NULL,
  route          VARCHAR(191)      NOT NULL,   -- the pattern, not the resolved path
  status_code    SMALLINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED   NULL,
  api_key_id     BIGINT UNSIGNED   NULL,
  platform_id    TINYINT UNSIGNED  NULL,
  country_id     SMALLINT UNSIGNED NULL,
  duration_ms    INT UNSIGNED      NULL,
  request_bytes  INT UNSIGNED      NULL,
  response_bytes INT UNSIGNED      NULL,
  db_query_count SMALLINT UNSIGNED NULL,
  db_time_ms     INT UNSIGNED      NULL,
  cache_hit      BOOLEAN           NOT NULL DEFAULT FALSE,
  ip_hash        CHAR(64)          NULL,
  user_agent     VARCHAR(255)      NULL,
  error_code     VARCHAR(64)       NULL,
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_api_request_logs_route (route, created_at),
  KEY idx_api_request_logs_status (status_code, created_at),
  KEY idx_api_request_logs_request (request_id),
  KEY idx_api_request_logs_key (api_key_id, created_at)
) ENGINE = InnoDB;
