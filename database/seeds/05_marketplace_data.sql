-- =============================================================================
-- 05  Marketplace domain data: gold purity + live rates, property amenities,
--     vehicle features, and the make / model / variant catalogue
--     Satisfies §5 (Purity, Live gold rates), §6 (Property Features / amenities),
--     §7 (Specifications) and the spec's opening requirement that vehicles be
--     comparable — vehicle_variants is the reference spec sheet the compare
--     screen and the AI comparison read from.
--     Derived gold rates are written as arithmetic on the per-gram rate so the
--     tola / ounce / 10g columns can never drift out of sync.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1. Gold purity reference (§5 Purity / Karat). Used to validate a submitted
--    karat/fineness pair and to label listings consistently across regions.
-- -----------------------------------------------------------------------------
INSERT INTO gold_purity_standards (karat, fineness, purity_percent, label, common_regions, sort_order) VALUES
  (24.00, 999, 99.900, '24K / 999 Fine',   '["CN","HK","IN","AE","SG","TW"]',      1),
  (23.00, 958, 95.800, '23K / 958',        '["TH","MM","VN"]',                     2),
  (22.00, 916, 91.600, '22K / 916 Hallmark','["PK","IN","BD","LK","NP","AE"]',     3),
  (21.00, 875, 87.500, '21K / 875',        '["SA","AE","EG","KW","QA","JO","IQ"]', 4),
  (18.00, 750, 75.000, '18K / 750',        '["GB","DE","FR","IT","TR","US","CH"]', 5),
  (14.00, 585, 58.500, '14K / 585',        '["US","DE","RU","PL","UA"]',           6),
  (10.00, 416, 41.600, '10K / 416',        '["US","CA"]',                          7),
  ( 9.00, 375, 37.500, '9K / 375',         '["GB","IE","AU","NZ","ZA"]',           8)
ON DUPLICATE KEY UPDATE
  fineness = VALUES(fineness), purity_percent = VALUES(purity_percent), label = VALUES(label),
  common_regions = VALUES(common_regions), sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 2. Live gold rates (§5 Live gold rates) for the six launch markets in local
--    currency, at roughly USD 85/g for 24K. Karat scaling: 22K x 0.9167,
--    21K x 0.875, 18K x 0.75. Explicit ids are required because the unique key
--    includes the nullable city_id, and MySQL treats each NULL as distinct.
-- -----------------------------------------------------------------------------
INSERT INTO gold_rates (id, country_id, city_id, currency, metal, karat, rate_per_gram, rate_per_tola, rate_per_ounce, rate_per_10g, buy_rate, sell_rate, change_amount, change_percent, source) VALUES
  -- Pakistan (PKR)
  ( 1, 1, NULL, 'PKR', 'gold', 24.00, 23800.0000, 23800.0000*11.6638, 23800.0000*31.1035, 23800.0000*10, 23800.0000*0.985, 23800.0000*1.015, 23800.0000*0.0063, 0.630, 'static'),
  ( 2, 1, NULL, 'PKR', 'gold', 22.00, 23800.0000*0.9167, 23800.0000*0.9167*11.6638, 23800.0000*0.9167*31.1035, 23800.0000*0.9167*10, 23800.0000*0.9167*0.985, 23800.0000*0.9167*1.015, 23800.0000*0.9167*0.0063, 0.630, 'static'),
  ( 3, 1, NULL, 'PKR', 'gold', 21.00, 23800.0000*0.8750, 23800.0000*0.8750*11.6638, 23800.0000*0.8750*31.1035, 23800.0000*0.8750*10, 23800.0000*0.8750*0.985, 23800.0000*0.8750*1.015, 23800.0000*0.8750*0.0063, 0.630, 'static'),
  ( 4, 1, NULL, 'PKR', 'gold', 18.00, 23800.0000*0.7500, 23800.0000*0.7500*11.6638, 23800.0000*0.7500*31.1035, 23800.0000*0.7500*10, 23800.0000*0.7500*0.985, 23800.0000*0.7500*1.015, 23800.0000*0.7500*0.0063, 0.630, 'static'),
  -- India (INR)
  ( 5, 2, NULL, 'INR', 'gold', 24.00,  7140.0000,  7140.0000*11.6638,  7140.0000*31.1035,  7140.0000*10,  7140.0000*0.985,  7140.0000*1.015,  7140.0000*0.0058, 0.580, 'static'),
  ( 6, 2, NULL, 'INR', 'gold', 22.00,  7140.0000*0.9167,  7140.0000*0.9167*11.6638,  7140.0000*0.9167*31.1035,  7140.0000*0.9167*10,  7140.0000*0.9167*0.985,  7140.0000*0.9167*1.015,  7140.0000*0.9167*0.0058, 0.580, 'static'),
  ( 7, 2, NULL, 'INR', 'gold', 21.00,  7140.0000*0.8750,  7140.0000*0.8750*11.6638,  7140.0000*0.8750*31.1035,  7140.0000*0.8750*10,  7140.0000*0.8750*0.985,  7140.0000*0.8750*1.015,  7140.0000*0.8750*0.0058, 0.580, 'static'),
  ( 8, 2, NULL, 'INR', 'gold', 18.00,  7140.0000*0.7500,  7140.0000*0.7500*11.6638,  7140.0000*0.7500*31.1035,  7140.0000*0.7500*10,  7140.0000*0.7500*0.985,  7140.0000*0.7500*1.015,  7140.0000*0.7500*0.0058, 0.580, 'static'),
  -- United Arab Emirates (AED)
  ( 9, 3, NULL, 'AED', 'gold', 24.00,   312.0000,   312.0000*11.6638,   312.0000*31.1035,   312.0000*10,   312.0000*0.985,   312.0000*1.015,   312.0000*0.0041, 0.410, 'static'),
  (10, 3, NULL, 'AED', 'gold', 22.00,   312.0000*0.9167,   312.0000*0.9167*11.6638,   312.0000*0.9167*31.1035,   312.0000*0.9167*10,   312.0000*0.9167*0.985,   312.0000*0.9167*1.015,   312.0000*0.9167*0.0041, 0.410, 'static'),
  (11, 3, NULL, 'AED', 'gold', 21.00,   312.0000*0.8750,   312.0000*0.8750*11.6638,   312.0000*0.8750*31.1035,   312.0000*0.8750*10,   312.0000*0.8750*0.985,   312.0000*0.8750*1.015,   312.0000*0.8750*0.0041, 0.410, 'static'),
  (12, 3, NULL, 'AED', 'gold', 18.00,   312.0000*0.7500,   312.0000*0.7500*11.6638,   312.0000*0.7500*31.1035,   312.0000*0.7500*10,   312.0000*0.7500*0.985,   312.0000*0.7500*1.015,   312.0000*0.7500*0.0041, 0.410, 'static'),
  -- Saudi Arabia (SAR)
  (13, 4, NULL, 'SAR', 'gold', 24.00,   319.0000,   319.0000*11.6638,   319.0000*31.1035,   319.0000*10,   319.0000*0.985,   319.0000*1.015,   319.0000*0.0041, 0.410, 'static'),
  (14, 4, NULL, 'SAR', 'gold', 22.00,   319.0000*0.9167,   319.0000*0.9167*11.6638,   319.0000*0.9167*31.1035,   319.0000*0.9167*10,   319.0000*0.9167*0.985,   319.0000*0.9167*1.015,   319.0000*0.9167*0.0041, 0.410, 'static'),
  (15, 4, NULL, 'SAR', 'gold', 21.00,   319.0000*0.8750,   319.0000*0.8750*11.6638,   319.0000*0.8750*31.1035,   319.0000*0.8750*10,   319.0000*0.8750*0.985,   319.0000*0.8750*1.015,   319.0000*0.8750*0.0041, 0.410, 'static'),
  (16, 4, NULL, 'SAR', 'gold', 18.00,   319.0000*0.7500,   319.0000*0.7500*11.6638,   319.0000*0.7500*31.1035,   319.0000*0.7500*10,   319.0000*0.7500*0.985,   319.0000*0.7500*1.015,   319.0000*0.7500*0.0041, 0.410, 'static'),
  -- United States (USD)
  (17, 5, NULL, 'USD', 'gold', 24.00,    85.0000,    85.0000*11.6638,    85.0000*31.1035,    85.0000*10,    85.0000*0.985,    85.0000*1.015,    85.0000*0.0039, 0.390, 'static'),
  (18, 5, NULL, 'USD', 'gold', 22.00,    85.0000*0.9167,    85.0000*0.9167*11.6638,    85.0000*0.9167*31.1035,    85.0000*0.9167*10,    85.0000*0.9167*0.985,    85.0000*0.9167*1.015,    85.0000*0.9167*0.0039, 0.390, 'static'),
  (19, 5, NULL, 'USD', 'gold', 21.00,    85.0000*0.8750,    85.0000*0.8750*11.6638,    85.0000*0.8750*31.1035,    85.0000*0.8750*10,    85.0000*0.8750*0.985,    85.0000*0.8750*1.015,    85.0000*0.8750*0.0039, 0.390, 'static'),
  (20, 5, NULL, 'USD', 'gold', 18.00,    85.0000*0.7500,    85.0000*0.7500*11.6638,    85.0000*0.7500*31.1035,    85.0000*0.7500*10,    85.0000*0.7500*0.985,    85.0000*0.7500*1.015,    85.0000*0.7500*0.0039, 0.390, 'static'),
  -- United Kingdom (GBP)
  (21, 6, NULL, 'GBP', 'gold', 24.00,    67.0000,    67.0000*11.6638,    67.0000*31.1035,    67.0000*10,    67.0000*0.985,    67.0000*1.015,    67.0000*0.0036, 0.360, 'static'),
  (22, 6, NULL, 'GBP', 'gold', 22.00,    67.0000*0.9167,    67.0000*0.9167*11.6638,    67.0000*0.9167*31.1035,    67.0000*0.9167*10,    67.0000*0.9167*0.985,    67.0000*0.9167*1.015,    67.0000*0.9167*0.0036, 0.360, 'static'),
  (23, 6, NULL, 'GBP', 'gold', 21.00,    67.0000*0.8750,    67.0000*0.8750*11.6638,    67.0000*0.8750*31.1035,    67.0000*0.8750*10,    67.0000*0.8750*0.985,    67.0000*0.8750*1.015,    67.0000*0.8750*0.0036, 0.360, 'static'),
  (24, 6, NULL, 'GBP', 'gold', 18.00,    67.0000*0.7500,    67.0000*0.7500*11.6638,    67.0000*0.7500*31.1035,    67.0000*0.7500*10,    67.0000*0.7500*0.985,    67.0000*0.7500*1.015,    67.0000*0.7500*0.0036, 0.360, 'static')
ON DUPLICATE KEY UPDATE
  currency = VALUES(currency), karat = VALUES(karat), rate_per_gram = VALUES(rate_per_gram),
  rate_per_tola = VALUES(rate_per_tola), rate_per_ounce = VALUES(rate_per_ounce),
  rate_per_10g = VALUES(rate_per_10g), buy_rate = VALUES(buy_rate), sell_rate = VALUES(sell_rate),
  change_amount = VALUES(change_amount), change_percent = VALUES(change_percent),
  source = VALUES(source), as_of = CURRENT_TIMESTAMP;

-- -----------------------------------------------------------------------------
-- 3. Property amenities (§6 Property Features). `applies_to` gates which usage
--    types offer the amenity, so the create-listing form never asks a plot
--    seller about a swimming pool.
-- -----------------------------------------------------------------------------
INSERT INTO property_amenities (code, name, icon, group_code, applies_to, is_filterable, sort_order, is_active) VALUES
  -- main
  ('parking',            'Parking',              'square-parking', 'main',      '["residential","commercial","rental"]',        TRUE,  10,  TRUE),
  ('lift',               'Lift / Elevator',      'move-vertical',  'main',      '["residential","commercial","rental"]',        TRUE,  20,  TRUE),
  ('security',           'Security',             'shield',         'main',      '["residential","commercial","rental"]',        TRUE,  30,  TRUE),
  ('backup_power',       'Backup Power',          'battery-charging','main',     '["residential","commercial","rental"]',        TRUE,  40,  TRUE),
  ('water_supply',       'Water Supply',          'droplets',       'main',      '["residential","commercial","rental","land"]', TRUE,  50,  TRUE),
  ('gas',                'Gas Connection',        'flame',          'main',      '["residential","commercial","rental"]',        TRUE,  60,  TRUE),
  ('electricity',        'Electricity',           'zap',            'main',      '["residential","commercial","rental","land"]', TRUE,  70,  TRUE),
  ('internet',           'Internet',              'wifi',           'main',      '["residential","commercial","rental"]',        TRUE,  80,  TRUE),
  ('air_conditioning',   'Air Conditioning',      'air-vent',       'main',      '["residential","commercial","rental"]',        TRUE,  90,  TRUE),
  ('heating',            'Heating',               'thermometer',    'main',      '["residential","commercial","rental"]',        TRUE,  100, TRUE),
  -- indoor
  ('furnished',          'Furnished',             'sofa',           'indoor',    '["residential","rental","commercial"]',        TRUE,  110, TRUE),
  ('kitchen_appliances', 'Kitchen Appliances',    'cooking-pot',    'indoor',    '["residential","rental"]',                     TRUE,  120, TRUE),
  ('wardrobes',          'Built-in Wardrobes',    'shirt',          'indoor',    '["residential","rental"]',                     TRUE,  130, TRUE),
  ('store_room',         'Store Room',            'archive',        'indoor',    '["residential","commercial","rental"]',        TRUE,  140, TRUE),
  ('servant_quarter',    'Servant Quarter',       'door-closed',    'indoor',    '["residential"]',                              TRUE,  150, TRUE),
  ('laundry',            'Laundry Area',          'washing-machine','indoor',    '["residential","rental"]',                     TRUE,  160, TRUE),
  ('study_room',         'Study Room',            'book-open',      'indoor',    '["residential","rental"]',                     TRUE,  170, TRUE),
  ('prayer_room',        'Prayer Room',           'moon',           'indoor',    '["residential","commercial","rental"]',        TRUE,  180, TRUE),
  ('basement',           'Basement',              'layers',         'indoor',    '["residential","commercial"]',                 TRUE,  190, TRUE),
  ('false_ceiling',      'False Ceiling',         'panel-top',      'indoor',    '["residential","commercial"]',                 FALSE, 200, TRUE),
  ('marble_flooring',    'Marble Flooring',       'grid-2x2',       'indoor',    '["residential","commercial"]',                 TRUE,  210, TRUE),
  ('wooden_flooring',    'Wooden Flooring',       'grid-2x2',       'indoor',    '["residential","commercial"]',                 TRUE,  220, TRUE),
  -- outdoor
  ('garden',             'Garden',                'trees',          'outdoor',   '["residential","rental"]',                     TRUE,  230, TRUE),
  ('lawn',               'Lawn',                  'sprout',         'outdoor',   '["residential","rental"]',                     TRUE,  240, TRUE),
  ('terrace',            'Terrace',               'sun',            'outdoor',   '["residential","rental","commercial"]',        TRUE,  250, TRUE),
  ('balcony',            'Balcony',               'panel-top-open', 'outdoor',   '["residential","rental"]',                     TRUE,  260, TRUE),
  ('swimming_pool',      'Swimming Pool',         'waves',          'outdoor',   '["residential","rental"]',                     TRUE,  270, TRUE),
  ('bbq_area',           'BBQ Area',              'flame',          'outdoor',   '["residential","rental"]',                     TRUE,  280, TRUE),
  ('roof_access',        'Roof Access',           'arrow-up',       'outdoor',   '["residential","rental"]',                     FALSE, 290, TRUE),
  ('courtyard',          'Courtyard',             'square',         'outdoor',   '["residential","rental"]',                     FALSE, 300, TRUE),
  ('boundary_wall',      'Boundary Wall',         'brick-wall',     'outdoor',   '["residential","land","commercial"]',          TRUE,  310, TRUE),
  ('main_gate',          'Main Gate',             'door-open',      'outdoor',   '["residential","land","commercial"]',          FALSE, 320, TRUE),
  -- security
  ('cctv',               'CCTV',                  'cctv',           'security',  '["residential","commercial","rental"]',        TRUE,  330, TRUE),
  ('guard',              'Security Guard',        'shield-check',   'security',  '["residential","commercial","rental"]',        TRUE,  340, TRUE),
  ('intercom',           'Intercom',              'phone-call',     'security',  '["residential","commercial","rental"]',        TRUE,  350, TRUE),
  ('gated_community',    'Gated Community',       'fence',          'security',  '["residential","rental","land"]',              TRUE,  360, TRUE),
  ('fire_alarm',         'Fire Alarm',            'bell-ring',      'security',  '["residential","commercial","rental"]',        TRUE,  370, TRUE),
  ('fire_extinguisher',  'Fire Extinguisher',     'fire-extinguisher','security','["residential","commercial","rental"]',        FALSE, 380, TRUE),
  ('emergency_exit',     'Emergency Exit',        'door-open',      'security',  '["commercial","rental"]',                      FALSE, 390, TRUE),
  -- community
  ('gym',                'Gym',                   'dumbbell',       'community', '["residential","rental","commercial"]',        TRUE,  400, TRUE),
  ('playground',         'Playground',            'baby',           'community', '["residential","rental"]',                     TRUE,  410, TRUE),
  ('community_hall',     'Community Hall',        'users',          'community', '["residential","rental"]',                     TRUE,  420, TRUE),
  ('mosque',             'Mosque',                'moon-star',      'community', '["residential","rental","land"]',              TRUE,  430, TRUE),
  ('park',               'Park',                  'trees',          'community', '["residential","rental","land"]',              TRUE,  440, TRUE),
  ('jogging_track',      'Jogging Track',         'footprints',     'community', '["residential","rental"]',                     TRUE,  450, TRUE),
  ('tennis_court',       'Tennis Court',          'circle-dot',     'community', '["residential","rental"]',                     FALSE, 460, TRUE),
  ('kids_area',          'Kids Area',             'baby',           'community', '["residential","rental"]',                     TRUE,  470, TRUE),
  ('clubhouse',          'Clubhouse',             'landmark',       'community', '["residential","rental"]',                     TRUE,  480, TRUE),
  -- utilities
  ('sewerage',           'Sewerage',              'pipette',        'utilities', '["residential","commercial","rental","land"]', TRUE,  490, TRUE),
  ('sui_gas',            'Sui Gas',               'flame',          'utilities', '["residential","commercial","rental"]',        TRUE,  500, TRUE),
  ('solar_panels',       'Solar Panels',          'sun',            'utilities', '["residential","commercial","rental"]',        TRUE,  510, TRUE),
  ('water_tank',         'Water Tank',            'container',      'utilities', '["residential","commercial","rental"]',        TRUE,  520, TRUE),
  ('borewell',           'Borewell',              'droplet',        'utilities', '["residential","land"]',                       TRUE,  530, TRUE),
  ('generator',          'Generator',             'power',          'utilities', '["residential","commercial","rental"]',        TRUE,  540, TRUE),
  ('ups',                'UPS',                   'battery',        'utilities', '["residential","commercial","rental"]',        TRUE,  550, TRUE),
  -- nearby (§11 Nearby Places)
  ('school',             'School Nearby',         'graduation-cap', 'nearby',    '["residential","rental","land"]',              TRUE,  560, TRUE),
  ('hospital',           'Hospital Nearby',       'cross',          'nearby',    '["residential","rental","land"]',              TRUE,  570, TRUE),
  ('market',             'Market Nearby',         'shopping-basket','nearby',    '["residential","commercial","rental"]',        TRUE,  580, TRUE),
  ('mall',               'Mall Nearby',           'shopping-bag',   'nearby',    '["residential","commercial","rental"]',        TRUE,  590, TRUE),
  ('public_transport',   'Public Transport',      'bus',            'nearby',    '["residential","commercial","rental"]',        TRUE,  600, TRUE),
  ('highway',            'Highway Access',        'route',          'nearby',    '["commercial","land","residential"]',          TRUE,  610, TRUE),
  ('airport',            'Airport Nearby',        'plane',          'nearby',    '["residential","commercial","rental"]',        TRUE,  620, TRUE),
  ('restaurant',         'Restaurants Nearby',    'utensils',       'nearby',    '["residential","commercial","rental"]',        FALSE, 630, TRUE),
  -- business (commercial-only)
  ('conference_room',    'Conference Room',       'presentation',   'business',  '["commercial"]',                               TRUE,  640, TRUE),
  ('reception',          'Reception Area',        'concierge-bell', 'business',  '["commercial"]',                               TRUE,  650, TRUE),
  ('server_room',        'Server Room',           'server',        'business',   '["commercial"]',                               FALSE, 660, TRUE),
  ('loading_dock',       'Loading Dock',          'truck',          'business',  '["commercial"]',                               TRUE,  670, TRUE),
  ('three_phase',        'Three-Phase Power',     'zap',            'business',  '["commercial"]',                               TRUE,  680, TRUE),
  ('freight_lift',       'Freight Lift',          'move-vertical',  'business',  '["commercial"]',                               TRUE,  690, TRUE),
  ('parking_bays',       'Dedicated Parking Bays','square-parking', 'business',  '["commercial"]',                               TRUE,  700, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), icon = VALUES(icon), group_code = VALUES(group_code),
  applies_to = VALUES(applies_to), is_filterable = VALUES(is_filterable),
  sort_order = VALUES(sort_order), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 4. Vehicle features (§7). `applies_to` holds vehicle_type values, so a boat
--    listing is offered radar and a fishfinder rather than alloy wheels.
-- -----------------------------------------------------------------------------
INSERT INTO vehicle_features (code, name, icon, group_code, applies_to, is_filterable, is_comparable, sort_order, is_active) VALUES
  -- safety
  ('abs',                  'ABS',                       'disc',            'safety', '["car","motorcycle","bus","truck","van","taxi"]', TRUE,  TRUE,  10,  TRUE),
  ('airbags',              'Airbags',                   'shield',          'safety', '["car","bus","truck","van","taxi"]',              TRUE,  TRUE,  20,  TRUE),
  ('ebd',                  'EBD',                       'gauge',           'safety', '["car","bus","truck","van","taxi"]',              FALSE, TRUE,  30,  TRUE),
  ('esp',                  'Electronic Stability',      'activity',        'safety', '["car","bus","truck","van","taxi"]',              TRUE,  TRUE,  40,  TRUE),
  ('traction_control',     'Traction Control',          'circle-dot',      'safety', '["car","motorcycle","truck","van","taxi"]',       TRUE,  TRUE,  50,  TRUE),
  ('hill_assist',          'Hill Start Assist',         'mountain',        'safety', '["car","truck","van","taxi"]',                    FALSE, TRUE,  60,  TRUE),
  ('isofix',               'ISOFIX Child Seat Mounts',  'baby',            'safety', '["car","van","taxi"]',                            FALSE, TRUE,  70,  TRUE),
  ('immobilizer',          'Engine Immobilizer',        'lock',            'safety', '["car","motorcycle","van","taxi"]',               TRUE,  TRUE,  80,  TRUE),
  ('tpms',                 'Tyre Pressure Monitoring',  'circle-gauge',    'safety', '["car","truck","van","taxi"]',                    FALSE, TRUE,  90,  TRUE),
  ('lane_assist',          'Lane Keep Assist',          'route',           'safety', '["car","truck","van"]',                           TRUE,  TRUE,  100, TRUE),
  ('blind_spot',           'Blind Spot Monitor',        'eye-off',         'safety', '["car","truck","van"]',                           TRUE,  TRUE,  110, TRUE),
  ('collision_warning',    'Forward Collision Warning', 'triangle-alert',  'safety', '["car","truck","van"]',                           TRUE,  TRUE,  120, TRUE),
  ('auto_emergency_brake', 'Autonomous Emergency Brake','octagon-alert',   'safety', '["car","truck","van"]',                           TRUE,  TRUE,  130, TRUE),
  ('parking_sensors',      'Parking Sensors',           'radar',           'safety', '["car","truck","van","taxi"]',                     TRUE,  TRUE,  140, TRUE),
  ('rear_camera',          'Rear View Camera',          'camera',          'safety', '["car","truck","van","taxi"]',                     TRUE,  TRUE,  150, TRUE),
  ('camera_360',           '360 Degree Camera',         'scan',            'safety', '["car","truck","van"]',                            TRUE,  TRUE,  160, TRUE),
  ('adaptive_cruise',      'Adaptive Cruise Control',   'gauge-circle',    'safety', '["car","truck","van"]',                            TRUE,  TRUE,  170, TRUE),
  -- comfort
  ('air_conditioning',     'Air Conditioning',          'air-vent',        'comfort', '["car","bus","truck","van","taxi","heavy_machinery","tractor"]', TRUE,  TRUE,  180, TRUE),
  ('climate_control',      'Climate Control',           'thermometer',     'comfort', '["car","bus","van","taxi"]',                      TRUE,  TRUE,  190, TRUE),
  ('power_steering',       'Power Steering',            'steering-wheel',  'comfort', '["car","bus","truck","van","taxi","tractor"]',    TRUE,  TRUE,  200, TRUE),
  ('power_windows',        'Power Windows',             'panel-top-open',  'comfort', '["car","bus","truck","van","taxi"]',              TRUE,  TRUE,  210, TRUE),
  ('power_mirrors',        'Power Mirrors',             'square',          'comfort', '["car","truck","van","taxi"]',                    FALSE, TRUE,  220, TRUE),
  ('cruise_control',       'Cruise Control',            'gauge',           'comfort', '["car","truck","van","taxi"]',                    TRUE,  TRUE,  230, TRUE),
  ('keyless_entry',        'Keyless Entry',             'key',             'comfort', '["car","van","taxi"]',                            TRUE,  TRUE,  240, TRUE),
  ('push_start',           'Push Button Start',         'power',           'comfort', '["car","van","taxi"]',                            TRUE,  TRUE,  250, TRUE),
  ('heated_seats',         'Heated Seats',              'flame',           'comfort', '["car","van"]',                                   FALSE, TRUE,  260, TRUE),
  ('ventilated_seats',     'Ventilated Seats',          'wind',            'comfort', '["car","van"]',                                   FALSE, TRUE,  270, TRUE),
  ('memory_seats',         'Memory Seats',              'save',            'comfort', '["car","van"]',                                   FALSE, TRUE,  280, TRUE),
  ('leather_seats',        'Leather Seats',             'armchair',        'comfort', '["car","van","yacht"]',                            TRUE,  TRUE,  290, TRUE),
  ('sunroof',              'Sunroof',                   'sun',             'comfort', '["car","van"]',                                   TRUE,  TRUE,  300, TRUE),
  ('panoramic_roof',       'Panoramic Roof',            'sun',             'comfort', '["car","van"]',                                   TRUE,  TRUE,  310, TRUE),
  ('rear_ac_vents',        'Rear AC Vents',             'air-vent',        'comfort', '["car","van","bus","taxi"]',                      TRUE,  TRUE,  320, TRUE),
  ('armrest',              'Centre Armrest',            'minus',           'comfort', '["car","van","bus","taxi"]',                      FALSE, FALSE, 330, TRUE),
  ('cup_holders',          'Cup Holders',               'cup-soda',        'comfort', '["car","van","bus","taxi"]',                      FALSE, FALSE, 340, TRUE),
  -- entertainment
  ('touchscreen',          'Touchscreen Infotainment',  'monitor',         'entertainment', '["car","van","bus","taxi","yacht"]',        TRUE,  TRUE,  350, TRUE),
  ('android_auto',         'Android Auto',              'smartphone',      'entertainment', '["car","van","taxi"]',                      TRUE,  TRUE,  360, TRUE),
  ('apple_carplay',        'Apple CarPlay',             'smartphone',      'entertainment', '["car","van","taxi"]',                      TRUE,  TRUE,  370, TRUE),
  ('bluetooth',            'Bluetooth',                 'bluetooth',       'entertainment', '["car","motorcycle","van","bus","taxi","boat","yacht"]', TRUE, TRUE, 380, TRUE),
  ('usb',                  'USB Ports',                 'usb',             'entertainment', '["car","van","bus","taxi"]',                FALSE, FALSE, 390, TRUE),
  ('aux',                  'AUX Input',                 'audio-lines',     'entertainment', '["car","van","bus","taxi"]',                FALSE, FALSE, 400, TRUE),
  ('navigation',           'Built-in Navigation',       'map',             'entertainment', '["car","van","truck","bus","boat","yacht"]', TRUE,  TRUE,  410, TRUE),
  ('premium_audio',        'Premium Audio System',      'speaker',         'entertainment', '["car","van","yacht"]',                      TRUE,  TRUE,  420, TRUE),
  ('rear_entertainment',   'Rear Seat Entertainment',   'tv',              'entertainment', '["car","van","bus"]',                       FALSE, TRUE,  430, TRUE),
  ('wireless_charging',    'Wireless Charging',         'battery-charging','entertainment', '["car","van","taxi"]',                      TRUE,  TRUE,  440, TRUE),
  ('voice_control',        'Voice Control',             'mic',             'entertainment', '["car","van","taxi"]',                      FALSE, TRUE,  450, TRUE),
  -- exterior
  ('alloy_wheels',         'Alloy Wheels',              'circle-dot',      'exterior', '["car","motorcycle","van","truck","taxi"]',      TRUE,  TRUE,  460, TRUE),
  ('led_headlights',       'LED Headlights',            'lightbulb',       'exterior', '["car","motorcycle","van","truck","bus","taxi"]',TRUE,  TRUE,  470, TRUE),
  ('drl',                  'Daytime Running Lights',    'sun',             'exterior', '["car","motorcycle","van","truck","taxi"]',      FALSE, TRUE,  480, TRUE),
  ('fog_lights',           'Fog Lights',                'cloud-fog',       'exterior', '["car","motorcycle","van","truck","bus","taxi"]',TRUE,  TRUE,  490, TRUE),
  ('roof_rails',           'Roof Rails',                'minus',           'exterior', '["car","van"]',                                  FALSE, TRUE,  500, TRUE),
  ('spoiler',              'Rear Spoiler',              'chevron-up',      'exterior', '["car"]',                                        FALSE, TRUE,  510, TRUE),
  ('tow_hitch',            'Tow Hitch',                 'link',            'exterior', '["car","van","truck","atv"]',                    TRUE,  TRUE,  520, TRUE),
  ('sunroof_exterior',     'Panoramic Glass Roof',      'sun',             'exterior', '["car","van"]',                                  FALSE, TRUE,  530, TRUE),
  ('rain_sensor',          'Rain Sensing Wipers',       'cloud-rain',      'exterior', '["car","van","truck","taxi"]',                   FALSE, TRUE,  540, TRUE),
  ('auto_headlights',      'Automatic Headlights',      'lamp',            'exterior', '["car","van","truck","taxi"]',                   FALSE, TRUE,  550, TRUE),
  -- technology
  ('digital_cluster',      'Digital Instrument Cluster','gauge',           'technology', '["car","motorcycle","van","truck"]',            TRUE,  TRUE,  560, TRUE),
  ('hud',                  'Head-Up Display',           'projector',       'technology', '["car","van"]',                                FALSE, TRUE,  570, TRUE),
  ('remote_start',         'Remote Engine Start',       'radio',           'technology', '["car","van","truck"]',                        FALSE, TRUE,  580, TRUE),
  ('connected_car',        'Connected Car App',         'wifi',            'technology', '["car","van","truck"]',                        TRUE,  TRUE,  590, TRUE),
  ('ota_updates',          'Over-the-Air Updates',      'cloud-download',  'technology', '["car","van"]',                                FALSE, TRUE,  600, TRUE),
  ('dashcam',              'Dashcam',                   'video',           'technology', '["car","van","truck","taxi","bus"]',           TRUE,  TRUE,  610, TRUE),
  ('tyre_pressure_display','Tyre Pressure Display',     'circle-gauge',    'technology', '["car","van","truck"]',                        FALSE, TRUE,  620, TRUE),
  -- assistance
  ('auto_park',            'Automatic Parking',         'square-parking',  'assistance', '["car","van"]',                                TRUE,  TRUE,  630, TRUE),
  ('auto_hold',            'Auto Hold',                 'hand',            'assistance', '["car","van","truck"]',                        FALSE, TRUE,  640, TRUE),
  ('360_view',             '360 Degree View',           'scan-eye',        'assistance', '["car","van","truck","heavy_machinery"]',       TRUE,  TRUE,  650, TRUE),
  ('night_vision',         'Night Vision Assist',       'moon',            'assistance', '["car","van"]',                                FALSE, TRUE,  660, TRUE),
  -- commercial
  ('refrigerated',         'Refrigerated Body',         'snowflake',       'commercial', '["truck","van","trailer"]',                     TRUE,  TRUE,  670, TRUE),
  ('tail_lift',            'Tail Lift',                 'move-vertical',   'commercial', '["truck","van","trailer"]',                     TRUE,  TRUE,  680, TRUE),
  ('crane',                'Mounted Crane',             'crane',           'commercial', '["truck","heavy_machinery"]',                   TRUE,  TRUE,  690, TRUE),
  ('tipper',               'Tipper Body',               'triangle',        'commercial', '["truck","trailer"]',                           TRUE,  TRUE,  700, TRUE),
  ('tanker',               'Tanker Body',               'container',       'commercial', '["truck","trailer"]',                           TRUE,  TRUE,  710, TRUE),
  ('flatbed',              'Flatbed',                   'rectangle-horizontal','commercial','["truck","trailer"]',                        TRUE,  TRUE,  720, TRUE),
  ('gps_tracker',          'GPS Tracker',               'map-pin',         'commercial', '["truck","van","bus","taxi","car","trailer"]',   TRUE,  TRUE,  730, TRUE),
  -- marine
  ('cabin',                'Cabin',                     'door-closed',     'marine', '["boat","yacht"]',                                  TRUE,  TRUE,  740, TRUE),
  ('galley',               'Galley',                    'cooking-pot',     'marine', '["boat","yacht"]',                                  TRUE,  TRUE,  750, TRUE),
  ('head',                 'Head / Toilet',             'bath',            'marine', '["boat","yacht"]',                                  TRUE,  TRUE,  760, TRUE),
  ('radar',                'Radar',                     'radar',           'marine', '["boat","yacht"]',                                  TRUE,  TRUE,  770, TRUE),
  ('fishfinder',           'Fishfinder / Sonar',        'fish',            'marine', '["boat"]',                                          TRUE,  TRUE,  780, TRUE),
  ('autopilot',            'Autopilot',                 'navigation',      'marine', '["boat","yacht"]',                                  TRUE,  TRUE,  790, TRUE),
  ('trailer_included',     'Trailer Included',          'container',       'marine', '["boat","jet_ski"]',                                TRUE,  TRUE,  800, TRUE),
  ('outboard',             'Outboard Engine',           'cog',             'marine', '["boat"]',                                          TRUE,  TRUE,  810, TRUE),
  ('inboard',              'Inboard Engine',            'cog',             'marine', '["boat","yacht"]',                                  TRUE,  TRUE,  820, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), icon = VALUES(icon), group_code = VALUES(group_code),
  applies_to = VALUES(applies_to), is_filterable = VALUES(is_filterable),
  is_comparable = VALUES(is_comparable), sort_order = VALUES(sort_order), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 5. Vehicle makes (§7 Make). Ids are pinned so model ids can be derived as
--    make_id * 100 + n, which keeps the catalogue below readable.
-- -----------------------------------------------------------------------------
INSERT INTO vehicle_makes (id, name, slug, country_id, vehicle_types, is_popular, is_active, sort_order) VALUES
  ( 1, 'Toyota',          'toyota',          10, '["car","van","bus","truck"]',                                    TRUE,  TRUE,  1),
  ( 2, 'Honda',           'honda',           10, '["car","motorcycle","atv"]',                                     TRUE,  TRUE,  2),
  ( 3, 'Suzuki',          'suzuki',          10, '["car","motorcycle","van"]',                                     TRUE,  TRUE,  3),
  ( 4, 'Hyundai',         'hyundai',         49, '["car","van","truck","bus"]',                                    TRUE,  TRUE,  4),
  ( 5, 'Kia',             'kia',             49, '["car","van"]',                                                  TRUE,  TRUE,  5),
  ( 6, 'Nissan',          'nissan',          10, '["car","van","truck"]',                                          TRUE,  TRUE,  6),
  ( 7, 'Mitsubishi',      'mitsubishi',      10, '["car","truck","van"]',                                          TRUE,  TRUE,  7),
  ( 8, 'Mazda',           'mazda',           10, '["car"]',                                                        FALSE, TRUE,  8),
  ( 9, 'Ford',            'ford',             5, '["car","truck","van"]',                                          TRUE,  TRUE,  9),
  (10, 'Chevrolet',       'chevrolet',        5, '["car","truck"]',                                                FALSE, TRUE, 10),
  (11, 'Volkswagen',      'volkswagen',      11, '["car","van"]',                                                  TRUE,  TRUE, 11),
  (12, 'Audi',            'audi',            11, '["car"]',                                                        TRUE,  TRUE, 12),
  (13, 'BMW',             'bmw',             11, '["car","motorcycle"]',                                           TRUE,  TRUE, 13),
  (14, 'Mercedes-Benz',   'mercedes-benz',   11, '["car","truck","bus","van"]',                                    TRUE,  TRUE, 14),
  (15, 'Porsche',         'porsche',         11, '["car"]',                                                        FALSE, TRUE, 15),
  (16, 'Volvo',           'volvo',           38, '["car","truck","bus"]',                                          FALSE, TRUE, 16),
  (17, 'Peugeot',         'peugeot',         12, '["car","van"]',                                                  FALSE, TRUE, 17),
  (18, 'Renault',         'renault',         12, '["car","van"]',                                                  FALSE, TRUE, 18),
  (19, 'Fiat',            'fiat',            14, '["car","van"]',                                                  FALSE, TRUE, 19),
  (20, 'Jeep',            'jeep',             5, '["car"]',                                                        FALSE, TRUE, 20),
  (21, 'Land Rover',      'land-rover',       6, '["car"]',                                                        FALSE, TRUE, 21),
  (22, 'Jaguar',          'jaguar',           6, '["car"]',                                                        FALSE, TRUE, 22),
  (23, 'Lexus',           'lexus',           10, '["car"]',                                                        TRUE,  TRUE, 23),
  (24, 'Infiniti',        'infiniti',        10, '["car"]',                                                        FALSE, TRUE, 24),
  (25, 'Tesla',           'tesla',            5, '["car"]',                                                        TRUE,  TRUE, 25),
  (26, 'BYD',             'byd',             16, '["car","bus"]',                                                  TRUE,  TRUE, 26),
  (27, 'MG',              'mg',              16, '["car"]',                                                        TRUE,  TRUE, 27),
  (28, 'Changan',         'changan',         16, '["car","van"]',                                                  TRUE,  TRUE, 28),
  (29, 'Haval',           'haval',           16, '["car"]',                                                        TRUE,  TRUE, 29),
  (30, 'Chery',           'chery',           16, '["car"]',                                                        FALSE, TRUE, 30),
  (31, 'Proton',          'proton',          23, '["car"]',                                                        FALSE, TRUE, 31),
  (32, 'Isuzu',           'isuzu',           10, '["truck","car","bus"]',                                          TRUE,  TRUE, 32),
  (33, 'Hino',            'hino',            10, '["truck","bus"]',                                                FALSE, TRUE, 33),
  (34, 'Tata',            'tata',             2, '["car","truck","bus"]',                                          TRUE,  TRUE, 34),
  (35, 'Mahindra',        'mahindra',         2, '["car","tractor","truck"]',                                      TRUE,  TRUE, 35),
  (36, 'Maruti Suzuki',   'maruti-suzuki',    2, '["car"]',                                                        TRUE,  TRUE, 36),
  (37, 'Yamaha',          'yamaha',          10, '["motorcycle","jet_ski","boat"]',                                TRUE,  TRUE, 37),
  (38, 'Kawasaki',        'kawasaki',        10, '["motorcycle","jet_ski"]',                                       FALSE, TRUE, 38),
  (39, 'Ducati',          'ducati',          14, '["motorcycle"]',                                                 FALSE, TRUE, 39),
  (40, 'Harley-Davidson', 'harley-davidson',  5, '["motorcycle"]',                                                 FALSE, TRUE, 40),
  (41, 'Royal Enfield',   'royal-enfield',    2, '["motorcycle"]',                                                 TRUE,  TRUE, 41),
  (42, 'Bajaj',           'bajaj',            2, '["motorcycle","rickshaw"]',                                      TRUE,  TRUE, 42),
  (43, 'Hero',            'hero',             2, '["motorcycle"]',                                                 TRUE,  TRUE, 43),
  (44, 'TVS',             'tvs',              2, '["motorcycle","rickshaw"]',                                      TRUE,  TRUE, 44),
  (45, 'KTM',             'ktm',             70, '["motorcycle"]',                                                 FALSE, TRUE, 45),
  (46, 'Vespa',           'vespa',           14, '["motorcycle"]',                                                 FALSE, TRUE, 46),
  (47, 'United',          'united',           1, '["motorcycle","rickshaw"]',                                      TRUE,  TRUE, 47),
  (48, 'Road Prince',     'road-prince',      1, '["motorcycle"]',                                                 TRUE,  TRUE, 48),
  (49, 'Massey Ferguson', 'massey-ferguson',  5, '["tractor","agriculture_equipment"]',                            TRUE,  TRUE, 49),
  (50, 'John Deere',      'john-deere',       5, '["tractor","agriculture_equipment","construction_equipment"]',    TRUE,  TRUE, 50),
  (51, 'New Holland',     'new-holland',     14, '["tractor","agriculture_equipment"]',                            TRUE,  TRUE, 51),
  (52, 'Caterpillar',     'caterpillar',      5, '["heavy_machinery","construction_equipment"]',                   TRUE,  TRUE, 52),
  (53, 'Komatsu',         'komatsu',         10, '["heavy_machinery","construction_equipment"]',                   FALSE, TRUE, 53),
  (54, 'JCB',             'jcb',              6, '["construction_equipment","heavy_machinery"]',                   TRUE,  TRUE, 54),
  (55, 'Yanmar',          'yanmar',          10, '["tractor","agriculture_equipment","boat"]',                     FALSE, TRUE, 55),
  (56, 'Kubota',          'kubota',          10, '["tractor","agriculture_equipment","construction_equipment"]',   FALSE, TRUE, 56),
  (57, 'Sea-Ray',         'sea-ray',          5, '["boat","yacht"]',                                               FALSE, TRUE, 57),
  (58, 'Yamaha Marine',   'yamaha-marine',   10, '["boat","jet_ski"]',                                             FALSE, TRUE, 58)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), slug = VALUES(slug), country_id = VALUES(country_id),
  vehicle_types = VALUES(vehicle_types), is_popular = VALUES(is_popular),
  is_active = VALUES(is_active), sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 6. Vehicle models (§7 Model). Toyota, Honda and Suzuki are the volume sellers
--    in the launch markets, so those line-ups are covered in depth.
-- -----------------------------------------------------------------------------
INSERT INTO vehicle_models (id, make_id, name, slug, vehicle_type, body_type, segment, production_start, production_end, is_popular, is_active) VALUES
  -- Toyota
  ( 101,  1, 'Corolla',        'corolla',        'car', 'sedan',       'C',       1966, NULL, TRUE,  TRUE),
  ( 102,  1, 'Yaris',          'yaris',          'car', 'sedan',       'B',       1999, NULL, TRUE,  TRUE),
  ( 103,  1, 'Camry',          'camry',          'car', 'sedan',       'D',       1982, NULL, TRUE,  TRUE),
  ( 104,  1, 'Fortuner',       'fortuner',       'car', 'suv',         'D-SUV',   2005, NULL, TRUE,  TRUE),
  ( 105,  1, 'Hilux',          'hilux',          'car', 'pickup',      'Pickup',  1968, NULL, TRUE,  TRUE),
  ( 106,  1, 'Land Cruiser',   'land-cruiser',   'car', 'suv',         'F-SUV',   1951, NULL, TRUE,  TRUE),
  ( 107,  1, 'Prado',          'prado',          'car', 'suv',         'E-SUV',   1990, NULL, TRUE,  TRUE),
  ( 108,  1, 'RAV4',           'rav4',           'car', 'crossover',   'C-SUV',   1994, NULL, TRUE,  TRUE),
  ( 109,  1, 'Vitz',           'vitz',           'car', 'hatchback',   'B',       1999, NULL, TRUE,  TRUE),
  ( 110,  1, 'Aqua',           'aqua',           'car', 'hatchback',   'B',       2011, NULL, TRUE,  TRUE),
  ( 111,  1, 'Prius',          'prius',          'car', 'hatchback',   'C',       1997, NULL, TRUE,  TRUE),
  ( 112,  1, 'Coaster',        'coaster',        'bus', NULL,          'Minibus', 1969, NULL, FALSE, TRUE),
  ( 113,  1, 'Hiace',          'hiace',          'van', 'minivan',     'Van',     1967, NULL, TRUE,  TRUE),
  -- Honda
  ( 201,  2, 'Civic',          'civic',          'car', 'sedan',       'C',       1972, NULL, TRUE,  TRUE),
  ( 202,  2, 'City',           'city',           'car', 'sedan',       'B',       1981, NULL, TRUE,  TRUE),
  ( 203,  2, 'Accord',         'accord',         'car', 'sedan',       'D',       1976, NULL, FALSE, TRUE),
  ( 204,  2, 'BR-V',           'br-v',           'car', 'crossover',   'B-SUV',   2016, NULL, TRUE,  TRUE),
  ( 205,  2, 'HR-V',           'hr-v',           'car', 'crossover',   'B-SUV',   1998, NULL, TRUE,  TRUE),
  ( 206,  2, 'CR-V',           'cr-v',           'car', 'suv',         'C-SUV',   1995, NULL, TRUE,  TRUE),
  ( 207,  2, 'Vezel',          'vezel',          'car', 'crossover',   'B-SUV',   2013, NULL, TRUE,  TRUE),
  ( 208,  2, 'Fit',            'fit',            'car', 'hatchback',   'B',       2001, NULL, TRUE,  TRUE),
  ( 209,  2, 'Freed',          'freed',          'car', 'mpv',         'MPV',     2008, NULL, FALSE, TRUE),
  ( 210,  2, 'CG 125',         'cg-125',         'motorcycle', NULL,   'Commuter',1976, NULL, TRUE,  TRUE),
  ( 211,  2, 'CD 70',          'cd-70',          'motorcycle', NULL,   'Commuter',1970, NULL, TRUE,  TRUE),
  ( 212,  2, 'CB 150F',        'cb-150f',        'motorcycle', NULL,   'Standard',2016, NULL, TRUE,  TRUE),
  -- Suzuki
  ( 301,  3, 'Alto',           'alto',           'car', 'hatchback',   'A',       1979, NULL, TRUE,  TRUE),
  ( 302,  3, 'Cultus',         'cultus',         'car', 'hatchback',   'B',       1983, NULL, TRUE,  TRUE),
  ( 303,  3, 'Swift',          'swift',          'car', 'hatchback',   'B',       2004, NULL, TRUE,  TRUE),
  ( 304,  3, 'Wagon R',        'wagon-r',        'car', 'hatchback',   'A',       1993, NULL, TRUE,  TRUE),
  ( 305,  3, 'Bolan',          'bolan',          'van', 'minivan',     'Van',     1988, NULL, TRUE,  TRUE),
  ( 306,  3, 'Ravi',           'ravi',           'car', 'pickup',      'Pickup',  1988, NULL, TRUE,  TRUE),
  ( 307,  3, 'Every',          'every',          'van', 'minivan',     'Van',     1982, NULL, FALSE, TRUE),
  ( 308,  3, 'Jimny',          'jimny',          'car', 'suv',         'A-SUV',   1970, NULL, TRUE,  TRUE),
  ( 309,  3, 'Ciaz',           'ciaz',           'car', 'sedan',       'C',       2014, NULL, FALSE, TRUE),
  ( 310,  3, 'Baleno',         'baleno',         'car', 'hatchback',   'B',       1995, NULL, FALSE, TRUE),
  ( 311,  3, 'GS 150',         'gs-150',         'motorcycle', NULL,   'Standard',2014, NULL, TRUE,  TRUE),
  -- Hyundai
  ( 401,  4, 'Elantra',        'elantra',        'car', 'sedan',       'C',       1990, NULL, TRUE,  TRUE),
  ( 402,  4, 'Tucson',         'tucson',         'car', 'suv',         'C-SUV',   2004, NULL, TRUE,  TRUE),
  ( 403,  4, 'Sonata',         'sonata',         'car', 'sedan',       'D',       1985, NULL, FALSE, TRUE),
  ( 404,  4, 'Santa Fe',       'santa-fe',       'car', 'suv',         'D-SUV',   2000, NULL, FALSE, TRUE),
  ( 405,  4, 'Porter',         'porter',         'truck', NULL,        'LCV',     1977, NULL, TRUE,  TRUE),
  ( 406,  4, 'Creta',          'creta',          'car', 'crossover',   'B-SUV',   2014, NULL, TRUE,  TRUE),
  ( 407,  4, 'i10',            'i10',            'car', 'hatchback',   'A',       2007, NULL, FALSE, TRUE),
  ( 408,  4, 'i20',            'i20',            'car', 'hatchback',   'B',       2008, NULL, FALSE, TRUE),
  -- Kia
  ( 501,  5, 'Sportage',       'sportage',       'car', 'suv',         'C-SUV',   1993, NULL, TRUE,  TRUE),
  ( 502,  5, 'Picanto',        'picanto',        'car', 'hatchback',   'A',       2004, NULL, TRUE,  TRUE),
  ( 503,  5, 'Sorento',        'sorento',        'car', 'suv',         'D-SUV',   2002, NULL, FALSE, TRUE),
  ( 504,  5, 'Stonic',         'stonic',         'car', 'crossover',   'B-SUV',   2017, NULL, TRUE,  TRUE),
  ( 505,  5, 'Carnival',       'carnival',       'car', 'mpv',         'MPV',     1998, NULL, FALSE, TRUE),
  ( 506,  5, 'Seltos',         'seltos',         'car', 'crossover',   'C-SUV',   2019, NULL, FALSE, TRUE),
  -- Nissan
  ( 601,  6, 'Sunny',          'sunny',          'car', 'sedan',       'B',       1966, NULL, FALSE, TRUE),
  ( 602,  6, 'X-Trail',        'x-trail',        'car', 'suv',         'C-SUV',   2000, NULL, FALSE, TRUE),
  ( 603,  6, 'Patrol',         'patrol',         'car', 'suv',         'F-SUV',   1951, NULL, TRUE,  TRUE),
  ( 604,  6, 'Navara',         'navara',         'car', 'pickup',      'Pickup',  1997, NULL, FALSE, TRUE),
  ( 605,  6, 'Note',           'note',           'car', 'hatchback',   'B',       2004, NULL, FALSE, TRUE),
  ( 606,  6, 'Dayz',           'dayz',           'car', 'micro',       'Kei',     2013, NULL, FALSE, TRUE),
  -- Mitsubishi
  ( 701,  7, 'Lancer',         'lancer',         'car', 'sedan',       'C',       1973, 2017, FALSE, TRUE),
  ( 702,  7, 'Pajero',         'pajero',         'car', 'suv',         'E-SUV',   1982, NULL, TRUE,  TRUE),
  ( 703,  7, 'Outlander',      'outlander',      'car', 'crossover',   'C-SUV',   2001, NULL, FALSE, TRUE),
  ( 704,  7, 'L200',           'l200',           'car', 'pickup',      'Pickup',  1978, NULL, FALSE, TRUE),
  ( 705,  7, 'Mirage',         'mirage',         'car', 'hatchback',   'A',       1978, NULL, FALSE, TRUE),
  -- Mazda
  ( 801,  8, 'Mazda3',         'mazda3',         'car', 'sedan',       'C',       2003, NULL, FALSE, TRUE),
  ( 802,  8, 'Mazda6',         'mazda6',         'car', 'sedan',       'D',       2002, NULL, FALSE, TRUE),
  ( 803,  8, 'CX-5',           'cx-5',           'car', 'suv',         'C-SUV',   2012, NULL, FALSE, TRUE),
  ( 804,  8, 'CX-30',          'cx-30',          'car', 'crossover',   'B-SUV',   2019, NULL, FALSE, TRUE),
  -- Ford
  ( 901,  9, 'Focus',          'focus',          'car', 'hatchback',   'C',       1998, NULL, FALSE, TRUE),
  ( 902,  9, 'Mustang',        'mustang',        'car', 'coupe',       'Sports',  1964, NULL, TRUE,  TRUE),
  ( 903,  9, 'Ranger',         'ranger',         'car', 'pickup',      'Pickup',  1983, NULL, TRUE,  TRUE),
  ( 904,  9, 'Explorer',       'explorer',       'car', 'suv',         'D-SUV',   1990, NULL, FALSE, TRUE),
  ( 905,  9, 'Transit',        'transit',        'van', 'minivan',     'Van',     1965, NULL, FALSE, TRUE),
  -- Chevrolet
  (1001, 10, 'Cruze',          'cruze',          'car', 'sedan',       'C',       2008, NULL, FALSE, TRUE),
  (1002, 10, 'Malibu',         'malibu',         'car', 'sedan',       'D',       1964, NULL, FALSE, TRUE),
  (1003, 10, 'Tahoe',          'tahoe',          'car', 'suv',         'F-SUV',   1994, NULL, FALSE, TRUE),
  (1004, 10, 'Silverado',      'silverado',      'car', 'pickup',      'Pickup',  1998, NULL, FALSE, TRUE),
  -- Volkswagen
  (1101, 11, 'Golf',           'golf',           'car', 'hatchback',   'C',       1974, NULL, TRUE,  TRUE),
  (1102, 11, 'Passat',         'passat',         'car', 'sedan',       'D',       1973, NULL, FALSE, TRUE),
  (1103, 11, 'Tiguan',         'tiguan',         'car', 'suv',         'C-SUV',   2007, NULL, FALSE, TRUE),
  (1104, 11, 'Polo',           'polo',           'car', 'hatchback',   'B',       1975, NULL, FALSE, TRUE),
  (1105, 11, 'Transporter',    'transporter',    'van', 'minivan',     'Van',     1950, NULL, FALSE, TRUE),
  -- Audi
  (1201, 12, 'A3',             'a3',             'car', 'hatchback',   'C',       1996, NULL, FALSE, TRUE),
  (1202, 12, 'A4',             'a4',             'car', 'sedan',       'D',       1994, NULL, TRUE,  TRUE),
  (1203, 12, 'A6',             'a6',             'car', 'sedan',       'E',       1994, NULL, FALSE, TRUE),
  (1204, 12, 'Q5',             'q5',             'car', 'suv',         'D-SUV',   2008, NULL, FALSE, TRUE),
  (1205, 12, 'Q7',             'q7',             'car', 'suv',         'E-SUV',   2005, NULL, FALSE, TRUE),
  -- BMW
  (1301, 13, '3 Series',       '3-series',       'car', 'sedan',       'D',       1975, NULL, TRUE,  TRUE),
  (1302, 13, '5 Series',       '5-series',       'car', 'sedan',       'E',       1972, NULL, TRUE,  TRUE),
  (1303, 13, 'X3',             'x3',             'car', 'suv',         'D-SUV',   2003, NULL, FALSE, TRUE),
  (1304, 13, 'X5',             'x5',             'car', 'suv',         'E-SUV',   1999, NULL, TRUE,  TRUE),
  (1305, 13, '7 Series',       '7-series',       'car', 'sedan',       'F',       1977, NULL, FALSE, TRUE),
  -- Mercedes-Benz
  (1401, 14, 'C-Class',        'c-class',        'car', 'sedan',       'D',       1993, NULL, TRUE,  TRUE),
  (1402, 14, 'E-Class',        'e-class',        'car', 'sedan',       'E',       1953, NULL, TRUE,  TRUE),
  (1403, 14, 'S-Class',        's-class',        'car', 'sedan',       'F',       1972, NULL, TRUE,  TRUE),
  (1404, 14, 'GLC',            'glc',            'car', 'suv',         'D-SUV',   2015, NULL, FALSE, TRUE),
  (1405, 14, 'GLE',            'gle',            'car', 'suv',         'E-SUV',   1997, NULL, FALSE, TRUE),
  (1406, 14, 'Sprinter',       'sprinter',       'van', 'minivan',     'Van',     1995, NULL, FALSE, TRUE),
  -- Porsche
  (1501, 15, '911',            '911',            'car', 'coupe',       'Sports',  1964, NULL, FALSE, TRUE),
  (1502, 15, 'Cayenne',        'cayenne',        'car', 'suv',         'E-SUV',   2002, NULL, FALSE, TRUE),
  (1503, 15, 'Macan',          'macan',          'car', 'suv',         'D-SUV',   2014, NULL, FALSE, TRUE),
  -- Volvo
  (1601, 16, 'XC60',           'xc60',           'car', 'suv',         'D-SUV',   2008, NULL, FALSE, TRUE),
  (1602, 16, 'XC90',           'xc90',           'car', 'suv',         'E-SUV',   2002, NULL, FALSE, TRUE),
  (1603, 16, 'S60',            's60',            'car', 'sedan',       'D',       2000, NULL, FALSE, TRUE),
  -- Peugeot
  (1701, 17, '208',            '208',            'car', 'hatchback',   'B',       2012, NULL, FALSE, TRUE),
  (1702, 17, '2008',           '2008',           'car', 'crossover',   'B-SUV',   2013, NULL, FALSE, TRUE),
  (1703, 17, '3008',           '3008',           'car', 'crossover',   'C-SUV',   2008, NULL, FALSE, TRUE),
  -- Renault
  (1801, 18, 'Duster',         'duster',         'car', 'crossover',   'B-SUV',   2010, NULL, FALSE, TRUE),
  (1802, 18, 'Kwid',           'kwid',           'car', 'hatchback',   'A',       2015, NULL, FALSE, TRUE),
  (1803, 18, 'Clio',           'clio',           'car', 'hatchback',   'B',       1990, NULL, FALSE, TRUE),
  -- Fiat
  (1901, 19, '500',            '500',            'car', 'hatchback',   'A',       2007, NULL, FALSE, TRUE),
  (1902, 19, 'Punto',          'punto',          'car', 'hatchback',   'B',       1993, NULL, FALSE, TRUE),
  -- Jeep
  (2001, 20, 'Wrangler',       'wrangler',       'car', 'suv',         'D-SUV',   1986, NULL, FALSE, TRUE),
  (2002, 20, 'Grand Cherokee', 'grand-cherokee', 'car', 'suv',         'E-SUV',   1992, NULL, FALSE, TRUE),
  (2003, 20, 'Compass',        'compass',        'car', 'crossover',   'C-SUV',   2006, NULL, FALSE, TRUE),
  -- Land Rover
  (2101, 21, 'Range Rover',    'range-rover',    'car', 'suv',         'F-SUV',   1970, NULL, TRUE,  TRUE),
  (2102, 21, 'Defender',       'defender',       'car', 'suv',         'E-SUV',   1983, NULL, FALSE, TRUE),
  (2103, 21, 'Discovery',      'discovery',      'car', 'suv',         'E-SUV',   1989, NULL, FALSE, TRUE),
  -- Jaguar
  (2201, 22, 'XE',             'xe',             'car', 'sedan',       'D',       2015, NULL, FALSE, TRUE),
  (2202, 22, 'F-Pace',         'f-pace',         'car', 'suv',         'D-SUV',   2016, NULL, FALSE, TRUE),
  -- Lexus
  (2301, 23, 'ES',             'es',             'car', 'sedan',       'E',       1989, NULL, FALSE, TRUE),
  (2302, 23, 'RX',             'rx',             'car', 'suv',         'D-SUV',   1998, NULL, TRUE,  TRUE),
  (2303, 23, 'LX',             'lx',             'car', 'suv',         'F-SUV',   1996, NULL, TRUE,  TRUE),
  -- Infiniti
  (2401, 24, 'Q50',            'q50',            'car', 'sedan',       'D',       2013, NULL, FALSE, TRUE),
  (2402, 24, 'QX80',           'qx80',           'car', 'suv',         'F-SUV',   2010, NULL, FALSE, TRUE),
  -- Tesla
  (2501, 25, 'Model 3',        'model-3',        'car', 'sedan',       'D',       2017, NULL, TRUE,  TRUE),
  (2502, 25, 'Model Y',        'model-y',        'car', 'crossover',   'D-SUV',   2020, NULL, TRUE,  TRUE),
  (2503, 25, 'Model S',        'model-s',        'car', 'sedan',       'F',       2012, NULL, FALSE, TRUE),
  (2504, 25, 'Model X',        'model-x',        'car', 'suv',         'E-SUV',   2015, NULL, FALSE, TRUE),
  -- BYD
  (2601, 26, 'Atto 3',         'atto-3',         'car', 'crossover',   'C-SUV',   2022, NULL, TRUE,  TRUE),
  (2602, 26, 'Seal',           'seal',           'car', 'sedan',       'D',       2022, NULL, TRUE,  TRUE),
  (2603, 26, 'Dolphin',        'dolphin',        'car', 'hatchback',   'B',       2021, NULL, FALSE, TRUE),
  -- MG
  (2701, 27, 'HS',             'hs',             'car', 'suv',         'C-SUV',   2018, NULL, TRUE,  TRUE),
  (2702, 27, 'ZS',             'zs',             'car', 'crossover',   'B-SUV',   2017, NULL, TRUE,  TRUE),
  (2703, 27, 'MG 5',           'mg-5',           'car', 'sedan',       'C',       2020, NULL, FALSE, TRUE),
  -- Changan
  (2801, 28, 'Alsvin',         'alsvin',         'car', 'sedan',       'B',       2018, NULL, TRUE,  TRUE),
  (2802, 28, 'Oshan X7',       'oshan-x7',       'car', 'suv',         'C-SUV',   2019, NULL, TRUE,  TRUE),
  (2803, 28, 'Karvaan',        'karvaan',        'van', 'minivan',     'Van',     2019, NULL, FALSE, TRUE),
  -- Haval
  (2901, 29, 'H6',             'h6',             'car', 'suv',         'C-SUV',   2011, NULL, TRUE,  TRUE),
  (2902, 29, 'Jolion',         'jolion',         'car', 'crossover',   'B-SUV',   2020, NULL, TRUE,  TRUE),
  -- Chery
  (3001, 30, 'Tiggo 4 Pro',    'tiggo-4-pro',    'car', 'crossover',   'B-SUV',   2021, NULL, FALSE, TRUE),
  (3002, 30, 'Tiggo 8 Pro',    'tiggo-8-pro',    'car', 'suv',         'D-SUV',   2020, NULL, FALSE, TRUE),
  -- Proton
  (3101, 31, 'Saga',           'saga',           'car', 'sedan',       'B',       1985, NULL, FALSE, TRUE),
  (3102, 31, 'X70',            'x70',            'car', 'suv',         'C-SUV',   2018, NULL, FALSE, TRUE),
  -- Isuzu
  (3201, 32, 'D-Max',          'd-max',          'car',   'pickup',    'Pickup',  2002, NULL, TRUE,  TRUE),
  (3202, 32, 'NPR',            'npr',            'truck', NULL,        'LCV',     1959, NULL, FALSE, TRUE),
  (3203, 32, 'FVR',            'fvr',            'truck', NULL,        'HCV',     1984, NULL, FALSE, TRUE),
  -- Hino
  (3301, 33, '300 Series',     '300-series',     'truck', NULL,        'LCV',     1964, NULL, TRUE,  TRUE),
  (3302, 33, '500 Series',     '500-series',     'truck', NULL,        'MCV',     1981, NULL, FALSE, TRUE),
  -- Tata
  (3401, 34, 'Nexon',          'nexon',          'car',   'crossover', 'B-SUV',   2017, NULL, TRUE,  TRUE),
  (3402, 34, 'Ace',            'ace',            'truck', NULL,        'LCV',     2005, NULL, TRUE,  TRUE),
  (3403, 34, 'Starbus',        'starbus',        'bus',   NULL,        'Bus',     2007, NULL, FALSE, TRUE),
  -- Mahindra
  (3501, 35, 'Scorpio',        'scorpio',        'car',     'suv',     'D-SUV',   2002, NULL, TRUE,  TRUE),
  (3502, 35, 'Thar',           'thar',           'car',     'suv',     'C-SUV',   2010, NULL, TRUE,  TRUE),
  (3503, 35, 'Bolero',         'bolero',         'car',     'suv',     'C-SUV',   2000, NULL, FALSE, TRUE),
  (3504, 35, '575 DI',         '575-di',         'tractor', NULL,      'Tractor', 1990, NULL, TRUE,  TRUE),
  -- Maruti Suzuki
  (3601, 36, 'Alto K10',       'alto-k10',       'car', 'hatchback',   'A',       2010, NULL, TRUE,  TRUE),
  (3602, 36, 'Swift',          'swift',          'car', 'hatchback',   'B',       2005, NULL, TRUE,  TRUE),
  (3603, 36, 'Baleno',         'baleno',         'car', 'hatchback',   'B',       2015, NULL, TRUE,  TRUE),
  (3604, 36, 'Dzire',          'dzire',          'car', 'sedan',       'B',       2008, NULL, TRUE,  TRUE),
  (3605, 36, 'Brezza',         'brezza',         'car', 'crossover',   'B-SUV',   2016, NULL, TRUE,  TRUE),
  (3606, 36, 'Ertiga',         'ertiga',         'car', 'mpv',         'MPV',     2012, NULL, TRUE,  TRUE),
  -- Yamaha
  (3701, 37, 'YBR 125',        'ybr-125',        'motorcycle', NULL,   'Commuter',2008, NULL, TRUE,  TRUE),
  (3702, 37, 'YBR 125G',       'ybr-125g',       'motorcycle', NULL,   'Standard',2016, NULL, TRUE,  TRUE),
  (3703, 37, 'YZF-R3',         'yzf-r3',         'motorcycle', NULL,   'Sport',   2015, NULL, FALSE, TRUE),
  (3704, 37, 'FZ-S',           'fz-s',           'motorcycle', NULL,   'Standard',2008, NULL, FALSE, TRUE),
  -- Kawasaki
  (3801, 38, 'Ninja 400',      'ninja-400',      'motorcycle', NULL,   'Sport',   2018, NULL, FALSE, TRUE),
  (3802, 38, 'Z900',           'z900',           'motorcycle', NULL,   'Naked',   2017, NULL, FALSE, TRUE),
  -- Ducati
  (3901, 39, 'Monster',        'monster',        'motorcycle', NULL,   'Naked',   1993, NULL, FALSE, TRUE),
  (3902, 39, 'Panigale V2',    'panigale-v2',    'motorcycle', NULL,   'Sport',   2020, NULL, FALSE, TRUE),
  -- Harley-Davidson
  (4001, 40, 'Iron 883',       'iron-883',       'motorcycle', NULL,   'Cruiser', 2009, NULL, FALSE, TRUE),
  (4002, 40, 'Street Glide',   'street-glide',   'motorcycle', NULL,   'Tourer',  1998, NULL, FALSE, TRUE),
  -- Royal Enfield
  (4101, 41, 'Classic 350',    'classic-350',    'motorcycle', NULL,   'Cruiser', 2009, NULL, TRUE,  TRUE),
  (4102, 41, 'Himalayan',      'himalayan',      'motorcycle', NULL,   'Adventure',2016,NULL, TRUE,  TRUE),
  (4103, 41, 'Hunter 350',     'hunter-350',     'motorcycle', NULL,   'Roadster',2022, NULL, FALSE, TRUE),
  -- Bajaj
  (4201, 42, 'Pulsar 150',     'pulsar-150',     'motorcycle', NULL,   'Standard',2001, NULL, TRUE,  TRUE),
  (4202, 42, 'Pulsar NS200',   'pulsar-ns200',   'motorcycle', NULL,   'Naked',   2012, NULL, FALSE, TRUE),
  (4203, 42, 'RE Compact',     're-compact',     'rickshaw',   NULL,   'Auto',    1998, NULL, TRUE,  TRUE),
  -- Hero
  (4301, 43, 'Splendor Plus',  'splendor-plus',  'motorcycle', NULL,   'Commuter',1994, NULL, TRUE,  TRUE),
  (4302, 43, 'HF Deluxe',      'hf-deluxe',      'motorcycle', NULL,   'Commuter',2006, NULL, TRUE,  TRUE),
  -- TVS
  (4401, 44, 'Apache RTR 160', 'apache-rtr-160', 'motorcycle', NULL,   'Standard',2007, NULL, FALSE, TRUE),
  (4402, 44, 'Jupiter',        'jupiter',        'motorcycle', NULL,   'Scooter', 2013, NULL, FALSE, TRUE),
  -- KTM
  (4501, 45, 'Duke 200',       'duke-200',       'motorcycle', NULL,   'Naked',   2012, NULL, FALSE, TRUE),
  (4502, 45, 'RC 390',         'rc-390',         'motorcycle', NULL,   'Sport',   2014, NULL, FALSE, TRUE),
  -- Vespa
  (4601, 46, 'Primavera 150',  'primavera-150',  'motorcycle', NULL,   'Scooter', 2013, NULL, FALSE, TRUE),
  -- United
  (4701, 47, 'US 70',          'us-70',          'motorcycle', NULL,   'Commuter',2002, NULL, TRUE,  TRUE),
  (4702, 47, 'US 125',         'us-125',         'motorcycle', NULL,   'Commuter',2010, NULL, FALSE, TRUE),
  -- Road Prince
  (4801, 48, 'RP 70',          'rp-70',          'motorcycle', NULL,   'Commuter',2005, NULL, TRUE,  TRUE),
  (4802, 48, 'Wego 150',       'wego-150',       'motorcycle', NULL,   'Scooter', 2018, NULL, FALSE, TRUE),
  -- Massey Ferguson
  (4901, 49, 'MF 240',         'mf-240',         'tractor', NULL,      'Tractor', 1980, NULL, TRUE,  TRUE),
  (4902, 49, 'MF 385',         'mf-385',         'tractor', NULL,      'Tractor', 1985, NULL, TRUE,  TRUE),
  -- John Deere
  (5001, 50, '5050D',          '5050d',          'tractor', NULL,      'Tractor', 2010, NULL, TRUE,  TRUE),
  (5002, 50, '5310',           '5310',           'tractor', NULL,      'Tractor', 2012, NULL, FALSE, TRUE),
  -- New Holland
  (5101, 51, 'Ghazi 65',       'ghazi-65',       'tractor', NULL,      'Tractor', 1995, NULL, TRUE,  TRUE),
  (5102, 51, 'TD 80',          'td-80',          'tractor', NULL,      'Tractor', 2005, NULL, FALSE, TRUE),
  -- Caterpillar
  (5201, 52, '320 Excavator',  '320-excavator',  'heavy_machinery', NULL, 'Excavator', 1995, NULL, TRUE,  TRUE),
  (5202, 52, 'D6 Dozer',       'd6-dozer',       'heavy_machinery', NULL, 'Dozer',     1959, NULL, FALSE, TRUE),
  -- Komatsu
  (5301, 53, 'PC200',          'pc200',          'heavy_machinery', NULL, 'Excavator', 1990, NULL, FALSE, TRUE),
  -- JCB
  (5401, 54, '3DX Backhoe',    '3dx-backhoe',    'construction_equipment', NULL, 'Backhoe', 1980, NULL, TRUE,  TRUE),
  (5402, 54, 'JS205',          'js205',          'construction_equipment', NULL, 'Excavator',2005, NULL, FALSE, TRUE),
  -- Yanmar
  (5501, 55, 'YM 357',         'ym-357',         'tractor', NULL,      'Tractor', 1985, NULL, FALSE, TRUE),
  -- Kubota
  (5601, 56, 'L4508',          'l4508',          'tractor', NULL,      'Tractor', 2015, NULL, FALSE, TRUE),
  -- Sea-Ray
  (5701, 57, 'SPX 210',        'spx-210',        'boat',  NULL,        'Bowrider',2016, NULL, FALSE, TRUE),
  (5702, 57, 'Sundancer 320',  'sundancer-320',  'yacht', NULL,        'Cruiser', 2015, NULL, FALSE, TRUE),
  -- Yamaha Marine
  (5801, 58, 'VX Cruiser',     'vx-cruiser',     'jet_ski', NULL,      'Runabout',2015, NULL, FALSE, TRUE),
  (5802, 58, 'FX SVHO',        'fx-svho',        'jet_ski', NULL,      'Performance',2014,NULL,FALSE, TRUE)
ON DUPLICATE KEY UPDATE
  make_id = VALUES(make_id), name = VALUES(name), slug = VALUES(slug),
  vehicle_type = VALUES(vehicle_type), body_type = VALUES(body_type), segment = VALUES(segment),
  production_start = VALUES(production_start), production_end = VALUES(production_end),
  is_popular = VALUES(is_popular), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 7. Vehicle variants — the reference spec sheet. These numbers are what the
--    §15 compare table renders side by side and what the AI comparison reasons
--    over when a user picks 3 or 4 cars, so they are real published figures for
--    the launch markets rather than placeholders. launch_price is quoted in PKR
--    because Pakistan is market #1 and it doubles as the depreciation baseline.
-- -----------------------------------------------------------------------------
INSERT INTO vehicle_variants (model_id, name, slug, year_from, year_to, engine_cc, engine_type, cylinders, power_hp, torque_nm, fuel_type, transmission, drivetrain, seats, doors, mileage_city, mileage_highway, fuel_tank_l, battery_kwh, range_km, top_speed_kmh, acceleration_0_100, length_mm, width_mm, height_mm, wheelbase_mm, ground_clearance_mm, kerb_weight_kg, boot_space_l, payload_kg, towing_kg, airbags, safety_rating, launch_price, launch_currency, is_active) VALUES
  -- Toyota Corolla
  ( 101, 'Altis Grande 1.8 CVT', 'altis-grande-1-8-cvt', 2020, NULL, 1798, 'Inline-4 DOHC Dual VVT-i', 4, 138, 173, 'petrol', 'cvt',    'fwd', 5, 4, 13.50, 17.00, 55.0, NULL, NULL, 180, 10.50, 4630, 1780, 1435, 2700, 145, 1310, 470, NULL, NULL,  7, 5.0,  6299000.00, 'PKR', TRUE),
  ( 101, 'Altis 1.6 CVT',        'altis-1-6-cvt',        2020, NULL, 1598, 'Inline-4 DOHC Dual VVT-i', 4, 121, 154, 'petrol', 'cvt',    'fwd', 5, 4, 13.00, 16.50, 55.0, NULL, NULL, 180, 11.90, 4630, 1780, 1435, 2700, 145, 1290, 470, NULL, NULL,  3, 5.0,  5699000.00, 'PKR', TRUE),
  ( 101, 'GLi 1.6 MT',           'gli-1-6-mt',           2020, NULL, 1598, 'Inline-4 DOHC Dual VVT-i', 4, 121, 154, 'petrol', 'manual', 'fwd', 5, 4, 14.00, 17.50, 55.0, NULL, NULL, 180, 11.50, 4630, 1780, 1435, 2700, 145, 1265, 470, NULL, NULL,  3, 5.0,  5199000.00, 'PKR', TRUE),
  ( 101, 'XLi 1.6 MT',           'xli-1-6-mt',           2020, NULL, 1598, 'Inline-4 DOHC Dual VVT-i', 4, 121, 154, 'petrol', 'manual', 'fwd', 5, 4, 14.00, 17.50, 55.0, NULL, NULL, 180, 11.80, 4630, 1780, 1435, 2700, 145, 1250, 470, NULL, NULL,  2, 4.0,  4799000.00, 'PKR', TRUE),
  -- Toyota Yaris
  ( 102, 'ATIV X CVT 1.5',       'ativ-x-cvt-1-5',       2020, NULL, 1496, 'Inline-4 DOHC Dual VVT-i', 4, 106, 140, 'petrol', 'cvt',    'fwd', 5, 4, 15.00, 18.50, 42.0, NULL, NULL, 175, 11.50, 4425, 1730, 1475, 2550, 140, 1105, 476, NULL, NULL,  7, 5.0,  5099000.00, 'PKR', TRUE),
  ( 102, 'ATIV CVT 1.3',         'ativ-cvt-1-3',         2020, NULL, 1329, 'Inline-4 DOHC Dual VVT-i', 4,  98, 123, 'petrol', 'cvt',    'fwd', 5, 4, 15.50, 19.00, 42.0, NULL, NULL, 170, 13.00, 4425, 1730, 1475, 2550, 140, 1075, 476, NULL, NULL,  3, 4.0,  4699000.00, 'PKR', TRUE),
  ( 102, 'GLI MT 1.3',           'gli-mt-1-3',           2020, NULL, 1329, 'Inline-4 DOHC Dual VVT-i', 4,  98, 123, 'petrol', 'manual', 'fwd', 5, 4, 16.50, 20.00, 42.0, NULL, NULL, 170, 12.50, 4425, 1730, 1475, 2550, 140, 1050, 476, NULL, NULL,  2, 4.0,  4349000.00, 'PKR', TRUE),
  -- Toyota Fortuner
  ( 104, '2.8 Sigma 4 AT',       '2-8-sigma-4-at',       2021, NULL, 2755, 'Inline-4 Turbo Diesel',    4, 201, 500, 'diesel', 'automatic', '4wd', 7, 5, 10.50, 13.00, 80.0, NULL, NULL, 180, 10.00, 4795, 1855, 1835, 2745, 220, 2185, 296, NULL, 3100,  7, 5.0, 18999000.00, 'PKR', TRUE),
  ( 104, '2.4 G AT',             '2-4-g-at',             2021, NULL, 2393, 'Inline-4 Turbo Diesel',    4, 148, 400, 'diesel', 'automatic', 'rwd', 7, 5, 11.50, 14.00, 80.0, NULL, NULL, 170, 12.50, 4795, 1855, 1835, 2745, 220, 2035, 296, NULL, 2800,  3, 5.0, 16499000.00, 'PKR', TRUE),
  ( 104, '2.7 VVTi AT',          '2-7-vvti-at',          2021, NULL, 2694, 'Inline-4 DOHC VVT-i',      4, 164, 245, 'petrol', 'automatic', 'rwd', 7, 5,  8.50, 11.00, 80.0, NULL, NULL, 175, 11.50, 4795, 1855, 1835, 2745, 220, 2050, 296, NULL, 2500,  3, 5.0, 15499000.00, 'PKR', TRUE),
  -- Toyota Hilux
  ( 105, 'Revo V 2.8 AT',        'revo-v-2-8-at',        2021, NULL, 2755, 'Inline-4 Turbo Diesel',    4, 201, 500, 'diesel', 'automatic', '4wd', 5, 4, 11.00, 13.50, 80.0, NULL, NULL, 175, 10.70, 5325, 1855, 1815, 3085, 286, 2115, NULL, 1000, 3200,  7, 5.0, 17299000.00, 'PKR', TRUE),
  ( 105, 'Revo G 2.8 MT',        'revo-g-2-8-mt',        2021, NULL, 2755, 'Inline-4 Turbo Diesel',    4, 201, 420, 'diesel', 'manual',    '4wd', 5, 4, 12.00, 14.50, 80.0, NULL, NULL, 175, 11.50, 5325, 1855, 1815, 3085, 286, 2050, NULL, 1000, 3200,  3, 5.0, 15999000.00, 'PKR', TRUE),
  ( 105, 'Single Cab 2.4 MT',    'single-cab-2-4-mt',    2021, NULL, 2393, 'Inline-4 Turbo Diesel',    4, 148, 343, 'diesel', 'manual',    'rwd', 3, 2, 12.50, 15.00, 80.0, NULL, NULL, 165, 14.00, 5265, 1800, 1795, 3085, 286, 1815, NULL, 1240, 2500,  2, 4.0,  9999000.00, 'PKR', TRUE),
  -- Toyota Land Cruiser
  ( 106, 'ZX 3.5 Twin Turbo AT', 'zx-3-5-twin-turbo-at', 2022, NULL, 3444, 'V6 Twin Turbo Petrol',     6, 409, 650, 'petrol', 'automatic', '4wd', 7, 5,  7.00,  9.50, 110.0, NULL, NULL, 210,  6.70, 4985, 1980, 1925, 2850, 230, 2530, 130, NULL, 3500, 10, 5.0, 89999000.00, 'PKR', TRUE),
  ( 106, 'GR-J 3.3 Diesel AT',   'gr-j-3-3-diesel-at',   2022, NULL, 3346, 'V6 Twin Turbo Diesel',     6, 305, 700, 'diesel', 'automatic', '4wd', 7, 5,  9.50, 12.50, 110.0, NULL, NULL, 210,  6.90, 4985, 1980, 1925, 2850, 230, 2560, 130, NULL, 3500, 10, 5.0, 84999000.00, 'PKR', TRUE),
  -- Honda Civic
  ( 201, 'RS 1.5 Turbo CVT',     'rs-1-5-turbo-cvt',     2022, NULL, 1498, 'Inline-4 VTEC Turbo',      4, 178, 240, 'petrol', 'cvt',    'fwd', 5, 4, 12.00, 16.00, 47.0, NULL, NULL, 220,  8.20, 4674, 1800, 1416, 2735, 133, 1350, 519, NULL, NULL,  6, 5.0,  9999000.00, 'PKR', TRUE),
  ( 201, 'Oriel 1.8 CVT',        'oriel-1-8-cvt',        2022, NULL, 1799, 'Inline-4 i-VTEC',          4, 141, 174, 'petrol', 'cvt',    'fwd', 5, 4, 13.00, 17.00, 47.0, NULL, NULL, 200, 10.80, 4674, 1800, 1416, 2735, 133, 1300, 519, NULL, NULL,  6, 5.0,  8499000.00, 'PKR', TRUE),
  ( 201, 'VTi 1.8 CVT',          'vti-1-8-cvt',          2022, NULL, 1799, 'Inline-4 i-VTEC',          4, 141, 174, 'petrol', 'cvt',    'fwd', 5, 4, 13.50, 17.50, 47.0, NULL, NULL, 200, 11.00, 4674, 1800, 1416, 2735, 133, 1280, 519, NULL, NULL,  4, 5.0,  7999000.00, 'PKR', TRUE),
  -- Honda City
  ( 202, 'Aspire 1.5 CVT',       'aspire-1-5-cvt',       2021, NULL, 1497, 'Inline-4 i-VTEC',          4, 119, 145, 'petrol', 'cvt',    'fwd', 5, 4, 15.00, 18.50, 40.0, NULL, NULL, 180, 11.00, 4553, 1748, 1467, 2600, 165, 1120, 506, NULL, NULL,  6, 5.0,  5899000.00, 'PKR', TRUE),
  ( 202, '1.2 CVT',              '1-2-cvt',              2021, NULL, 1199, 'Inline-4 i-VTEC',          4,  89, 110, 'petrol', 'cvt',    'fwd', 5, 4, 15.50, 19.00, 40.0, NULL, NULL, 170, 14.00, 4553, 1748, 1467, 2600, 165, 1075, 506, NULL, NULL,  2, 4.0,  5199000.00, 'PKR', TRUE),
  ( 202, '1.2 MT',               '1-2-mt',               2021, NULL, 1199, 'Inline-4 i-VTEC',          4,  89, 110, 'petrol', 'manual', 'fwd', 5, 4, 16.50, 20.00, 40.0, NULL, NULL, 170, 13.50, 4553, 1748, 1467, 2600, 165, 1050, 506, NULL, NULL,  2, 4.0,  4899000.00, 'PKR', TRUE),
  -- Honda BR-V
  ( 204, '1.5 i-VTEC CVT',       '1-5-i-vtec-cvt',       2022, NULL, 1497, 'Inline-4 i-VTEC',          4, 118, 145, 'petrol', 'cvt',    'fwd', 7, 5, 13.00, 16.50, 42.0, NULL, NULL, 175, 12.50, 4453, 1735, 1666, 2662, 201, 1225, 223, NULL, NULL,  6, 5.0,  7199000.00, 'PKR', TRUE),
  ( 204, '1.5 i-VTEC MT',        '1-5-i-vtec-mt',        2022, NULL, 1497, 'Inline-4 i-VTEC',          4, 118, 145, 'petrol', 'manual', 'fwd', 7, 5, 14.00, 17.50, 42.0, NULL, NULL, 175, 11.80, 4453, 1735, 1666, 2662, 201, 1200, 223, NULL, NULL,  2, 4.0,  6699000.00, 'PKR', TRUE),
  -- Suzuki Alto
  ( 301, 'VXL AGS 660',          'vxl-ags-660',          2019, NULL,  658, 'Inline-3 DOHC R06A',       3,  39,  56, 'petrol', 'amt',    'fwd', 4, 5, 18.00, 21.50, 27.0, NULL, NULL, 140, 18.00, 3395, 1475, 1490, 2345, 170,  665, 129, NULL, NULL,  2, 3.0,  3099000.00, 'PKR', TRUE),
  ( 301, 'VXR 660 MT',           'vxr-660-mt',           2019, NULL,  658, 'Inline-3 DOHC R06A',       3,  39,  56, 'petrol', 'manual', 'fwd', 4, 5, 19.00, 22.50, 27.0, NULL, NULL, 140, 17.00, 3395, 1475, 1490, 2345, 170,  650, 129, NULL, NULL,  2, 3.0,  2699000.00, 'PKR', TRUE),
  ( 301, 'VX 660 MT',            'vx-660-mt',            2019, NULL,  658, 'Inline-3 DOHC R06A',       3,  39,  56, 'petrol', 'manual', 'fwd', 4, 5, 19.50, 23.00, 27.0, NULL, NULL, 140, 17.50, 3395, 1475, 1490, 2345, 170,  640, 129, NULL, NULL,  0, 2.0,  2399000.00, 'PKR', TRUE),
  -- Suzuki Cultus
  ( 302, 'VXL 1.0 MT',           'vxl-1-0-mt',           2017, NULL,  998, 'Inline-3 DOHC K10B',       3,  67,  90, 'petrol', 'manual', 'fwd', 5, 5, 16.00, 19.50, 35.0, NULL, NULL, 155, 13.50, 3765, 1650, 1510, 2430, 170,  880, 254, NULL, NULL,  2, 3.0,  3899000.00, 'PKR', TRUE),
  ( 302, 'AGS 1.0',              'ags-1-0',              2018, NULL,  998, 'Inline-3 DOHC K10B',       3,  67,  90, 'petrol', 'amt',    'fwd', 5, 5, 15.50, 19.00, 35.0, NULL, NULL, 155, 14.50, 3765, 1650, 1510, 2430, 170,  895, 254, NULL, NULL,  2, 3.0,  4199000.00, 'PKR', TRUE),
  -- Suzuki Swift
  ( 303, 'GLX CVT 1.2',          'glx-cvt-1-2',          2022, NULL, 1197, 'Inline-4 DOHC K12M',       4,  82, 113, 'petrol', 'cvt',    'fwd', 5, 5, 17.00, 21.00, 37.0, NULL, NULL, 165, 12.50, 3845, 1735, 1495, 2450, 163,  900, 265, NULL, NULL,  6, 4.0,  5399000.00, 'PKR', TRUE),
  ( 303, 'GL MT 1.2',            'gl-mt-1-2',            2022, NULL, 1197, 'Inline-4 DOHC K12M',       4,  82, 113, 'petrol', 'manual', 'fwd', 5, 5, 18.00, 22.00, 37.0, NULL, NULL, 165, 11.90, 3845, 1735, 1495, 2450, 163,  875, 265, NULL, NULL,  2, 4.0,  4499000.00, 'PKR', TRUE),
  -- Suzuki Wagon R
  ( 304, 'VXL 1.0 MT',           'vxl-1-0-mt',           2014, NULL,  998, 'Inline-3 DOHC K10B',       3,  67,  90, 'petrol', 'manual', 'fwd', 5, 5, 16.50, 20.00, 35.0, NULL, NULL, 150, 14.50, 3600, 1475, 1670, 2400, 165,  830, 180, NULL, NULL,  2, 3.0,  3699000.00, 'PKR', TRUE),
  ( 304, 'AGS 1.0',              'ags-1-0',              2019, NULL,  998, 'Inline-3 DOHC K10B',       3,  67,  90, 'petrol', 'amt',    'fwd', 5, 5, 16.00, 19.50, 35.0, NULL, NULL, 150, 15.50, 3600, 1475, 1670, 2400, 165,  845, 180, NULL, NULL,  2, 3.0,  3999000.00, 'PKR', TRUE),
  -- Hyundai Tucson
  ( 402, '1.6 T-GDi AWD',        '1-6-t-gdi-awd',        2021, NULL, 1598, 'Inline-4 GDi Turbo',       4, 177, 265, 'petrol', 'dct',       'awd', 5, 5, 12.00, 15.50, 54.0, NULL, NULL, 200,  9.10, 4630, 1865, 1665, 2755, 181, 1600, 620, NULL, 1600,  6, 5.0, 13499000.00, 'PKR', TRUE),
  ( 402, '2.0 AT FWD',           '2-0-at-fwd',           2020, NULL, 1999, 'Inline-4 MPi Nu',          4, 155, 192, 'petrol', 'automatic', 'fwd', 5, 5, 11.00, 14.50, 62.0, NULL, NULL, 190, 11.00, 4630, 1865, 1665, 2755, 181, 1520, 620, NULL, 1400,  6, 5.0, 10999000.00, 'PKR', TRUE),
  -- Kia Sportage
  ( 501, 'AWD 2.0 AT',           'awd-2-0-at',           2020, NULL, 1999, 'Inline-4 MPi Nu',          4, 155, 196, 'petrol', 'automatic', 'awd', 5, 5, 10.50, 13.50, 62.0, NULL, NULL, 190, 11.50, 4660, 1865, 1660, 2755, 182, 1610, 591, NULL, 1600,  6, 5.0, 11999000.00, 'PKR', TRUE),
  ( 501, 'Alpha 2.0 AT',         'alpha-2-0-at',         2020, NULL, 1999, 'Inline-4 MPi Nu',          4, 155, 196, 'petrol', 'automatic', 'fwd', 5, 5, 11.50, 14.50, 62.0, NULL, NULL, 190, 11.20, 4660, 1865, 1660, 2755, 182, 1510, 591, NULL, 1400,  2, 5.0,  9999000.00, 'PKR', TRUE),
  -- Kia Picanto
  ( 502, '1.0 AT',               '1-0-at',               2019, NULL,  998, 'Inline-3 DOHC Kappa',      3,  68,  94, 'petrol', 'automatic', 'fwd', 5, 5, 15.00, 18.00, 35.0, NULL, NULL, 160, 14.50, 3595, 1595, 1485, 2400, 152,  935, 255, NULL, NULL,  2, 3.0,  3899000.00, 'PKR', TRUE),
  ( 502, '1.0 MT',               '1-0-mt',               2019, NULL,  998, 'Inline-3 DOHC Kappa',      3,  68,  94, 'petrol', 'manual',    'fwd', 5, 5, 16.00, 19.50, 35.0, NULL, NULL, 160, 13.50, 3595, 1595, 1485, 2400, 152,  910, 255, NULL, NULL,  2, 3.0,  3499000.00, 'PKR', TRUE),
  -- Tesla Model 3 (electric reference for the compare screen)
  (2501, 'Long Range AWD',       'long-range-awd',       2023, NULL, NULL, 'Dual Permanent Magnet',  NULL, 394, 493, 'electric', 'automatic', 'awd', 5, 4, NULL, NULL, NULL, 79.00, 629, 201,  4.40, 4720, 1933, 1441, 2875, 138, 1828, 594, NULL, 1000,  8, 5.0, 19999000.00, 'PKR', TRUE),
  (2501, 'Rear-Wheel Drive',     'rear-wheel-drive',     2023, NULL, NULL, 'Single Permanent Magnet',NULL, 279, 420, 'electric', 'automatic', 'rwd', 5, 4, NULL, NULL, NULL, 57.50, 513, 201,  6.10, 4720, 1933, 1441, 2875, 138, 1765, 594, NULL,  750,  8, 5.0, 16999000.00, 'PKR', TRUE),
  -- Honda CG 125
  ( 210, 'CG 125 Standard',      'cg-125-standard',      2019, NULL,  124, 'Single Cylinder OHV',      1,  11,   9, 'petrol', 'manual', 'rwd', 2, 0, 45.00, 50.00,  9.2, NULL, NULL, 100, NULL, 1912,  736, 1041, 1206, 140,  106, NULL, NULL, NULL, 0, NULL,  234900.00, 'PKR', TRUE),
  ( 210, 'CG 125 Special',       'cg-125-special',       2021, NULL,  124, 'Single Cylinder OHV',      1,  11,   9, 'petrol', 'manual', 'rwd', 2, 0, 45.00, 50.00,  9.2, NULL, NULL, 100, NULL, 1912,  736, 1041, 1206, 140,  108, NULL, NULL, NULL, 0, NULL,  254900.00, 'PKR', TRUE),
  -- Yamaha YBR 125
  (3701, 'YBR 125',              'ybr-125',              2018, NULL,  124, 'Single Cylinder SOHC',     1,  11,  10, 'petrol', 'manual', 'rwd', 2, 0, 40.00, 45.00, 13.0, NULL, NULL, 110, NULL, 1980,  745, 1080, 1290, 155,  118, NULL, NULL, NULL, 0, NULL,  391000.00, 'PKR', TRUE),
  (3701, 'YBR 125Z DX',          'ybr-125z-dx',          2021, NULL,  124, 'Single Cylinder SOHC',     1,  11,  10, 'petrol', 'manual', 'rwd', 2, 0, 40.00, 45.00, 13.0, NULL, NULL, 110, NULL, 1980,  745, 1080, 1290, 155,  120, NULL, NULL, NULL, 0, NULL,  428000.00, 'PKR', TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), year_from = VALUES(year_from), year_to = VALUES(year_to),
  engine_cc = VALUES(engine_cc), engine_type = VALUES(engine_type), cylinders = VALUES(cylinders),
  power_hp = VALUES(power_hp), torque_nm = VALUES(torque_nm), fuel_type = VALUES(fuel_type),
  transmission = VALUES(transmission), drivetrain = VALUES(drivetrain), seats = VALUES(seats),
  doors = VALUES(doors), mileage_city = VALUES(mileage_city), mileage_highway = VALUES(mileage_highway),
  fuel_tank_l = VALUES(fuel_tank_l), battery_kwh = VALUES(battery_kwh), range_km = VALUES(range_km),
  top_speed_kmh = VALUES(top_speed_kmh), acceleration_0_100 = VALUES(acceleration_0_100),
  length_mm = VALUES(length_mm), width_mm = VALUES(width_mm), height_mm = VALUES(height_mm),
  wheelbase_mm = VALUES(wheelbase_mm), ground_clearance_mm = VALUES(ground_clearance_mm),
  kerb_weight_kg = VALUES(kerb_weight_kg), boot_space_l = VALUES(boot_space_l),
  payload_kg = VALUES(payload_kg), towing_kg = VALUES(towing_kg), airbags = VALUES(airbags),
  safety_rating = VALUES(safety_rating), launch_price = VALUES(launch_price),
  launch_currency = VALUES(launch_currency), is_active = VALUES(is_active);
