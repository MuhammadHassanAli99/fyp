-- =============================================================================
-- 013  Advertisement system
--      (§21 Banner Ads, Native Ads, Featured Ads, Sponsored Listings,
--       Video Ads, Location Ads, Category Ads, Campaign Manager)
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Advertisers. Separate from users/businesses because an ad account has its own
-- billing identity, credit line and approval state — an agency may buy ads for
-- clients who never sign up.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_advertisers (
  id              BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)          NOT NULL,
  user_id         BIGINT UNSIGNED   NULL,
  business_id     BIGINT UNSIGNED   NULL,
  company_name    VARCHAR(191)      NOT NULL,
  contact_name    VARCHAR(128)      NULL,
  contact_email   VARCHAR(191)      NULL,
  contact_phone   VARCHAR(24)       NULL,
  country_id      SMALLINT UNSIGNED NULL,
  billing_address JSON              NULL,
  tax_id          VARCHAR(96)       NULL,
  credit_limit    DECIMAL(18,2)     NOT NULL DEFAULT 0.00,   -- postpaid ceiling
  balance         DECIMAL(18,2)     NOT NULL DEFAULT 0.00,   -- prepaid credit
  currency        CHAR(3)           NOT NULL,
  status          ENUM('pending','active','suspended','closed') NOT NULL DEFAULT 'pending',
  approved_by     BIGINT UNSIGNED   NULL,
  approved_at     TIMESTAMP         NULL,
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ad_advertisers_uuid (uuid),
  KEY idx_ad_advertisers_user (user_id),
  KEY idx_ad_advertisers_business (business_id),
  KEY idx_ad_advertisers_status (status, created_at),
  CONSTRAINT fk_ad_advertisers_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ad_advertisers_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ad_advertisers_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ad_advertisers_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_ad_advertisers_approver FOREIGN KEY (approved_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Inventory slots. The client asks for a placement code and the ad server
-- answers, so adding "home_story_1" is a row plus a widget — not a release.
-- Floor prices stop a placement being bought below its worth.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_placements (
  id             SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(64)       NOT NULL,   -- home_banner_top | search_native_3
  name           VARCHAR(128)      NOT NULL,
  page           VARCHAR(64)       NULL,       -- home | search | listing_detail | chat
  position       VARCHAR(64)       NULL,       -- top | inline_3 | bottom | sidebar
  format         ENUM('banner','native','video','interstitial','carousel',
                      'sponsored_listing','story') NOT NULL DEFAULT 'banner',
  width          SMALLINT UNSIGNED NULL,
  height         SMALLINT UNSIGNED NULL,
  aspect_ratio   VARCHAR(16)       NULL,
  max_file_kb    INT UNSIGNED      NULL,
  platforms      JSON              NULL,       -- ["android","ios","web"]
  marketplace_id TINYINT UNSIGNED  NULL,       -- NULL = every marketplace
  floor_cpm      DECIMAL(12,4)     NULL,
  floor_cpc      DECIMAL(12,4)     NULL,
  currency       CHAR(3)           NULL,
  is_active      BOOLEAN           NOT NULL DEFAULT TRUE,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ad_placements_code (code),
  KEY idx_ad_placements_lookup (marketplace_id, is_active, page),
  CONSTRAINT fk_ad_placements_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_placements_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Campaigns (§21 Campaign Manager). spent_amount is denormalised from
-- ad_daily_stats so the ad server can stop serving on budget exhaustion
-- without aggregating. `schedule` holds dayparting: {"mon":[[9,17]],...}.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                     BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid                   CHAR(36)         NOT NULL,
  advertiser_id          BIGINT UNSIGNED  NOT NULL,
  name                   VARCHAR(191)     NOT NULL,
  objective              ENUM('awareness','traffic','leads','listing_views',
                              'app_installs','conversions') NOT NULL DEFAULT 'traffic',
  marketplace_id         TINYINT UNSIGNED NULL,
  status                 ENUM('draft','pending_review','approved','active','paused',
                              'completed','rejected','exhausted') NOT NULL DEFAULT 'draft',
  pricing_model          ENUM('cpm','cpc','cpa','fixed','sponsored') NOT NULL DEFAULT 'cpm',
  bid_amount             DECIMAL(12,4)    NULL,
  total_budget           DECIMAL(18,2)    NULL,
  daily_budget           DECIMAL(18,2)    NULL,
  spent_amount           DECIMAL(18,2)    NOT NULL DEFAULT 0.00,
  currency               CHAR(3)          NOT NULL,
  starts_at              TIMESTAMP        NULL,
  ends_at                TIMESTAMP        NULL,
  schedule               JSON             NULL,
  frequency_cap_per_user SMALLINT UNSIGNED NULL,
  frequency_cap_period   ENUM('hour','day','week','campaign') NOT NULL DEFAULT 'day',
  review_notes           VARCHAR(500)     NULL,
  reviewed_by            BIGINT UNSIGNED  NULL,
  reviewed_at            TIMESTAMP        NULL,
  created_by             BIGINT UNSIGNED  NULL,
  created_at             TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ad_campaigns_uuid (uuid),
  -- The ad server's candidate query
  KEY idx_ad_campaigns_serving (status, starts_at, ends_at),
  KEY idx_ad_campaigns_advertiser (advertiser_id, status),
  KEY idx_ad_campaigns_review (status, created_at),
  CONSTRAINT fk_ad_campaigns_advertiser FOREIGN KEY (advertiser_id)
    REFERENCES ad_advertisers (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_campaigns_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_campaigns_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_ad_campaigns_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ad_campaigns_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_ad_campaigns_budget CHECK (total_budget IS NULL OR total_budget >= 0),
  CONSTRAINT chk_ad_campaigns_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Targeting rules (§21 Location Ads, Category Ads). One row per dimension so
-- rules compose: include country=PK, include category=cars, exclude city=Quetta.
-- `values` is reserved in MySQL, hence target_values.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_targeting (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id   BIGINT UNSIGNED NOT NULL,
  target_kind   ENUM('country','region','city','radius','language','platform','os',
                     'marketplace','category','brand','keyword','price_range','age',
                     'gender','device','audience_segment','listing_status','user_type')
                  NOT NULL,
  operator      ENUM('include','exclude') NOT NULL DEFAULT 'include',
  target_values JSON            NULL,          -- id list or literal values
  -- Radius targeting (target_kind='radius')
  radius_km     DECIMAL(8,2)    NULL,
  latitude      DECIMAL(10,7)   NULL,
  longitude     DECIMAL(10,7)   NULL,
  PRIMARY KEY (id),
  KEY idx_ad_targeting_campaign (campaign_id, target_kind),
  CONSTRAINT fk_ad_targeting_campaign FOREIGN KEY (campaign_id)
    REFERENCES ad_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Creatives. `weight` drives A/B rotation inside a campaign; impressions and
-- clicks are cached counters for the rotation logic (authoritative numbers live
-- in ad_daily_stats). Each creative is moderated on its own.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_creatives (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)        NOT NULL,
  campaign_id      BIGINT UNSIGNED NOT NULL,
  name             VARCHAR(128)    NULL,
  format           ENUM('banner','native','video','interstitial','carousel','story')
                     NOT NULL DEFAULT 'banner',
  headline         VARCHAR(191)    NULL,
  body             VARCHAR(500)    NULL,
  cta_label        VARCHAR(48)     NULL,
  image_url        VARCHAR(512)    NULL,
  video_url        VARCHAR(512)    NULL,
  thumb_url        VARCHAR(512)    NULL,
  logo_url         VARCHAR(512)    NULL,
  landing_url      VARCHAR(512)    NULL,
  deep_link        VARCHAR(512)    NULL,
  width            SMALLINT UNSIGNED NULL,
  height           SMALLINT UNSIGNED NULL,
  duration_secs    SMALLINT UNSIGNED NULL,
  language         VARCHAR(10)     NULL,
  status           ENUM('draft','pending_review','approved','rejected','paused')
                     NOT NULL DEFAULT 'draft',
  rejection_reason VARCHAR(500)    NULL,
  moderation_score DECIMAL(5,2)    NULL,
  weight           SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  impressions      INT UNSIGNED    NOT NULL DEFAULT 0,
  clicks           INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ad_creatives_uuid (uuid),
  KEY idx_ad_creatives_campaign (campaign_id, status, weight),
  KEY idx_ad_creatives_review (status, created_at),
  CONSTRAINT fk_ad_creatives_campaign FOREIGN KEY (campaign_id)
    REFERENCES ad_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Which slots a campaign buys, with an optional per-placement bid override.
CREATE TABLE IF NOT EXISTS ad_campaign_placements (
  campaign_id  BIGINT UNSIGNED   NOT NULL,
  placement_id SMALLINT UNSIGNED NOT NULL,
  -- Priced in the campaign's currency; NULL = use ad_campaigns.bid_amount
  bid_amount   DECIMAL(12,4)     NULL,
  is_active    BOOLEAN           NOT NULL DEFAULT TRUE,
  PRIMARY KEY (campaign_id, placement_id),
  KEY idx_ad_campaign_placements_placement (placement_id, is_active),
  CONSTRAINT fk_ad_campaign_placements_campaign FOREIGN KEY (campaign_id)
    REFERENCES ad_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_campaign_placements_placement FOREIGN KEY (placement_id)
    REFERENCES ad_placements (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Impression log — the highest-volume table in the schema. Only the two access
-- paths that matter are indexed (campaign and creative over time); the geo /
-- platform / session / listing columns are denormalised analytics dimensions
-- and deliberately carry no FK, because every extra FK is another secondary
-- index on the insert path. Reporting reads ad_daily_stats, not this table.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_impressions (
  id               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  campaign_id      BIGINT UNSIGNED   NOT NULL,
  creative_id      BIGINT UNSIGNED   NOT NULL,
  placement_id     SMALLINT UNSIGNED NULL,
  user_id          BIGINT UNSIGNED   NULL,
  guest_uuid       CHAR(36)          NULL,
  device_id        BIGINT UNSIGNED   NULL,
  session_id       BIGINT UNSIGNED   NULL,
  country_id       SMALLINT UNSIGNED NULL,
  city_id          INT UNSIGNED      NULL,
  platform_id      TINYINT UNSIGNED  NULL,
  marketplace_id   TINYINT UNSIGNED  NULL,
  listing_id       BIGINT UNSIGNED   NULL,   -- set for sponsored listings
  position         SMALLINT UNSIGNED NULL,   -- slot index in the feed
  cost             DECIMAL(12,6)     NOT NULL DEFAULT 0.000000,
  currency         CHAR(3)           NULL,
  is_viewable      BOOLEAN           NOT NULL DEFAULT FALSE,   -- passed the viewability check
  view_duration_ms INT UNSIGNED      NULL,
  ip_hash          CHAR(64)          NULL,
  created_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_impressions_campaign (campaign_id, created_at),
  KEY idx_ad_impressions_creative (creative_id, created_at),
  CONSTRAINT fk_ad_impressions_campaign FOREIGN KEY (campaign_id)
    REFERENCES ad_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_impressions_creative FOREIGN KEY (creative_id)
    REFERENCES ad_creatives (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Click log. impression_id ties a click back to what was actually rendered,
-- which is how click fraud is scored (§19). Same denormalisation rule as
-- ad_impressions: dimension columns without FKs.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_clicks (
  id                 BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  impression_id      BIGINT UNSIGNED   NULL,
  campaign_id        BIGINT UNSIGNED   NOT NULL,
  creative_id        BIGINT UNSIGNED   NOT NULL,
  placement_id       SMALLINT UNSIGNED NULL,
  user_id            BIGINT UNSIGNED   NULL,
  guest_uuid         CHAR(36)          NULL,
  cost               DECIMAL(12,6)     NOT NULL DEFAULT 0.000000,
  currency           CHAR(3)           NULL,
  country_id         SMALLINT UNSIGNED NULL,
  platform_id        TINYINT UNSIGNED  NULL,
  is_fraud_suspected BOOLEAN           NOT NULL DEFAULT FALSE,
  fraud_score        DECIMAL(5,2)      NULL,
  ip_hash            CHAR(64)          NULL,
  created_at         TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_clicks_campaign (campaign_id, created_at),
  KEY idx_ad_clicks_creative (creative_id, created_at),
  KEY idx_ad_clicks_impression (impression_id),
  KEY idx_ad_clicks_fraud (is_fraud_suspected, created_at),
  CONSTRAINT fk_ad_clicks_impression FOREIGN KEY (impression_id)
    REFERENCES ad_impressions (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ad_clicks_campaign FOREIGN KEY (campaign_id)
    REFERENCES ad_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_clicks_creative FOREIGN KEY (creative_id)
    REFERENCES ad_creatives (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Post-click outcomes, so CPA campaigns can be billed and ROI reported.
CREATE TABLE IF NOT EXISTS ad_conversions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id     BIGINT UNSIGNED NOT NULL,
  creative_id     BIGINT UNSIGNED NULL,
  click_id        BIGINT UNSIGNED NULL,
  user_id         BIGINT UNSIGNED NULL,
  conversion_kind ENUM('lead','signup','listing_view','contact','purchase','call')
                    NOT NULL,
  value           DECIMAL(18,2)   NULL,
  currency        CHAR(3)         NULL,
  reference_type  VARCHAR(48)     NULL,
  reference_id    BIGINT UNSIGNED NULL,
  attributed_at   TIMESTAMP       NULL,       -- when attribution was decided
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_conversions_campaign (campaign_id, created_at),
  KEY idx_ad_conversions_click (click_id),
  KEY idx_ad_conversions_kind (conversion_kind, created_at),
  CONSTRAINT fk_ad_conversions_campaign FOREIGN KEY (campaign_id)
    REFERENCES ad_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_conversions_creative FOREIGN KEY (creative_id)
    REFERENCES ad_creatives (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ad_conversions_click FOREIGN KEY (click_id)
    REFERENCES ad_clicks (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ad_conversions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §21 Sponsored Listings — a real listing promoted inside the feed rather than
-- a banner. position_weight is multiplied into the feed ranking, so a sponsored
-- listing lifts instead of jumping to a fixed slot.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sponsored_listings (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id     BIGINT UNSIGNED NOT NULL,
  listing_id      BIGINT UNSIGNED NOT NULL,
  bid_amount      DECIMAL(12,4)   NULL,
  currency        CHAR(3)         NULL,
  position_weight DECIMAL(8,4)    NOT NULL DEFAULT 1.0000,
  status          ENUM('active','paused','ended') NOT NULL DEFAULT 'active',
  impressions     INT UNSIGNED    NOT NULL DEFAULT 0,
  clicks          INT UNSIGNED    NOT NULL DEFAULT 0,
  spend           DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  starts_at       TIMESTAMP       NULL,
  ends_at         TIMESTAMP       NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sponsored_listings (campaign_id, listing_id),
  -- Feed injection: which listings are sponsored right now
  KEY idx_sponsored_listings_live (status, starts_at, ends_at),
  KEY idx_sponsored_listings_listing (listing_id, status),
  CONSTRAINT fk_sponsored_listings_campaign FOREIGN KEY (campaign_id)
    REFERENCES ad_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sponsored_listings_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Daily rollup written by a job from the impression/click/conversion logs.
-- The campaign manager dashboard reads only this table, so it stays fast no
-- matter how large the logs get. NULL creative_id / placement_id = the
-- campaign-level total for that day.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ad_daily_stats (
  id                   BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  campaign_id          BIGINT UNSIGNED   NOT NULL,
  creative_id          BIGINT UNSIGNED   NULL,
  placement_id         SMALLINT UNSIGNED NULL,
  stat_date            DATE              NOT NULL,
  impressions          INT UNSIGNED      NOT NULL DEFAULT 0,
  viewable_impressions INT UNSIGNED      NOT NULL DEFAULT 0,
  clicks               INT UNSIGNED      NOT NULL DEFAULT 0,
  conversions          INT UNSIGNED      NOT NULL DEFAULT 0,
  spend                DECIMAL(18,4)     NOT NULL DEFAULT 0.0000,
  currency             CHAR(3)           NULL,
  ctr                  DECIMAL(8,4)      NULL,   -- percent
  cpc                  DECIMAL(12,4)     NULL,
  cpm                  DECIMAL(12,4)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ad_daily_stats (campaign_id, creative_id, placement_id, stat_date),
  KEY idx_ad_daily_stats_date (stat_date, campaign_id),
  CONSTRAINT fk_ad_daily_stats_campaign FOREIGN KEY (campaign_id)
    REFERENCES ad_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_daily_stats_creative FOREIGN KEY (creative_id)
    REFERENCES ad_creatives (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ad_daily_stats_placement FOREIGN KEY (placement_id)
    REFERENCES ad_placements (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;
