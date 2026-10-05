-- =============================================================================
-- 08  Gold marketplace reference data (idempotent)
--     Country purity rules, hallmark authorities, compliance, notifications,
--     subscription entitlements, jobs, sample rate history + forecasts.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Country purity standards. Karat is a display label; fineness is stored.
-- -----------------------------------------------------------------------------
INSERT INTO gold_purity_country_standards
  (country_id, karat, fineness, purity_percent, standard_code, verification_method, label, is_default, is_active, sort_order) VALUES
  (1, 24.00, 999, 99.900, 'PK-24K',  'hallmark', '24K / 999', TRUE,  TRUE, 1),
  (1, 22.00, 916, 91.600, 'PK-22K',  'hallmark', '22K / 916 Pakistan hallmark', TRUE, TRUE, 2),
  (1, 21.00, 875, 87.500, 'PK-21K',  'hallmark', '21K / 875', TRUE, TRUE, 3),
  (1, 18.00, 750, 75.000, 'PK-18K',  'hallmark', '18K / 750', TRUE, TRUE, 4),
  (2, 22.00, 916, 91.600, 'IN-BIS-22', 'bis_hallmark', '22K BIS 916', TRUE, TRUE, 1),
  (2, 18.00, 750, 75.000, 'IN-BIS-18', 'bis_hallmark', '18K BIS 750', TRUE, TRUE, 2),
  (2, 14.00, 585, 58.500, 'IN-BIS-14', 'bis_hallmark', '14K BIS 585', FALSE, TRUE, 3),
  (3, 24.00, 999, 99.900, 'AE-24K', 'assay', '24K / 999 UAE', TRUE, TRUE, 1),
  (3, 22.00, 916, 91.600, 'AE-22K', 'assay', '22K / 916 UAE', TRUE, TRUE, 2),
  (3, 21.00, 875, 87.500, 'AE-21K', 'assay', '21K / 875 UAE', TRUE, TRUE, 3),
  (3, 18.00, 750, 75.000, 'AE-18K', 'assay', '18K / 750 UAE', TRUE, TRUE, 4),
  (4, 21.00, 875, 87.500, 'SA-21K', 'assay', '21K / 875 KSA', TRUE, TRUE, 1),
  (4, 18.00, 750, 75.000, 'SA-18K', 'assay', '18K / 750 KSA', TRUE, TRUE, 2),
  (5, 24.00, 999, 99.900, 'US-24K', 'assay', '24K / 999', TRUE, TRUE, 1),
  (5, 18.00, 750, 75.000, 'US-18K', 'assay', '18K / 750', TRUE, TRUE, 2),
  (5, 14.00, 585, 58.500, 'US-14K', 'assay', '14K / 585', TRUE, TRUE, 3),
  (5, 10.00, 416, 41.600, 'US-10K', 'assay', '10K / 416', FALSE, TRUE, 4),
  (6, 22.00, 916, 91.600, 'UK-22K', 'assay_office', '22K / 916 UK', TRUE, TRUE, 1),
  (6, 18.00, 750, 75.000, 'UK-18K', 'assay_office', '18K / 750 UK', TRUE, TRUE, 2),
  (6,  9.00, 375, 37.500, 'UK-9K',  'assay_office', '9K / 375 UK', TRUE, TRUE, 3)
ON DUPLICATE KEY UPDATE
  fineness = VALUES(fineness), purity_percent = VALUES(purity_percent),
  verification_method = VALUES(verification_method), label = VALUES(label),
  is_active = VALUES(is_active), sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- Hallmark authorities
-- -----------------------------------------------------------------------------
INSERT INTO gold_hallmark_authorities (id, code, name, country_id, verification_source, is_active, sort_order) VALUES
  (1, 'bis',           'Bureau of Indian Standards',           2, 'bis.gov.in',           TRUE, 1),
  (2, 'pgji',          'Pakistan Gold Jewellers Association',  1, 'pgji',                 TRUE, 2),
  (3, 'dmcc_assay',    'DMCC Assay Office',                    3, 'dmcc.ae',              TRUE, 3),
  (4, 'saso',          'SASO Precious Metals',                 4, 'saso.gov.sa',          TRUE, 4),
  (5, 'london_assay',  'London Assay Office',                  6, 'assayofficelondon.co.uk', TRUE, 5),
  (6, 'lbma',          'LBMA',                                 NULL, 'lbma.org.uk',        TRUE, 6),
  (7, 'local_shop',    'Local licensed shop',                  NULL, 'manual',             TRUE, 90)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), country_id = VALUES(country_id),
  verification_source = VALUES(verification_source), is_active = VALUES(is_active);

UPDATE brands SET verification_status = 'verified', verified_at = CURRENT_TIMESTAMP
 WHERE marketplace_id = 1 AND slug IN ('pamp-suisse','valcambi','perth-mint','argor-heraeus','tanishq','damas');

-- -----------------------------------------------------------------------------
-- Compliance defaults (configurable; not legal advice).
-- -----------------------------------------------------------------------------
INSERT INTO gold_compliance_rules
  (country_id, is_active, kyc_required_above, aml_required_above, physical_verify_above,
   escrow_required_above, currency, min_kyc_level, seller_verification_required,
   import_export_restricted, tax_code, record_retention_days) VALUES
  (1, TRUE,  500000.00, 2000000.00, 1000000.00, 2000000.00, 'PKR', 'basic',    TRUE,  FALSE, 'PK-GST', 2555),
  (2, TRUE,   200000.00, 1000000.00,  500000.00, 1000000.00, 'INR', 'standard', TRUE,  FALSE, 'IN-GST', 2555),
  (3, TRUE,    20000.00,   55000.00,   40000.00,   55000.00, 'AED', 'standard', TRUE,  TRUE,  'AE-VAT', 2555),
  (4, TRUE,    20000.00,   55000.00,   40000.00,   55000.00, 'SAR', 'standard', TRUE,  TRUE,  'SA-VAT', 2555),
  (5, TRUE,    10000.00,   10000.00,   25000.00,   25000.00, 'USD', 'standard', TRUE,  FALSE, 'US-SALES', 2555),
  (6, TRUE,     8000.00,    8000.00,   20000.00,   20000.00, 'GBP', 'standard', TRUE,  FALSE, 'UK-VAT', 2555)
ON DUPLICATE KEY UPDATE
  kyc_required_above = VALUES(kyc_required_above),
  aml_required_above = VALUES(aml_required_above),
  physical_verify_above = VALUES(physical_verify_above),
  escrow_required_above = VALUES(escrow_required_above),
  currency = VALUES(currency),
  min_kyc_level = VALUES(min_kyc_level),
  is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, sort_order, is_active) VALUES
  ('gold.bid.new',            'New bid',                     'Someone bid on your gold auction',           'gold', TRUE,  FALSE, FALSE, TRUE, FALSE, 200, TRUE),
  ('gold.bid.outbid',         'Outbid',                      'You were outbid on a gold auction',          'gold', TRUE,  FALSE, FALSE, TRUE, FALSE, 201, TRUE),
  ('gold.auction.starting',   'Auction starting',            'A watched gold auction is about to start',   'gold', TRUE,  FALSE, FALSE, TRUE, FALSE, 202, TRUE),
  ('gold.auction.ending',     'Auction ending soon',         'A gold auction is ending soon',              'gold', TRUE,  FALSE, FALSE, TRUE, FALSE, 203, TRUE),
  ('gold.auction.won',        'Auction won',                 'You won a gold auction',                     'gold', TRUE,  TRUE,  FALSE, TRUE, TRUE,  204, TRUE),
  ('gold.auction.lost',       'Auction lost',                'A gold auction you bid on ended',            'gold', TRUE,  FALSE, FALSE, TRUE, FALSE, 205, TRUE),
  ('gold.listing.approved',   'Listing approved',            'Your gold listing was published',            'gold', TRUE,  FALSE, FALSE, TRUE, FALSE, 206, TRUE),
  ('gold.listing.rejected',   'Listing rejected',            'Your gold listing needs changes',            'gold', TRUE,  FALSE, FALSE, TRUE, FALSE, 207, TRUE),
  ('gold.order.status',       'Gold order update',           'Status change on a gold purchase',           'gold', TRUE,  TRUE,  FALSE, TRUE, TRUE,  208, TRUE),
  ('gold.payment.status',     'Gold payment update',         'Payment or escrow update',                   'gold', TRUE,  TRUE,  FALSE, TRUE, TRUE,  209, TRUE),
  ('gold.verification',       'Gold verification',           'Certificate, hallmark or physical result',   'gold', TRUE,  FALSE, FALSE, TRUE, FALSE, 210, TRUE),
  ('gold.price.alert',        'Gold price alert',            'Market rate moved past your alert',          'gold', TRUE,  FALSE, FALSE, TRUE, FALSE, 211, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), description = VALUES(description), is_active = VALUES(is_active);

INSERT INTO notification_templates
  (category_code, channel, language, title, body, action_url, variables, is_active, version) VALUES
  ('gold.bid.new',          'in_app', 'en', 'New bid on {{title}}',          '{{amount}} {{currency}} — {{bidder}} placed a bid.', '/listing/{{listingId}}', '["title","amount","currency","bidder","listingId"]', TRUE, 1),
  ('gold.bid.outbid',       'in_app', 'en', 'You were outbid',               'Someone bid {{amount}} {{currency}} on {{title}}.', '/listing/{{listingId}}', '["title","amount","currency","listingId"]', TRUE, 1),
  ('gold.auction.won',      'in_app', 'en', 'You won the auction',           'You won {{title}} at {{amount}} {{currency}}.', '/listing/{{listingId}}', '["title","amount","currency","listingId"]', TRUE, 1),
  ('gold.auction.lost',     'in_app', 'en', 'Auction ended',                 '{{title}} ended. You were not the highest bidder.', '/listing/{{listingId}}', '["title","listingId"]', TRUE, 1),
  ('gold.listing.approved', 'in_app', 'en', 'Gold listing published',        '{{title}} is now live.', '/listing/{{listingId}}', '["title","listingId"]', TRUE, 1),
  ('gold.listing.rejected', 'in_app', 'en', 'Gold listing not published',    '{{title}} was not published. {{reason}}', '/listing/{{listingId}}', '["title","reason","listingId"]', TRUE, 1),
  ('gold.order.status',     'in_app', 'en', 'Gold order {{status}}',         'Order {{orderNumber}} is now {{status}}.', '/orders/{{orderUuid}}', '["status","orderNumber","orderUuid"]', TRUE, 1),
  ('gold.verification',     'in_app', 'en', 'Verification update',           '{{summary}}', '/listing/{{listingId}}', '["summary","listingId"]', TRUE, 1)
ON DUPLICATE KEY UPDATE body = VALUES(body), title = VALUES(title), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- Global subscription entitlements used by Gold (no separate billing system).
-- -----------------------------------------------------------------------------
INSERT INTO features (code, name, description, unit, is_metered, reset_period, sort_order) VALUES
  ('gold_auctions',            'Gold auctions',            'Create and bid on gold auctions',              'boolean', FALSE, 'none',          20),
  ('gold_featured',            'Featured gold listings',   'Featured placement in the gold feed',          'count',   TRUE,  'billing_cycle', 21),
  ('gold_ai_tools',            'Gold AI tools',            'Authenticity risk and forecast tools',         'boolean', FALSE, 'none',          22),
  ('gold_price_alerts',        'Gold price alerts',        'Alerts when market rates move',                'count',   FALSE, 'none',          23),
  ('gold_advanced_market_data','Advanced gold market data','History, forecast range, analytics',           'boolean', FALSE, 'none',          24),
  ('gold_priority_moderation', 'Priority gold moderation', 'Faster review for gold listings',              'boolean', FALSE, 'none',          25)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled) VALUES
  (1, 'gold_auctions',             NULL, FALSE, TRUE),
  (1, 'gold_featured',             0,    FALSE, FALSE),
  (1, 'gold_ai_tools',             NULL, FALSE, TRUE),
  (1, 'gold_price_alerts',         3,    FALSE, TRUE),
  (1, 'gold_advanced_market_data', NULL, FALSE, FALSE),
  (1, 'gold_priority_moderation',  NULL, FALSE, FALSE),
  (2, 'gold_auctions',             NULL, FALSE, TRUE),
  (2, 'gold_featured',             2,    FALSE, TRUE),
  (2, 'gold_ai_tools',             NULL, FALSE, TRUE),
  (2, 'gold_price_alerts',         25,   FALSE, TRUE),
  (2, 'gold_advanced_market_data', NULL, FALSE, TRUE),
  (2, 'gold_priority_moderation',  NULL, FALSE, TRUE)
ON DUPLICATE KEY UPDATE
  limit_value = VALUES(limit_value),
  is_enabled = VALUES(is_enabled);

-- -----------------------------------------------------------------------------
-- Jobs
-- -----------------------------------------------------------------------------
INSERT INTO scheduled_jobs (code, name, cron, is_enabled) VALUES
  ('gold.forecast.generate', 'Generate gold price forecasts', '15 */6 * * *', TRUE),
  ('gold.auctions.tick',     'Start/end gold auctions',       '* * * * *',    TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), cron = VALUES(cron), is_enabled = VALUES(is_enabled);

INSERT INTO sort_options (id, marketplace_id, code, label, sort_field, direction, applies_to, requires_location, is_default, sort_order, is_active) VALUES
  (15, 1, 'ending_soon', 'Auction ending soon', '(SELECT a.ends_at FROM auctions a WHERE a.listing_id = l.id AND a.status = ''live'')', 'asc',  'listings', FALSE, FALSE, 15, TRUE),
  (16, 1, 'trust',       'Highest trust',       'ts.score', 'desc', 'listings', FALSE, FALSE, 16, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), sort_field = VALUES(sort_field), direction = VALUES(direction), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- Sample history + 7d forecast so the Gold home screen is not empty.
-- -----------------------------------------------------------------------------
INSERT INTO gold_rate_history (country_id, currency, metal, karat, rate_per_gram, open_rate, high_rate, low_rate, close_rate, source, as_of_date)
SELECT 1, 'PKR', 'gold', 24.00,
       23800.0000 * (1 + ((n - 15) * 0.0012)),
       23800.0000 * (1 + ((n - 16) * 0.0012)),
       23800.0000 * (1 + ((n - 15) * 0.0012) + 0.004),
       23800.0000 * (1 + ((n - 15) * 0.0012) - 0.004),
       23800.0000 * (1 + ((n - 15) * 0.0012)),
       'static',
       DATE_SUB(CURRENT_DATE, INTERVAL n DAY)
FROM (
  SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5
  UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9 UNION SELECT 10
  UNION SELECT 11 UNION SELECT 12 UNION SELECT 13 UNION SELECT 14 UNION SELECT 15
  UNION SELECT 16 UNION SELECT 17 UNION SELECT 18 UNION SELECT 19 UNION SELECT 20
  UNION SELECT 21 UNION SELECT 22 UNION SELECT 23 UNION SELECT 24 UNION SELECT 25
  UNION SELECT 26 UNION SELECT 27 UNION SELECT 28 UNION SELECT 29 UNION SELECT 30
) days
ON DUPLICATE KEY UPDATE
  rate_per_gram = VALUES(rate_per_gram), close_rate = VALUES(close_rate);

INSERT INTO gold_price_predictions
  (country_id, currency, karat, horizon, predicted_rate, lower_bound, upper_bound, confidence,
   direction, drivers, model, model_id, model_version, feature_version, result_status, target_date)
VALUES
  (1, 'PKR', 24.00, '7d',  24120.0000, 23650.0000, 24600.0000, 62.00, 'up',
   '["recent_trend","fx_stability"]', 'sma-vol-v1', 'gold-forecast', '1', '1', 'ready', DATE_ADD(CURRENT_DATE, INTERVAL 7 DAY)),
  (1, 'PKR', 24.00, '30d', 24480.0000, 23200.0000, 25800.0000, 48.00, 'up',
   '["seasonality","volatility"]', 'sma-vol-v1', 'gold-forecast', '1', '1', 'ready', DATE_ADD(CURRENT_DATE, INTERVAL 30 DAY))
ON DUPLICATE KEY UPDATE
  predicted_rate = VALUES(predicted_rate),
  lower_bound = VALUES(lower_bound),
  upper_bound = VALUES(upper_bound),
  confidence = VALUES(confidence),
  generated_at = CURRENT_TIMESTAMP;
