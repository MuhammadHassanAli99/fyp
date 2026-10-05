-- =============================================================================
-- 04  Dynamic attribute schema: attributes, options, category bindings
--     This one table set drives four screens at once — the create-listing form,
--     the filter panel (§10), the sort menu and the compare table (§15).
--     Satisfies §5 Specifications, §6 Property Features, §7 Specifications,
--     §10 Filters (incl. Verified Seller / Premium Seller).
--     Attribute ids are pinned: 1000 global, 1100 gold, 1200 property, 1300
--     vehicles. `unit_code` is descriptive (cc/hp/kWh) and only carries a
--     measurement_units code when `unit_group` is a convertible dimension.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1a. GLOBAL attributes (marketplace_id NULL) — apply in all three modules
-- -----------------------------------------------------------------------------
INSERT INTO attributes (id, marketplace_id, code, label, help_text, data_type, input_type, unit_code, unit_group, is_required, is_filterable, is_sortable, is_comparable, is_searchable, show_in_card, validation, default_value, filter_widget, sort_order, is_active) VALUES
  (1000, NULL, 'condition',          'Condition',          'Overall state of the item',                     'enum',    'select',   NULL, 'none', FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL, NULL, 'checkbox_list', 10, TRUE),
  (1001, NULL, 'warranty',           'Warranty',           'Item is still covered by a warranty',           'boolean', 'switch',   NULL, 'none', FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL, '0',  'toggle',        20, TRUE),
  (1002, NULL, 'delivery_available', 'Delivery available', 'Seller can deliver or ship',                    'boolean', 'switch',   NULL, 'none', FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, NULL, '0',  'toggle',        30, TRUE),
  (1003, NULL, 'negotiable',         'Negotiable',         'Price is open to offers',                       'boolean', 'switch',   NULL, 'none', FALSE, TRUE,  FALSE, FALSE, FALSE, TRUE,  NULL, '0',  'toggle',        40, TRUE),
  (1004, NULL, 'verified_seller',    'Verified seller',    'Only listings from identity-verified sellers',   'boolean', 'switch',   NULL, 'none', FALSE, TRUE,  FALSE, FALSE, FALSE, TRUE,  NULL, '0',  'toggle',        50, TRUE),
  (1005, NULL, 'premium_seller',     'Premium seller',     'Only listings from subscribed premium sellers',  'boolean', 'switch',   NULL, 'none', FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, NULL, '0',  'toggle',        60, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), help_text = VALUES(help_text), data_type = VALUES(data_type),
  input_type = VALUES(input_type), unit_code = VALUES(unit_code), unit_group = VALUES(unit_group),
  is_required = VALUES(is_required), is_filterable = VALUES(is_filterable), is_sortable = VALUES(is_sortable),
  is_comparable = VALUES(is_comparable), is_searchable = VALUES(is_searchable), show_in_card = VALUES(show_in_card),
  validation = VALUES(validation), default_value = VALUES(default_value),
  filter_widget = VALUES(filter_widget), sort_order = VALUES(sort_order), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 1b. GOLD attributes (§5 Purity / Karat / Weight / Brand / Certificate /
--     Hallmark / Making Charges)
-- -----------------------------------------------------------------------------
INSERT INTO attributes (id, marketplace_id, code, label, help_text, data_type, input_type, unit_code, unit_group, is_required, is_filterable, is_sortable, is_comparable, is_searchable, show_in_card, validation, default_value, filter_widget, sort_order, is_active) VALUES
  (1100, 1, 'karat',                 'Karat',                 'Purity expressed in karat',                       'enum',       'select',       NULL,    'none',   TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  TRUE,  NULL,                                 NULL, 'checkbox_list', 10,  TRUE),
  (1101, 1, 'fineness',              'Fineness',              'Millesimal fineness stamped on the piece',        'enum',       'select',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 20,  TRUE),
  (1102, 1, 'metal_type',            'Metal type',            'Gold, white gold, rose gold, silver, platinum',   'enum',       'select',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 'gold', 'checkbox_list', 30, TRUE),
  (1103, 1, 'weight_grams',          'Net weight',            'Pure metal content, excluding stones',            'decimal',    'number',       'gram',  'weight', TRUE,  TRUE,  TRUE,  TRUE,  FALSE, TRUE,  '{"min":0.01,"max":100000,"step":0.001}', NULL, 'range_slider', 40, TRUE),
  (1104, 1, 'gross_weight',          'Gross weight',          'Total weight including stones and findings',      'decimal',    'number',       'gram',  'weight', FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0.01,"max":100000,"step":0.001}', NULL, 'none',        50, TRUE),
  (1105, 1, 'stone_weight',          'Stone weight',          'Combined weight of all stones',                   'decimal',    'number',       'gram',  'weight', FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":10000,"step":0.001}',  NULL, 'none',           60, TRUE),
  (1106, 1, 'form',                  'Form',                  'Bar, coin, jewellery, scrap and so on',           'enum',       'select',       NULL,    'none',   TRUE,  TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 NULL, 'checkbox_list', 70,  TRUE),
  (1107, 1, 'jewellery_type',        'Jewellery type',        'Ring, bangle, necklace and so on',                'enum',       'select',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  TRUE,  FALSE, NULL,                                 NULL, 'checkbox_list', 80,  TRUE),
  (1108, 1, 'hallmarked',            'Hallmarked',            'Carries an official hallmark stamp',              'boolean',    'switch',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 '0',  'toggle',        90,  TRUE),
  (1109, 1, 'certificate',           'Certificate',           'Sold with an assay or purity certificate',        'boolean',    'switch',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 '0',  'toggle',        100, TRUE),
  (1110, 1, 'certificate_authority', 'Certificate authority', 'Who issued the certificate',                      'enum',       'select',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 110, TRUE),
  (1111, 1, 'making_charges',        'Making charges',        'Labour charge on top of the metal value',         'decimal',    'number',       NULL,    'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":10000000,"step":0.01}', NULL, 'none',        120, TRUE),
  (1112, 1, 'making_charge_type',    'Making charge type',    'Flat amount, per gram, or a percentage',          'enum',       'select',       NULL,    'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'none',          130, TRUE),
  (1113, 1, 'wastage_percent',       'Wastage %',             'Wastage deduction applied by the jeweller',       'decimal',    'number',       NULL,    'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":40,"step":0.01}',     NULL, 'none',          140, TRUE),
  (1114, 1, 'gemstones',             'Has gemstones',         'Piece is set with stones',                        'boolean',    'switch',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        150, TRUE),
  (1115, 1, 'gemstone_type',         'Gemstone type',         'Which stones are set in the piece',               'multi_enum', 'multiselect',  NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  TRUE,  FALSE, NULL,                                 NULL, 'checkbox_list', 160, TRUE),
  (1116, 1, 'buyback',               'Buyback offered',       'Seller will buy the piece back',                  'boolean',    'switch',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        170, TRUE),
  (1117, 1, 'exchange_accepted',     'Exchange accepted',     'Old gold accepted against this piece',            'boolean',    'switch',       NULL,    'none',   FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, NULL,                                 '0',  'toggle',        180, TRUE),
  (1118, 1, 'investment_grade',      'Investment grade',      'Bullion-grade metal bought for investment',       'boolean',    'switch',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        190, TRUE),
  (1119, 1, 'antique',               'Antique',               'Antique or heritage piece',                       'boolean',    'switch',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        200, TRUE),
  (1120, 1, 'size_label',            'Size',                  'Ring size or chain length',                       'string',     'text',         NULL,    'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"maxLength":48}',                   NULL, 'none',          210, TRUE),
  (1121, 1, 'gender_target',         'Worn by',               'Who the piece is designed for',                   'enum',       'select',       NULL,    'none',   FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 220, TRUE),
  (1122, 1, 'purity_verified',       'Purity verified',       'Purity confirmed by an XRF or assay test',        'boolean',    'switch',       NULL,    'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 '0',  'toggle',        230, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), help_text = VALUES(help_text), data_type = VALUES(data_type),
  input_type = VALUES(input_type), unit_code = VALUES(unit_code), unit_group = VALUES(unit_group),
  is_required = VALUES(is_required), is_filterable = VALUES(is_filterable), is_sortable = VALUES(is_sortable),
  is_comparable = VALUES(is_comparable), is_searchable = VALUES(is_searchable), show_in_card = VALUES(show_in_card),
  validation = VALUES(validation), default_value = VALUES(default_value),
  filter_widget = VALUES(filter_widget), sort_order = VALUES(sort_order), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 1c. PROPERTY attributes (§6 Property Features, Documents, Rental terms)
-- -----------------------------------------------------------------------------
INSERT INTO attributes (id, marketplace_id, code, label, help_text, data_type, input_type, unit_code, unit_group, is_required, is_filterable, is_sortable, is_comparable, is_searchable, show_in_card, validation, default_value, filter_widget, sort_order, is_active) VALUES
  (1200, 2, 'bedrooms',               'Bedrooms',               NULL,                                              'integer', 'number',   NULL,   'none',   TRUE,  TRUE,  TRUE,  TRUE,  FALSE, TRUE,  '{"min":0,"max":50}',                 NULL, 'min_max',       10,  TRUE),
  (1201, 2, 'bathrooms',              'Bathrooms',              NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, TRUE,  TRUE,  TRUE,  FALSE, TRUE,  '{"min":0,"max":50}',                 NULL, 'min_max',       20,  TRUE),
  (1202, 2, 'kitchens',               'Kitchens',               NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":10}',                 NULL, 'none',          30,  TRUE),
  (1203, 2, 'drawing_rooms',          'Drawing rooms',          NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":10}',                 NULL, 'none',          40,  TRUE),
  (1204, 2, 'servant_quarters',       'Servant quarters',       NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":10}',                 NULL, 'none',          50,  TRUE),
  (1205, 2, 'store_rooms',            'Store rooms',            NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":10}',                 NULL, 'none',          60,  TRUE),
  (1206, 2, 'floors',                 'Floors in the unit',     NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":200}',                NULL, 'min_max',       70,  TRUE),
  (1207, 2, 'floor_number',           'Floor number',           'Which floor the unit sits on',                    'integer', 'number',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, '{"min":-5,"max":200}',               NULL, 'min_max',       80,  TRUE),
  (1208, 2, 'total_floors',           'Floors in the building', NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":1,"max":200}',                NULL, 'none',          90,  TRUE),
  (1209, 2, 'area',                   'Area',                   'Plot or built-up area in your preferred unit',    'decimal', 'number',   'sqm',  'area',   TRUE,  TRUE,  TRUE,  TRUE,  FALSE, TRUE,  '{"min":1,"max":100000000,"step":0.01}', NULL, 'range_slider', 100, TRUE),
  (1210, 2, 'covered_area',           'Covered area',           'Constructed area only',                           'decimal', 'number',   'sqm',  'area',   FALSE, TRUE,  TRUE,  TRUE,  FALSE, FALSE, '{"min":1,"max":100000000,"step":0.01}', NULL, 'range_slider', 110, TRUE),
  (1211, 2, 'plot_dimensions',        'Plot dimensions',        'Frontage x depth, for example 30 x 60',           'string',  'text',     NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  TRUE,  FALSE, '{"maxLength":64}',                   NULL, 'none',          120, TRUE),
  (1212, 2, 'parking_spaces',         'Parking spaces',         NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":500}',                NULL, 'min_max',       130, TRUE),
  (1213, 2, 'furnishing',             'Furnishing',             NULL,                                              'enum',    'select',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 NULL, 'checkbox_list', 140, TRUE),
  (1214, 2, 'facing',                 'Facing',                 'Direction the main entrance faces',               'enum',    'select',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 150, TRUE),
  (1215, 2, 'year_built',             'Year built',             NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, TRUE,  TRUE,  TRUE,  FALSE, FALSE, '{"min":1800,"max":2100}',            NULL, 'min_max',       160, TRUE),
  (1216, 2, 'construction_status',    'Construction status',    NULL,                                              'enum',    'select',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 NULL, 'checkbox_list', 170, TRUE),
  (1217, 2, 'ownership_type',         'Ownership type',         'Freehold, leasehold, power of attorney',          'enum',    'select',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 180, TRUE),
  (1218, 2, 'possession_status',      'Possession status',      NULL,                                              'enum',    'select',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 190, TRUE),
  (1219, 2, 'road_width',             'Road width',             'Width of the road the plot fronts, in feet',      'decimal', 'number',   'ft',   'distance', FALSE, TRUE, FALSE, TRUE, FALSE, FALSE, '{"min":0,"max":500,"step":0.5}',     NULL, 'min_max',       200, TRUE),
  (1220, 2, 'swimming_pool',          'Swimming pool',          NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        210, TRUE),
  (1221, 2, 'gym',                    'Gym',                    NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        220, TRUE),
  (1222, 2, 'garden',                 'Garden',                 NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        230, TRUE),
  (1223, 2, 'balcony',                'Balconies',              NULL,                                              'integer', 'number',   NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":50}',                 NULL, 'none',          240, TRUE),
  (1224, 2, 'elevator',               'Elevator',               NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        250, TRUE),
  (1225, 2, 'security',               'Security staff',         NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        260, TRUE),
  (1226, 2, 'cctv',                   'CCTV',                   NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        270, TRUE),
  (1227, 2, 'backup_power',           'Backup power',           'Generator or UPS backup',                         'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        280, TRUE),
  (1228, 2, 'gated_community',        'Gated community',        NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        290, TRUE),
  (1229, 2, 'corner',                 'Corner plot',            NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        300, TRUE),
  (1230, 2, 'park_facing',            'Park facing',            NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        310, TRUE),
  (1231, 2, 'rent_period',            'Rent period',            'How the rent is quoted',                          'enum',    'select',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 NULL, 'checkbox_list', 320, TRUE),
  (1232, 2, 'security_deposit',       'Security deposit',       NULL,                                              'decimal', 'number',   NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":1000000000,"step":0.01}', NULL, 'none',       330, TRUE),
  (1233, 2, 'advance_months',         'Advance months',         'Months of rent payable up front',                 'integer', 'number',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":36}',                 NULL, 'min_max',       340, TRUE),
  (1234, 2, 'maintenance_charges',    'Maintenance charges',    NULL,                                              'decimal', 'number',   NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":10000000,"step":0.01}', NULL, 'none',         350, TRUE),
  (1235, 2, 'utilities_included',     'Utilities included',     NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        360, TRUE),
  (1236, 2, 'tenant_preference',      'Tenant preference',      NULL,                                              'enum',    'select',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 370, TRUE),
  (1237, 2, 'pets_allowed',           'Pets allowed',           NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        380, TRUE),
  (1238, 2, 'occupancy_type',         'Occupancy',              'Single, shared, dormitory, whole place',           'enum',    'select',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 390, TRUE),
  (1239, 2, 'attached_bathroom',      'Attached bathroom',      NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        400, TRUE),
  (1240, 2, 'meals_included',         'Meals included',         NULL,                                              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        410, TRUE),
  (1241, 2, 'installments_available', 'Installments available', 'Payable in instalments',                          'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 '0',  'toggle',        420, TRUE),
  (1242, 2, 'ownership_papers',       'Ownership papers',       '§6 Documents: title deed available',              'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        430, TRUE),
  (1243, 2, 'noc',                    'NOC available',          'No-objection certificate from the authority',      'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        440, TRUE),
  (1244, 2, 'approved',               'Approved by authority',  '§6 Documents: approval documents on file',        'boolean', 'switch',   NULL,   'none',   FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        450, TRUE),
  (1245, 2, 'floor_load',            'Floor load capacity',    'Commercial floor loading in kg per square metre',  'decimal', 'number',   NULL,   'none',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":100000,"step":0.01}', NULL, 'none',          460, TRUE),
  (1246, 2, 'ceiling_height',        'Ceiling height',         'Clear internal height in feet',                    'decimal', 'number',   'ft',   'distance', FALSE, FALSE, FALSE, TRUE, FALSE, FALSE, '{"min":0,"max":200,"step":0.1}',     NULL, 'none',          470, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), help_text = VALUES(help_text), data_type = VALUES(data_type),
  input_type = VALUES(input_type), unit_code = VALUES(unit_code), unit_group = VALUES(unit_group),
  is_required = VALUES(is_required), is_filterable = VALUES(is_filterable), is_sortable = VALUES(is_sortable),
  is_comparable = VALUES(is_comparable), is_searchable = VALUES(is_searchable), show_in_card = VALUES(show_in_card),
  validation = VALUES(validation), default_value = VALUES(default_value),
  filter_widget = VALUES(filter_widget), sort_order = VALUES(sort_order), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 1d. VEHICLE attributes (§7 Specifications). The comparable flags here are what
--     the §15 compare table and the AI comparison read as their column set.
-- -----------------------------------------------------------------------------
INSERT INTO attributes (id, marketplace_id, code, label, help_text, data_type, input_type, unit_code, unit_group, is_required, is_filterable, is_sortable, is_comparable, is_searchable, show_in_card, validation, default_value, filter_widget, sort_order, is_active) VALUES
  (1300, 3, 'make',                'Make',                  NULL,                                            'string',  'autocomplete', NULL,   'none',     TRUE,  TRUE,  FALSE, TRUE,  TRUE,  TRUE,  NULL,                                 NULL, 'search',        10,  TRUE),
  (1301, 3, 'model',               'Model',                 NULL,                                            'string',  'autocomplete', NULL,   'none',     TRUE,  TRUE,  FALSE, TRUE,  TRUE,  TRUE,  NULL,                                 NULL, 'search',        20,  TRUE),
  (1302, 3, 'variant',             'Variant',               'Trim level, for example Altis Grande 1.8 CVT',   'string',  'autocomplete', NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  TRUE,  FALSE, NULL,                                 NULL, 'search',        30,  TRUE),
  (1303, 3, 'year',                'Year',                  'Model year',                                    'integer', 'number',       NULL,   'none',     TRUE,  TRUE,  TRUE,  TRUE,  FALSE, TRUE,  '{"min":1900,"max":2100}',            NULL, 'min_max',       40,  TRUE),
  (1304, 3, 'mileage',             'Mileage',               'Distance driven',                               'integer', 'number',       'km',   'distance', TRUE,  TRUE,  TRUE,  TRUE,  FALSE, TRUE,  '{"min":0,"max":3000000}',            NULL, 'range_slider',  50,  TRUE),
  (1305, 3, 'engine_capacity',     'Engine capacity',       'Displacement in cubic centimetres',             'integer', 'number',       'cc',   'none',     FALSE, TRUE,  TRUE,  TRUE,  FALSE, TRUE,  '{"min":25,"max":30000}',             NULL, 'range_slider',  60,  TRUE),
  (1306, 3, 'engine_power',        'Power',                 'Maximum power in horsepower',                   'integer', 'number',       'hp',   'none',     FALSE, TRUE,  TRUE,  TRUE,  FALSE, FALSE, '{"min":1,"max":3000}',               NULL, 'min_max',       70,  TRUE),
  (1307, 3, 'fuel_type',           'Fuel type',             NULL,                                            'enum',    'select',       NULL,   'none',     TRUE,  TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 NULL, 'checkbox_list', 80,  TRUE),
  (1308, 3, 'transmission',        'Transmission',          NULL,                                            'enum',    'select',       NULL,   'none',     TRUE,  TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 NULL, 'checkbox_list', 90,  TRUE),
  (1309, 3, 'drivetrain',          'Drivetrain',            NULL,                                            'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 100, TRUE),
  (1310, 3, 'body_type',           'Body type',             NULL,                                            'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 110, TRUE),
  (1311, 3, 'color_exterior',      'Exterior colour',       NULL,                                            'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 NULL, 'checkbox_list', 120, TRUE),
  (1312, 3, 'color_interior',      'Interior colour',       NULL,                                            'enum',    'select',       NULL,   'none',     FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'none',          130, TRUE),
  (1313, 3, 'doors',               'Doors',                 NULL,                                            'integer', 'number',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":10}',                 NULL, 'checkbox_list', 140, TRUE),
  (1314, 3, 'seats',               'Seats',                 NULL,                                            'integer', 'number',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, '{"min":1,"max":100}',                NULL, 'min_max',       150, TRUE),
  (1315, 3, 'registration_city',   'Registration city',     'City the vehicle is registered in',             'string',  'autocomplete', NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  TRUE,  FALSE, NULL,                                 NULL, 'search',        160, TRUE),
  (1316, 3, 'registration_status', 'Registration status',   NULL,                                            'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 170, TRUE),
  (1317, 3, 'assembly',            'Assembly',              'Locally assembled or imported',                 'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 180, TRUE),
  (1318, 3, 'owners_count',        'Previous owners',       NULL,                                            'integer', 'number',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":50}',                 NULL, 'min_max',       190, TRUE),
  (1319, 3, 'accident_history',    'Accident history',      NULL,                                            'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 200, TRUE),
  (1320, 3, 'service_history',     'Service history',       NULL,                                            'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 210, TRUE),
  (1321, 3, 'condition_grade',     'Condition grade',       NULL,                                            'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 220, TRUE),
  (1322, 3, 'inspected',           'Inspected',             'Third-party inspection completed',              'boolean', 'switch',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 '0',  'toggle',        230, TRUE),
  (1323, 3, 'inspection_score',    'Inspection score',      'Out of 100',                                    'decimal', 'number',       NULL,   'none',     FALSE, TRUE,  TRUE,  TRUE,  FALSE, TRUE,  '{"min":0,"max":100,"step":0.1}',     NULL, 'min_max',       240, TRUE),
  (1324, 3, 'battery_capacity',    'Battery capacity',      'Usable battery capacity',                       'decimal', 'number',       'kWh',  'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":1000,"step":0.1}',    NULL, 'min_max',       250, TRUE),
  (1325, 3, 'range_km',            'Electric range',        'Claimed range on a full charge',                'integer', 'number',       'km',   'distance', FALSE, TRUE,  TRUE,  TRUE,  FALSE, FALSE, '{"min":0,"max":2000}',               NULL, 'min_max',       260, TRUE),
  (1326, 3, 'top_speed',           'Top speed',             NULL,                                            'integer', 'number',       'km/h', 'none',     FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":600}',                NULL, 'none',          270, TRUE),
  (1327, 3, 'acceleration_0_100',  '0-100 km/h',            'Seconds from standstill to 100 km/h',           'decimal', 'number',       's',    'none',     FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":1,"max":60,"step":0.1}',      NULL, 'none',          280, TRUE),
  (1328, 3, 'mileage_city',        'Fuel economy (city)',   'Kilometres per litre in city driving',          'decimal', 'number',       'km/l', 'none',     FALSE, TRUE,  TRUE,  TRUE,  FALSE, TRUE,  '{"min":0,"max":100,"step":0.1}',     NULL, 'min_max',       290, TRUE),
  (1329, 3, 'fuel_tank',           'Fuel tank',             NULL,                                            'decimal', 'number',       'l',    'volume',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":2000,"step":0.1}',    NULL, 'none',          300, TRUE),
  (1330, 3, 'airbags',             'Airbags',               NULL,                                            'integer', 'number',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":20}',                 NULL, 'min_max',       310, TRUE),
  (1331, 3, 'safety_rating',       'Safety rating',         'NCAP stars out of 5',                           'decimal', 'number',       NULL,   'none',     FALSE, TRUE,  TRUE,  TRUE,  FALSE, FALSE, '{"min":0,"max":5,"step":0.5}',       NULL, 'min_max',       320, TRUE),
  (1332, 3, 'boot_space',          'Boot space',            NULL,                                            'integer', 'number',       'l',    'volume',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":10000}',              NULL, 'none',          330, TRUE),
  (1333, 3, 'ground_clearance',    'Ground clearance',      NULL,                                            'integer', 'number',       'mm',   'none',     FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":1000}',               NULL, 'none',          340, TRUE),
  (1334, 3, 'kerb_weight',         'Kerb weight',           NULL,                                            'integer', 'number',       'kg',   'weight',   FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":100000}',             NULL, 'none',          350, TRUE),
  (1335, 3, 'finance_available',   'Finance available',     'Seller offers or arranges financing',           'boolean', 'switch',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 '0',  'toggle',        360, TRUE),
  (1336, 3, 'exchange_accepted',   'Exchange accepted',     'Seller will consider a trade-in',               'boolean', 'switch',       NULL,   'none',     FALSE, TRUE,  FALSE, FALSE, FALSE, FALSE, NULL,                                 '0',  'toggle',        370, TRUE),
  (1337, 3, 'with_driver',         'With driver',           'Rental includes a driver',                      'boolean', 'switch',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 '0',  'toggle',        380, TRUE),
  (1338, 3, 'rent_period',         'Rent period',           'How the rental price is quoted',                'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, TRUE,  NULL,                                 NULL, 'checkbox_list', 390, TRUE),
  (1339, 3, 'km_limit_per_day',    'Daily km limit',        'Included kilometres per rental day',            'integer', 'number',       'km',   'distance', FALSE, FALSE, FALSE, TRUE,  FALSE, FALSE, '{"min":0,"max":5000}',               NULL, 'none',          400, TRUE),
  (1340, 3, 'insurance_status',    'Insurance status',      NULL,                                            'enum',    'select',       NULL,   'none',     FALSE, TRUE,  FALSE, TRUE,  FALSE, FALSE, NULL,                                 NULL, 'checkbox_list', 410, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), help_text = VALUES(help_text), data_type = VALUES(data_type),
  input_type = VALUES(input_type), unit_code = VALUES(unit_code), unit_group = VALUES(unit_group),
  is_required = VALUES(is_required), is_filterable = VALUES(is_filterable), is_sortable = VALUES(is_sortable),
  is_comparable = VALUES(is_comparable), is_searchable = VALUES(is_searchable), show_in_card = VALUES(show_in_card),
  validation = VALUES(validation), default_value = VALUES(default_value),
  filter_widget = VALUES(filter_widget), sort_order = VALUES(sort_order), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 2. Attribute options. Values mirror the ENUM members in the detail tables
--    (gold_listing_details, property_listing_details, vehicle_listing_details)
--    so a submitted option value can be written straight through.
-- -----------------------------------------------------------------------------
INSERT INTO attribute_options (attribute_id, value, label, sort_order, is_active) VALUES
  -- 1000 condition
  (1000, 'new',            'New',                1, TRUE),
  (1000, 'like_new',       'Like new',           2, TRUE),
  (1000, 'excellent',      'Excellent',          3, TRUE),
  (1000, 'good',           'Good',               4, TRUE),
  (1000, 'fair',           'Fair',               5, TRUE),
  (1000, 'used',           'Used',               6, TRUE),
  (1000, 'refurbished',    'Refurbished',        7, TRUE),
  -- 1100 karat
  (1100, '24K',            '24K',                1, TRUE),
  (1100, '22K',            '22K',                2, TRUE),
  (1100, '21K',            '21K',                3, TRUE),
  (1100, '18K',            '18K',                4, TRUE),
  (1100, '14K',            '14K',                5, TRUE),
  (1100, '10K',            '10K',                6, TRUE),
  (1100, '9K',             '9K',                 7, TRUE),
  -- 1101 fineness
  (1101, '999',            '999 (24K)',          1, TRUE),
  (1101, '916',            '916 (22K)',          2, TRUE),
  (1101, '875',            '875 (21K)',          3, TRUE),
  (1101, '750',            '750 (18K)',          4, TRUE),
  (1101, '585',            '585 (14K)',          5, TRUE),
  (1101, '375',            '375 (9K)',           6, TRUE),
  -- 1102 metal_type
  (1102, 'gold',           'Yellow gold',        1, TRUE),
  (1102, 'white_gold',     'White gold',         2, TRUE),
  (1102, 'rose_gold',      'Rose gold',          3, TRUE),
  (1102, 'silver',         'Silver',             4, TRUE),
  (1102, 'platinum',       'Platinum',           5, TRUE),
  (1102, 'palladium',      'Palladium',          6, TRUE),
  (1102, 'mixed',          'Mixed metals',       7, TRUE),
  -- 1106 form
  (1106, 'bar',            'Bar',                1, TRUE),
  (1106, 'coin',           'Coin',               2, TRUE),
  (1106, 'biscuit',        'Biscuit',            3, TRUE),
  (1106, 'jewellery',      'Jewellery',          4, TRUE),
  (1106, 'ornament',       'Ornament',           5, TRUE),
  (1106, 'scrap',          'Scrap',              6, TRUE),
  (1106, 'nugget',         'Nugget',             7, TRUE),
  -- 1107 jewellery_type
  (1107, 'ring',           'Ring',               1, TRUE),
  (1107, 'bangle',         'Bangle',             2, TRUE),
  (1107, 'bracelet',       'Bracelet',           3, TRUE),
  (1107, 'necklace',       'Necklace',           4, TRUE),
  (1107, 'earring',        'Earring',            5, TRUE),
  (1107, 'pendant',        'Pendant',            6, TRUE),
  (1107, 'chain',          'Chain',              7, TRUE),
  (1107, 'anklet',         'Anklet',             8, TRUE),
  (1107, 'nosepin',        'Nose pin',           9, TRUE),
  (1107, 'tikka',          'Tikka',             10, TRUE),
  (1107, 'set',            'Set',               11, TRUE),
  (1107, 'watch',          'Watch',             12, TRUE),
  (1107, 'other',          'Other',             13, TRUE),
  -- 1110 certificate_authority
  (1110, 'bis',            'BIS (India)',        1, TRUE),
  (1110, 'pgji',           'PGJI (Pakistan)',    2, TRUE),
  (1110, 'sgl',            'SGL',                3, TRUE),
  (1110, 'igi',            'IGI',                4, TRUE),
  (1110, 'gia',            'GIA',                5, TRUE),
  (1110, 'hallmark_uk',    'UK Hallmark',        6, TRUE),
  (1110, 'assay_office',   'Assay Office',       7, TRUE),
  (1110, 'lbma',           'LBMA',               8, TRUE),
  (1110, 'local_shop',     'Local shop',         9, TRUE),
  (1110, 'other',          'Other',             10, TRUE),
  -- 1112 making_charge_type
  (1112, 'flat',           'Flat amount',        1, TRUE),
  (1112, 'per_gram',       'Per gram',           2, TRUE),
  (1112, 'percent',        'Percentage',         3, TRUE),
  -- 1115 gemstone_type
  (1115, 'diamond',        'Diamond',            1, TRUE),
  (1115, 'ruby',           'Ruby',               2, TRUE),
  (1115, 'emerald',        'Emerald',            3, TRUE),
  (1115, 'sapphire',       'Sapphire',           4, TRUE),
  (1115, 'pearl',          'Pearl',              5, TRUE),
  (1115, 'topaz',          'Topaz',              6, TRUE),
  (1115, 'zircon',         'Zircon',             7, TRUE),
  (1115, 'other',          'Other',              8, TRUE),
  -- 1121 gender_target
  (1121, 'women',          'Women',              1, TRUE),
  (1121, 'men',            'Men',                2, TRUE),
  (1121, 'unisex',         'Unisex',             3, TRUE),
  (1121, 'kids',           'Kids',               4, TRUE),
  -- 1213 furnishing
  (1213, 'unfurnished',    'Unfurnished',        1, TRUE),
  (1213, 'semi_furnished', 'Semi furnished',     2, TRUE),
  (1213, 'furnished',      'Furnished',          3, TRUE),
  (1213, 'fully_furnished','Fully furnished',    4, TRUE),
  -- 1214 facing
  (1214, 'north',          'North',              1, TRUE),
  (1214, 'south',          'South',              2, TRUE),
  (1214, 'east',           'East',               3, TRUE),
  (1214, 'west',           'West',               4, TRUE),
  (1214, 'north_east',     'North east',         5, TRUE),
  (1214, 'north_west',     'North west',         6, TRUE),
  (1214, 'south_east',     'South east',         7, TRUE),
  (1214, 'south_west',     'South west',         8, TRUE),
  -- 1216 construction_status
  (1216, 'ready',              'Ready',              1, TRUE),
  (1216, 'under_construction', 'Under construction', 2, TRUE),
  (1216, 'off_plan',           'Off plan',           3, TRUE),
  (1216, 'grey_structure',     'Grey structure',     4, TRUE),
  (1216, 'renovated',          'Renovated',          5, TRUE),
  -- 1217 ownership_type
  (1217, 'freehold',           'Freehold',           1, TRUE),
  (1217, 'leasehold',          'Leasehold',          2, TRUE),
  (1217, 'power_of_attorney',  'Power of attorney',  3, TRUE),
  (1217, 'allotment',          'Allotment',          4, TRUE),
  (1217, 'shared',             'Shared',             5, TRUE),
  -- 1218 possession_status
  (1218, 'vacant',         'Vacant',             1, TRUE),
  (1218, 'occupied',       'Occupied',           2, TRUE),
  (1218, 'tenanted',       'Tenanted',           3, TRUE),
  (1218, 'immediate',      'Immediate',          4, TRUE),
  (1218, 'on_transfer',    'On transfer',        5, TRUE),
  -- 1231 rent_period (property)
  (1231, 'monthly',        'Per month',          1, TRUE),
  (1231, 'weekly',         'Per week',           2, TRUE),
  (1231, 'daily',          'Per day',            3, TRUE),
  (1231, 'nightly',        'Per night',          4, TRUE),
  (1231, 'yearly',         'Per year',           5, TRUE),
  -- 1236 tenant_preference
  (1236, 'any',            'Any',                1, TRUE),
  (1236, 'family',         'Family',             2, TRUE),
  (1236, 'bachelor',       'Bachelor',           3, TRUE),
  (1236, 'female',         'Female only',        4, TRUE),
  (1236, 'male',           'Male only',          5, TRUE),
  (1236, 'student',        'Student',            6, TRUE),
  (1236, 'corporate',      'Corporate',          7, TRUE),
  -- 1238 occupancy_type
  (1238, 'single',         'Single',             1, TRUE),
  (1238, 'double',         'Double',             2, TRUE),
  (1238, 'triple',         'Triple',             3, TRUE),
  (1238, 'shared',         'Shared',             4, TRUE),
  (1238, 'dormitory',      'Dormitory',          5, TRUE),
  (1238, 'entire_place',   'Entire place',       6, TRUE),
  -- 1307 fuel_type
  (1307, 'petrol',         'Petrol',             1, TRUE),
  (1307, 'diesel',         'Diesel',             2, TRUE),
  (1307, 'hybrid',         'Hybrid',             3, TRUE),
  (1307, 'plugin_hybrid',  'Plug-in hybrid',     4, TRUE),
  (1307, 'electric',       'Electric',           5, TRUE),
  (1307, 'cng',            'CNG',                6, TRUE),
  (1307, 'lpg',            'LPG',                7, TRUE),
  (1307, 'hydrogen',       'Hydrogen',           8, TRUE),
  (1307, 'other',          'Other',              9, TRUE),
  -- 1308 transmission
  (1308, 'manual',         'Manual',             1, TRUE),
  (1308, 'automatic',      'Automatic',          2, TRUE),
  (1308, 'cvt',            'CVT',                3, TRUE),
  (1308, 'amt',            'AMT',                4, TRUE),
  (1308, 'dct',            'DCT',                5, TRUE),
  (1308, 'semi_automatic', 'Semi automatic',     6, TRUE),
  -- 1309 drivetrain
  (1309, 'fwd',            'Front-wheel drive',  1, TRUE),
  (1309, 'rwd',            'Rear-wheel drive',   2, TRUE),
  (1309, 'awd',            'All-wheel drive',    3, TRUE),
  (1309, '4wd',            'Four-wheel drive',   4, TRUE),
  -- 1310 body_type
  (1310, 'sedan',          'Sedan',              1, TRUE),
  (1310, 'hatchback',      'Hatchback',          2, TRUE),
  (1310, 'suv',            'SUV',                3, TRUE),
  (1310, 'crossover',      'Crossover',          4, TRUE),
  (1310, 'coupe',          'Coupe',              5, TRUE),
  (1310, 'convertible',    'Convertible',        6, TRUE),
  (1310, 'wagon',          'Wagon',              7, TRUE),
  (1310, 'pickup',         'Pickup',             8, TRUE),
  (1310, 'minivan',        'Minivan',            9, TRUE),
  (1310, 'micro',          'Micro',             10, TRUE),
  (1310, 'mpv',            'MPV',               11, TRUE),
  (1310, 'roadster',       'Roadster',          12, TRUE),
  (1310, 'limousine',      'Limousine',         13, TRUE),
  (1310, 'other',          'Other',             14, TRUE),
  -- 1311 color_exterior
  (1311, 'white',          'White',              1, TRUE),
  (1311, 'black',          'Black',              2, TRUE),
  (1311, 'silver',         'Silver',             3, TRUE),
  (1311, 'grey',           'Grey',               4, TRUE),
  (1311, 'blue',           'Blue',               5, TRUE),
  (1311, 'red',            'Red',                6, TRUE),
  (1311, 'brown',          'Brown',              7, TRUE),
  (1311, 'green',          'Green',              8, TRUE),
  (1311, 'beige',          'Beige',              9, TRUE),
  (1311, 'gold',           'Gold',              10, TRUE),
  (1311, 'maroon',         'Maroon',            11, TRUE),
  (1311, 'yellow',         'Yellow',            12, TRUE),
  (1311, 'orange',         'Orange',            13, TRUE),
  (1311, 'purple',         'Purple',            14, TRUE),
  (1311, 'other',          'Other',             15, TRUE),
  -- 1312 color_interior
  (1312, 'black',          'Black',              1, TRUE),
  (1312, 'grey',           'Grey',               2, TRUE),
  (1312, 'beige',          'Beige',              3, TRUE),
  (1312, 'brown',          'Brown',              4, TRUE),
  (1312, 'white',          'White',              5, TRUE),
  (1312, 'red',            'Red',                6, TRUE),
  (1312, 'other',          'Other',              7, TRUE),
  -- 1316 registration_status
  (1316, 'registered',     'Registered',         1, TRUE),
  (1316, 'unregistered',   'Unregistered',       2, TRUE),
  (1316, 'applied',        'Applied',            3, TRUE),
  (1316, 'transferred',    'Transferred',        4, TRUE),
  (1316, 'on_papers',      'On papers',          5, TRUE),
  -- 1317 assembly
  (1317, 'local',          'Locally assembled',  1, TRUE),
  (1317, 'imported',       'Imported',           2, TRUE),
  (1317, 'ckd',            'CKD',                3, TRUE),
  (1317, 'cbu',            'CBU',                4, TRUE),
  -- 1319 accident_history
  (1319, 'none',           'No accidents',       1, TRUE),
  (1319, 'minor',          'Minor',              2, TRUE),
  (1319, 'major',          'Major',              3, TRUE),
  (1319, 'unknown',        'Unknown',            4, TRUE),
  -- 1320 service_history
  (1320, 'full',           'Full',               1, TRUE),
  (1320, 'partial',        'Partial',            2, TRUE),
  (1320, 'none',           'None',               3, TRUE),
  (1320, 'unknown',        'Unknown',            4, TRUE),
  -- 1321 condition_grade
  (1321, 'excellent',      'Excellent',          1, TRUE),
  (1321, 'very_good',      'Very good',          2, TRUE),
  (1321, 'good',           'Good',               3, TRUE),
  (1321, 'fair',           'Fair',               4, TRUE),
  (1321, 'poor',           'Poor',               5, TRUE),
  (1321, 'salvage',        'Salvage',            6, TRUE),
  -- 1338 rent_period (vehicles)
  (1338, 'hourly',         'Per hour',           1, TRUE),
  (1338, 'daily',          'Per day',            2, TRUE),
  (1338, 'weekly',         'Per week',           3, TRUE),
  (1338, 'monthly',        'Per month',          4, TRUE),
  (1338, 'yearly',         'Per year',           5, TRUE),
  (1338, 'per_trip',       'Per trip',           6, TRUE),
  -- 1340 insurance_status
  (1340, 'valid',          'Valid',              1, TRUE),
  (1340, 'expired',        'Expired',            2, TRUE),
  (1340, 'none',           'None',               3, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), sort_order = VALUES(sort_order), is_active = VALUES(is_active);

-- =============================================================================
-- 3. category_attributes — which attribute appears in which category.
--    Bindings are written as SELECTs over category codes rather than ~2,000
--    hand-typed id pairs: the intent stays readable and a renumbered taxonomy
--    cannot silently mis-bind. is_required / is_filterable / is_comparable are
--    left NULL, which the schema defines as "inherit from the attribute"; the
--    genuinely required combinations are marked in section 4 below.
-- =============================================================================

-- 3a. Global attributes on every leaf category of all three marketplaces
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id IS NULL
WHERE c.is_leaf = TRUE
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 3b. GOLD bindings
-- -----------------------------------------------------------------------------

-- Core metal facts apply to every gold leaf, bullion and jewellery alike
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 1 AND a.code IN (
  'karat','fineness','metal_type','weight_grams','gross_weight','form',
  'hallmarked','certificate','certificate_authority','purity_verified',
  'buyback','exchange_accepted'
)
WHERE c.marketplace_id = 1 AND c.is_leaf = TRUE
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Jewellery-only fields: making charges, stones, sizing and who wears it
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 1 AND a.code IN (
  'jewellery_type','size_label','gender_target','stone_weight',
  'making_charges','making_charge_type','wastage_percent','gemstones','gemstone_type'
)
WHERE c.marketplace_id = 1 AND c.code IN (
  'ring','bangle','bracelet','necklace','earring','pendant','chain',
  'jewellery_set','anklet','nose_pin','gemstone_jewellery'
)
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Investment grade is a bullion concept
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 1 AND a.code = 'investment_grade'
WHERE c.marketplace_id = 1 AND c.code IN ('gold_bars','gold_coins','investment_gold','silver','platinum')
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Antique applies to heritage pieces and to jewellery
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 1 AND a.code = 'antique'
WHERE c.marketplace_id = 1 AND c.code IN (
  'antique_gold','ring','bangle','bracelet','necklace','earring','pendant','chain',
  'jewellery_set','anklet','nose_pin','gemstone_jewellery'
)
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 3c. PROPERTY bindings, driven by group_code
-- -----------------------------------------------------------------------------

-- Area, legal status and payment terms are asked for on every property leaf
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 2 AND a.code IN (
  'area','facing','ownership_type','possession_status',
  'ownership_papers','noc','approved','installments_available',
  'gated_community','corner','park_facing'
)
WHERE c.marketplace_id = 2 AND c.is_leaf = TRUE
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Anything with a building on it: construction, services and vertical access
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 2 AND a.code IN (
  'covered_area','year_built','construction_status','parking_spaces',
  'elevator','security','cctv','backup_power','total_floors'
)
WHERE c.marketplace_id = 2 AND c.is_leaf = TRUE AND c.group_code IN ('residential','commercial','rental')
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Rooms and lifestyle amenities: residential and rental only, never land
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 2 AND a.code IN (
  'bedrooms','bathrooms','kitchens','drawing_rooms','servant_quarters','store_rooms',
  'floors','floor_number','furnishing','balcony','swimming_pool','gym','garden'
)
WHERE c.marketplace_id = 2 AND c.is_leaf = TRUE AND c.group_code IN ('residential','rental')
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Tenancy terms: rental group only (§6 Rental categories)
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 2 AND a.code IN (
  'rent_period','security_deposit','advance_months','maintenance_charges',
  'utilities_included','tenant_preference','pets_allowed','occupancy_type',
  'attached_bathroom','meals_included'
)
WHERE c.marketplace_id = 2 AND c.is_leaf = TRUE AND c.group_code = 'rental'
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Plot geometry: land, plus houses which are still sold by plot size
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 2 AND a.code IN ('plot_dimensions','road_width')
WHERE c.marketplace_id = 2 AND c.is_leaf = TRUE AND (c.group_code = 'land' OR c.code IN ('house','villa','farm_house','townhouse'))
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Commercial-only structural specs
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 2 AND a.code IN ('floor_load','ceiling_height')
WHERE c.marketplace_id = 2 AND c.is_leaf = TRUE AND c.group_code = 'commercial'
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 3d. VEHICLE bindings
-- -----------------------------------------------------------------------------

-- Identity, paperwork and history: every vehicle except parts and accessories
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 3 AND a.code IN (
  'make','model','variant','year','condition_grade','registration_city','registration_status',
  'assembly','owners_count','accident_history','service_history','inspected','inspection_score',
  'finance_available','exchange_accepted','insurance_status','color_exterior'
)
WHERE c.marketplace_id = 3 AND c.is_leaf = TRUE AND c.group_code <> 'parts'
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Powertrain: everything that is driven or ridden. Trailers have no engine and
-- boats/yachts are quoted in engine hours rather than displacement.
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 3 AND a.code IN ('mileage','engine_power','fuel_type','transmission')
WHERE c.marketplace_id = 3 AND c.is_leaf = TRUE AND c.group_code NOT IN ('parts','trailer')
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 3 AND a.code = 'engine_capacity'
WHERE c.marketplace_id = 3 AND c.is_leaf = TRUE
  AND c.group_code NOT IN ('parts','trailer')
  AND c.code NOT IN ('boats','yachts')
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- The full car / passenger spec sheet that the compare table renders (§15)
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 3 AND a.code IN (
  'drivetrain','body_type','color_interior','doors','seats','airbags','safety_rating',
  'boot_space','ground_clearance','kerb_weight','mileage_city','fuel_tank',
  'top_speed','acceleration_0_100'
)
WHERE c.marketplace_id = 3 AND c.is_leaf = TRUE AND c.group_code = 'passenger'
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Buses, trucks and vans share the seating and weight columns
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 3 AND a.code IN ('seats','doors','kerb_weight','fuel_tank','drivetrain')
WHERE c.marketplace_id = 3 AND c.code IN ('buses','trucks','vans','rickshaw')
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Electric specifics only where an electric variant actually exists
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 3 AND a.code IN ('battery_capacity','range_km')
WHERE c.marketplace_id = 3 AND (c.group_code = 'passenger' OR c.code IN ('motorcycle_electric','buses','vans'))
  AND c.is_leaf = TRUE
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Rental terms (§7 Rent) for the categories whose operations include rent
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 3 AND a.code IN ('with_driver','rent_period','km_limit_per_day')
WHERE c.marketplace_id = 3 AND c.is_leaf = TRUE AND c.group_code NOT IN ('parts')
  AND JSON_CONTAINS(c.operations, '"rent"')
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- Parts and accessories only need fitment on top of the global attributes
INSERT INTO category_attributes (category_id, attribute_id, is_required, is_filterable, is_comparable, sort_order)
SELECT c.id, a.id, NULL, NULL, NULL, a.sort_order
FROM categories c
JOIN attributes a ON a.marketplace_id = 3 AND a.code IN ('make','model','year')
WHERE c.marketplace_id = 3 AND c.group_code = 'parts'
ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order);

-- =============================================================================
-- 4. Required-field overrides. Applied as UPDATEs after the bindings so that
--    re-running the bind SELECTs (which write is_required = NULL to inherit)
--    cannot quietly drop a mandatory field.
-- =============================================================================

-- Gold: a listing without karat, weight and form is not a gold listing (§5)
UPDATE category_attributes ca
JOIN attributes a ON a.id = ca.attribute_id
SET ca.is_required = TRUE
WHERE a.marketplace_id = 1 AND a.code IN ('karat','weight_grams','form');

-- Property: area is mandatory everywhere, bedrooms only where people sleep (§6)
UPDATE category_attributes ca
JOIN attributes a ON a.id = ca.attribute_id
SET ca.is_required = TRUE
WHERE a.marketplace_id = 2 AND a.code = 'area';

UPDATE category_attributes ca
JOIN attributes a ON a.id = ca.attribute_id
JOIN categories c ON c.id = ca.category_id
SET ca.is_required = TRUE
WHERE a.marketplace_id = 2 AND a.code = 'bedrooms' AND c.group_code = 'residential';

-- Rental: how the rent is quoted cannot be left blank
UPDATE category_attributes ca
JOIN attributes a ON a.id = ca.attribute_id
JOIN categories c ON c.id = ca.category_id
SET ca.is_required = TRUE
WHERE a.marketplace_id = 2 AND a.code = 'rent_period' AND c.group_code = 'rental';

-- Vehicles: the six fields every buyer filters on (§7, §10)
UPDATE category_attributes ca
JOIN attributes a ON a.id = ca.attribute_id
JOIN categories c ON c.id = ca.category_id
SET ca.is_required = TRUE
WHERE a.marketplace_id = 3
  AND a.code IN ('make','model','year','mileage','fuel_type','transmission')
  AND c.group_code <> 'parts';

-- Parts keep make/model optional: a universal accessory fits everything
UPDATE category_attributes ca
JOIN attributes a ON a.id = ca.attribute_id
JOIN categories c ON c.id = ca.category_id
SET ca.is_required = FALSE
WHERE a.marketplace_id = 3 AND c.group_code = 'parts';
