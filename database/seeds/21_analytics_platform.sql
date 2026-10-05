-- =============================================================================
-- 21  Analytics platform: funnel definitions for Gold / Property / Vehicles.
--     Idempotent. Rollup also upserts these rows; the seed exists so dashboards
--     have funnel codes before the first hourly job.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

INSERT INTO funnel_definitions (code, name, marketplace_id, steps, window_hours, is_active)
VALUES (
  'platform.visitor_to_sale',
  'Visitor to purchase',
  NULL,
  JSON_ARRAY('session.started','search.performed','listing.viewed','favorite.added','message.sent','lead.created','offer.created','listing.sold'),
  168,
  1
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  steps = VALUES(steps),
  window_hours = VALUES(window_hours),
  is_active = 1;

INSERT INTO funnel_definitions (code, name, marketplace_id, steps, window_hours, is_active)
SELECT
  'gold.visitor_to_sale',
  'Gold visitor to sale',
  id,
  JSON_ARRAY('search.performed','listing.viewed','lead.created','listing.sold'),
  168,
  1
FROM marketplaces WHERE code = 'gold'
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  marketplace_id = VALUES(marketplace_id),
  steps = VALUES(steps),
  window_hours = VALUES(window_hours),
  is_active = 1;

INSERT INTO funnel_definitions (code, name, marketplace_id, steps, window_hours, is_active)
SELECT
  'property.visitor_to_rental',
  'Property visitor to rental',
  id,
  JSON_ARRAY('search.performed','listing.viewed','lead.created','listing.rented'),
  336,
  1
FROM marketplaces WHERE code = 'property'
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  marketplace_id = VALUES(marketplace_id),
  steps = VALUES(steps),
  window_hours = VALUES(window_hours),
  is_active = 1;

INSERT INTO funnel_definitions (code, name, marketplace_id, steps, window_hours, is_active)
SELECT
  'vehicles.visitor_to_sale',
  'Vehicle visitor to sale',
  id,
  JSON_ARRAY('search.performed','listing.viewed','lead.created','offer.created','listing.sold'),
  168,
  1
FROM marketplaces WHERE code = 'vehicles'
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  marketplace_id = VALUES(marketplace_id),
  steps = VALUES(steps),
  window_hours = VALUES(window_hours),
  is_active = 1;
