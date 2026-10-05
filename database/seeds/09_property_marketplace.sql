-- =============================================================================
-- 09  Property marketplace reference data (idempotent)
--     Type/transaction rules, area units, rental durations, attributes,
--     map providers, notifications, subscription entitlements, jobs.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Property type → allowed transaction types (database-driven, not Flutter).
-- -----------------------------------------------------------------------------
INSERT INTO property_type_rules
  (property_kind, usage_group, category_code, allowed_operations, requires_bedrooms, requires_covered_area, is_land, is_hospitality, is_active, sort_order)
VALUES
  ('house',             'residential',  'house',             '["buy","sell","rent"]', TRUE,  TRUE,  FALSE, FALSE, TRUE, 10),
  ('apartment',         'residential',  'apartment',         '["buy","sell","rent"]', TRUE,  TRUE,  FALSE, FALSE, TRUE, 20),
  ('flat',              'residential',  'flat',              '["buy","sell","rent"]', TRUE,  TRUE,  FALSE, FALSE, TRUE, 30),
  ('villa',             'residential',  'villa',             '["buy","sell","rent"]', TRUE,  TRUE,  FALSE, FALSE, TRUE, 40),
  ('farm_house',        'residential',  'farm_house',        '["buy","sell","rent"]', TRUE,  TRUE,  FALSE, FALSE, TRUE, 50),
  ('penthouse',         'residential',  'penthouse',         '["buy","sell","rent"]', TRUE,  TRUE,  FALSE, FALSE, TRUE, 60),
  ('studio',            'residential',  'studio',            '["buy","sell","rent"]', FALSE, TRUE,  FALSE, FALSE, TRUE, 70),
  ('townhouse',         'residential',  'townhouse',         '["buy","sell","rent"]', TRUE,  TRUE,  FALSE, FALSE, TRUE, 80),
  ('office',            'commercial',   'office',            '["buy","sell","rent"]', FALSE, TRUE,  FALSE, FALSE, TRUE, 110),
  ('shop',              'commercial',   'shop',              '["buy","sell","rent"]', FALSE, TRUE,  FALSE, FALSE, TRUE, 120),
  ('warehouse',         'commercial',   'warehouse',         '["buy","sell","rent"]', FALSE, TRUE,  FALSE, FALSE, TRUE, 130),
  ('factory',           'commercial',   'factory',           '["buy","sell","rent"]', FALSE, TRUE,  FALSE, FALSE, TRUE, 140),
  ('building',          'commercial',   'building',          '["buy","sell","rent"]', FALSE, FALSE, FALSE, FALSE, TRUE, 150),
  ('plaza',             'commercial',   'plaza',             '["buy","sell","rent"]', FALSE, FALSE, FALSE, FALSE, TRUE, 160),
  ('showroom',          'commercial',   'showroom',          '["buy","sell","rent"]', FALSE, TRUE,  FALSE, FALSE, TRUE, 170),
  ('room',              'hospitality',  'room',              '["rent"]',              FALSE, FALSE, FALSE, TRUE,  TRUE, 210),
  ('hotel',             'hospitality',  'hotel',             '["rent"]',              FALSE, FALSE, FALSE, TRUE,  TRUE, 220),
  ('guest_house',       'hospitality',  'guest_house',       '["rent"]',              FALSE, FALSE, FALSE, TRUE,  TRUE, 230),
  ('hostel',            'hospitality',  'hostel',            '["rent"]',              FALSE, FALSE, FALSE, TRUE,  TRUE, 240),
  ('serviced_apartment','hospitality',  'serviced_apartment','["rent"]',              TRUE,  TRUE,  FALSE, TRUE,  TRUE, 250),
  ('residential_plot',  'land',         'residential_plot',  '["buy","sell"]',        FALSE, FALSE, TRUE,  FALSE, TRUE, 310),
  ('commercial_plot',   'land',         'commercial_plot',   '["buy","sell"]',        FALSE, FALSE, TRUE,  FALSE, TRUE, 320),
  ('agricultural_land', 'land',         'agricultural_land', '["buy","sell"]',        FALSE, FALSE, TRUE,  FALSE, TRUE, 330),
  ('industrial_land',   'land',         'industrial_land',   '["buy","sell"]',        FALSE, FALSE, TRUE,  FALSE, TRUE, 340)
ON DUPLICATE KEY UPDATE
  usage_group = VALUES(usage_group),
  allowed_operations = VALUES(allowed_operations),
  requires_bedrooms = VALUES(requires_bedrooms),
  requires_covered_area = VALUES(requires_covered_area),
  is_land = VALUES(is_land),
  is_hospitality = VALUES(is_hospitality),
  is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);

UPDATE categories
   SET group_code = 'hospitality'
 WHERE marketplace_id = 2
   AND code IN ('room','hotel','guest_house','hostel','serviced_apartment','shared_room');

INSERT INTO taxonomy_versions (marketplace_id, version) VALUES (2, 2)
ON DUPLICATE KEY UPDATE version = version + 1;

-- -----------------------------------------------------------------------------
-- Area units. Factors are DECIMAL so conversion is not IEEE-754.
-- Global defaults (country_id NULL) plus Pakistan-local defaults.
-- -----------------------------------------------------------------------------
INSERT INTO property_area_units (code, name, symbol, to_sqm, country_id, is_default, is_active, sort_order) VALUES
  ('sqm',      'Square metre',  'm²',     1.0000000000, NULL, TRUE,  TRUE, 10),
  ('sqft',     'Square foot',   'ft²',    0.0929030400, NULL, FALSE, TRUE, 20),
  ('sqyd',     'Square yard',   'yd²',    0.8361273600, NULL, FALSE, TRUE, 30),
  ('marla',    'Marla',         'marla',  25.2928526400, NULL, FALSE, TRUE, 40),
  ('kanal',    'Kanal',         'kanal',  505.8570528000, NULL, FALSE, TRUE, 50),
  ('acre',     'Acre',          'acre',   4046.8564224000, NULL, FALSE, TRUE, 60),
  ('hectare',  'Hectare',       'ha',     10000.0000000000, NULL, FALSE, TRUE, 70),
  ('bigha',    'Bigha',         'bigha',  1618.7420000000, NULL, FALSE, TRUE, 80),
  ('cent',     'Cent',          'cent',   40.4685642240, NULL, FALSE, TRUE, 90),
  ('ground',   'Ground',        'ground', 222.9670000000, NULL, FALSE, TRUE, 100),
  ('dunam',    'Dunam',         'dunam',  1000.0000000000, NULL, FALSE, TRUE, 110),
  ('sqft',     'Square foot',   'ft²',    0.0929030400, 1, FALSE, TRUE, 20),
  ('marla',    'Marla',         'marla',  25.2928526400, 1, TRUE,  TRUE, 40),
  ('kanal',    'Kanal',         'kanal',  505.8570528000, 1, FALSE, TRUE, 50),
  ('sqm',      'Square metre',  'm²',     1.0000000000, 1, FALSE, TRUE, 10)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), symbol = VALUES(symbol), to_sqm = VALUES(to_sqm),
  is_default = VALUES(is_default), is_active = VALUES(is_active);

INSERT INTO property_rental_durations (code, name, stay_kind, duration_days, is_active, sort_order) VALUES
  ('nightly',   'Nightly',        'short_term', 1,    TRUE, 10),
  ('daily',     'Daily',          'short_term', 1,    TRUE, 20),
  ('weekly',    'Weekly',         'short_term', 7,    TRUE, 30),
  ('monthly',   'Monthly',        'either',     30,   TRUE, 40),
  ('6_months',  '6 months',       'long_term',  182,  TRUE, 50),
  ('12_months', '12 months',      'long_term',  365,  TRUE, 60),
  ('24_months', '24 months',      'long_term',  730,  TRUE, 70),
  ('custom',    'Custom duration','either',     NULL, TRUE, 90)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), stay_kind = VALUES(stay_kind),
  duration_days = VALUES(duration_days), is_active = VALUES(is_active);

INSERT INTO property_attributes (code, name, data_type, applies_to, is_filterable, sort_order, is_active) VALUES
  ('bedrooms',          'Bedrooms',           'number',  '["residential","hospitality"]', TRUE, 10, TRUE),
  ('bathrooms',         'Bathrooms',          'number',  '["residential","hospitality"]', TRUE, 20, TRUE),
  ('floors',            'Floors',             'number',  '["residential","commercial"]', TRUE, 30, TRUE),
  ('parking',           'Parking',            'boolean', '["residential","commercial","hospitality"]', TRUE, 40, TRUE),
  ('garden',            'Garden',             'boolean', '["residential"]', TRUE, 50, TRUE),
  ('balcony',           'Balcony',            'boolean', '["residential"]', TRUE, 60, TRUE),
  ('swimming_pool',     'Swimming pool',      'boolean', '["residential","hospitality"]', TRUE, 70, TRUE),
  ('gym',               'Gym',                'boolean', '["residential","commercial","hospitality"]', TRUE, 80, TRUE),
  ('elevator',          'Elevator',           'boolean', '["residential","commercial"]', TRUE, 90, TRUE),
  ('security',          'Security',           'boolean', '["residential","commercial"]', TRUE, 100, TRUE),
  ('cctv',              'CCTV',               'boolean', '["residential","commercial"]', TRUE, 110, TRUE),
  ('backup_power',      'Backup power',       'boolean', '["residential","commercial"]', TRUE, 120, TRUE),
  ('solar',             'Solar',              'boolean', '["residential","commercial"]', TRUE, 130, TRUE),
  ('water',             'Water',              'boolean', '["residential","commercial","land"]', TRUE, 140, TRUE),
  ('gas',               'Gas',                'boolean', '["residential","commercial"]', TRUE, 150, TRUE),
  ('internet',          'Internet',           'boolean', '["residential","commercial","hospitality"]', TRUE, 160, TRUE),
  ('furnished_beds',    'Beds included',      'number',  '["residential","hospitality"]', FALSE, 200, TRUE),
  ('furnished_wardrobes','Wardrobes',         'number',  '["residential"]', FALSE, 210, TRUE),
  ('furnished_ac',      'Air conditioning',   'boolean', '["residential","commercial"]', TRUE, 220, TRUE),
  ('furnished_fridge',  'Refrigerator',       'boolean', '["residential"]', FALSE, 230, TRUE),
  ('furnished_washer',  'Washing machine',    'boolean', '["residential"]', FALSE, 240, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), applies_to = VALUES(applies_to), is_active = VALUES(is_active);

INSERT INTO property_map_providers (code, name, is_default, is_active, config) VALUES
  ('openstreetmap', 'OpenStreetMap', TRUE,  TRUE, '{"tileUrl":"https://tile.openstreetmap.org/{z}/{x}/{y}.png"}'),
  ('none',          'Coordinates only', FALSE, TRUE, '{}')
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- Notifications — reuse the global notifications table via category codes.
-- -----------------------------------------------------------------------------
INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, sort_order, is_active) VALUES
  ('property.offer',        'Property offers',         'Offer, counter-offer and acceptance updates', 'property', TRUE, FALSE, FALSE, TRUE, FALSE, 300, TRUE),
  ('property.listing',      'Property listing status', 'Listing approved, rejected or published',     'property', TRUE, FALSE, FALSE, TRUE, FALSE, 301, TRUE),
  ('property.document',     'Property documents',      'Document verification updates',               'property', TRUE, FALSE, FALSE, TRUE, FALSE, 302, TRUE),
  ('property.application',  'Rental applications',     'Application submitted, accepted or rejected', 'property', TRUE, FALSE, FALSE, TRUE, FALSE, 303, TRUE),
  ('property.booking',      'Property bookings',       'Hospitality booking updates',                 'property', TRUE, FALSE, FALSE, TRUE, FALSE, 304, TRUE),
  ('property.lease',        'Leases and rent',         'Lease and rent due reminders',                'property', TRUE, TRUE,  FALSE, TRUE, TRUE,  305, TRUE),
  ('property.payment',      'Property payments',       'Deposit, rent and booking payments',          'property', TRUE, TRUE,  FALSE, TRUE, TRUE,  306, TRUE),
  ('property.search',       'Saved property alerts',   'New matches for saved searches and prices',   'property', TRUE, FALSE, FALSE, TRUE, FALSE, 307, TRUE),
  ('property.verification', 'Property verification',   'Ownership and inspection verification',       'property', TRUE, FALSE, FALSE, TRUE, FALSE, 308, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- Subscription features (global entitlement system — not a Property billing fork).
-- -----------------------------------------------------------------------------
INSERT INTO features (code, name, description, unit, is_metered, reset_period, sort_order) VALUES
  ('property_saved_searches', 'Property saved searches', 'Saved searches and price alerts', 'count', FALSE, 'none', 40),
  ('property_valuation',      'Property valuation tools', 'AI valuation assistance', 'boolean', FALSE, 'none', 41),
  ('property_featured',       'Featured property listings', 'Featured slots for property', 'count', TRUE, 'billing_cycle', 42),
  ('property_leads',          'Property lead management', 'Lead inbox and analytics', 'boolean', FALSE, 'none', 43),
  ('property_projects',       'Builder projects', 'Project / building / unit inventory', 'boolean', FALSE, 'none', 44),
  ('property_bulk_listings',  'Bulk property listings', 'Agency bulk upload', 'boolean', FALSE, 'none', 45)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled) VALUES
  (1, 'property_saved_searches', 5,  FALSE, TRUE),
  (1, 'property_valuation',      NULL, FALSE, TRUE),
  (1, 'property_featured',       0,  FALSE, FALSE),
  (1, 'property_leads',          NULL, FALSE, FALSE),
  (1, 'property_projects',       NULL, FALSE, FALSE),
  (1, 'property_bulk_listings',  NULL, FALSE, FALSE),
  (2, 'property_saved_searches', 25, FALSE, TRUE),
  (2, 'property_valuation',      NULL, FALSE, TRUE),
  (2, 'property_featured',       3,  FALSE, TRUE),
  (2, 'property_leads',          NULL, FALSE, TRUE),
  (2, 'property_projects',       NULL, FALSE, TRUE),
  (2, 'property_bulk_listings',  NULL, FALSE, TRUE)
ON DUPLICATE KEY UPDATE
  limit_value = VALUES(limit_value),
  is_unlimited = VALUES(is_unlimited),
  is_enabled = VALUES(is_enabled);
