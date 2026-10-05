-- =============================================================================
-- 036  Advertisement Platform (additive on 013 / 012)
--      One Ad Platform for Gold, Property and Vehicle. Does NOT create
--      gold_ads / property_ads / vehicle_ads or a second payment system.
-- =============================================================================

USE marketplace;

ALTER TABLE ad_campaigns
  MODIFY COLUMN status ENUM(
    'draft','pending_review','approved','active','paused','scheduled',
    'completed','rejected','exhausted'
  ) NOT NULL DEFAULT 'draft';

ALTER TABLE ad_campaigns
  MODIFY COLUMN objective ENUM(
    'awareness','traffic','leads','listing_views','app_installs','conversions',
    'messages','calls','website_visits'
  ) NOT NULL DEFAULT 'traffic';

ALTER TABLE ad_campaigns
  MODIFY COLUMN pricing_model ENUM('cpm','cpc','cpa','cpv','fixed','sponsored') NOT NULL DEFAULT 'cpm';

ALTER TABLE ad_campaigns
  ADD COLUMN category_id INT UNSIGNED NULL AFTER marketplace_id,
  ADD COLUMN order_id BIGINT UNSIGNED NULL AFTER spent_amount,
  ADD KEY idx_ad_campaigns_category (category_id, status);

ALTER TABLE ad_campaigns
  ADD CONSTRAINT fk_ad_campaigns_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_ad_campaigns_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE ad_creatives
  MODIFY COLUMN format ENUM(
    'banner','native','video','interstitial','carousel','story','featured','sponsored_listing'
  ) NOT NULL DEFAULT 'banner';

ALTER TABLE ad_clicks
  ADD COLUMN is_invalid BOOLEAN NOT NULL DEFAULT FALSE AFTER is_fraud_suspected,
  ADD COLUMN invalid_reason VARCHAR(64) NULL AFTER is_invalid;

ALTER TABLE ad_impressions
  ADD COLUMN is_invalid BOOLEAN NOT NULL DEFAULT FALSE AFTER is_viewable,
  ADD COLUMN uuid CHAR(36) NULL AFTER id,
  ADD UNIQUE KEY uk_ad_impressions_uuid (uuid);

CREATE TABLE IF NOT EXISTS ad_spend_events (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id   BIGINT UNSIGNED NOT NULL,
  impression_id BIGINT UNSIGNED NULL,
  click_id      BIGINT UNSIGNED NULL,
  pricing_model ENUM('cpm','cpc','cpa','cpv','fixed','sponsored') NOT NULL,
  amount        DECIMAL(18,6)   NOT NULL,
  currency      CHAR(3)         NOT NULL,
  billed        BOOLEAN         NOT NULL DEFAULT TRUE,
  reason        VARCHAR(64)     NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ad_spend_campaign (campaign_id, created_at),
  CONSTRAINT fk_ad_spend_campaign FOREIGN KEY (campaign_id)
    REFERENCES ad_campaigns (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
