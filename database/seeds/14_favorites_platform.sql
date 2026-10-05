-- =============================================================================
-- 14  Favorites platform demo data
--     Deterministic ids. Idempotent via INSERT ... ON DUPLICATE KEY.
--     Depends on: 06_demo_listings (seller 9001, listings 9101–9106),
--                 03_marketplaces, 002 users.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- Demo buyer (separate from the seller so favorite.added notifications have a recipient)
INSERT INTO users (
  id, uuid, email, phone_country_code, phone_number, phone_e164, username,
  password_hash, password_changed_at, account_type, status,
  country_id, language, currency, timezone, theme, measurement_system,
  email_verified_at, last_active_at
) VALUES (
  9002,
  'a2222222-2222-4222-8222-222222222222',
  'demo.buyer@aurelia.test',
  '+92', '3007654321', '+923007654321', 'demo_buyer',
  'scrypt$32768$8$1$tCeqj3czrM6i9l4ut+9yDg==$kixZFkzTkxKQRRdxYXALR+TkTbWdFz6ukHBmTXowEa2h/7ISul4joS0KGI881FfQ569794+XdoWQsyf2QXsz2g==',
  CURRENT_TIMESTAMP,
  'individual',
  'active',
  1, 'en', 'PKR', 'Asia/Karachi', 'system', 'metric',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
)
ON DUPLICATE KEY UPDATE
  email = VALUES(email),
  password_hash = VALUES(password_hash),
  status = VALUES(status);

INSERT INTO user_profiles (user_id, display_name, first_name, last_name, bio, show_phone, show_email, profile_completeness)
VALUES (
  9002, 'AURELIA Demo Buyer', 'Demo', 'Buyer',
  'Seeded demo buyer for Favorites / Collections / Compare.',
  FALSE, FALSE, 60
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  bio = VALUES(bio);

INSERT INTO user_roles (user_id, role_id, marketplace_id, granted_at)
VALUES (9002, 1, NULL, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE granted_at = VALUES(granted_at);

-- Default + marketplace-scoped collections (ids pinned)
INSERT INTO favorite_collections (
  id, user_id, marketplace_id, parent_id, name, description, icon, color,
  is_default, is_public, visibility, share_token, item_count, sort_order
) VALUES
  (9401, 9002, NULL, NULL, 'Saved', 'Default saved items', 'heart', '#D4AF37', TRUE, FALSE, 'private', NULL, 0, 0),
  (9402, 9002, 1, NULL, 'Investment Gold', 'Bars and jewellery to watch', 'gem', '#D4AF37', FALSE, FALSE, 'private', NULL, 0, 10),
  (9403, 9002, 2, NULL, 'Karachi Properties', 'Homes in DHA and around', 'building', '#0EA5E9', FALSE, FALSE, 'private', NULL, 0, 20),
  (9404, 9002, 3, NULL, 'Family Cars', 'Daily drivers', 'car', '#7C3AED', FALSE, FALSE, 'private', NULL, 0, 30),
  (9405, 9002, 3, 9404, 'Toyota', 'Toyota shortlist', 'car', '#7C3AED', FALSE, FALSE, 'private', NULL, 0, 0)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  marketplace_id = VALUES(marketplace_id),
  parent_id = VALUES(parent_id),
  visibility = VALUES(visibility),
  is_default = VALUES(is_default);

-- Universal favorites across gold / property / vehicles
INSERT INTO favorites (
  id, user_id, listing_id, marketplace_id, entity_type, entity_id, collection_id,
  note, title_snapshot, price_at_save, currency, notify_price_drop, notify_status_change
) VALUES
  (9501, 9002, 9101, 1, 'listing', 9101, 9402, 'Bridal set for comparison', '22K Gold Necklace Set — Bridal', 485000.00, 'PKR', TRUE, TRUE),
  (9502, 9002, 9102, 1, 'listing', 9102, 9402, NULL, '24K Investment Gold Bar 10g', 312000.00, 'PKR', TRUE, TRUE),
  (9503, 9002, 9103, 2, 'listing', 9103, 9403, 'DHA apartment', '3 Bed Apartment in DHA Phase 5', NULL, 'PKR', TRUE, TRUE),
  (9504, 9002, 9105, 3, 'listing', 9105, 9405, NULL, NULL, NULL, 'PKR', TRUE, TRUE)
ON DUPLICATE KEY UPDATE
  collection_id = VALUES(collection_id),
  note = VALUES(note),
  title_snapshot = VALUES(title_snapshot);

UPDATE favorites f
INNER JOIN listings l ON l.id = f.listing_id
   SET f.title_snapshot = LEFT(l.title, 255),
       f.price_at_save = COALESCE(f.price_at_save, l.price),
       f.currency = COALESCE(f.currency, l.currency)
 WHERE f.user_id = 9002;

UPDATE favorite_collections c
   SET item_count = (
     SELECT COUNT(*) FROM favorites f WHERE f.collection_id = c.id
   )
 WHERE c.user_id = 9002;

UPDATE listings l
   SET favorite_count = (
     SELECT COUNT(*) FROM favorites f WHERE f.listing_id = l.id
   )
 WHERE l.id IN (9101, 9102, 9103, 9104, 9105, 9106);
