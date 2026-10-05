-- =============================================================================
-- 10  Vehicle marketplace reference data (idempotent)
--     Category rules, fuels, transmissions, conditions, rental durations,
--     inspection checklists, parts categories, trade rules, notifications.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

UPDATE marketplaces
   SET operations = '["buy","sell","rent","auction"]',
       tagline = 'Buy, sell, rent and auction vehicles worldwide',
       config = JSON_SET(
         COALESCE(config, '{}'),
         '$.allowsAuction', TRUE,
         '$.partsMarketplace', TRUE,
         '$.importExport', TRUE,
         '$.comparison', TRUE,
         '$.priceEstimate', TRUE
       )
 WHERE id = 3;

UPDATE categories
   SET operations = JSON_ARRAY('buy','sell','rent','auction')
 WHERE marketplace_id = 3
   AND JSON_CONTAINS(operations, JSON_QUOTE('sell'));

UPDATE categories
   SET is_leaf = FALSE
 WHERE id = 336;

INSERT INTO categories (id, marketplace_id, parent_id, code, name, slug, path, depth, icon, operations, group_code, is_leaf, is_active, sort_order) VALUES
  (338, 3, 336, 'oem_parts',          'OEM Parts',          'oem-parts',          '/336/338/', 1, 'cog',     '["buy","sell"]', 'parts', TRUE, TRUE, 1),
  (339, 3, 336, 'aftermarket_parts',  'Aftermarket',        'aftermarket',        '/336/339/', 1, 'cog',     '["buy","sell"]', 'parts', TRUE, TRUE, 2),
  (340, 3, 336, 'used_parts',         'Used Parts',         'used-parts',         '/336/340/', 1, 'recycle', '["buy","sell"]', 'parts', TRUE, TRUE, 3),
  (341, 3, 336, 'refurbished_parts',  'Refurbished',        'refurbished-parts',  '/336/341/', 1, 'wrench',  '["buy","sell"]', 'parts', TRUE, TRUE, 4),
  (342, 3, 336, 'tires_parts',        'Tires',              'tires',              '/336/342/', 1, 'circle',  '["buy","sell"]', 'parts', TRUE, TRUE, 5),
  (343, 3, 336, 'batteries_parts',    'Batteries',          'batteries',          '/336/343/', 1, 'battery', '["buy","sell"]', 'parts', TRUE, TRUE, 6),
  (344, 3, 336, 'lubricants_parts',   'Lubricants',         'lubricants',         '/336/344/', 1, 'droplet', '["buy","sell"]', 'parts', TRUE, TRUE, 7),
  (345, 3, 336, 'tools_parts',        'Tools',              'tools',              '/336/345/', 1, 'hammer',  '["buy","sell"]', 'parts', TRUE, TRUE, 8),
  (346, 3, 336, 'performance_parts',  'Performance Parts',  'performance-parts',  '/336/346/', 1, 'gauge',   '["buy","sell"]', 'parts', TRUE, TRUE, 9)
ON DUPLICATE KEY UPDATE
  parent_id = VALUES(parent_id), code = VALUES(code), name = VALUES(name), slug = VALUES(slug),
  path = VALUES(path), operations = VALUES(operations), is_leaf = VALUES(is_leaf), is_active = VALUES(is_active);

INSERT INTO vehicle_category_rules
  (vehicle_type, category_code, group_code, allowed_operations, requires_make_model, requires_mileage, uses_engine_hours, is_marine, is_machinery, is_active, sort_order)
VALUES
  ('car',                     'cars',                   'passenger',   '["buy","sell","rent","auction"]', TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE, 10),
  ('motorcycle',              'motorcycles',            'two_wheeler', '["buy","sell","rent","auction"]', TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE, 20),
  ('bus',                     'buses',                  'commercial',  '["buy","sell","rent","auction"]', TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE, 30),
  ('truck',                   'trucks',                 'commercial',  '["buy","sell","rent","auction"]', TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE, 40),
  ('van',                     'vans',                   'commercial',  '["buy","sell","rent","auction"]', TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE, 50),
  ('taxi',                    'taxi',                   'passenger',   '["buy","sell","rent","auction"]', TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE, 60),
  ('rickshaw',                'rickshaw',               'commercial',  '["buy","sell","rent","auction"]', TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE, 70),
  ('heavy_machinery',         'heavy_machinery',        'machinery',   '["buy","sell","rent","auction"]', FALSE, FALSE, TRUE,  FALSE, TRUE,  TRUE, 80),
  ('construction_equipment',  'construction_equipment', 'machinery',   '["buy","sell","rent","auction"]', FALSE, FALSE, TRUE,  FALSE, TRUE,  TRUE, 90),
  ('agriculture_equipment',   'agriculture_equipment',  'agriculture', '["buy","sell","rent","auction"]', FALSE, FALSE, TRUE,  FALSE, TRUE,  TRUE, 100),
  ('boat',                    'boats',                  'marine',      '["buy","sell","rent","auction"]', FALSE, FALSE, FALSE, TRUE,  FALSE, TRUE, 110),
  ('yacht',                   'yachts',                 'marine',      '["buy","sell","rent","auction"]', FALSE, FALSE, FALSE, TRUE,  FALSE, TRUE, 120),
  ('jet_ski',                 'jet_ski',                'marine',      '["buy","sell","rent","auction"]', FALSE, FALSE, FALSE, TRUE,  FALSE, TRUE, 130),
  ('tractor',                 'tractors',               'agriculture', '["buy","sell","rent","auction"]', FALSE, FALSE, TRUE,  FALSE, TRUE,  TRUE, 140),
  ('atv',                     'atv_quad',               'recreation',  '["buy","sell","rent","auction"]', TRUE,  TRUE,  FALSE, FALSE, FALSE, TRUE, 150),
  ('trailer',                 'trailers',               'trailer',     '["buy","sell","rent","auction"]', FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, 160)
ON DUPLICATE KEY UPDATE
  category_code = VALUES(category_code),
  allowed_operations = VALUES(allowed_operations),
  requires_make_model = VALUES(requires_make_model),
  requires_mileage = VALUES(requires_mileage),
  uses_engine_hours = VALUES(uses_engine_hours),
  is_marine = VALUES(is_marine),
  is_machinery = VALUES(is_machinery),
  is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);

INSERT INTO vehicle_fuel_types (code, name, is_electric, is_active, sort_order) VALUES
  ('petrol', 'Petrol', FALSE, TRUE, 10),
  ('diesel', 'Diesel', FALSE, TRUE, 20),
  ('hybrid', 'Hybrid', FALSE, TRUE, 30),
  ('plugin_hybrid', 'Plug-in Hybrid', TRUE, TRUE, 40),
  ('electric', 'Electric', TRUE, TRUE, 50),
  ('cng', 'CNG', FALSE, TRUE, 60),
  ('lpg', 'LPG', FALSE, TRUE, 70),
  ('hydrogen', 'Hydrogen', FALSE, TRUE, 80),
  ('other', 'Other', FALSE, TRUE, 90)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_electric = VALUES(is_electric), is_active = VALUES(is_active);

INSERT INTO vehicle_transmission_types (code, name, is_active, sort_order) VALUES
  ('manual', 'Manual', TRUE, 10),
  ('automatic', 'Automatic', TRUE, 20),
  ('cvt', 'CVT', TRUE, 30),
  ('amt', 'AMT', TRUE, 40),
  ('dct', 'DCT', TRUE, 50),
  ('semi_automatic', 'Semi-automatic', TRUE, 60)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO vehicle_drive_types (code, name, is_active, sort_order) VALUES
  ('fwd', 'Front-wheel drive', TRUE, 10),
  ('rwd', 'Rear-wheel drive', TRUE, 20),
  ('awd', 'All-wheel drive', TRUE, 30),
  ('4wd', 'Four-wheel drive', TRUE, 40)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO vehicle_condition_codes (code, name, is_legal_sale, is_active, sort_order) VALUES
  ('new', 'New', TRUE, TRUE, 10),
  ('used', 'Used', TRUE, TRUE, 20),
  ('certified_used', 'Certified used', TRUE, TRUE, 30),
  ('damaged', 'Damaged', TRUE, TRUE, 40),
  ('salvage', 'Salvage', TRUE, TRUE, 50),
  ('restored', 'Restored', TRUE, TRUE, 60),
  ('classic', 'Classic', TRUE, TRUE, 70),
  ('antique', 'Antique', TRUE, TRUE, 80),
  ('refurbished', 'Refurbished', TRUE, TRUE, 90),
  ('rebuilt', 'Rebuilt', TRUE, TRUE, 100)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_legal_sale = VALUES(is_legal_sale), is_active = VALUES(is_active);

INSERT INTO vehicle_mileage_units (code, name, to_km, is_active, sort_order) VALUES
  ('km', 'Kilometres', 1.0000000000, TRUE, 10),
  ('mi', 'Miles', 1.6093400000, TRUE, 20),
  ('hours', 'Engine hours', 1.0000000000, TRUE, 30)
ON DUPLICATE KEY UPDATE name = VALUES(name), to_km = VALUES(to_km), is_active = VALUES(is_active);

INSERT INTO vehicle_rental_durations (code, name, duration_days, is_active, sort_order) VALUES
  ('daily', 'Daily', 1, TRUE, 10),
  ('weekly', 'Weekly', 7, TRUE, 20),
  ('monthly', 'Monthly', 30, TRUE, 30),
  ('long_term', 'Long-term', 90, TRUE, 40),
  ('custom', 'Custom', NULL, TRUE, 50)
ON DUPLICATE KEY UPDATE name = VALUES(name), duration_days = VALUES(duration_days), is_active = VALUES(is_active);

INSERT INTO vehicle_document_types (code, name, is_private, is_active, sort_order) VALUES
  ('title', 'Title', TRUE, TRUE, 10),
  ('registration', 'Registration', TRUE, TRUE, 20),
  ('bill_of_sale', 'Bill of sale', TRUE, TRUE, 30),
  ('invoice', 'Purchase invoice', TRUE, TRUE, 40),
  ('certificate_of_origin', 'Certificate of origin', TRUE, TRUE, 50),
  ('export_certificate', 'Export certificate', TRUE, TRUE, 60),
  ('import_permit', 'Import permit', TRUE, TRUE, 70),
  ('customs_declaration', 'Customs declaration', TRUE, TRUE, 80),
  ('inspection_certificate', 'Inspection certificate', TRUE, TRUE, 90),
  ('insurance', 'Insurance', TRUE, TRUE, 100),
  ('bill_of_lading', 'Bill of lading', TRUE, TRUE, 110),
  ('commercial_invoice', 'Commercial invoice', TRUE, TRUE, 120),
  ('shipping', 'Shipping documents', TRUE, TRUE, 130),
  ('vin_photo', 'VIN photo', TRUE, TRUE, 140),
  ('other', 'Other', TRUE, TRUE, 150)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_private = VALUES(is_private), is_active = VALUES(is_active);

INSERT INTO vehicle_shipping_modes (code, name, is_active, sort_order) VALUES
  ('roro', 'Roll-on / roll-off', TRUE, 10),
  ('container', 'Container', TRUE, 20),
  ('vehicle_carrier', 'Vehicle carrier', TRUE, 30),
  ('land_transport', 'Land transport', TRUE, 40),
  ('port_to_port', 'Port to port', TRUE, 50),
  ('door_to_door', 'Door to door', TRUE, 60)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO vehicle_part_categories (code, name, parent_code, is_active, sort_order) VALUES
  ('oem', 'OEM Parts', NULL, TRUE, 10),
  ('aftermarket', 'Aftermarket', NULL, TRUE, 20),
  ('used', 'Used Parts', NULL, TRUE, 30),
  ('refurbished', 'Refurbished', NULL, TRUE, 40),
  ('accessories', 'Accessories', NULL, TRUE, 50),
  ('tires', 'Tires', NULL, TRUE, 60),
  ('batteries', 'Batteries', NULL, TRUE, 70),
  ('lubricants', 'Lubricants', NULL, TRUE, 80),
  ('tools', 'Tools', NULL, TRUE, 90),
  ('performance', 'Performance Parts', NULL, TRUE, 100)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = VALUES(is_active);

INSERT INTO vehicle_inspection_checklists (code, name, applies_to, is_active, sort_order) VALUES
  ('car', 'Car / light vehicle', '["car","taxi","van","motorcycle","rickshaw"]', TRUE, 10),
  ('machinery', 'Machinery', '["heavy_machinery","construction_equipment","agriculture_equipment","tractor"]', TRUE, 20),
  ('boat', 'Marine', '["boat","yacht","jet_ski"]', TRUE, 30)
ON DUPLICATE KEY UPDATE name = VALUES(name), applies_to = VALUES(applies_to), is_active = VALUES(is_active);

INSERT INTO vehicle_inspection_checklist_items (checklist_code, item_code, name, group_code, sort_order) VALUES
  ('car', 'engine', 'Engine', 'mechanical', 10),
  ('car', 'transmission', 'Transmission', 'mechanical', 20),
  ('car', 'brakes', 'Brakes', 'safety', 30),
  ('car', 'suspension', 'Suspension', 'mechanical', 40),
  ('car', 'steering', 'Steering', 'safety', 50),
  ('car', 'tires', 'Tires', 'condition', 60),
  ('car', 'body', 'Body', 'condition', 70),
  ('car', 'paint', 'Paint', 'condition', 80),
  ('car', 'chassis', 'Chassis', 'structure', 90),
  ('car', 'electrical', 'Electrical', 'electrical', 100),
  ('car', 'ac', 'Air conditioning', 'comfort', 110),
  ('car', 'interior', 'Interior', 'condition', 120),
  ('car', 'safety', 'Safety systems', 'safety', 130),
  ('car', 'odometer', 'Odometer', 'identity', 140),
  ('car', 'vin', 'VIN', 'identity', 150),
  ('car', 'documents', 'Documents', 'identity', 160),
  ('machinery', 'engine_hours', 'Engine hours', 'usage', 10),
  ('machinery', 'hydraulics', 'Hydraulics', 'mechanical', 20),
  ('machinery', 'hydraulic_pump', 'Hydraulic pump', 'mechanical', 30),
  ('machinery', 'transmission', 'Transmission', 'mechanical', 40),
  ('machinery', 'structure', 'Structure', 'structure', 50),
  ('machinery', 'undercarriage', 'Undercarriage', 'structure', 60),
  ('machinery', 'safety_system', 'Safety system', 'safety', 70),
  ('machinery', 'attachments', 'Attachments', 'equipment', 80),
  ('boat', 'hull', 'Hull', 'structure', 10),
  ('boat', 'engine', 'Engine', 'mechanical', 20),
  ('boat', 'propulsion', 'Propulsion', 'mechanical', 30),
  ('boat', 'electrical', 'Electrical', 'electrical', 40),
  ('boat', 'navigation', 'Navigation', 'safety', 50),
  ('boat', 'safety', 'Safety', 'safety', 60),
  ('boat', 'fuel_system', 'Fuel system', 'mechanical', 70)
ON DUPLICATE KEY UPDATE name = VALUES(name), group_code = VALUES(group_code), sort_order = VALUES(sort_order);

INSERT INTO vehicle_features (code, name, icon, group_code, is_filterable, is_comparable, sort_order, is_active) VALUES
  ('sunroof', 'Sunroof', 'sun', 'exterior', TRUE, TRUE, 10, TRUE),
  ('panoramic_roof', 'Panoramic roof', 'sun', 'exterior', TRUE, TRUE, 20, TRUE),
  ('led_headlights', 'LED headlights', 'lightbulb', 'exterior', TRUE, TRUE, 30, TRUE),
  ('alloy_wheels', 'Alloy wheels', 'circle', 'exterior', TRUE, TRUE, 40, TRUE),
  ('leather', 'Leather', 'armchair', 'interior', TRUE, TRUE, 50, TRUE),
  ('heated_seats', 'Heated seats', 'flame', 'comfort', TRUE, TRUE, 60, TRUE),
  ('ventilated_seats', 'Ventilated seats', 'wind', 'comfort', TRUE, TRUE, 70, TRUE),
  ('digital_dashboard', 'Digital dashboard', 'monitor', 'technology', TRUE, TRUE, 80, TRUE),
  ('abs', 'ABS', 'shield', 'safety', TRUE, TRUE, 90, TRUE),
  ('airbags', 'Airbags', 'shield', 'safety', TRUE, TRUE, 100, TRUE),
  ('esc', 'ESC', 'shield', 'safety', TRUE, TRUE, 110, TRUE),
  ('adas', 'ADAS', 'cpu', 'assistance', TRUE, TRUE, 120, TRUE),
  ('lane_assist', 'Lane assist', 'git-commit', 'assistance', TRUE, TRUE, 130, TRUE),
  ('blind_spot', 'Blind spot monitoring', 'eye', 'assistance', TRUE, TRUE, 140, TRUE),
  ('collision_warning', 'Collision warning', 'alert-triangle', 'assistance', TRUE, TRUE, 150, TRUE),
  ('parking_sensors', 'Parking sensors', 'radio', 'assistance', TRUE, TRUE, 160, TRUE),
  ('camera', 'Camera', 'camera', 'assistance', TRUE, TRUE, 170, TRUE),
  ('apple_carplay', 'Apple CarPlay', 'smartphone', 'entertainment', TRUE, TRUE, 180, TRUE),
  ('android_auto', 'Android Auto', 'smartphone', 'entertainment', TRUE, TRUE, 190, TRUE),
  ('navigation', 'Navigation', 'map', 'entertainment', TRUE, TRUE, 200, TRUE),
  ('bluetooth', 'Bluetooth', 'bluetooth', 'entertainment', TRUE, TRUE, 210, TRUE),
  ('wireless_charging', 'Wireless charging', 'battery-charging', 'technology', TRUE, TRUE, 220, TRUE),
  ('digital_key', 'Digital key', 'key', 'technology', TRUE, TRUE, 230, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), group_code = VALUES(group_code), is_active = VALUES(is_active);

INSERT INTO vehicle_trade_rules
  (origin_country_id, destination_country_id, version, effective_from, max_vehicle_age_years,
   emission_requirement, safety_requirement, hand_drive, inspection_required, registration_required,
   duty_rate_pct, import_tax_pct, required_documents, restrictions, notes, is_active)
SELECT o.id, d.id, 1, '2026-01-01',
       CASE WHEN d.iso2 IN ('PK','IN') THEN 5 ELSE 15 END,
       'Destination emission standard at time of import',
       'Destination safety standard at time of import',
       'either', TRUE, TRUE,
       10.0000, 5.0000,
       JSON_ARRAY('invoice','title','certificate_of_origin','export_certificate','bill_of_lading','inspection_certificate'),
       JSON_OBJECT('note','Rules are versioned. Never assume a corridor is permanently open.'),
       'Seed corridor only. Confirm current legal requirements before a live shipment.',
       TRUE
FROM countries o
JOIN countries d ON d.id <> o.id
WHERE o.id BETWEEN 1 AND 6 AND d.id BETWEEN 1 AND 6
ON DUPLICATE KEY UPDATE notes = VALUES(notes), is_active = VALUES(is_active);

INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, sort_order, is_active) VALUES
  ('vehicle.offer',         'Vehicle offers',          'Offer, counter-offer and acceptance',     'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 400, TRUE),
  ('vehicle.listing',       'Vehicle listing status',  'Listing published, sold or updated',      'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 401, TRUE),
  ('vehicle.document',      'Vehicle documents',       'Document verification updates',           'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 402, TRUE),
  ('vehicle.rental',        'Vehicle rentals',         'Booking and availability updates',        'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 403, TRUE),
  ('vehicle.auction',       'Vehicle auctions',        'Auction start, ending and settlement',    'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 404, TRUE),
  ('vehicle.payment',       'Vehicle payments',        'Purchase, deposit and rental payments',   'vehicles', TRUE, TRUE,  FALSE, TRUE, TRUE,  405, TRUE),
  ('vehicle.search',        'Saved vehicle alerts',    'New matches, price drops and stock',      'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 406, TRUE),
  ('vehicle.verification',  'Vehicle verification',    'VIN, ownership and inspection results',   'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 407, TRUE),
  ('vehicle.trade',         'Import / export',         'Trade, customs and shipment updates',     'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 408, TRUE),
  ('vehicle.parts',         'Parts availability',      'Parts back in stock and compatibility',   'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 409, TRUE),
  ('vehicle.reminder',      'Vehicle reminders',       'Service, registration and insurance',     'vehicles', TRUE, FALSE, FALSE, TRUE, FALSE, 410, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_active = VALUES(is_active);

INSERT INTO notification_templates
  (category_code, channel, language, title, body, action_url, variables, is_active, version) VALUES
  ('vehicle.offer',        'in_app', 'en', 'Vehicle offer update',     '{{summary}}', '/listing/{{listingId}}', '["summary","listingId"]', TRUE, 1),
  ('vehicle.search',       'in_app', 'en', 'New vehicle match',        '{{title}} matches “{{name}}”.', '/listing/{{listingId}}', '["title","name","listingId"]', TRUE, 1),
  ('vehicle.auction',      'in_app', 'en', 'Auction update',           '{{summary}}', '/listing/{{listingId}}', '["summary","listingId"]', TRUE, 1),
  ('vehicle.rental',       'in_app', 'en', 'Rental update',            '{{summary}}', '/listing/{{listingId}}', '["summary","listingId"]', TRUE, 1),
  ('vehicle.trade',        'in_app', 'en', 'Shipment update',          '{{summary}}', '/listing/{{listingId}}', '["summary","listingId"]', TRUE, 1),
  ('vehicle.parts',        'in_app', 'en', 'Parts update',             '{{summary}}', '/vehicles/parts', '["summary"]', TRUE, 1)
ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), is_active = VALUES(is_active);

INSERT INTO features (code, name, description, unit, is_metered, reset_period, sort_order) VALUES
  ('vehicle_saved_searches', 'Vehicle saved searches', 'Saved searches and price alerts', 'count', FALSE, 'none', 50),
  ('vehicle_valuation',      'Vehicle valuation tools', 'AI valuation assistance', 'boolean', FALSE, 'none', 51),
  ('vehicle_dealer_inventory','Dealer inventory', 'Bulk dealer inventory tools', 'boolean', FALSE, 'none', 52),
  ('vehicle_leads',          'Vehicle lead management', 'CRM / leads inbox', 'boolean', FALSE, 'none', 53),
  ('vehicle_trade',          'Import / export workflow', 'International vehicle trade', 'boolean', FALSE, 'none', 54)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled) VALUES
  (1, 'vehicle_saved_searches', 5,  FALSE, TRUE),
  (1, 'vehicle_valuation',      NULL, FALSE, TRUE),
  (1, 'vehicle_dealer_inventory', NULL, FALSE, FALSE),
  (1, 'vehicle_leads',          NULL, FALSE, FALSE),
  (1, 'vehicle_trade',          NULL, FALSE, TRUE),
  (2, 'vehicle_saved_searches', 25, FALSE, TRUE),
  (2, 'vehicle_valuation',      NULL, FALSE, TRUE),
  (2, 'vehicle_dealer_inventory', NULL, FALSE, TRUE),
  (2, 'vehicle_leads',          NULL, FALSE, TRUE),
  (2, 'vehicle_trade',          NULL, FALSE, TRUE)
ON DUPLICATE KEY UPDATE
  limit_value = VALUES(limit_value),
  is_unlimited = VALUES(is_unlimited),
  is_enabled = VALUES(is_enabled);

INSERT INTO scheduled_jobs (code, name, cron, is_enabled) VALUES
  ('vehicle.maintenance',        'Vehicle offers, rentals, documents and reminders', '*/15 * * * *', TRUE),
  ('vehicle.analytics.rollup',   'Vehicle listing analytics rollup',                 '0 */6 * * *', TRUE),
  ('vehicle.shipments.track',    'Poll shipment adapters',                           '*/10 * * * *', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), cron = VALUES(cron), is_enabled = VALUES(is_enabled);

INSERT INTO sort_options (id, marketplace_id, code, label, sort_field, direction, applies_to, requires_location, is_default, sort_order, is_active) VALUES
  (35, 3, 'best_deal',       'Best value vs market', 'vehicle_listing_details.price_vs_market_pct', 'asc',  'listings', FALSE, FALSE, 35, TRUE),
  (36, 3, 'inspection_desc', 'Highest inspection',   'vehicle_listing_details.inspection_score',    'desc', 'listings', FALSE, FALSE, 36, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), sort_field = VALUES(sort_field), direction = VALUES(direction), is_active = VALUES(is_active);
