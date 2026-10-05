-- =============================================================================
-- 15  Subscription platform catalogue (idempotent, code-based)
--     Completes Free → Enterprise. Relationships use plan codes, not hard-coded
--     ids, except the original Free/Starter rows already inserted as 1/2.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Feature vocabulary. Existing codes are updated in place; new codes are added.
-- Application code looks up these codes — never plan names.
-- -----------------------------------------------------------------------------
INSERT INTO features (code, name, description, unit, is_metered, reset_period, sort_order) VALUES
  ('active_listings',          'Active listings',           'How many live listings a seller may hold',              'count',   TRUE,  'none',          1),
  ('images_per_listing',       'Images per listing',        'Max photos attached to one listing',                   'count',   FALSE, 'none',          2),
  ('featured_listings',        'Featured listings',         'Promote a listing to featured slots',                  'count',   TRUE,  'billing_cycle', 3),
  ('boosts_per_month',         'Boosts per month',          'Temporary feed boosts',                                'count',   TRUE,  'monthly',       4),
  ('video_upload',             'Video upload',              'Attach videos to listings',                            'boolean', FALSE, 'none',          8),
  ('ai_tools',                 'AI tools',                  'Access to AI helpers',                                 'boolean', FALSE, 'none',          7),
  ('ai_operations',            'AI operations',             'Metered AI calls per billing period',                  'count',   TRUE,  'billing_cycle', 70),
  ('listing_analytics',        'Basic analytics',           'Per-listing performance dashboard',                    'boolean', FALSE, 'none',          11),
  ('advanced_analytics',       'Advanced analytics',        'Unique viewers, conversion and series',                'boolean', FALSE, 'none',          71),
  ('business_analytics',       'Business analytics',        'Lead export and business reporting',                   'boolean', FALSE, 'none',          72),
  ('higher_search_ranking',    'Higher search ranking',     'Server-side ranking boost at index time',              'boolean', FALSE, 'none',          73),
  ('dealer_badge',             'Dealer badge eligibility',  'May receive the dealer badge when verified',           'boolean', FALSE, 'none',          74),
  ('agency_badge',             'Agency badge eligibility',  'May receive the agency badge when verified',           'boolean', FALSE, 'none',          75),
  ('premium_badge',            'Premium badge',             'Premium seller mark while subscribed',                 'boolean', FALSE, 'none',          76),
  ('priority_support',         'Priority support',          'Priority customer support',                            'boolean', FALSE, 'none',          77),
  ('dedicated_support',        'Dedicated support',         'Named support channel for enterprise',                 'boolean', FALSE, 'none',          78),
  ('team_seats',               'Team seats',                'Business members included',                            'count',   FALSE, 'none',          79),
  ('storage_bytes',            'Media storage',             'Object-storage quota in bytes',                        'bytes',   TRUE,  'none',          80),
  ('vehicle_featured',         'Featured vehicle listings', 'Featured slots for vehicles',                          'count',   TRUE,  'billing_cycle', 81),
  ('bulk_upload',              'Bulk upload',               'Bulk listing import',                                  'boolean', FALSE, 'none',          82),
  ('api_access',               'API access',                'Public API credentials',                               'boolean', FALSE, 'none',          83),
  ('unlimited_listings',       'Unlimited listings',        'No active listing cap',                                'boolean', FALSE, 'none',          84)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  unit = VALUES(unit),
  is_metered = VALUES(is_metered),
  reset_period = VALUES(reset_period),
  sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- Plans. Ids 1/2 already seeded. 3–5 are the remaining public catalogue.
-- Enterprise is public for display; custom contracts use overrides.
-- -----------------------------------------------------------------------------
INSERT INTO subscription_plans (
  id, code, name, description, marketplace_id, tier, audience, trial_days,
  is_public, is_active, is_default, sort_order, badge_code, metadata
) VALUES
  (1, 'free', 'Free', 'Starter plan for individual sellers across all marketplaces',
   NULL, 0, 'both', 0, TRUE, TRUE, TRUE, 1, NULL, JSON_OBJECT('baseCurrency','USD')),
  (2, 'starter', 'Starter', 'More listings, video and featured slots for active sellers',
   NULL, 1, 'both', 7, TRUE, TRUE, FALSE, 2, NULL, JSON_OBJECT('baseCurrency','USD')),
  (3, 'professional', 'Professional', 'Higher limits, AI quota, ranking and dealer-badge eligibility',
   NULL, 2, 'both', 14, TRUE, TRUE, FALSE, 3, 'premium', JSON_OBJECT('baseCurrency','USD')),
  (4, 'business', 'Business', 'Team seats, business analytics, dealer and agency badge eligibility',
   NULL, 3, 'business', 14, TRUE, TRUE, FALSE, 4, NULL, JSON_OBJECT('baseCurrency','USD')),
  (5, 'enterprise', 'Enterprise', 'Custom limits, dedicated support and negotiated pricing',
   NULL, 4, 'business', 0, TRUE, TRUE, FALSE, 5, NULL, JSON_OBJECT('baseCurrency','USD','custom',TRUE))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  tier = VALUES(tier),
  audience = VALUES(audience),
  trial_days = VALUES(trial_days),
  is_public = VALUES(is_public),
  is_active = VALUES(is_active),
  is_default = VALUES(is_default),
  sort_order = VALUES(sort_order),
  badge_code = VALUES(badge_code),
  metadata = VALUES(metadata);

-- -----------------------------------------------------------------------------
-- Localized chargeable prices. Display conversion is not used as the charge.
-- country_id NULL = catalogue default for that currency.
-- -----------------------------------------------------------------------------
INSERT INTO plan_prices (plan_id, country_id, currency, billing_interval, amount, original_amount, is_active)
SELECT p.id, NULL, x.currency, x.billing_interval, x.amount, x.original_amount, TRUE
FROM subscription_plans p
JOIN (
  SELECT 'free' code, 'USD' currency, 'monthly' billing_interval, 0.00 amount, NULL original_amount
  UNION ALL SELECT 'free', 'USD', 'yearly', 0.00, NULL
  UNION ALL SELECT 'starter', 'USD', 'monthly', 9.99, 12.99
  UNION ALL SELECT 'starter', 'USD', 'yearly', 99.00, 119.88
  UNION ALL SELECT 'starter', 'EUR', 'monthly', 9.49, NULL
  UNION ALL SELECT 'starter', 'GBP', 'monthly', 7.99, NULL
  UNION ALL SELECT 'starter', 'PKR', 'monthly', 2499.00, NULL
  UNION ALL SELECT 'starter', 'INR', 'monthly', 799.00, NULL
  UNION ALL SELECT 'starter', 'SAR', 'monthly', 37.00, NULL
  UNION ALL SELECT 'starter', 'AED', 'monthly', 37.00, NULL
  UNION ALL SELECT 'starter', 'CAD', 'monthly', 12.99, NULL
  UNION ALL SELECT 'starter', 'AUD', 'monthly', 14.99, NULL
  UNION ALL SELECT 'starter', 'TRY', 'monthly', 329.00, NULL
  UNION ALL SELECT 'starter', 'JPY', 'monthly', 1499.00, NULL
  UNION ALL SELECT 'professional', 'USD', 'monthly', 19.99, 24.99
  UNION ALL SELECT 'professional', 'USD', 'yearly', 199.00, 239.88
  UNION ALL SELECT 'professional', 'EUR', 'monthly', 18.99, NULL
  UNION ALL SELECT 'professional', 'GBP', 'monthly', 15.99, NULL
  UNION ALL SELECT 'professional', 'PKR', 'monthly', 5999.00, NULL
  UNION ALL SELECT 'professional', 'INR', 'monthly', 1699.00, NULL
  UNION ALL SELECT 'professional', 'SAR', 'monthly', 75.00, NULL
  UNION ALL SELECT 'professional', 'AED', 'monthly', 73.00, NULL
  UNION ALL SELECT 'professional', 'CAD', 'monthly', 27.00, NULL
  UNION ALL SELECT 'professional', 'AUD', 'monthly', 29.00, NULL
  UNION ALL SELECT 'professional', 'TRY', 'monthly', 649.00, NULL
  UNION ALL SELECT 'professional', 'JPY', 'monthly', 2999.00, NULL
  UNION ALL SELECT 'business', 'USD', 'monthly', 49.99, 59.99
  UNION ALL SELECT 'business', 'USD', 'yearly', 499.00, 599.88
  UNION ALL SELECT 'business', 'EUR', 'monthly', 47.99, NULL
  UNION ALL SELECT 'business', 'GBP', 'monthly', 39.99, NULL
  UNION ALL SELECT 'business', 'PKR', 'monthly', 14999.00, NULL
  UNION ALL SELECT 'business', 'INR', 'monthly', 4199.00, NULL
  UNION ALL SELECT 'business', 'SAR', 'monthly', 187.00, NULL
  UNION ALL SELECT 'business', 'AED', 'monthly', 184.00, NULL
  UNION ALL SELECT 'business', 'CAD', 'monthly', 67.00, NULL
  UNION ALL SELECT 'business', 'AUD', 'monthly', 74.00, NULL
  UNION ALL SELECT 'business', 'TRY', 'monthly', 1649.00, NULL
  UNION ALL SELECT 'business', 'JPY', 'monthly', 7499.00, NULL
  UNION ALL SELECT 'enterprise', 'USD', 'monthly', 199.00, NULL
  UNION ALL SELECT 'enterprise', 'USD', 'yearly', 1990.00, NULL
  UNION ALL SELECT 'enterprise', 'EUR', 'monthly', 189.00, NULL
  UNION ALL SELECT 'enterprise', 'GBP', 'monthly', 159.00, NULL
  UNION ALL SELECT 'enterprise', 'PKR', 'monthly', 55999.00, NULL
  UNION ALL SELECT 'enterprise', 'INR', 'monthly', 16999.00, NULL
  UNION ALL SELECT 'enterprise', 'SAR', 'monthly', 749.00, NULL
  UNION ALL SELECT 'enterprise', 'AED', 'monthly', 729.00, NULL
  UNION ALL SELECT 'enterprise', 'CAD', 'monthly', 269.00, NULL
  UNION ALL SELECT 'enterprise', 'AUD', 'monthly', 299.00, NULL
  UNION ALL SELECT 'enterprise', 'TRY', 'monthly', 6499.00, NULL
  UNION ALL SELECT 'enterprise', 'JPY', 'monthly', 29999.00, NULL
) x ON x.code = p.code
WHERE p.marketplace_id IS NULL
ON DUPLICATE KEY UPDATE
  amount = VALUES(amount),
  original_amount = VALUES(original_amount),
  is_active = TRUE;

INSERT INTO plan_prices (plan_id, country_id, currency, billing_interval, amount, is_active)
SELECT p.id, 1, 'PKR', 'monthly', x.amount, TRUE
FROM subscription_plans p
JOIN (
  SELECT 'free' code, 0.00 amount
  UNION ALL SELECT 'starter', 2499.00
  UNION ALL SELECT 'professional', 5999.00
  UNION ALL SELECT 'business', 14999.00
  UNION ALL SELECT 'enterprise', 55999.00
) x ON x.code = p.code
WHERE p.marketplace_id IS NULL
ON DUPLICATE KEY UPDATE amount = VALUES(amount), is_active = TRUE;

-- -----------------------------------------------------------------------------
-- Plan ↔ feature matrix. Looked up by plan code.
-- limit_value NULL + is_unlimited = no cap. is_enabled FALSE hides the feature.
-- -----------------------------------------------------------------------------
INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled)
SELECT p.id, x.feature_code, x.limit_value, x.is_unlimited, x.is_enabled
FROM subscription_plans p
JOIN (
  -- FREE
  SELECT 'free' plan_code, 'active_listings' feature_code, 25 limit_value, FALSE is_unlimited, TRUE is_enabled
  UNION ALL SELECT 'free', 'images_per_listing', 10, FALSE, TRUE
  UNION ALL SELECT 'free', 'featured_listings', 0, FALSE, FALSE
  UNION ALL SELECT 'free', 'boosts_per_month', 0, FALSE, FALSE
  UNION ALL SELECT 'free', 'video_upload', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'ai_tools', NULL, FALSE, TRUE
  UNION ALL SELECT 'free', 'ai_operations', 5, FALSE, TRUE
  UNION ALL SELECT 'free', 'listing_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'free', 'advanced_analytics', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'business_analytics', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'higher_search_ranking', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'dealer_badge', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'agency_badge', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'premium_badge', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'priority_support', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'dedicated_support', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'team_seats', 1, FALSE, TRUE
  UNION ALL SELECT 'free', 'storage_bytes', 1073741824, FALSE, TRUE
  UNION ALL SELECT 'free', 'vehicle_featured', 0, FALSE, FALSE
  UNION ALL SELECT 'free', 'bulk_upload', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'api_access', NULL, FALSE, FALSE
  UNION ALL SELECT 'free', 'unlimited_listings', NULL, FALSE, FALSE
  -- STARTER
  UNION ALL SELECT 'starter', 'active_listings', 100, FALSE, TRUE
  UNION ALL SELECT 'starter', 'images_per_listing', 20, FALSE, TRUE
  UNION ALL SELECT 'starter', 'featured_listings', 3, FALSE, TRUE
  UNION ALL SELECT 'starter', 'boosts_per_month', 5, FALSE, TRUE
  UNION ALL SELECT 'starter', 'video_upload', NULL, FALSE, TRUE
  UNION ALL SELECT 'starter', 'ai_tools', NULL, FALSE, TRUE
  UNION ALL SELECT 'starter', 'ai_operations', 50, FALSE, TRUE
  UNION ALL SELECT 'starter', 'listing_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'starter', 'advanced_analytics', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'business_analytics', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'higher_search_ranking', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'dealer_badge', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'agency_badge', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'premium_badge', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'priority_support', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'dedicated_support', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'team_seats', 1, FALSE, TRUE
  UNION ALL SELECT 'starter', 'storage_bytes', 5368709120, FALSE, TRUE
  UNION ALL SELECT 'starter', 'vehicle_featured', 2, FALSE, TRUE
  UNION ALL SELECT 'starter', 'bulk_upload', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'api_access', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'unlimited_listings', NULL, FALSE, FALSE
  -- PROFESSIONAL
  UNION ALL SELECT 'professional', 'active_listings', 100, FALSE, TRUE
  UNION ALL SELECT 'professional', 'images_per_listing', 30, FALSE, TRUE
  UNION ALL SELECT 'professional', 'featured_listings', 10, FALSE, TRUE
  UNION ALL SELECT 'professional', 'boosts_per_month', 20, FALSE, TRUE
  UNION ALL SELECT 'professional', 'video_upload', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'ai_tools', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'ai_operations', 200, FALSE, TRUE
  UNION ALL SELECT 'professional', 'listing_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'advanced_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'business_analytics', NULL, FALSE, FALSE
  UNION ALL SELECT 'professional', 'higher_search_ranking', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'dealer_badge', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'agency_badge', NULL, FALSE, FALSE
  UNION ALL SELECT 'professional', 'premium_badge', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'priority_support', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'dedicated_support', NULL, FALSE, FALSE
  UNION ALL SELECT 'professional', 'team_seats', 3, FALSE, TRUE
  UNION ALL SELECT 'professional', 'storage_bytes', 26843545600, FALSE, TRUE
  UNION ALL SELECT 'professional', 'vehicle_featured', 10, FALSE, TRUE
  UNION ALL SELECT 'professional', 'bulk_upload', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'api_access', NULL, FALSE, FALSE
  UNION ALL SELECT 'professional', 'unlimited_listings', NULL, FALSE, FALSE
  -- BUSINESS
  UNION ALL SELECT 'business', 'active_listings', 500, FALSE, TRUE
  UNION ALL SELECT 'business', 'images_per_listing', 50, FALSE, TRUE
  UNION ALL SELECT 'business', 'featured_listings', 50, FALSE, TRUE
  UNION ALL SELECT 'business', 'boosts_per_month', 50, FALSE, TRUE
  UNION ALL SELECT 'business', 'video_upload', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'ai_tools', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'ai_operations', 1000, FALSE, TRUE
  UNION ALL SELECT 'business', 'listing_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'advanced_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'business_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'higher_search_ranking', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'dealer_badge', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'agency_badge', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'premium_badge', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'priority_support', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'dedicated_support', NULL, FALSE, FALSE
  UNION ALL SELECT 'business', 'team_seats', 10, FALSE, TRUE
  UNION ALL SELECT 'business', 'storage_bytes', 107374182400, FALSE, TRUE
  UNION ALL SELECT 'business', 'vehicle_featured', 25, FALSE, TRUE
  UNION ALL SELECT 'business', 'bulk_upload', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'api_access', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'unlimited_listings', NULL, FALSE, FALSE
  -- ENTERPRISE (defaults; overrides customise per subscription)
  UNION ALL SELECT 'enterprise', 'active_listings', NULL, TRUE, TRUE
  UNION ALL SELECT 'enterprise', 'images_per_listing', NULL, TRUE, TRUE
  UNION ALL SELECT 'enterprise', 'featured_listings', NULL, TRUE, TRUE
  UNION ALL SELECT 'enterprise', 'boosts_per_month', NULL, TRUE, TRUE
  UNION ALL SELECT 'enterprise', 'video_upload', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'ai_tools', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'ai_operations', NULL, TRUE, TRUE
  UNION ALL SELECT 'enterprise', 'listing_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'advanced_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'business_analytics', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'higher_search_ranking', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'dealer_badge', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'agency_badge', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'premium_badge', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'priority_support', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'dedicated_support', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'team_seats', 50, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'storage_bytes', NULL, TRUE, TRUE
  UNION ALL SELECT 'enterprise', 'vehicle_featured', NULL, TRUE, TRUE
  UNION ALL SELECT 'enterprise', 'bulk_upload', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'api_access', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'unlimited_listings', NULL, FALSE, TRUE
) x ON x.plan_code = p.code
WHERE p.marketplace_id IS NULL
ON DUPLICATE KEY UPDATE
  limit_value = VALUES(limit_value),
  is_unlimited = VALUES(is_unlimited),
  is_enabled = VALUES(is_enabled);

-- Copy marketplace-specific features already seeded for Free/Starter onto higher tiers.
INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled)
SELECT dest.id, src.feature_code,
       CASE dest.code
         WHEN 'professional' THEN GREATEST(COALESCE(src.limit_value, 0) * 2, COALESCE(src.limit_value, 0))
         WHEN 'business' THEN GREATEST(COALESCE(src.limit_value, 0) * 5, COALESCE(src.limit_value, 0))
         WHEN 'enterprise' THEN src.limit_value
         ELSE src.limit_value
       END,
       CASE WHEN dest.code = 'enterprise' AND src.feature_code LIKE '%featured%' THEN TRUE ELSE src.is_unlimited END,
       TRUE
FROM plan_features src
JOIN subscription_plans starter ON starter.id = src.plan_id AND starter.code = 'starter' AND starter.marketplace_id IS NULL
JOIN subscription_plans dest ON dest.code IN ('professional','business','enterprise') AND dest.marketplace_id IS NULL
WHERE src.feature_code IN (
  'gold_auctions','gold_featured','gold_ai_tools','gold_price_alerts','gold_advanced_market_data','gold_priority_moderation',
  'property_saved_searches','property_valuation','property_featured','property_leads','property_projects','property_bulk_listings',
  'vehicle_saved_searches','vehicle_valuation','vehicle_dealer_inventory','vehicle_leads','vehicle_trade',
  'renewals_per_year','dealer_inventory','lead_access','instant_marketplace_alerts','notification_email_digest',
  'compare_slots','saved_searches','verified_badge'
)
ON DUPLICATE KEY UPDATE
  limit_value = VALUES(limit_value),
  is_unlimited = VALUES(is_unlimited),
  is_enabled = TRUE;

-- -----------------------------------------------------------------------------
-- Gateways. Drivers register in code; these rows decide country/currency offer.
-- -----------------------------------------------------------------------------
INSERT INTO payment_gateways (
  code, name, kind, supports_recurring, supports_refund, supported_countries, supported_currencies,
  fee_percent, fee_fixed, is_active, is_test_mode, sort_order
) VALUES
  ('manual', 'Manual settlement', 'cash', FALSE, TRUE, NULL, NULL, 0.000, 0.0000, TRUE, TRUE, 99),
  ('stripe', 'Stripe', 'card', TRUE, TRUE, NULL, JSON_ARRAY('USD','EUR','GBP','CAD','AUD','AED','SAR','INR','SGD'), 2.900, 0.3000, TRUE, TRUE, 1),
  ('paypal', 'PayPal', 'wallet', TRUE, TRUE, NULL, JSON_ARRAY('USD','EUR','GBP','CAD','AUD'), 3.400, 0.3000, TRUE, TRUE, 2),
  ('apple_pay', 'Apple In-App Purchase', 'wallet', TRUE, TRUE, NULL, NULL, 15.000, 0.0000, TRUE, TRUE, 3),
  ('google_play', 'Google Play Billing', 'wallet', TRUE, TRUE, NULL, NULL, 15.000, 0.0000, TRUE, TRUE, 4)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  supports_recurring = VALUES(supports_recurring),
  is_active = VALUES(is_active),
  is_test_mode = VALUES(is_test_mode),
  sort_order = VALUES(sort_order);

-- Plan-name ABAC is forbidden. AI is gated by entitlements in the AI module.
UPDATE access_policies
   SET is_active = FALSE,
       description = 'Disabled: AI access is entitlement-gated (ai_tools / ai_operations), not plan-name gated'
 WHERE code = 'ai_tools.use.subscription_tier';

INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, policy_group, marketplace_scope, sort_order, is_active)
VALUES
  ('subscription.upgraded',   'Plan upgraded',    'A plan upgrade took effect',     'billing', TRUE, FALSE, FALSE, TRUE, TRUE, 'TRANSACTIONAL', 'GENERAL', 34, TRUE),
  ('subscription.downgraded', 'Plan downgraded',  'A plan downgrade took effect',   'billing', TRUE, FALSE, FALSE, TRUE, TRUE, 'TRANSACTIONAL', 'GENERAL', 35, TRUE),
  ('subscription.paused',     'Plan paused',      'A subscription was paused',      'billing', TRUE, FALSE, FALSE, TRUE, TRUE, 'TRANSACTIONAL', 'GENERAL', 36, TRUE),
  ('subscription.resumed',    'Plan resumed',     'A subscription was resumed',     'billing', TRUE, FALSE, FALSE, TRUE, TRUE, 'TRANSACTIONAL', 'GENERAL', 37, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = TRUE;

INSERT INTO notification_templates
  (category_code, channel, language, subject, title, body, action_url, variables, is_active, version)
VALUES
  ('subscription.upgraded',   'in_app', 'en', NULL, 'Plan upgraded', 'You are now on {{toPlan}}.', '/subscription', '["toPlan"]', TRUE, 1),
  ('subscription.downgraded', 'in_app', 'en', NULL, 'Plan changed', '{{toPlan}} takes effect {{endsAt}}. Existing listings are kept.', '/subscription', '["toPlan","endsAt"]', TRUE, 1),
  ('subscription.paused',     'in_app', 'en', NULL, 'Plan paused', '{{planCode}} is paused.', '/subscription', '["planCode"]', TRUE, 1),
  ('subscription.resumed',    'in_app', 'en', NULL, 'Plan resumed', '{{planCode}} is active again.', '/subscription', '["planCode"]', TRUE, 1)
ON DUPLICATE KEY UPDATE body = VALUES(body), action_url = VALUES(action_url), is_active = TRUE;

UPDATE notification_templates
   SET action_url = '/subscription'
 WHERE category_code LIKE 'subscription.%';

INSERT INTO scheduled_jobs (code, name, cron, is_enabled) VALUES
  ('subscription.lifecycle', 'Renew, expire, apply pending plan changes', '*/15 * * * *', TRUE),
  ('subscription.dunning',   'Past-due to grace to expired',              '0 * * * *', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), cron = VALUES(cron), is_enabled = VALUES(is_enabled);
