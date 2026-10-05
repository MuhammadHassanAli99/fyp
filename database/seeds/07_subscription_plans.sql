-- =============================================================================
-- 07  Subscription plans + features (required for posting listings)
--     Free default plan grants active_listings + images so createListing works
--     without a paid subscription.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

INSERT INTO features (code, name, description, unit, is_metered, reset_period, sort_order) VALUES
  ('active_listings',    'Active listings',      'How many live listings a seller may hold', 'count',   TRUE,  'none',          1),
  ('images_per_listing', 'Images per listing',   'Max photos attached to one listing',      'count',   FALSE, 'none',          2),
  ('featured_listings',  'Featured listings',    'Promote a listing to featured slots',     'count',   TRUE,  'billing_cycle', 3),
  ('boosts_per_month',   'Boosts per month',     'Temporary feed boosts',                   'count',   TRUE,  'monthly',       4),
  ('compare_slots',      'Compare slots',        'Items allowed in one comparison set',     'count',   FALSE, 'none',          5),
  ('saved_searches',     'Saved searches',       'Saved search alerts',                     'count',   FALSE, 'none',          6),
  ('ai_tools',           'AI tools',             'AI compare and valuation helpers',        'boolean', FALSE, 'none',          7),
  ('video_upload',       'Video upload',         'Attach videos to listings',               'boolean', FALSE, 'none',          8),
  ('verified_badge',     'Verified badge',       'Seller verified badge',                   'boolean', FALSE, 'none',          9)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  unit = VALUES(unit),
  is_metered = VALUES(is_metered),
  reset_period = VALUES(reset_period),
  sort_order = VALUES(sort_order);

INSERT INTO subscription_plans (
  id, code, name, description, marketplace_id, tier, audience, trial_days,
  is_public, is_active, is_default, sort_order
) VALUES
  (1, 'free', 'Free', 'Starter plan for individual sellers across all marketplaces',
   NULL, 0, 'both', 0, TRUE, TRUE, TRUE, 1),
  (2, 'starter', 'Starter', 'More listings and photos for active sellers',
   NULL, 1, 'both', 7, TRUE, TRUE, FALSE, 2)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  is_active = VALUES(is_active),
  is_default = VALUES(is_default),
  sort_order = VALUES(sort_order);

INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled) VALUES
  (1, 'active_listings',    25,  FALSE, TRUE),
  (1, 'images_per_listing', 10,  FALSE, TRUE),
  (1, 'compare_slots',       4,  FALSE, TRUE),
  (1, 'saved_searches',      5,  FALSE, TRUE),
  (1, 'ai_tools',         NULL,  FALSE, TRUE),
  (1, 'video_upload',     NULL,  FALSE, FALSE),
  (1, 'featured_listings',   0,  FALSE, FALSE),
  (1, 'boosts_per_month',    0,  FALSE, FALSE),
  (1, 'verified_badge',   NULL,  FALSE, FALSE),
  (2, 'active_listings',   100,  FALSE, TRUE),
  (2, 'images_per_listing', 20,  FALSE, TRUE),
  (2, 'compare_slots',       4,  FALSE, TRUE),
  (2, 'saved_searches',     25,  FALSE, TRUE),
  (2, 'ai_tools',         NULL,  FALSE, TRUE),
  (2, 'video_upload',     NULL,  FALSE, TRUE),
  (2, 'featured_listings',   3,  FALSE, TRUE),
  (2, 'boosts_per_month',    5,  FALSE, TRUE),
  (2, 'verified_badge',   NULL,  FALSE, FALSE)
ON DUPLICATE KEY UPDATE
  limit_value = VALUES(limit_value),
  is_unlimited = VALUES(is_unlimited),
  is_enabled = VALUES(is_enabled);

INSERT INTO plan_prices (plan_id, country_id, currency, billing_interval, amount, is_active) VALUES
  (1, NULL, 'USD', 'monthly', 0.00, TRUE),
  (1, 1,    'PKR', 'monthly', 0.00, TRUE),
  (2, NULL, 'USD', 'monthly', 9.99, TRUE),
  (2, 1,    'PKR', 'monthly', 2499.00, TRUE)
ON DUPLICATE KEY UPDATE
  amount = VALUES(amount),
  is_active = VALUES(is_active);
