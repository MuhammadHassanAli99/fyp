-- =============================================================================
-- 031  Subscription platform (additive on 012)
--      Extends the existing centralized billing schema. Does NOT create a
--      second Gold/Property/Vehicle subscription system.
--      - Lifecycle statuses: grace_period, suspended
--      - Scheduled downgrade (pending_plan_*)
--      - Enterprise entitlement overrides (per subscription, not plan name)
--      - Append-only usage events for audit
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Status vocabulary used by SubscriptionService. Existing values are preserved
-- so live rows stay valid; grace_period and suspended are added.
-- -----------------------------------------------------------------------------
ALTER TABLE user_subscriptions
  MODIFY COLUMN status ENUM(
    'trialing',
    'active',
    'past_due',
    'grace_period',
    'paused',
    'cancelled',
    'expired',
    'suspended',
    'incomplete'
  ) NOT NULL DEFAULT 'incomplete';

ALTER TABLE user_subscriptions
  ADD COLUMN pending_plan_id SMALLINT UNSIGNED NULL AFTER plan_price_id,
  ADD COLUMN pending_plan_price_id INT UNSIGNED NULL AFTER pending_plan_id,
  ADD COLUMN grace_period_ends_at TIMESTAMP NULL AFTER current_period_end,
  ADD COLUMN metadata JSON NULL AFTER gateway_customer_id;

ALTER TABLE user_subscriptions
  ADD CONSTRAINT fk_user_subscriptions_pending_plan FOREIGN KEY (pending_plan_id)
    REFERENCES subscription_plans (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_user_subscriptions_pending_price FOREIGN KEY (pending_plan_price_id)
    REFERENCES plan_prices (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE subscription_plans
  ADD COLUMN metadata JSON NULL AFTER badge_code;

ALTER TABLE subscription_history
  MODIFY COLUMN change_kind ENUM(
    'create','upgrade','downgrade','renew','cancel','reactivate',
    'expire','pause','resume','grant','override'
  ) NOT NULL;

-- -----------------------------------------------------------------------------
-- Enterprise / negotiated limits. One row per (subscription, feature) so a
-- custom contract never requires a hard-coded "if plan == enterprise" branch.
-- Overrides win over plan_features at entitlement load time.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_entitlement_overrides (
  id              BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  subscription_id BIGINT UNSIGNED   NOT NULL,
  feature_code    VARCHAR(64)       NOT NULL,
  limit_value     BIGINT            NULL,
  is_unlimited    BOOLEAN           NOT NULL DEFAULT FALSE,
  is_enabled      BOOLEAN           NOT NULL DEFAULT TRUE,
  reason          VARCHAR(255)      NULL,
  created_by      BIGINT UNSIGNED   NULL,
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_subscription_overrides (subscription_id, feature_code),
  KEY idx_subscription_overrides_feature (feature_code),
  CONSTRAINT fk_subscription_overrides_sub FOREIGN KEY (subscription_id)
    REFERENCES user_subscriptions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_subscription_overrides_feature FOREIGN KEY (feature_code)
    REFERENCES features (code) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_subscription_overrides_actor FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Meter audit. subscription_usage remains the counter; this table explains
-- who consumed what. No PAN/secrets — only feature codes and deltas.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_usage_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  feature_code    VARCHAR(64)     NOT NULL,
  delta           BIGINT          NOT NULL,
  used_after      BIGINT          NOT NULL,
  limit_value     BIGINT          NULL,
  reference_type  VARCHAR(48)     NULL,
  reference_id    BIGINT UNSIGNED NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_usage_events_subscription (subscription_id, feature_code, created_at),
  KEY idx_usage_events_user (user_id, created_at),
  CONSTRAINT fk_usage_events_subscription FOREIGN KEY (subscription_id)
    REFERENCES user_subscriptions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_usage_events_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_usage_events_feature FOREIGN KEY (feature_code)
    REFERENCES features (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
