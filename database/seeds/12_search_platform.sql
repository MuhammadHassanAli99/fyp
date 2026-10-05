-- =============================================================================
-- 12  Search platform reference data (idempotent)
--     Autocomplete dictionary, evaluation queries, notification categories, jobs.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Notification categories for saved-search alerts.
-- -----------------------------------------------------------------------------
INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, sort_order, is_active) VALUES
  ('search.saved_match',  'Saved search match',  'A new listing matches a saved search', 'search', TRUE,  FALSE, FALSE, TRUE, FALSE, 120, TRUE),
  ('search.saved_digest', 'Saved search digest', 'Daily or weekly digest of new matches', 'search', TRUE,  TRUE,  FALSE, TRUE, FALSE, 121, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), description = VALUES(description), is_active = VALUES(is_active);

INSERT INTO notification_templates
  (category_code, channel, language, title, body, action_url, variables, is_active, version) VALUES
  ('search.saved_match',  'in_app', 'en', 'New match: {{title}}', '{{body}}', '/search', '["title","body","listingId"]', TRUE, 1),
  ('search.saved_digest', 'in_app', 'en', '{{count}} new matches', '{{body}}', '/search/saved', '["count","body"]', TRUE, 1)
ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), is_active = VALUES(is_active);

INSERT INTO scheduled_jobs (code, name, cron, is_enabled) VALUES
  ('search.trending.rollup',     'Roll up trending searches',              '10 * * * *', TRUE),
  ('search.cache.purge',         'Purge expired search cache',             '*/15 * * * *', TRUE),
  ('search.embed.pending',       'Embed changed searchable listings',      '*/10 * * * *', TRUE),
  ('search.alerts.digest',       'Daily/weekly saved-search digests',      '0 8 * * *', TRUE),
  ('search.suggestions.refresh', 'Refresh autocomplete weights',           '20 * * * *', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), cron = VALUES(cron), is_enabled = VALUES(is_enabled);

-- -----------------------------------------------------------------------------
-- Autocomplete dictionary. Prefix lookup; no LLM on keystroke.
-- marketplace_id: 1 gold, 2 property, 3 vehicles, NULL = global.
-- -----------------------------------------------------------------------------
INSERT INTO search_suggestions (marketplace_id, term, kind, target_type, weight, is_curated, is_active) VALUES
  (1, '24K gold', 'gold_term', 'keyword', 100, TRUE, TRUE),
  (1, '22K gold', 'gold_term', 'keyword', 95, TRUE, TRUE),
  (1, 'gold bar', 'gold_term', 'keyword', 90, TRUE, TRUE),
  (1, 'gold coin', 'gold_term', 'keyword', 88, TRUE, TRUE),
  (1, 'gold ring', 'gold_term', 'keyword', 86, TRUE, TRUE),
  (1, 'gold necklace', 'gold_term', 'keyword', 84, TRUE, TRUE),
  (1, 'gold bangle', 'gold_term', 'keyword', 82, TRUE, TRUE),
  (1, 'gold earrings', 'gold_term', 'keyword', 80, TRUE, TRUE),
  (1, 'investment gold', 'gold_term', 'keyword', 78, TRUE, TRUE),
  (1, 'hallmarked gold', 'gold_term', 'keyword', 76, TRUE, TRUE),
  (1, 'scrap gold', 'gold_term', 'keyword', 70, TRUE, TRUE),
  (1, 'antique gold', 'gold_term', 'keyword', 68, TRUE, TRUE),
  (2, 'house for sale', 'property_kind', 'keyword', 100, TRUE, TRUE),
  (2, 'house for rent', 'property_kind', 'keyword', 98, TRUE, TRUE),
  (2, 'apartment', 'property_kind', 'keyword', 90, TRUE, TRUE),
  (2, 'flat', 'property_kind', 'keyword', 88, TRUE, TRUE),
  (2, 'villa', 'property_kind', 'keyword', 86, TRUE, TRUE),
  (2, 'plot', 'property_kind', 'keyword', 84, TRUE, TRUE),
  (2, 'office', 'property_kind', 'keyword', 80, TRUE, TRUE),
  (2, 'shop', 'property_kind', 'keyword', 78, TRUE, TRUE),
  (2, '3 bedroom house', 'keyword', 'keyword', 92, TRUE, TRUE),
  (2, 'furnished apartment', 'keyword', 'keyword', 85, TRUE, TRUE),
  (3, 'Toyota', 'make', 'brand', 100, TRUE, TRUE),
  (3, 'Honda', 'make', 'brand', 95, TRUE, TRUE),
  (3, 'Suzuki', 'make', 'brand', 90, TRUE, TRUE),
  (3, 'Corolla', 'model', 'model', 92, TRUE, TRUE),
  (3, 'Civic', 'model', 'model', 90, TRUE, TRUE),
  (3, 'automatic car', 'keyword', 'keyword', 88, TRUE, TRUE),
  (3, 'motorcycle', 'vehicle_type', 'keyword', 86, TRUE, TRUE),
  (3, 'spare parts', 'vehicle_part', 'keyword', 80, TRUE, TRUE),
  (3, 'tyres', 'vehicle_part', 'keyword', 70, TRUE, TRUE),
  (NULL, 'Islamabad', 'location', 'city', 90, TRUE, TRUE),
  (NULL, 'Lahore', 'location', 'city', 90, TRUE, TRUE),
  (NULL, 'Karachi', 'location', 'city', 90, TRUE, TRUE),
  (NULL, 'Dubai', 'location', 'city', 80, TRUE, TRUE),
  (NULL, 'Riyadh', 'location', 'city', 78, TRUE, TRUE)
ON DUPLICATE KEY UPDATE weight = VALUES(weight), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- Evaluation queries used by search quality tests and offline scoring.
-- -----------------------------------------------------------------------------
INSERT INTO search_evaluation_queries
  (suite, query_text, language, expected_marketplace, expected_operation, expected_dsl, notes, is_active) VALUES
  ('gold', '24k gold 10 gram chahiye', 'ur', 'gold', NULL, '{"filters":{"karat":"24","weightMin":10,"weightMax":10}}', 'mixed Urdu/English gold weight', TRUE),
  ('gold', '22K hallmarked necklace under 2 lakh', 'en', 'gold', NULL, '{"filters":{"karat":"22","jewelleryType":"necklace","hallmarked":true}}', 'karat + jewellery + price', TRUE),
  ('property', '3 bedroom house rent Lahore', 'en', 'property', 'rent', '{"filters":{"bedroomsMin":3,"propertyKind":"house"}}', 'rent + beds + city', TRUE),
  ('property', 'Find me a cheap house', 'en', 'property', NULL, '{"clarification":true}', 'ambiguous buy vs rent', TRUE),
  ('vehicles', 'I need an automatic Toyota for family use under 50 lakh near Islamabad', 'en', 'vehicles', NULL, '{"filters":{"transmission":"automatic"}}', 'filter vs family preference', TRUE),
  ('vehicles', 'Toyota automatic under 50 lakh, preferably low mileage', 'en', 'vehicles', NULL, '{"preferences":{"lowMileage":true}}', 'soft preference must not be a hard filter', TRUE),
  ('global', 'Toyota under 50 lakh, house under 2 crore, 24K gold', 'en', NULL, NULL, '{"multi":true}', 'multi-marketplace global query', TRUE),
  ('multilingual', 'Islamabad mein 50 lakh se kam automatic Corolla', 'ur', 'vehicles', NULL, '{"filters":{"transmission":"automatic"}}', 'romanized Urdu mixed query', TRUE),
  ('voice', 'automatic honda civic islamabad', 'en', 'vehicles', NULL, '{"filters":{"transmission":"automatic"}}', 'voice transcript style', TRUE),
  ('misspellings', 'toyta corola automatc', 'en', 'vehicles', NULL, '{}', 'typo robustness', TRUE)
ON DUPLICATE KEY UPDATE expected_dsl = VALUES(expected_dsl), notes = VALUES(notes);
