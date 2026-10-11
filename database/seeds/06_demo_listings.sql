-- =============================================================================
-- 06  Demo seller + published sample listings (Gold only — the API is
--     Gold-only; Property/Vehicles demo listings were removed along with
--     those marketplace modules).
--     Gives the Flutter feeds something real to show after `npm run db:seed`.
--     Demo login: demo.seller@aurelia.test / Password123!
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Demo seller (id pinned so listing FKs stay stable across re-seeds)
-- Password hash: scrypt for Password123! (matches backend password.ts)
-- -----------------------------------------------------------------------------
INSERT INTO users (
  id, uuid, email, phone_country_code, phone_number, phone_e164, username,
  password_hash, password_changed_at, account_type, status,
  country_id, language, currency, timezone, theme, measurement_system,
  email_verified_at, last_active_at
) VALUES (
  9001,
  'a1111111-1111-4111-8111-111111111111',
  'demo.seller@aurelia.test',
  '+92', '3001234567', '+923001234567', 'demo_seller',
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
  status = VALUES(status),
  country_id = VALUES(country_id),
  language = VALUES(language),
  currency = VALUES(currency);

INSERT INTO user_profiles (user_id, display_name, first_name, last_name, bio, whatsapp, show_phone, show_email, profile_completeness)
VALUES (
  9001, 'AURELIA Demo Seller', 'Demo', 'Seller',
  'Seeded demo seller for the Gold feed.',
  '+923001234567', TRUE, TRUE, 80
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  bio = VALUES(bio);

INSERT INTO user_roles (user_id, role_id, marketplace_id, granted_at)
VALUES (9001, 2, NULL, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE granted_at = VALUES(granted_at);

-- -----------------------------------------------------------------------------
-- Published listings (ids 9101–9102). Property (9103/9104) and Vehicle
-- (9105/9106) demo listings were removed with those marketplaces.
-- -----------------------------------------------------------------------------
INSERT INTO listings (
  id, uuid, reference_code, marketplace_id, category_id, user_id, operation,
  title, slug, description, language, condition_code,
  price, currency, price_type, price_period, price_base, price_negotiable,
  country_id, status, published_at, expires_at,
  is_featured, is_verified, media_count, completeness_score, search_rank,
  contact_phone, contact_whatsapp, allow_chat, allow_calls, allow_offers, source
) VALUES
  (9101, 'b1111111-1111-4111-8111-111111111101', 'GLD-DEMO01', 1, 113, 9001, 'sell',
   '22K Gold Necklace Set — Bridal', '22k-gold-necklace-set-bridal',
   'Hallmarked 22K bridal necklace set with matching earrings. Ideal for weddings.',
   'en', 'new', 485000.00, 'PKR', 'fixed', 'total', 485000.00, TRUE,
   1, 'published', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 90 DAY),
   TRUE, TRUE, 0, 90, 1.2, '+923001234567', '+923001234567', TRUE, TRUE, TRUE, 'import'),

  (9102, 'b1111111-1111-4111-8111-111111111102', 'GLD-DEMO02', 1, 100, 9001, 'sell',
   '24K Investment Gold Bar 10g', '24k-investment-gold-bar-10g',
   'LBMA-style 24K bar, sealed packaging. Perfect for stacking.',
   'en', 'new', 312000.00, 'PKR', 'fixed', 'total', 312000.00, FALSE,
   1, 'published', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 90 DAY),
   FALSE, TRUE, 0, 85, 1.1, '+923001234567', '+923001234567', TRUE, TRUE, TRUE, 'import')
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  description = VALUES(description),
  price = VALUES(price),
  price_base = VALUES(price_base),
  status = 'published',
  published_at = COALESCE(listings.published_at, CURRENT_TIMESTAMP),
  expires_at = VALUES(expires_at),
  deleted_at = NULL;

-- -----------------------------------------------------------------------------
-- Gold details
-- -----------------------------------------------------------------------------
INSERT INTO gold_listing_details (
  listing_id, karat, fineness, purity_percent, metal_type,
  gross_weight_g, net_weight_g, weight_unit, weight_display, quantity,
  brand_name, is_hallmarked, hallmark_authority, has_certificate,
  certificate_authority, form, jewellery_type, gender_target,
  making_charges, making_charge_type, is_investment_grade, buyback_available,
  delivery_available, authenticity_verdict, authenticity_score
) VALUES
  (9101, 22.00, 916, 91.600, 'gold',
   45.500, 44.200, 'gram', 45.500, 1,
   'Local Jeweller', TRUE, 'Pakistan Hallmark', TRUE,
   'local_shop', 'jewellery', 'necklace', 'women',
   35000.00, 'flat', FALSE, TRUE,
   TRUE, 'likely_genuine', 92.50),
  (9102, 24.00, 999, 99.900, 'gold',
   10.000, 10.000, 'gram', 10.000, 1,
   'AURELIA Bullion', TRUE, 'Assay Office', TRUE,
   'lbma', 'bar', NULL, 'unisex',
   0.00, 'flat', TRUE, TRUE,
   TRUE, 'likely_genuine', 98.00)
ON DUPLICATE KEY UPDATE
  karat = VALUES(karat),
  net_weight_g = VALUES(net_weight_g),
  form = VALUES(form),
  is_hallmarked = VALUES(is_hallmarked);

-- Property and Vehicle demo listing detail rows (previously listing ids
-- 9103/9104 and 9105/9106) were removed along with the Property and Vehicles
-- marketplace modules. 09_property_marketplace.sql / 10_vehicle_marketplace.sql
-- are left as no-ops since their target marketplaces are now inactive.
