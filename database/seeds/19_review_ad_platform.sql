-- =============================================================================
-- 19  Review + Advertisement Platform seeds (idempotent)
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

INSERT INTO review_criteria (id, marketplace_id, code, label, applies_to, sort_order, is_active) VALUES
  (14, 1, 'quality',              'Product quality',        'listing',   4, TRUE),
  (15, 1, 'value',                'Value',                  'all',       5, TRUE),
  (25, 2, 'cleanliness',          'Cleanliness',            'listing',   5, TRUE),
  (35, 3, 'buying_experience',    'Buying experience',      'listing',   5, TRUE),
  (36, 3, 'after_sales_service',  'After-sales service',    'dealer',    6, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), applies_to = VALUES(applies_to), is_active = VALUES(is_active);

INSERT INTO ad_placements
  (id, code, name, page, position, format, width, height, aspect_ratio, marketplace_id, floor_cpm, floor_cpc, currency, is_active, sort_order)
VALUES
  (1, 'home_banner_top',      'Home banner',            'home',           'top',      'banner',            1200, 300, '4:1',  NULL, 2.50, 0.20, 'USD', TRUE, 1),
  (2, 'search_native_3',      'Search native slot',     'search',         'inline_3', 'native',            NULL, NULL, '16:9', NULL, 3.00, 0.35, 'USD', TRUE, 2),
  (3, 'search_banner',        'Search banner',          'search',         'top',      'banner',            1200, 180, '6:1',  NULL, 2.00, 0.18, 'USD', TRUE, 3),
  (4, 'listing_detail_native','Listing detail native',  'listing_detail', 'inline',   'native',            NULL, NULL, '16:9', NULL, 2.80, 0.30, 'USD', TRUE, 4),
  (5, 'sponsored_feed',       'Sponsored listing',      'search',         'feed',     'sponsored_listing', NULL, NULL, NULL,  NULL, 4.00, 0.40, 'USD', TRUE, 5),
  (6, 'category_inline',      'Category ad',            'category',       'inline',   'native',            NULL, NULL, '16:9', NULL, 2.20, 0.22, 'USD', TRUE, 6),
  (7, 'video_pre_roll',       'Video ad',               'listing_detail', 'pre_roll', 'video',             1280, 720, '16:9', NULL, 8.00, 0.80, 'USD', TRUE, 7)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), is_active = VALUES(is_active), floor_cpm = VALUES(floor_cpm), floor_cpc = VALUES(floor_cpc);

INSERT INTO features (code, name, description, unit, is_metered, reset_period, sort_order) VALUES
  ('ad_campaigns', 'Ad campaigns', 'Self-serve advertising campaigns', 'count', TRUE, 'billing_cycle', 90),
  ('ad_credits',   'Ad credits',   'Prepaid advertising access',       'boolean', FALSE, 'none', 91)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled)
SELECT p.id, x.feature_code, x.limit_value, x.is_unlimited, x.is_enabled
FROM subscription_plans p
JOIN (
  SELECT 'free' plan_code, 'ad_campaigns' feature_code, 0 limit_value, FALSE is_unlimited, FALSE is_enabled
  UNION ALL SELECT 'starter', 'ad_campaigns', 1, FALSE, TRUE
  UNION ALL SELECT 'professional', 'ad_campaigns', 5, FALSE, TRUE
  UNION ALL SELECT 'business', 'ad_campaigns', 25, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'ad_campaigns', NULL, TRUE, TRUE
  UNION ALL SELECT 'free', 'ad_credits', NULL, FALSE, FALSE
  UNION ALL SELECT 'starter', 'ad_credits', NULL, FALSE, TRUE
  UNION ALL SELECT 'professional', 'ad_credits', NULL, FALSE, TRUE
  UNION ALL SELECT 'business', 'ad_credits', NULL, FALSE, TRUE
  UNION ALL SELECT 'enterprise', 'ad_credits', NULL, FALSE, TRUE
) x ON x.plan_code = p.code
WHERE p.marketplace_id IS NULL
ON DUPLICATE KEY UPDATE
  limit_value = VALUES(limit_value),
  is_unlimited = VALUES(is_unlimited),
  is_enabled = VALUES(is_enabled);

UPDATE feature_flags
   SET is_enabled = TRUE, rollout_percent = 100
 WHERE code = 'ads_platform';

INSERT INTO risk_policy_thresholds
  (code, name, allow_max, monitor_max, step_up_max, review_max, restriction_max, whitelist_score_reduction, is_active, notes)
VALUES
  ('ads', 'Advertising traffic', 29.99, 44.99, 59.99, 74.99, 89.99, 10.00, TRUE, 'Invalid clicks are not billed')
ON DUPLICATE KEY UPDATE is_active = TRUE;

INSERT INTO risk_signals (code, name, description, category, weight, severity, is_active, auto_action) VALUES
  ('review_similar_text',  'Similar review text',     'Review body matches another recent review',     'content',  22.000, 'medium', TRUE, 'review'),
  ('self_click',           'Self click',              'Advertiser clicked their own ad',               'behavior', 40.000, 'high',   TRUE, 'none'),
  ('click_velocity',       'Click velocity',          'Repeated clicks on the same campaign',          'velocity', 24.000, 'medium', TRUE, 'none'),
  ('invalid_ad_traffic',   'Invalid ad traffic',      'Impression or click failed traffic validation', 'network',  30.000, 'high',   TRUE, 'none')
ON DUPLICATE KEY UPDATE weight = VALUES(weight), is_active = TRUE;

INSERT INTO scheduled_jobs (code, name, cron, is_enabled) VALUES
  ('reviews.aggregate',     'Recompute rating summaries',           '*/15 * * * *', TRUE),
  ('reviews.invitations',   'Expire review invitations',            '0 * * * *',    TRUE),
  ('reviews.media.process', 'Process review video/image jobs',      '* * * * *',    TRUE),
  ('ads.rollup',            'Roll up ad daily stats and budgets',   '*/10 * * * *', TRUE),
  ('ads.schedule',          'Activate scheduled ad campaigns',      '*/5 * * * *',  TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_enabled = VALUES(is_enabled);

INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, policy_group, marketplace_scope, sort_order, is_active)
VALUES
  ('review.reported',          'Review reported',     'A review you wrote was reported',         'social',  TRUE, FALSE, FALSE, TRUE, FALSE, 'SOCIAL',         'GENERAL', 32, TRUE),
  ('ad_campaign.approved',     'Campaign approved',   'An ad campaign was approved',             'billing', TRUE, TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 40, TRUE),
  ('ad_campaign.rejected',     'Campaign rejected',   'An ad campaign was rejected',             'billing', TRUE, TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 41, TRUE),
  ('ad_campaign.budget_low',   'Campaign budget low', 'An ad campaign is near its budget limit', 'billing', TRUE, FALSE, FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 42, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = TRUE;
