-- =============================================================================
-- 11  Global listing engine reference data (idempotent)
--     Promotion packages, notification categories, extra permissions, quotas.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Promotion packages. Flutter must fetch these; prices are not hardcoded.
-- -----------------------------------------------------------------------------
INSERT INTO listing_promotion_packages
  (code, name, description, promotion_type, duration_days, price, currency, priority, quota_feature, is_stackable, is_active, sort_order)
VALUES
  ('featured_7',     'Featured 7 days',     'Highlighted in marketplace feeds',           'featured',      7,  9.99,  'USD', 100, 'featured_listings', TRUE, TRUE, 1),
  ('featured_14',    'Featured 14 days',    'Highlighted in marketplace feeds',           'featured',     14, 16.99,  'USD', 100, 'featured_listings', TRUE, TRUE, 2),
  ('boost_3',        'Boost 3 days',        'Temporarily raise search rank',              'boosted',       3,  4.99,  'USD',  40, 'boosts_per_month',  TRUE, TRUE, 3),
  ('boost_7',        'Boost 7 days',        'Temporarily raise search rank',              'boosted',       7,  8.99,  'USD',  40, 'boosts_per_month',  TRUE, TRUE, 4),
  ('top_search_7',   'Top of search',       'Appear at the top of matching searches',     'top_search',    7, 12.99,  'USD',  60, NULL,                TRUE, TRUE, 5),
  ('homepage_7',     'Homepage',            'Homepage placement where inventory allows',  'homepage',      7, 24.99,  'USD',  90, NULL,                TRUE, TRUE, 6),
  ('category_top_7', 'Category top',        'Pin to the top of the listing category',     'category_top',  7, 11.99,  'USD',  80, NULL,                TRUE, TRUE, 7),
  ('location_top_7', 'Location top',        'Pin to the top of the city/area feed',       'location_top',  7, 11.99,  'USD',  70, NULL,                TRUE, TRUE, 8),
  ('premium_30',     'Premium 30 days',     'Featured + boost bundle for a month',        'premium',      30, 39.99,  'USD',  85, NULL,                TRUE, TRUE, 9),
  ('urgent_3',       'Urgent 3 days',       'Urgent badge on the listing card',           'urgent',        3,  2.99,  'USD',  30, NULL,                TRUE, TRUE, 10),
  ('bump_1',         'Bump',                'Move the listing to the top of recency',     'bump',          1,  1.49,  'USD',  10, NULL,                FALSE, TRUE, 11)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), description = VALUES(description), price = VALUES(price),
  duration_days = VALUES(duration_days), priority = VALUES(priority),
  is_active = VALUES(is_active), sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- Extra listing permissions (ids 203+ avoid colliding with 02_access_control).
-- -----------------------------------------------------------------------------
INSERT INTO permissions (id, code, resource, action, description) VALUES
  (203, 'listing.restore',         'listing', 'restore',         'Restore an archived listing'),
  (204, 'listing.transfer',        'listing', 'transfer',        'Change listing ownership'),
  (205, 'listing.override_fraud',  'listing', 'override_fraud',  'Override an automated fraud hold'),
  (206, 'listing.view_documents',  'listing', 'view_documents',  'View private listing documents')
ON DUPLICATE KEY UPDATE
  code = VALUES(code), resource = VALUES(resource), action = VALUES(action),
  description = VALUES(description);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('listing.restore')
WHERE r.code IN ('user','seller','dealer','agency','builder','gold_shop','admin','super_admin','moderator');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('listing.transfer','listing.override_fraud','listing.view_documents')
WHERE r.code IN ('admin','super_admin','moderator','fraud_analyst');

-- -----------------------------------------------------------------------------
-- Subscription features the listing engine enforces server-side.
-- -----------------------------------------------------------------------------
INSERT INTO features (code, name, description, unit, is_metered, reset_period, sort_order) VALUES
  ('renewals_per_year',  'Listing renewals',     'How many times a seller may renew listings', 'count',   TRUE,  'yearly',        10),
  ('listing_analytics',  'Listing analytics',    'Per-listing performance dashboard',          'boolean', FALSE, 'none',          11),
  ('dealer_inventory',   'Dealer inventory',     'Bulk dealer inventory tools',                'boolean', FALSE, 'none',          12),
  ('lead_access',        'Lead access',          'View and export listing leads',              'boolean', FALSE, 'none',          13)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), description = VALUES(description), unit = VALUES(unit),
  is_metered = VALUES(is_metered), reset_period = VALUES(reset_period);

INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled) VALUES
  (1, 'renewals_per_year',  12, FALSE, TRUE),
  (1, 'listing_analytics', NULL, FALSE, TRUE),
  (1, 'dealer_inventory',  NULL, FALSE, FALSE),
  (1, 'lead_access',       NULL, FALSE, TRUE),
  (1, 'featured_listings',   0, FALSE, FALSE),
  (1, 'boosts_per_month',    0, FALSE, FALSE)
ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), limit_value = VALUES(limit_value);

INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled)
SELECT 2, code, CASE code
    WHEN 'renewals_per_year' THEN 48
    WHEN 'featured_listings' THEN 4
    WHEN 'boosts_per_month' THEN 8
    ELSE NULL
  END, FALSE, TRUE
FROM features
WHERE code IN ('renewals_per_year','listing_analytics','dealer_inventory','lead_access','featured_listings','boosts_per_month')
ON DUPLICATE KEY UPDATE is_enabled = TRUE;

-- -----------------------------------------------------------------------------
-- Listing notification categories + in-app templates.
-- -----------------------------------------------------------------------------
INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, sort_order, is_active) VALUES
  ('listing.published',          'Listing published',     'Your listing is live',                         'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 80, TRUE),
  ('listing.rejected',           'Listing rejected',      'Your listing needs changes',                   'listings', TRUE,  TRUE,  FALSE, TRUE, FALSE, 81, TRUE),
  ('listing.expiring',           'Listing expiring',      'Your listing will expire soon',                'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 82, TRUE),
  ('listing.expired',            'Listing expired',       'Your listing has expired',                     'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 83, TRUE),
  ('listing.renewed',            'Listing renewed',       'Your listing was renewed',                     'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 84, TRUE),
  ('listing.price_changed',      'Price changed',         'A watched listing changed price',              'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 85, TRUE),
  ('listing.offer_received',     'Offer received',        'Someone made an offer on your listing',        'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 86, TRUE),
  ('listing.offer_accepted',     'Offer accepted',        'An offer on a listing was accepted',           'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 87, TRUE),
  ('listing.sold',               'Listing sold',          'A listing was marked sold',                    'listings', TRUE,  FALSE, FALSE, TRUE, TRUE,  88, TRUE),
  ('listing.booking',            'Rental booking',        'A booking was made on a rental listing',       'listings', TRUE,  TRUE,  FALSE, TRUE, TRUE,  89, TRUE),
  ('listing.promotion_started',  'Promotion started',     'A paid promotion is now active',               'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 90, TRUE),
  ('listing.promotion_ending',   'Promotion ending',      'A promotion is about to expire',               'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 91, TRUE),
  ('listing.moderation',         'Moderation update',     'A moderator updated your listing',             'listings', TRUE,  FALSE, FALSE, TRUE, FALSE, 92, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), description = VALUES(description), is_active = VALUES(is_active);

INSERT INTO notification_templates
  (category_code, channel, language, title, body, action_url, variables, is_active, version) VALUES
  ('listing.published',         'in_app', 'en', '{{title}} is live',              'Your listing is now publicly searchable.', '/listing/{{listingId}}', '["title","listingId"]', TRUE, 1),
  ('listing.rejected',          'in_app', 'en', '{{title}} was not published',    '{{reason}}', '/listing/{{listingId}}', '["title","reason","listingId"]', TRUE, 1),
  ('listing.expiring',          'in_app', 'en', '{{title}} expires soon',         'Renew before {{expiresAt}} to stay in search.', '/listing/{{listingId}}', '["title","expiresAt","listingId"]', TRUE, 1),
  ('listing.expired',           'in_app', 'en', '{{title}} has expired',          'Renew to put this listing back in search.', '/listing/{{listingId}}', '["title","listingId"]', TRUE, 1),
  ('listing.renewed',           'in_app', 'en', '{{title}} was renewed',          'New expiry: {{expiresAt}}.', '/listing/{{listingId}}', '["title","expiresAt","listingId"]', TRUE, 1),
  ('listing.price_changed',     'in_app', 'en', 'Price update on {{title}}',      'New price: {{price}} {{currency}}.', '/listing/{{listingId}}', '["title","price","currency","listingId"]', TRUE, 1),
  ('listing.offer_received',    'in_app', 'en', 'New offer on {{title}}',         '{{amount}} {{currency}} from a buyer.', '/listing/{{listingId}}', '["title","amount","currency","listingId"]', TRUE, 1),
  ('listing.offer_accepted',    'in_app', 'en', 'Offer accepted',                 'Your offer on {{title}} was accepted.', '/listing/{{listingId}}', '["title","listingId"]', TRUE, 1),
  ('listing.sold',              'in_app', 'en', '{{title}} marked sold',          'The listing is no longer available.', '/listing/{{listingId}}', '["title","listingId"]', TRUE, 1),
  ('listing.booking',           'in_app', 'en', 'New booking on {{title}}',       '{{startsAt}} – {{endsAt}}.', '/listing/{{listingId}}', '["title","startsAt","endsAt","listingId"]', TRUE, 1),
  ('listing.promotion_started', 'in_app', 'en', 'Promotion started',              '{{kind}} is active on {{title}} until {{endsAt}}.', '/listing/{{listingId}}', '["kind","title","endsAt","listingId"]', TRUE, 1),
  ('listing.promotion_ending',  'in_app', 'en', 'Promotion ending soon',          '{{kind}} on {{title}} ends {{endsAt}}.', '/listing/{{listingId}}', '["kind","title","endsAt","listingId"]', TRUE, 1),
  ('listing.moderation',        'in_app', 'en', 'Moderation update',              '{{summary}}', '/listing/{{listingId}}', '["summary","listingId"]', TRUE, 1)
ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), is_active = VALUES(is_active);

INSERT INTO scheduled_jobs (code, name, cron, is_enabled) VALUES
  ('listing.expiry',              'Expire published listings',           '0 * * * *', TRUE),
  ('listing.expiring_reminders',  'Remind owners of upcoming expiry',    '15 * * * *', TRUE),
  ('listing.promotion_expiry',    'Expire listing promotions',           '*/10 * * * *', TRUE),
  ('listing.analytics_rollup',    'Roll up listing analytics events',    '*/5 * * * *', TRUE),
  ('listing.search_index',        'Refresh derived search index',        '*/2 * * * *', TRUE),
  ('listing.saved_search_match',  'Match saved searches to new listings','*/5 * * * *', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), cron = VALUES(cron), is_enabled = VALUES(is_enabled);
