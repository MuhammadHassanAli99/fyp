-- =============================================================================
-- 012  Subscriptions & payments
--      (§16 Subscription Plans — Free/Starter/Professional/Business/Enterprise
--       and every listed benefit as an entitlement row;
--       §17 Payment Gateway — cards, wallets, PayPal, Stripe, bank transfer,
--       regional wallets, subscription billing, invoices, refunds)
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Entitlement vocabulary. Every §16 benefit is a feature code, so gating is a
-- lookup instead of an if-tree, and a new benefit ships as a seed row.
-- Seeded codes: featured_listings, unlimited_listings, ai_tools, analytics,
-- priority_support, more_images, video_upload, higher_search_ranking,
-- dealer_badge, agency_badge, active_listings, boosts_per_month,
-- saved_searches, compare_slots, chat_translation, masked_calls, api_access,
-- team_seats, bulk_upload, lead_export, custom_branding, verified_badge.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS features (
  code         VARCHAR(64)  NOT NULL,
  name         VARCHAR(128) NOT NULL,
  description  VARCHAR(255) NULL,
  unit         ENUM('count','boolean','bytes','days') NOT NULL DEFAULT 'boolean',
  is_metered   BOOLEAN      NOT NULL DEFAULT FALSE,   -- consumption tracked in subscription_usage
  reset_period ENUM('none','daily','monthly','yearly','billing_cycle') NOT NULL DEFAULT 'none',
  sort_order   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (code)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Plans. marketplace_id NULL = one plan sold across all three modules;
-- setting it lets Vehicles run dealer-specific tiers without new tables.
-- `tier` is the upgrade/downgrade ordering used by proration.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscription_plans (
  id             SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(48)      NOT NULL,   -- free | starter | professional | business | enterprise
  name           VARCHAR(96)      NOT NULL,
  description    VARCHAR(500)     NULL,
  marketplace_id TINYINT UNSIGNED NULL,
  tier           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  audience       ENUM('individual','business','both') NOT NULL DEFAULT 'both',
  trial_days     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_public      BOOLEAN          NOT NULL DEFAULT TRUE,   -- FALSE = negotiated/enterprise only
  is_active      BOOLEAN          NOT NULL DEFAULT TRUE,
  is_default     BOOLEAN          NOT NULL DEFAULT FALSE,  -- assigned on signup
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  badge_code     VARCHAR(48)      NULL,       -- badge granted while subscribed (§3)
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_subscription_plans_code (code, marketplace_id),
  KEY idx_subscription_plans_visible (is_active, is_public, sort_order),
  CONSTRAINT fk_subscription_plans_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_subscription_plans_badge FOREIGN KEY (badge_code)
    REFERENCES badges (code) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Price book: per country, currency and billing interval, so PKR/SAR/USD
-- pricing is data. `interval` is reserved in MySQL, hence billing_interval.
-- gateway_price_ids maps this row to the price object at each gateway.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_prices (
  id                INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  plan_id           SMALLINT UNSIGNED NOT NULL,
  country_id        SMALLINT UNSIGNED NULL,        -- NULL = default price
  currency          CHAR(3)           NOT NULL,
  billing_interval  ENUM('monthly','quarterly','semi_annual','yearly','lifetime')
                      NOT NULL DEFAULT 'monthly',
  amount            DECIMAL(18,2)     NOT NULL,
  original_amount   DECIMAL(18,2)     NULL,        -- strike-through price
  setup_fee         DECIMAL(18,2)     NULL,
  gateway_price_ids JSON              NULL,        -- {"stripe":"price_123","paypal":"P-9"}
  is_active         BOOLEAN           NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uk_plan_prices (plan_id, country_id, currency, billing_interval),
  KEY idx_plan_prices_lookup (plan_id, is_active, country_id),
  CONSTRAINT fk_plan_prices_plan FOREIGN KEY (plan_id)
    REFERENCES subscription_plans (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_plan_prices_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_plan_prices_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_plan_prices_amount CHECK (amount >= 0)
) ENGINE = InnoDB;

-- What each plan grants. limit_value NULL + is_unlimited = the §16
-- "Unlimited Listings" case; is_enabled FALSE hides a feature from a tier.
CREATE TABLE IF NOT EXISTS plan_features (
  plan_id      SMALLINT UNSIGNED NOT NULL,
  feature_code VARCHAR(64)       NOT NULL,
  limit_value  BIGINT            NULL,
  is_unlimited BOOLEAN           NOT NULL DEFAULT FALSE,
  is_enabled   BOOLEAN           NOT NULL DEFAULT TRUE,
  PRIMARY KEY (plan_id, feature_code),
  KEY idx_plan_features_feature (feature_code),
  CONSTRAINT fk_plan_features_plan FOREIGN KEY (plan_id)
    REFERENCES subscription_plans (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_plan_features_feature FOREIGN KEY (feature_code)
    REFERENCES features (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Live subscriptions. business_id lets a company hold the seat pool while the
-- owning user still authenticates. Gateway ids are stored so a webhook can be
-- resolved without a lookup table.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_subscriptions (
  id                      BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid                    CHAR(36)          NOT NULL,
  user_id                 BIGINT UNSIGNED   NOT NULL,
  business_id             BIGINT UNSIGNED   NULL,
  plan_id                 SMALLINT UNSIGNED NOT NULL,
  plan_price_id           INT UNSIGNED      NULL,
  status                  ENUM('trialing','active','past_due','paused','cancelled',
                               'expired','incomplete') NOT NULL DEFAULT 'incomplete',
  quantity                SMALLINT UNSIGNED NOT NULL DEFAULT 1,   -- seats
  current_period_start    TIMESTAMP         NULL,
  current_period_end      TIMESTAMP         NULL,
  trial_start             TIMESTAMP         NULL,
  trial_end               TIMESTAMP         NULL,
  cancel_at               TIMESTAMP         NULL,   -- cancel at period end
  cancelled_at            TIMESTAMP         NULL,
  cancel_reason           VARCHAR(255)      NULL,
  ended_at                TIMESTAMP         NULL,
  auto_renew              BOOLEAN           NOT NULL DEFAULT TRUE,
  gateway                 VARCHAR(32)       NULL,
  gateway_subscription_id VARCHAR(191)      NULL,
  gateway_customer_id     VARCHAR(191)      NULL,
  latest_order_id         BIGINT UNSIGNED   NULL,
  created_at              TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_subscriptions_uuid (uuid),
  UNIQUE KEY uk_user_subscriptions_gateway (gateway, gateway_subscription_id),
  KEY idx_user_subscriptions_user (user_id, status),
  -- Renewal / expiry job
  KEY idx_user_subscriptions_renewal (status, current_period_end),
  KEY idx_user_subscriptions_business (business_id, status),
  CONSTRAINT fk_user_subscriptions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_subscriptions_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_user_subscriptions_plan FOREIGN KEY (plan_id)
    REFERENCES subscription_plans (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_user_subscriptions_price FOREIGN KEY (plan_price_id)
    REFERENCES plan_prices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Quota counters per billing window. The entitlements middleware increments
-- used_value; limit_value is copied from plan_features so a mid-cycle plan
-- change cannot retroactively break the window.
CREATE TABLE IF NOT EXISTS subscription_usage (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subscription_id BIGINT UNSIGNED NOT NULL,
  feature_code    VARCHAR(64)     NOT NULL,
  period_start    DATE            NOT NULL,
  period_end      DATE            NOT NULL,
  used_value      BIGINT          NOT NULL DEFAULT 0,
  limit_value     BIGINT          NULL,
  last_used_at    TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_subscription_usage (subscription_id, feature_code, period_start),
  KEY idx_subscription_usage_feature (feature_code, period_start),
  CONSTRAINT fk_subscription_usage_subscription FOREIGN KEY (subscription_id)
    REFERENCES user_subscriptions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_subscription_usage_feature FOREIGN KEY (feature_code)
    REFERENCES features (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Plan change audit — needed to answer "why is this user on this price?"
CREATE TABLE IF NOT EXISTS subscription_history (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  subscription_id   BIGINT UNSIGNED   NOT NULL,
  from_plan_id      SMALLINT UNSIGNED NULL,
  to_plan_id        SMALLINT UNSIGNED NULL,
  change_kind       ENUM('create','upgrade','downgrade','renew','cancel','reactivate',
                         'expire','pause','resume') NOT NULL,
  effective_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  proration_amount  DECIMAL(18,2)     NULL,
  currency          CHAR(3)           NULL,
  actor_id          BIGINT UNSIGNED   NULL,   -- NULL = system/renewal job
  reason            VARCHAR(255)      NULL,
  created_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_subscription_history_subscription (subscription_id, effective_at),
  CONSTRAINT fk_subscription_history_subscription FOREIGN KEY (subscription_id)
    REFERENCES user_subscriptions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_subscription_history_from_plan FOREIGN KEY (from_plan_id)
    REFERENCES subscription_plans (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_subscription_history_to_plan FOREIGN KEY (to_plan_id)
    REFERENCES subscription_plans (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_subscription_history_actor FOREIGN KEY (actor_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §17 Gateways. Country/currency support is data so checkout can offer
-- JazzCash in PK, Mada in SA and Stripe elsewhere without code branches.
-- Codes: stripe, paypal, google_pay, apple_pay, card, bank_transfer, jazzcash,
-- easypaisa, payfast, razorpay, mada, fawry, mercadopago, wallet.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_gateways (
  code                VARCHAR(32)  NOT NULL,
  name                VARCHAR(96)  NOT NULL,
  kind                ENUM('card','wallet','bank','bnpl','crypto','cash') NOT NULL DEFAULT 'card',
  supports_recurring  BOOLEAN      NOT NULL DEFAULT FALSE,
  supports_refund     BOOLEAN      NOT NULL DEFAULT TRUE,
  supported_countries JSON         NULL,        -- ISO2 list; NULL = worldwide
  supported_currencies JSON        NULL,
  config              JSON         NULL,        -- non-secret driver config
  fee_percent         DECIMAL(6,3) NOT NULL DEFAULT 0.000,
  fee_fixed           DECIMAL(12,4) NOT NULL DEFAULT 0.0000,
  fee_currency        CHAR(3)      NULL,        -- currency fee_fixed is quoted in
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
  is_test_mode        BOOLEAN      NOT NULL DEFAULT FALSE,
  sort_order          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (code),
  KEY idx_payment_gateways_active (is_active, sort_order)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Saved instruments. Only gateway tokens and display fragments are stored —
-- never a PAN, IBAN or CVV.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_methods (
  id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid                CHAR(36)         NOT NULL,
  user_id             BIGINT UNSIGNED  NOT NULL,
  gateway_code        VARCHAR(32)      NOT NULL,
  kind                ENUM('card','wallet','bank_account','paypal','apple_pay','google_pay')
                        NOT NULL DEFAULT 'card',
  gateway_token       VARCHAR(255)     NULL,
  gateway_customer_id VARCHAR(191)     NULL,
  brand               VARCHAR(32)      NULL,     -- visa | mastercard | mada
  last4               CHAR(4)          NULL,
  exp_month           TINYINT UNSIGNED NULL,
  exp_year            SMALLINT UNSIGNED NULL,
  holder_name         VARCHAR(128)     NULL,
  bank_name           VARCHAR(128)     NULL,
  iban_last4          CHAR(4)          NULL,
  billing_country_id  SMALLINT UNSIGNED NULL,
  is_default          BOOLEAN          NOT NULL DEFAULT FALSE,
  is_verified         BOOLEAN          NOT NULL DEFAULT FALSE,
  status              ENUM('active','expired','revoked','failed') NOT NULL DEFAULT 'active',
  created_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payment_methods_uuid (uuid),
  UNIQUE KEY uk_payment_methods_token (gateway_code, gateway_token),
  KEY idx_payment_methods_user (user_id, status, is_default),
  CONSTRAINT fk_payment_methods_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payment_methods_gateway FOREIGN KEY (gateway_code)
    REFERENCES payment_gateways (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payment_methods_country FOREIGN KEY (billing_country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Coupons. Scope lists are JSON id arrays because a promo is usually aimed at
-- "these plans in these countries" and never needs to be joined on.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  id               INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  code             VARCHAR(48)     NOT NULL,
  name             VARCHAR(128)    NULL,
  kind             ENUM('percent','fixed','free_trial','free_promotion') NOT NULL DEFAULT 'percent',
  value            DECIMAL(18,2)   NOT NULL DEFAULT 0.00,   -- percent points or fixed amount
  currency         CHAR(3)         NULL,        -- required when kind='fixed'
  applies_to       ENUM('subscription','promotion','advertisement','all') NOT NULL DEFAULT 'all',
  plan_ids         JSON            NULL,
  marketplace_ids  JSON            NULL,
  country_ids      JSON            NULL,
  min_amount       DECIMAL(18,2)   NULL,
  max_discount     DECIMAL(18,2)   NULL,
  max_redemptions  INT UNSIGNED    NULL,        -- NULL = unlimited
  max_per_user     SMALLINT UNSIGNED NULL,
  redemption_count INT UNSIGNED    NOT NULL DEFAULT 0,
  first_time_only  BOOLEAN         NOT NULL DEFAULT FALSE,
  starts_at        TIMESTAMP       NULL,
  ends_at          TIMESTAMP       NULL,
  is_active        BOOLEAN         NOT NULL DEFAULT TRUE,
  created_by       BIGINT UNSIGNED NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_coupons_code (code),
  KEY idx_coupons_live (is_active, starts_at, ends_at),
  CONSTRAINT fk_coupons_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_coupons_value CHECK (value >= 0)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Orders are the single checkout envelope for everything sellable:
-- subscriptions, listing promotions, ad budgets, verification, inspections,
-- wallet top-ups and auction deposits. reference_type/reference_id is a
-- deliberate polymorphic link — a real FK per kind would mean a column per kind.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)          NOT NULL,
  order_number      VARCHAR(32)       NOT NULL,   -- human-quotable, e.g. "ORD-2K7F91"
  user_id           BIGINT UNSIGNED   NOT NULL,
  business_id       BIGINT UNSIGNED   NULL,
  kind              ENUM('subscription','promotion','advertisement','verification',
                         'inspection','service','wallet_topup','auction_deposit')
                      NOT NULL,
  reference_type    VARCHAR(48)       NULL,
  reference_id      BIGINT UNSIGNED   NULL,
  subtotal          DECIMAL(18,2)     NOT NULL DEFAULT 0.00,
  discount_amount   DECIMAL(18,2)     NOT NULL DEFAULT 0.00,
  tax_amount        DECIMAL(18,2)     NOT NULL DEFAULT 0.00,
  total_amount      DECIMAL(18,2)     NOT NULL DEFAULT 0.00,
  currency          CHAR(3)           NOT NULL,
  status            ENUM('pending','awaiting_payment','paid','partially_refunded',
                         'refunded','failed','cancelled','expired') NOT NULL DEFAULT 'pending',
  coupon_id         INT UNSIGNED      NULL,
  gateway_code      VARCHAR(32)       NULL,
  payment_method_id BIGINT UNSIGNED   NULL,
  country_id        SMALLINT UNSIGNED NOT NULL,   -- drives tax_rules selection
  metadata          JSON              NULL,
  expires_at        TIMESTAMP         NULL,       -- unpaid checkout timeout
  paid_at           TIMESTAMP         NULL,
  created_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_orders_uuid (uuid),
  UNIQUE KEY uk_orders_number (order_number),
  KEY idx_orders_user (user_id, status, created_at),
  KEY idx_orders_business (business_id, status),
  -- Abandoned-checkout expiry sweep
  KEY idx_orders_expiry (status, expires_at),
  KEY idx_orders_reference (reference_type, reference_id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_orders_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_orders_coupon FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_orders_gateway FOREIGN KEY (gateway_code)
    REFERENCES payment_gateways (code) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_orders_payment_method FOREIGN KEY (payment_method_id)
    REFERENCES payment_methods (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_orders_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_orders_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_orders_total CHECK (total_amount >= 0 AND discount_amount >= 0)
) ENGINE = InnoDB;

-- Financial rows RESTRICT user deletion on purpose: GDPR erasure anonymises the
-- user record instead of destroying the payment audit trail (§25).

-- Wired with ALTER because orders is created after user_subscriptions.
ALTER TABLE user_subscriptions
  ADD CONSTRAINT fk_user_subscriptions_latest_order FOREIGN KEY (latest_order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS order_items (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id       BIGINT UNSIGNED NOT NULL,
  kind           ENUM('subscription','promotion','advertisement','verification',
                      'inspection','service','wallet_topup','auction_deposit','tax','fee')
                   NOT NULL,
  description    VARCHAR(255)    NOT NULL,
  reference_type VARCHAR(48)     NULL,
  reference_id   BIGINT UNSIGNED NULL,
  quantity       INT UNSIGNED    NOT NULL DEFAULT 1,
  unit_amount    DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  total_amount   DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  currency       CHAR(3)         NOT NULL,
  tax_rate       DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  tax_amount     DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  metadata       JSON            NULL,
  PRIMARY KEY (id),
  KEY idx_order_items_order (order_id),
  CONSTRAINT fk_order_items_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Payment attempts. One order can have several (retry after a failure), so the
-- money state of an order is derived from its payments, never overwritten.
-- base_amount is the total converted to the platform base currency at
-- exchange_rate, which is what reporting sums.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)        NOT NULL,
  order_id          BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  gateway_code      VARCHAR(32)     NOT NULL,
  payment_method_id BIGINT UNSIGNED NULL,
  amount            DECIMAL(18,2)   NOT NULL,
  currency          CHAR(3)         NOT NULL,
  base_amount       DECIMAL(18,2)   NULL,
  exchange_rate     DECIMAL(20,10)  NULL,
  gateway_fee       DECIMAL(18,2)   NULL,
  net_amount        DECIMAL(18,2)   NULL,
  status            ENUM('initiated','pending','requires_action','authorized','captured',
                         'succeeded','failed','cancelled','expired','disputed')
                      NOT NULL DEFAULT 'initiated',
  gateway_payment_id VARCHAR(191)   NULL,
  gateway_intent_id VARCHAR(191)    NULL,
  gateway_status    VARCHAR(64)     NULL,        -- raw provider status string
  failure_code      VARCHAR(64)     NULL,
  failure_message   VARCHAR(500)    NULL,
  three_ds_used     BOOLEAN         NOT NULL DEFAULT FALSE,
  ip_address        VARBINARY(16)   NULL,
  risk_score        TINYINT UNSIGNED NULL,
  authorized_at     TIMESTAMP       NULL,
  captured_at       TIMESTAMP       NULL,
  failed_at         TIMESTAMP       NULL,
  raw_response      JSON            NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payments_uuid (uuid),
  UNIQUE KEY uk_payments_gateway_id (gateway_code, gateway_payment_id),
  KEY idx_payments_order (order_id, status),
  KEY idx_payments_user (user_id, created_at),
  KEY idx_payments_status (status, created_at),
  KEY idx_payments_intent (gateway_intent_id),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payments_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payments_gateway FOREIGN KEY (gateway_code)
    REFERENCES payment_gateways (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payments_method FOREIGN KEY (payment_method_id)
    REFERENCES payment_methods (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payments_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_payments_amount CHECK (amount > 0)
) ENGINE = InnoDB;

-- §17 Refunds. Partial refunds are normal, so amount is per-refund and the
-- order status becomes 'partially_refunded' until the sums match.
CREATE TABLE IF NOT EXISTS refunds (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)        NOT NULL,
  payment_id        BIGINT UNSIGNED NOT NULL,
  order_id          BIGINT UNSIGNED NOT NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  amount            DECIMAL(18,2)   NOT NULL,
  currency          CHAR(3)         NOT NULL,
  reason            ENUM('requested_by_customer','duplicate','fraudulent',
                         'service_not_provided','downgrade','chargeback','other')
                      NOT NULL DEFAULT 'requested_by_customer',
  description       VARCHAR(500)    NULL,
  status            ENUM('pending','processing','succeeded','failed','cancelled')
                      NOT NULL DEFAULT 'pending',
  gateway_refund_id VARCHAR(191)    NULL,
  approved_by       BIGINT UNSIGNED NULL,
  approved_at       TIMESTAMP       NULL,
  processed_at      TIMESTAMP       NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_refunds_uuid (uuid),
  KEY idx_refunds_payment (payment_id, status),
  KEY idx_refunds_order (order_id),
  KEY idx_refunds_queue (status, created_at),
  CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id)
    REFERENCES payments (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_refunds_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_refunds_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_refunds_approver FOREIGN KEY (approved_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_refunds_amount CHECK (amount > 0)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §17 Invoices. Billing identity is snapshotted (name/email/address/tax id)
-- because an invoice must not change when the profile later does.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)        NOT NULL,
  invoice_number  VARCHAR(32)     NOT NULL,
  order_id        BIGINT UNSIGNED NULL,
  subscription_id BIGINT UNSIGNED NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  business_id     BIGINT UNSIGNED NULL,
  billing_name    VARCHAR(191)    NULL,
  billing_email   VARCHAR(191)    NULL,
  billing_address JSON            NULL,
  billing_tax_id  VARCHAR(96)     NULL,
  subtotal        DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  tax_amount      DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  total_amount    DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  amount_paid     DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  amount_due      DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  currency        CHAR(3)         NOT NULL,
  status          ENUM('draft','open','paid','void','uncollectible') NOT NULL DEFAULT 'draft',
  issued_at       TIMESTAMP       NULL,
  due_at          TIMESTAMP       NULL,
  paid_at         TIMESTAMP       NULL,
  pdf_url         VARCHAR(512)    NULL,
  notes           VARCHAR(500)    NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_invoices_uuid (uuid),
  UNIQUE KEY uk_invoices_number (invoice_number),
  KEY idx_invoices_user (user_id, status, issued_at),
  KEY idx_invoices_subscription (subscription_id, issued_at),
  KEY idx_invoices_order (order_id),
  -- Dunning: unpaid and past due
  KEY idx_invoices_overdue (status, due_at),
  CONSTRAINT fk_invoices_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_invoices_subscription FOREIGN KEY (subscription_id)
    REFERENCES user_subscriptions (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_invoices_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_invoices_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_invoices_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Invoice lines. period_start/period_end make a subscription line self-describing
-- ("Professional, 1 Mar – 31 Mar") without joining back to the subscription.
CREATE TABLE IF NOT EXISTS invoice_items (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  invoice_id   BIGINT UNSIGNED NOT NULL,
  description  VARCHAR(255)    NOT NULL,
  quantity     INT UNSIGNED    NOT NULL DEFAULT 1,
  unit_amount  DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  total_amount DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  currency     CHAR(3)         NOT NULL,
  tax_rate     DECIMAL(6,3)    NOT NULL DEFAULT 0.000,
  tax_amount   DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  period_start DATE            NULL,          -- service window for subscription lines
  period_end   DATE            NULL,
  PRIMARY KEY (id),
  KEY idx_invoice_items_invoice (invoice_id),
  CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id)
    REFERENCES invoices (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- One row per use; the (coupon_id, user_id) index is what enforces max_per_user.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  coupon_id       INT UNSIGNED    NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  order_id        BIGINT UNSIGNED NULL,
  discount_amount DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  currency        CHAR(3)         NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_coupon_redemptions_per_user (coupon_id, user_id),
  KEY idx_coupon_redemptions_order (order_id),
  CONSTRAINT fk_coupon_redemptions_coupon FOREIGN KEY (coupon_id)
    REFERENCES coupons (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_coupon_redemptions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_coupon_redemptions_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Wallets (§17 Regional wallets, auction deposits, refunds to credit).
-- One wallet per user per currency — never mix currencies in one balance.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)        NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  currency        CHAR(3)         NOT NULL,
  balance         DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  pending_balance DECIMAL(18,2)   NOT NULL DEFAULT 0.00,   -- holds not yet released
  lifetime_credit DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  lifetime_debit  DECIMAL(18,2)   NOT NULL DEFAULT 0.00,
  status          ENUM('active','frozen','closed') NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallets_uuid (uuid),
  UNIQUE KEY uk_wallets_user_currency (user_id, currency),
  CONSTRAINT fk_wallets_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_wallets_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Append-only ledger; balance_after makes every row auditable on its own.
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           CHAR(36)        NOT NULL,
  wallet_id      BIGINT UNSIGNED NOT NULL,
  kind           ENUM('credit','debit','hold','release','refund','payout','adjustment')
                   NOT NULL,
  amount         DECIMAL(18,2)   NOT NULL,
  currency       CHAR(3)         NOT NULL,
  balance_after  DECIMAL(18,2)   NOT NULL,
  reference_type VARCHAR(48)     NULL,
  reference_id   BIGINT UNSIGNED NULL,
  description    VARCHAR(255)    NULL,
  status         ENUM('pending','completed','failed','reversed') NOT NULL DEFAULT 'completed',
  created_by     BIGINT UNSIGNED NULL,          -- NULL = system
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_wallet_transactions_uuid (uuid),
  KEY idx_wallet_transactions_wallet (wallet_id, created_at),
  KEY idx_wallet_transactions_reference (reference_type, reference_id),
  CONSTRAINT fk_wallet_transactions_wallet FOREIGN KEY (wallet_id)
    REFERENCES wallets (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_wallet_transactions_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Money out (dealer refunds, ad credit returns, marketplace earnings).
CREATE TABLE IF NOT EXISTS payouts (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)        NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  business_id      BIGINT UNSIGNED NULL,
  amount           DECIMAL(18,2)   NOT NULL,
  currency         CHAR(3)         NOT NULL,
  method           ENUM('bank_transfer','paypal','wallet','stripe_connect')
                     NOT NULL DEFAULT 'bank_transfer',
  destination      JSON            NULL,        -- masked account details
  status           ENUM('requested','approved','processing','paid','failed','cancelled')
                     NOT NULL DEFAULT 'requested',
  gateway_payout_id VARCHAR(191)   NULL,
  requested_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by      BIGINT UNSIGNED NULL,
  approved_at      TIMESTAMP       NULL,
  paid_at          TIMESTAMP       NULL,
  failure_reason   VARCHAR(255)    NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payouts_uuid (uuid),
  KEY idx_payouts_user (user_id, status),
  -- Finance approval queue
  KEY idx_payouts_queue (status, requested_at),
  CONSTRAINT fk_payouts_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payouts_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_payouts_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_payouts_approver FOREIGN KEY (approved_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Gateway webhooks. (gateway_code, event_id) is the idempotency key: providers
-- retry aggressively and every event must be processed exactly once.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gateway_code    VARCHAR(32)     NOT NULL,
  event_id        VARCHAR(191)    NOT NULL,
  event_type      VARCHAR(96)     NOT NULL,
  payload         JSON            NOT NULL,
  signature_valid BOOLEAN         NOT NULL DEFAULT FALSE,
  status          ENUM('received','processing','processed','ignored','failed')
                    NOT NULL DEFAULT 'received',
  attempts        TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error           TEXT            NULL,
  received_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at    TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_webhook_events_idempotency (gateway_code, event_id),
  -- Retry poller
  KEY idx_webhook_events_queue (status, received_at),
  KEY idx_webhook_events_type (event_type, received_at),
  CONSTRAINT fk_webhook_events_gateway FOREIGN KEY (gateway_code)
    REFERENCES payment_gateways (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
