-- =============================================================================
-- 06  Demo seller + published sample listings (gold / property / vehicles)
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
  'Seeded demo seller for Gold, Property and Vehicles feeds.',
  '+923001234567', TRUE, TRUE, 80
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  bio = VALUES(bio);

INSERT INTO user_roles (user_id, role_id, marketplace_id, granted_at)
VALUES (9001, 2, NULL, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE granted_at = VALUES(granted_at);

-- -----------------------------------------------------------------------------
-- Published listings (ids 9101–9106)
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
   FALSE, TRUE, 0, 85, 1.1, '+923001234567', '+923001234567', TRUE, TRUE, TRUE, 'import'),

  (9103, 'b1111111-1111-4111-8111-111111111103', 'PRP-DEMO01', 2, 211, 9001, 'sell',
   '3 Bed Apartment in DHA Phase 5', '3-bed-apartment-dha-phase-5',
   'Bright corner apartment with open kitchen, covered parking and society gym access.',
   'en', 'excellent', 28500000.00, 'PKR', 'negotiable', 'total', 28500000.00, TRUE,
   1, 'published', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 120 DAY),
   TRUE, TRUE, 0, 88, 1.15, '+923001234567', '+923001234567', TRUE, TRUE, TRUE, 'import'),

  (9104, 'b1111111-1111-4111-8111-111111111104', 'PRP-DEMO02', 2, 210, 9001, 'rent',
   'Furnished House for Rent — Bahria Town', 'furnished-house-rent-bahria',
   'Fully furnished 4-bed house with lawn, backup power and 24/7 security.',
   'en', 'good', 180000.00, 'PKR', 'fixed', 'per_month', 180000.00, FALSE,
   1, 'published', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 60 DAY),
   FALSE, TRUE, 0, 82, 1.05, '+923001234567', '+923001234567', TRUE, TRUE, TRUE, 'import'),

  (9105, 'b1111111-1111-4111-8111-111111111105', 'VEH-DEMO01', 3, 310, 9001, 'sell',
   'Toyota Corolla Altis 2021', 'toyota-corolla-altis-2021',
   'Single owner, full service history, accident-free. Inspected and finance available.',
   'en', 'excellent', 5850000.00, 'PKR', 'negotiable', 'total', 5850000.00, TRUE,
   1, 'published', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 90 DAY),
   TRUE, TRUE, 0, 92, 1.25, '+923001234567', '+923001234567', TRUE, TRUE, TRUE, 'import'),

  (9106, 'b1111111-1111-4111-8111-111111111106', 'VEH-DEMO02', 3, 310, 9001, 'sell',
   'Honda Civic Oriel 2019', 'honda-civic-oriel-2019',
   'Pearl white Civic Oriel with sunroof. Well maintained city-driven car.',
   'en', 'good', 4950000.00, 'PKR', 'fixed', 'total', 4950000.00, FALSE,
   1, 'published', CURRENT_TIMESTAMP, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 90 DAY),
   FALSE, FALSE, 0, 80, 1.0, '+923001234567', '+923001234567', TRUE, TRUE, TRUE, 'import')
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

-- -----------------------------------------------------------------------------
-- Property details
-- -----------------------------------------------------------------------------
INSERT INTO property_listing_details (
  listing_id, property_kind, usage_type,
  bedrooms, bathrooms, kitchens, total_rooms,
  floors, floor_number, total_floors,
  area_value, area_unit, area_sqm, price_per_sqm,
  parking_spaces, has_garage, has_garden, has_swimming_pool, has_gym,
  has_elevator, has_security, has_backup_power, is_gated_community,
  furnishing, construction_status, society_name, year_built
) VALUES
  (9103, 'apartment', 'residential',
   3, 3, 1, 6,
   1, 4, 12,
   1800.000, 'sqft', 167.225, 170429.0000,
   1, FALSE, FALSE, TRUE, TRUE,
   TRUE, TRUE, TRUE, TRUE,
   'semi_furnished', 'ready', 'DHA Phase 5', 2019),
  (9104, 'house', 'rental',
   4, 4, 1, 8,
   2, NULL, 2,
   10.000, 'marla', 252.928, 711.6600,
   2, TRUE, TRUE, FALSE, FALSE,
   FALSE, TRUE, TRUE, TRUE,
   'fully_furnished', 'ready', 'Bahria Town', 2016)
ON DUPLICATE KEY UPDATE
  bedrooms = VALUES(bedrooms),
  bathrooms = VALUES(bathrooms),
  area_sqm = VALUES(area_sqm),
  furnishing = VALUES(furnishing),
  society_name = VALUES(society_name);

-- -----------------------------------------------------------------------------
-- Vehicle details (Toyota Corolla model 101, Honda Civic model 201)
-- -----------------------------------------------------------------------------
INSERT INTO vehicle_listing_details (
  listing_id, vehicle_type,
  make_id, model_id, make_name, model_name, variant_name, year,
  mileage, mileage_unit, mileage_km,
  engine_cc, fuel_type, transmission, drivetrain,
  body_type, color_exterior, color_family, doors, seats,
  assembly, condition_grade, owners_count, accident_history, service_history,
  is_inspected, inspection_score, finance_available, exchange_accepted
) VALUES
  (9105, 'car',
   1, 101, 'Toyota', 'Corolla', 'Altis 1.6', 2021,
   42000, 'km', 42000,
   1600, 'petrol', 'automatic', 'fwd',
   'sedan', 'Silver', 'silver', 4, 5,
   'local', 'excellent', 1, 'none', 'full',
   TRUE, 88.00, TRUE, TRUE),
  (9106, 'car',
   2, 201, 'Honda', 'Civic', 'Oriel 1.8', 2019,
   68000, 'km', 68000,
   1800, 'petrol', 'automatic', 'fwd',
   'sedan', 'Pearl White', 'white', 4, 5,
   'local', 'very_good', 2, 'none', 'partial',
   FALSE, NULL, TRUE, FALSE)
ON DUPLICATE KEY UPDATE
  year = VALUES(year),
  mileage_km = VALUES(mileage_km),
  fuel_type = VALUES(fuel_type),
  transmission = VALUES(transmission),
  is_inspected = VALUES(is_inspected);
