-- =============================================================================
-- 03  Marketplaces + full category taxonomy + sort options + review criteria
--     Satisfies spec §4 (Marketplace Selection), §5/§6/§7 (the complete category
--     lists for Gold / Property / Vehicles), line 5 "also add sort option",
--     §20 (Reviews) and §10 (brand filter).
--     Category ids are pinned by block — gold 100+, property 200+, vehicles 300+
--     so 04_attributes.sql can bind attributes by category code and stay legible.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1. The three marketplaces (§4). `config` is read by the backend
--    MarketplaceModule, so module behaviour is data rather than a code branch.
-- -----------------------------------------------------------------------------
INSERT INTO marketplaces (id, code, name, tagline, icon, color, operations, detail_table, config, is_active, is_coming_soon, sort_order) VALUES
  (1, 'gold',     'Gold',     'Buy, sell and auction gold with confidence', 'gem',        '#D4AF37', '["buy","sell","auction"]', 'gold_listing_details',    '{"allowsAuction":true,"requiresCertificate":false,"liveRates":true,"authenticityCheck":true,"pricePrediction":true,"weightUnits":["gram","tola","troy_ounce"]}', TRUE, FALSE, 1),
  (2, 'property', 'Property', 'Find your next home, office or plot',        'building-2', '#0EA5E9', '["buy","sell","rent"]',    'property_listing_details','{"requiresDocuments":true,"allowsViewings":true,"valuation":true,"comparison":true,"maxCompareItems":4,"areaUnits":["sqft","sqm","marla","kanal"]}',            TRUE, FALSE, 2),
  (3, 'vehicles', 'Vehicles', 'Compare and buy your next vehicle',          'car-front',  '#7C3AED', '["buy","sell","rent"]',    'vehicle_listing_details', '{"requiresInspection":false,"comparison":true,"priceEstimate":true,"maxCompareItems":4,"aiCompareMin":3,"importExport":true}',                                 TRUE, FALSE, 3)
ON DUPLICATE KEY UPDATE
  code = VALUES(code), name = VALUES(name), tagline = VALUES(tagline), icon = VALUES(icon),
  color = VALUES(color), operations = VALUES(operations), detail_table = VALUES(detail_table),
  config = VALUES(config), is_active = VALUES(is_active), is_coming_soon = VALUES(is_coming_soon),
  sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 2. Per-country availability. All three modules are live in the six launch
--    markets; gold and vehicles are globally tradeable, property is opened
--    market by market because it needs local document rules.
-- -----------------------------------------------------------------------------
INSERT INTO marketplace_countries (marketplace_id, country_id, is_active, launched_at)
SELECT m.id, c.id, TRUE, '2026-01-01 00:00:00'
FROM marketplaces m CROSS JOIN countries c
WHERE c.id BETWEEN 1 AND 6
ON DUPLICATE KEY UPDATE is_active = VALUES(is_active), launched_at = VALUES(launched_at);

INSERT INTO marketplace_countries (marketplace_id, country_id, is_active, launched_at)
SELECT m.id, c.id, TRUE, '2026-01-01 00:00:00'
FROM marketplaces m CROSS JOIN countries c
WHERE m.id IN (1, 3) AND c.id > 6
ON DUPLICATE KEY UPDATE is_active = VALUES(is_active), launched_at = VALUES(launched_at);

-- -----------------------------------------------------------------------------
-- 3. Marketplace names in the RTL launch languages (§1 Regional translations)
-- -----------------------------------------------------------------------------
INSERT INTO marketplace_translations (marketplace_id, language, name, tagline) VALUES
  (1, 'ar', 'الذهب',    'اشترِ وبِع الذهب بثقة'),
  (1, 'ur', 'سونا',     'اعتماد کے ساتھ سونا خریدیں اور بیچیں'),
  (2, 'ar', 'العقارات', 'ابحث عن منزلك أو مكتبك أو أرضك القادمة'),
  (2, 'ur', 'جائیداد',  'اپنا اگلا گھر، دفتر یا پلاٹ تلاش کریں'),
  (3, 'ar', 'المركبات', 'قارن واشترِ سيارتك القادمة'),
  (3, 'ur', 'گاڑیاں',   'موازنہ کریں اور اپنی اگلی گاڑی خریدیں')
ON DUPLICATE KEY UPDATE name = VALUES(name), tagline = VALUES(tagline);

-- -----------------------------------------------------------------------------
-- 4. Taxonomy version — clients cache categories/attributes and revalidate
--    against this counter instead of refetching the whole tree.
-- -----------------------------------------------------------------------------
INSERT INTO taxonomy_versions (marketplace_id, version) VALUES
  (1, 1),
  (2, 1),
  (3, 1)
ON DUPLICATE KEY UPDATE version = VALUES(version);

-- -----------------------------------------------------------------------------
-- 5a. GOLD categories (§5). Roots are inserted before children so the
--     self-referencing parent FK resolves inside a single statement.
-- -----------------------------------------------------------------------------
INSERT INTO categories (id, marketplace_id, parent_id, code, name, slug, path, depth, icon, operations, group_code, is_leaf, is_active, sort_order) VALUES
  (100, 1, NULL, 'gold_bars',          'Gold Bars',          'gold-bars',          '/100/', 0, 'rectangle-horizontal', '["buy","sell","auction"]', 'bullion',     TRUE,  TRUE, 1),
  (101, 1, NULL, 'gold_coins',         'Gold Coins',         'gold-coins',         '/101/', 0, 'circle-dollar-sign',   '["buy","sell","auction"]', 'bullion',     TRUE,  TRUE, 2),
  (102, 1, NULL, 'jewelry',            'Jewelry',            'jewelry',            '/102/', 0, 'gem',                  '["buy","sell","auction"]', 'jewellery',   FALSE, TRUE, 3),
  (103, 1, NULL, 'antique_gold',       'Antique Gold',       'antique-gold',       '/103/', 0, 'landmark',             '["buy","sell","auction"]', 'collectible', TRUE,  TRUE, 4),
  (104, 1, NULL, 'scrap_gold',         'Scrap Gold',         'scrap-gold',         '/104/', 0, 'recycle',              '["buy","sell"]',           'scrap',       TRUE,  TRUE, 5),
  (105, 1, NULL, 'investment_gold',    'Investment Gold',    'investment-gold',    '/105/', 0, 'trending-up',          '["buy","sell","auction"]', 'bullion',     TRUE,  TRUE, 6),
  (106, 1, NULL, 'silver',             'Silver',             'silver',             '/106/', 0, 'circle',               '["buy","sell","auction"]', 'other_metal', TRUE,  TRUE, 7),
  (107, 1, NULL, 'platinum',           'Platinum',           'platinum',           '/107/', 0, 'hexagon',              '["buy","sell","auction"]', 'other_metal', TRUE,  TRUE, 8),
  (108, 1, NULL, 'gemstone_jewellery', 'Gemstone Jewellery', 'gemstone-jewellery', '/108/', 0, 'diamond',              '["buy","sell","auction"]', 'jewellery',   TRUE,  TRUE, 9),
  -- Jewelry children (§5 Rings / Bangles / Necklace / Earrings and the rest of the form)
  (110, 1, 102, 'ring',           'Rings',      'rings',      '/102/110/', 1, 'circle-dot',  '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 1),
  (111, 1, 102, 'bangle',         'Bangles',    'bangles',    '/102/111/', 1, 'circle',      '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 2),
  (112, 1, 102, 'bracelet',       'Bracelets',  'bracelets',  '/102/112/', 1, 'link',        '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 3),
  (113, 1, 102, 'necklace',       'Necklaces',  'necklaces',  '/102/113/', 1, 'gem',         '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 4),
  (114, 1, 102, 'earring',        'Earrings',   'earrings',   '/102/114/', 1, 'ear',         '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 5),
  (115, 1, 102, 'pendant',        'Pendants',   'pendants',   '/102/115/', 1, 'droplet',     '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 6),
  (116, 1, 102, 'chain',          'Chains',     'chains',     '/102/116/', 1, 'link-2',      '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 7),
  (117, 1, 102, 'jewellery_set',  'Sets',       'sets',       '/102/117/', 1, 'layers',      '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 8),
  (118, 1, 102, 'anklet',         'Anklets',    'anklets',    '/102/118/', 1, 'footprints',  '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 9),
  (119, 1, 102, 'nose_pin',       'Nose Pins',  'nose-pins',  '/102/119/', 1, 'dot',         '["buy","sell","auction"]', 'jewellery', TRUE, TRUE, 10)
ON DUPLICATE KEY UPDATE
  parent_id = VALUES(parent_id), code = VALUES(code), name = VALUES(name), slug = VALUES(slug),
  path = VALUES(path), depth = VALUES(depth), icon = VALUES(icon), operations = VALUES(operations),
  group_code = VALUES(group_code), is_leaf = VALUES(is_leaf), is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 5b. PROPERTY categories (§6). The four spec sub-headings become roots and
--     also carry `group_code`, which is what drives attribute binding in 04.
-- -----------------------------------------------------------------------------
INSERT INTO categories (id, marketplace_id, parent_id, code, name, slug, path, depth, icon, operations, group_code, is_leaf, is_active, sort_order) VALUES
  (200, 2, NULL, 'residential', 'Residential', 'residential', '/200/', 0, 'home',         '["buy","sell","rent"]', 'residential', FALSE, TRUE, 1),
  (201, 2, NULL, 'commercial',  'Commercial',  'commercial',  '/201/', 0, 'building-2',   '["buy","sell","rent"]', 'commercial',  FALSE, TRUE, 2),
  (202, 2, NULL, 'rental',      'Rental',      'rental',      '/202/', 0, 'bed-double',   '["rent"]',              'rental',      FALSE, TRUE, 3),
  (203, 2, NULL, 'land',        'Land',        'land',        '/203/', 0, 'land-plot',    '["buy","sell"]',        'land',        FALSE, TRUE, 4),
  -- Residential
  (210, 2, 200, 'house',              'House',              'house',              '/200/210/', 1, 'home',            '["buy","sell","rent"]', 'residential', TRUE, TRUE, 1),
  (211, 2, 200, 'apartment',          'Apartment',          'apartment',          '/200/211/', 1, 'building',        '["buy","sell","rent"]', 'residential', TRUE, TRUE, 2),
  (212, 2, 200, 'flat',               'Flat',               'flat',               '/200/212/', 1, 'building',        '["buy","sell","rent"]', 'residential', TRUE, TRUE, 3),
  (213, 2, 200, 'villa',              'Villa',              'villa',              '/200/213/', 1, 'house',           '["buy","sell","rent"]', 'residential', TRUE, TRUE, 4),
  (214, 2, 200, 'farm_house',         'Farm House',         'farm-house',         '/200/214/', 1, 'tractor',         '["buy","sell","rent"]', 'residential', TRUE, TRUE, 5),
  (215, 2, 200, 'penthouse',          'Penthouse',          'penthouse',          '/200/215/', 1, 'building-2',      '["buy","sell","rent"]', 'residential', TRUE, TRUE, 6),
  (216, 2, 200, 'studio',             'Studio',             'studio',             '/200/216/', 1, 'square',          '["buy","sell","rent"]', 'residential', TRUE, TRUE, 7),
  (217, 2, 200, 'townhouse',          'Townhouse',          'townhouse',          '/200/217/', 1, 'houses',          '["buy","sell","rent"]', 'residential', TRUE, TRUE, 8),
  -- Commercial
  (220, 2, 201, 'office',             'Office',             'office',             '/201/220/', 1, 'briefcase',       '["buy","sell","rent"]', 'commercial',  TRUE, TRUE, 1),
  (221, 2, 201, 'shop',               'Shop',               'shop',               '/201/221/', 1, 'store',           '["buy","sell","rent"]', 'commercial',  TRUE, TRUE, 2),
  (222, 2, 201, 'warehouse',          'Warehouse',          'warehouse',          '/201/222/', 1, 'warehouse',       '["buy","sell","rent"]', 'commercial',  TRUE, TRUE, 3),
  (223, 2, 201, 'factory',            'Factory',            'factory',            '/201/223/', 1, 'factory',        '["buy","sell","rent"]', 'commercial',  TRUE, TRUE, 4),
  (224, 2, 201, 'building',           'Building',           'building',           '/201/224/', 1, 'building-2',      '["buy","sell","rent"]', 'commercial',  TRUE, TRUE, 5),
  (225, 2, 201, 'plaza',              'Plaza',              'plaza',              '/201/225/', 1, 'landmark',        '["buy","sell","rent"]', 'commercial',  TRUE, TRUE, 6),
  (226, 2, 201, 'showroom',           'Showroom',           'showroom',           '/201/226/', 1, 'panels-top-left', '["buy","sell","rent"]', 'commercial',  TRUE, TRUE, 7),
  -- Rental (§6 Rental: Room / Hotel / Guest House / Hostel and the shared-living forms)
  (230, 2, 202, 'room',               'Room',               'room',               '/202/230/', 1, 'door-open',       '["rent"]', 'rental', TRUE, TRUE, 1),
  (231, 2, 202, 'hotel',              'Hotel',              'hotel',              '/202/231/', 1, 'hotel',          '["rent"]', 'rental', TRUE, TRUE, 2),
  (232, 2, 202, 'guest_house',        'Guest House',        'guest-house',        '/202/232/', 1, 'bed-single',     '["rent"]', 'rental', TRUE, TRUE, 3),
  (233, 2, 202, 'hostel',             'Hostel',             'hostel',             '/202/233/', 1, 'bunk-bed',       '["rent"]', 'rental', TRUE, TRUE, 4),
  (234, 2, 202, 'serviced_apartment', 'Serviced Apartment', 'serviced-apartment', '/202/234/', 1, 'concierge-bell', '["rent"]', 'rental', TRUE, TRUE, 5),
  (235, 2, 202, 'shared_room',        'Shared Room',        'shared-room',        '/202/235/', 1, 'users',          '["rent"]', 'rental', TRUE, TRUE, 6),
  -- Land
  (240, 2, 203, 'residential_plot',   'Residential Plot',   'residential-plot',   '/203/240/', 1, 'land-plot', '["buy","sell"]', 'land', TRUE, TRUE, 1),
  (241, 2, 203, 'commercial_plot',    'Commercial Plot',    'commercial-plot',    '/203/241/', 1, 'land-plot', '["buy","sell"]', 'land', TRUE, TRUE, 2),
  (242, 2, 203, 'agricultural_land',  'Agricultural Land',  'agricultural-land',  '/203/242/', 1, 'wheat',     '["buy","sell"]', 'land', TRUE, TRUE, 3),
  (243, 2, 203, 'industrial_land',    'Industrial Land',    'industrial-land',    '/203/243/', 1, 'factory',   '["buy","sell"]', 'land', TRUE, TRUE, 4),
  (244, 2, 203, 'plot_file',          'Plot File',          'plot-file',          '/203/244/', 1, 'file-text', '["buy","sell"]', 'land', TRUE, TRUE, 5),
  (245, 2, 203, 'farmhouse_plot',     'Farmhouse Plot',     'farmhouse-plot',     '/203/245/', 1, 'trees',     '["buy","sell"]', 'land', TRUE, TRUE, 6)
ON DUPLICATE KEY UPDATE
  parent_id = VALUES(parent_id), code = VALUES(code), name = VALUES(name), slug = VALUES(slug),
  path = VALUES(path), depth = VALUES(depth), icon = VALUES(icon), operations = VALUES(operations),
  group_code = VALUES(group_code), is_leaf = VALUES(is_leaf), is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 5c. VEHICLE categories (§7), plus the body-style and bike-style children the
--     PakWheels-style manual comparison needs to narrow a shortlist.
-- -----------------------------------------------------------------------------
INSERT INTO categories (id, marketplace_id, parent_id, code, name, slug, path, depth, icon, operations, group_code, is_leaf, is_active, sort_order) VALUES
  (300, 3, NULL, 'cars',                  'Cars',                  'cars',                  '/300/', 0, 'car-front',      '["buy","sell","rent"]', 'passenger',   FALSE, TRUE, 1),
  (301, 3, NULL, 'motorcycles',           'Motorcycles',           'motorcycles',           '/301/', 0, 'bike',           '["buy","sell","rent"]', 'two_wheeler', FALSE, TRUE, 2),
  (302, 3, NULL, 'buses',                 'Buses',                 'buses',                 '/302/', 0, 'bus',            '["buy","sell","rent"]', 'commercial',  TRUE,  TRUE, 3),
  (303, 3, NULL, 'trucks',                'Trucks',                'trucks',                '/303/', 0, 'truck',          '["buy","sell","rent"]', 'commercial',  TRUE,  TRUE, 4),
  (304, 3, NULL, 'vans',                  'Vans',                  'vans',                  '/304/', 0, 'truck',          '["buy","sell","rent"]', 'commercial',  TRUE,  TRUE, 5),
  (305, 3, NULL, 'taxi',                  'Taxi',                  'taxi',                  '/305/', 0, 'car-taxi-front', '["buy","sell","rent"]', 'passenger',   TRUE,  TRUE, 6),
  (306, 3, NULL, 'rickshaw',              'Rickshaw',              'rickshaw',              '/306/', 0, 'bike',           '["buy","sell","rent"]', 'commercial',  TRUE,  TRUE, 7),
  (307, 3, NULL, 'tractors',              'Tractors',              'tractors',              '/307/', 0, 'tractor',        '["buy","sell","rent"]', 'agriculture', TRUE,  TRUE, 8),
  (308, 3, NULL, 'heavy_machinery',       'Heavy Machinery',       'heavy-machinery',       '/308/', 0, 'crane',          '["buy","sell","rent"]', 'machinery',   TRUE,  TRUE, 9),
  (309, 3, NULL, 'construction_equipment','Construction Equipment','construction-equipment','/309/', 0, 'hard-hat',       '["buy","sell","rent"]', 'machinery',   TRUE,  TRUE, 10),
  (330, 3, NULL, 'agriculture_equipment', 'Agriculture Equipment', 'agriculture-equipment', '/330/', 0, 'wheat',          '["buy","sell","rent"]', 'agriculture', TRUE,  TRUE, 11),
  (331, 3, NULL, 'boats',                 'Boats',                 'boats',                 '/331/', 0, 'sailboat',       '["buy","sell","rent"]', 'marine',      TRUE,  TRUE, 12),
  (332, 3, NULL, 'yachts',                'Yachts',                'yachts',                '/332/', 0, 'ship',           '["buy","sell","rent"]', 'marine',      TRUE,  TRUE, 13),
  (333, 3, NULL, 'jet_ski',               'Jet Ski',               'jet-ski',               '/333/', 0, 'waves',          '["buy","sell","rent"]', 'marine',      TRUE,  TRUE, 14),
  (334, 3, NULL, 'atv_quad',              'ATV / Quad',            'atv-quad',              '/334/', 0, 'mountain',       '["buy","sell","rent"]', 'recreation',  TRUE,  TRUE, 15),
  (335, 3, NULL, 'trailers',              'Trailers',              'trailers',              '/335/', 0, 'container',      '["buy","sell","rent"]', 'trailer',     TRUE,  TRUE, 16),
  (336, 3, NULL, 'spare_parts',           'Spare Parts',           'spare-parts',           '/336/', 0, 'cog',            '["buy","sell"]',        'parts',       TRUE,  TRUE, 17),
  (337, 3, NULL, 'vehicle_accessories',   'Vehicle Accessories',   'vehicle-accessories',   '/337/', 0, 'package',        '["buy","sell"]',        'parts',       TRUE,  TRUE, 18),
  -- Car body styles
  (310, 3, 300, 'sedan',       'Sedan',       'sedan',       '/300/310/', 1, 'car',       '["buy","sell","rent"]', 'passenger', TRUE, TRUE, 1),
  (311, 3, 300, 'hatchback',   'Hatchback',   'hatchback',   '/300/311/', 1, 'car',       '["buy","sell","rent"]', 'passenger', TRUE, TRUE, 2),
  (312, 3, 300, 'suv',         'SUV',         'suv',         '/300/312/', 1, 'car-front', '["buy","sell","rent"]', 'passenger', TRUE, TRUE, 3),
  (313, 3, 300, 'crossover',   'Crossover',   'crossover',   '/300/313/', 1, 'car-front', '["buy","sell","rent"]', 'passenger', TRUE, TRUE, 4),
  (314, 3, 300, 'coupe',       'Coupe',       'coupe',       '/300/314/', 1, 'car',       '["buy","sell","rent"]', 'passenger', TRUE, TRUE, 5),
  (315, 3, 300, 'convertible', 'Convertible', 'convertible', '/300/315/', 1, 'car',       '["buy","sell","rent"]', 'passenger', TRUE, TRUE, 6),
  (316, 3, 300, 'wagon',       'Wagon',       'wagon',       '/300/316/', 1, 'car',       '["buy","sell","rent"]', 'passenger', TRUE, TRUE, 7),
  (317, 3, 300, 'pickup',      'Pickup',      'pickup',      '/300/317/', 1, 'truck',     '["buy","sell","rent"]', 'passenger', TRUE, TRUE, 8),
  (318, 3, 300, 'van_mpv',     'Van / MPV',   'van-mpv',     '/300/318/', 1, 'bus',       '["buy","sell","rent"]', 'passenger', TRUE, TRUE, 9),
  -- Motorcycle styles
  (320, 3, 301, 'motorcycle_sport',    'Sport',    'sport',    '/301/320/', 1, 'bike',      '["buy","sell","rent"]', 'two_wheeler', TRUE, TRUE, 1),
  (321, 3, 301, 'motorcycle_cruiser',  'Cruiser',  'cruiser',  '/301/321/', 1, 'bike',      '["buy","sell","rent"]', 'two_wheeler', TRUE, TRUE, 2),
  (322, 3, 301, 'scooter',             'Scooter',  'scooter',  '/301/322/', 1, 'bike',      '["buy","sell","rent"]', 'two_wheeler', TRUE, TRUE, 3),
  (323, 3, 301, 'motorcycle_standard', 'Standard', 'standard', '/301/323/', 1, 'bike',      '["buy","sell","rent"]', 'two_wheeler', TRUE, TRUE, 4),
  (324, 3, 301, 'motorcycle_offroad',  'Off-Road', 'off-road', '/301/324/', 1, 'mountain',  '["buy","sell","rent"]', 'two_wheeler', TRUE, TRUE, 5),
  (325, 3, 301, 'motorcycle_electric', 'Electric', 'electric', '/301/325/', 1, 'zap',       '["buy","sell","rent"]', 'two_wheeler', TRUE, TRUE, 6)
ON DUPLICATE KEY UPDATE
  parent_id = VALUES(parent_id), code = VALUES(code), name = VALUES(name), slug = VALUES(slug),
  path = VALUES(path), depth = VALUES(depth), icon = VALUES(icon), operations = VALUES(operations),
  group_code = VALUES(group_code), is_leaf = VALUES(is_leaf), is_active = VALUES(is_active),
  sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 6. Category names in Arabic and Urdu (§1 Support RTL languages).
--    Real translations, not transliterations, wherever the language has a word.
-- -----------------------------------------------------------------------------
INSERT INTO category_translations (category_id, language, name) VALUES
  -- Gold
  (100, 'ar', 'سبائك الذهب'),            (100, 'ur', 'سونے کی سلاخیں'),
  (101, 'ar', 'عملات ذهبية'),             (101, 'ur', 'سونے کے سکے'),
  (102, 'ar', 'المجوهرات'),               (102, 'ur', 'زیورات'),
  (103, 'ar', 'ذهب أثري'),                (103, 'ur', 'قدیم سونا'),
  (104, 'ar', 'ذهب مستعمل'),              (104, 'ur', 'پرانا سونا'),
  (105, 'ar', 'ذهب استثماري'),            (105, 'ur', 'سرمایہ کاری کا سونا'),
  (106, 'ar', 'الفضة'),                   (106, 'ur', 'چاندی'),
  (107, 'ar', 'البلاتين'),                (107, 'ur', 'پلاٹینم'),
  (108, 'ar', 'مجوهرات بالأحجار الكريمة'), (108, 'ur', 'جواہرات کے زیورات'),
  (110, 'ar', 'خواتم'),                   (110, 'ur', 'انگوٹھیاں'),
  (111, 'ar', 'أساور صلبة'),              (111, 'ur', 'کنگن'),
  (112, 'ar', 'أساور'),                   (112, 'ur', 'بریسلٹ'),
  (113, 'ar', 'قلائد'),                   (113, 'ur', 'ہار'),
  (114, 'ar', 'أقراط'),                   (114, 'ur', 'بالیاں'),
  (115, 'ar', 'تعليقات'),                 (115, 'ur', 'لاکٹ'),
  (116, 'ar', 'سلاسل'),                   (116, 'ur', 'زنجیریں'),
  (117, 'ar', 'أطقم'),                    (117, 'ur', 'سیٹ'),
  (118, 'ar', 'خلاخيل'),                  (118, 'ur', 'پازیب'),
  (119, 'ar', 'حلق الأنف'),               (119, 'ur', 'نتھ'),
  -- Property
  (200, 'ar', 'سكني'),                    (200, 'ur', 'رہائشی'),
  (201, 'ar', 'تجاري'),                   (201, 'ur', 'تجارتی'),
  (202, 'ar', 'للإيجار'),                 (202, 'ur', 'کرائے کے لیے'),
  (203, 'ar', 'أراضٍ'),                   (203, 'ur', 'زمین'),
  (210, 'ar', 'منزل'),                    (210, 'ur', 'مکان'),
  (211, 'ar', 'شقة'),                     (211, 'ur', 'اپارٹمنٹ'),
  (212, 'ar', 'شقة سكنية'),               (212, 'ur', 'فلیٹ'),
  (213, 'ar', 'فيلا'),                    (213, 'ur', 'ولا'),
  (214, 'ar', 'بيت ريفي'),                (214, 'ur', 'فارم ہاؤس'),
  (215, 'ar', 'بنتهاوس'),                 (215, 'ur', 'پینٹ ہاؤس'),
  (216, 'ar', 'استوديو'),                 (216, 'ur', 'اسٹوڈیو'),
  (217, 'ar', 'تاون هاوس'),               (217, 'ur', 'ٹاؤن ہاؤس'),
  (220, 'ar', 'مكتب'),                    (220, 'ur', 'دفتر'),
  (221, 'ar', 'متجر'),                    (221, 'ur', 'دکان'),
  (222, 'ar', 'مستودع'),                  (222, 'ur', 'گودام'),
  (223, 'ar', 'مصنع'),                    (223, 'ur', 'کارخانہ'),
  (224, 'ar', 'مبنى'),                    (224, 'ur', 'عمارت'),
  (225, 'ar', 'بلازا'),                   (225, 'ur', 'پلازہ'),
  (226, 'ar', 'صالة عرض'),                (226, 'ur', 'شو روم'),
  (230, 'ar', 'غرفة'),                    (230, 'ur', 'کمرہ'),
  (231, 'ar', 'فندق'),                    (231, 'ur', 'ہوٹل'),
  (232, 'ar', 'دار ضيافة'),               (232, 'ur', 'گیسٹ ہاؤس'),
  (233, 'ar', 'مبيت'),                    (233, 'ur', 'ہاسٹل'),
  (234, 'ar', 'شقة مخدومة'),              (234, 'ur', 'سروسڈ اپارٹمنٹ'),
  (235, 'ar', 'غرفة مشتركة'),             (235, 'ur', 'مشترکہ کمرہ'),
  (240, 'ar', 'أرض سكنية'),               (240, 'ur', 'رہائشی پلاٹ'),
  (241, 'ar', 'أرض تجارية'),              (241, 'ur', 'تجارتی پلاٹ'),
  (242, 'ar', 'أرض زراعية'),              (242, 'ur', 'زرعی زمین'),
  (243, 'ar', 'أرض صناعية'),              (243, 'ur', 'صنعتی زمین'),
  (244, 'ar', 'ملف أرض'),                 (244, 'ur', 'پلاٹ فائل'),
  (245, 'ar', 'أرض بيت ريفي'),            (245, 'ur', 'فارم ہاؤس پلاٹ'),
  -- Vehicles
  (300, 'ar', 'سيارات'),                  (300, 'ur', 'کاریں'),
  (301, 'ar', 'دراجات نارية'),            (301, 'ur', 'موٹر سائیکلیں'),
  (302, 'ar', 'حافلات'),                  (302, 'ur', 'بسیں'),
  (303, 'ar', 'شاحنات'),                  (303, 'ur', 'ٹرک'),
  (304, 'ar', 'فانات'),                   (304, 'ur', 'وین'),
  (305, 'ar', 'سيارات أجرة'),             (305, 'ur', 'ٹیکسی'),
  (306, 'ar', 'ريكشا'),                   (306, 'ur', 'رکشہ'),
  (307, 'ar', 'تراكتورات'),               (307, 'ur', 'ٹریکٹر'),
  (308, 'ar', 'آليات ثقيلة'),             (308, 'ur', 'بھاری مشینری'),
  (309, 'ar', 'معدات بناء'),              (309, 'ur', 'تعمیراتی سامان'),
  (330, 'ar', 'معدات زراعية'),            (330, 'ur', 'زرعی سامان'),
  (331, 'ar', 'قوارب'),                   (331, 'ur', 'کشتیاں'),
  (332, 'ar', 'يخوت'),                    (332, 'ur', 'یاٹ'),
  (333, 'ar', 'دراجة مائية'),             (333, 'ur', 'جیٹ اسکی'),
  (334, 'ar', 'مركبات رباعية'),           (334, 'ur', 'اے ٹی وی'),
  (335, 'ar', 'مقطورات'),                 (335, 'ur', 'ٹریلر'),
  (336, 'ar', 'قطع غيار'),                (336, 'ur', 'اسپیئر پارٹس'),
  (337, 'ar', 'إكسسوارات المركبات'),      (337, 'ur', 'گاڑی کے لوازمات'),
  (310, 'ar', 'سيدان'),                   (310, 'ur', 'سیڈان'),
  (311, 'ar', 'هاتشباك'),                 (311, 'ur', 'ہیچ بیک'),
  (312, 'ar', 'دفع رباعي'),               (312, 'ur', 'ایس یو وی'),
  (313, 'ar', 'كروس أوفر'),               (313, 'ur', 'کراس اوور'),
  (314, 'ar', 'كوبيه'),                   (314, 'ur', 'کوپے'),
  (315, 'ar', 'مكشوفة'),                  (315, 'ur', 'کنورٹیبل'),
  (316, 'ar', 'ستيشن واغن'),              (316, 'ur', 'ویگن'),
  (317, 'ar', 'بيك أب'),                  (317, 'ur', 'پک اپ'),
  (318, 'ar', 'فان'),                     (318, 'ur', 'وین / ایم پی وی'),
  (320, 'ar', 'رياضية'),                  (320, 'ur', 'اسپورٹس'),
  (321, 'ar', 'كروزر'),                   (321, 'ur', 'کروزر'),
  (322, 'ar', 'سكوتر'),                   (322, 'ur', 'اسکوٹر'),
  (323, 'ar', 'قياسية'),                  (323, 'ur', 'اسٹینڈرڈ'),
  (324, 'ar', 'الطرق الوعرة'),            (324, 'ur', 'آف روڈ'),
  (325, 'ar', 'كهربائية'),                (325, 'ur', 'الیکٹرک')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- -----------------------------------------------------------------------------
-- 7. Sort options (spec line 5 "also add sort option"). `sort_field` is the
--    real column path the query builder resolves, so a new sort is a seed row.
-- -----------------------------------------------------------------------------
INSERT INTO sort_options (id, marketplace_id, code, label, sort_field, direction, applies_to, requires_location, is_default, sort_order, is_active) VALUES
  -- Global
  ( 1, NULL, 'relevance',          'Most relevant',       'relevance',                                'desc', 'all',      FALSE, TRUE,  1, TRUE),
  ( 2, NULL, 'date_desc',          'Newest first',        'listings.published_at',                    'desc', 'all',      FALSE, FALSE, 2, TRUE),
  ( 3, NULL, 'date_asc',           'Oldest first',        'listings.published_at',                    'asc',  'all',      FALSE, FALSE, 3, TRUE),
  ( 4, NULL, 'price_asc',          'Price: low to high',  'listings.price_base',                      'asc',  'all',      FALSE, FALSE, 4, TRUE),
  ( 5, NULL, 'price_desc',         'Price: high to low',  'listings.price_base',                      'desc', 'all',      FALSE, FALSE, 5, TRUE),
  ( 6, NULL, 'popular',            'Most viewed',         'listings.view_count',                      'desc', 'all',      FALSE, FALSE, 6, TRUE),
  ( 7, NULL, 'distance_asc',       'Nearest first',       'distance',                                 'asc',  'all',      TRUE,  FALSE, 7, TRUE),
  -- Gold (§5 Weight / Karat)
  (11, 1,    'weight_asc',         'Weight: low to high', 'gold_listing_details.net_weight_g',        'asc',  'listings', FALSE, FALSE, 11, TRUE),
  (12, 1,    'weight_desc',        'Weight: high to low', 'gold_listing_details.net_weight_g',        'desc', 'listings', FALSE, FALSE, 12, TRUE),
  (13, 1,    'karat_desc',         'Highest purity',      'gold_listing_details.karat',               'desc', 'listings', FALSE, FALSE, 13, TRUE),
  (14, 1,    'price_per_gram_asc', 'Cheapest per gram',   'gold_listing_details.rate_per_gram',       'asc',  'listings', FALSE, FALSE, 14, TRUE),
  -- Property (§6 Area / Bedrooms)
  (21, 2,    'area_asc',           'Area: small to large','property_listing_details.area_sqm',        'asc',  'listings', FALSE, FALSE, 21, TRUE),
  (22, 2,    'area_desc',          'Area: large to small','property_listing_details.area_sqm',        'desc', 'listings', FALSE, FALSE, 22, TRUE),
  (23, 2,    'price_per_area_asc', 'Cheapest per area',   'property_listing_details.price_per_sqm',   'asc',  'listings', FALSE, FALSE, 23, TRUE),
  (24, 2,    'bedrooms_desc',      'Most bedrooms',       'property_listing_details.bedrooms',        'desc', 'listings', FALSE, FALSE, 24, TRUE),
  -- Vehicles (§7 Mileage / Year / Engine)
  (31, 3,    'mileage_asc',        'Lowest mileage',      'vehicle_listing_details.mileage_km',       'asc',  'listings', FALSE, FALSE, 31, TRUE),
  (32, 3,    'year_desc',          'Newest model year',   'vehicle_listing_details.year',             'desc', 'listings', FALSE, FALSE, 32, TRUE),
  (33, 3,    'year_asc',           'Oldest model year',   'vehicle_listing_details.year',             'asc',  'listings', FALSE, FALSE, 33, TRUE),
  (34, 3,    'engine_desc',        'Largest engine',      'vehicle_listing_details.engine_cc',        'desc', 'listings', FALSE, FALSE, 34, TRUE)
ON DUPLICATE KEY UPDATE
  marketplace_id = VALUES(marketplace_id), code = VALUES(code), label = VALUES(label),
  sort_field = VALUES(sort_field), direction = VALUES(direction), applies_to = VALUES(applies_to),
  requires_location = VALUES(requires_location), is_default = VALUES(is_default),
  sort_order = VALUES(sort_order), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 8. Review criteria (§20 Reviews). Lives here rather than in 02 because
--    review_criteria.marketplace_id carries an FK to marketplaces. Explicit ids
--    are required: the unique key is (marketplace_id, code) and MySQL treats
--    each NULL marketplace_id as distinct, so ON DUPLICATE KEY would otherwise
--    insert the global rows again on every run.
-- -----------------------------------------------------------------------------
INSERT INTO review_criteria (id, marketplace_id, code, label, applies_to, sort_order, is_active) VALUES
  -- Global
  ( 1, NULL, 'communication',             'Communication',            'all',       1, TRUE),
  ( 2, NULL, 'accuracy_of_description',   'Accuracy of description',  'all',       2, TRUE),
  ( 3, NULL, 'price_fairness',            'Price fairness',           'all',       3, TRUE),
  ( 4, NULL, 'professionalism',           'Professionalism',          'all',       4, TRUE),
  ( 5, NULL, 'response_time',             'Response time',            'all',       5, TRUE),
  -- Gold
  (11, 1,    'purity_as_described',       'Purity as described',      'listing',   1, TRUE),
  (12, 1,    'packaging',                 'Packaging',                'listing',   2, TRUE),
  (13, 1,    'certification',             'Certification',            'gold_shop', 3, TRUE),
  -- Property
  (21, 2,    'property_condition',        'Property condition',       'listing',   1, TRUE),
  (22, 2,    'location_accuracy',         'Location accuracy',        'listing',   2, TRUE),
  (23, 2,    'landlord_behaviour',        'Landlord behaviour',       'seller',    3, TRUE),
  (24, 2,    'value_for_money',           'Value for money',          'listing',   4, TRUE),
  -- Vehicles
  (31, 3,    'vehicle_condition',         'Vehicle condition',        'listing',   1, TRUE),
  (32, 3,    'mechanical_condition',      'Mechanical condition',     'listing',   2, TRUE),
  (33, 3,    'paperwork',                 'Paperwork',                'seller',    3, TRUE),
  (34, 3,    'test_drive_experience',     'Test drive experience',    'dealer',    4, TRUE)
ON DUPLICATE KEY UPDATE
  marketplace_id = VALUES(marketplace_id), code = VALUES(code), label = VALUES(label),
  applies_to = VALUES(applies_to), sort_order = VALUES(sort_order), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 9. Gold brands (§5 Brand, §10 Brand filter). Vehicle makes live in their own
--    catalogue (vehicle_makes) because they carry model/variant hierarchies.
-- -----------------------------------------------------------------------------
INSERT INTO brands (id, marketplace_id, name, slug, country_id, is_popular, is_active, sort_order) VALUES
  ( 1, 1, 'Tanishq',           'tanishq',           2,    TRUE,  TRUE,  1),
  ( 2, 1, 'Malabar Gold',      'malabar-gold',      2,    TRUE,  TRUE,  2),
  ( 3, 1, 'Kalyan Jewellers',  'kalyan-jewellers',  2,    TRUE,  TRUE,  3),
  ( 4, 1, 'PC Jeweller',       'pc-jeweller',       2,    FALSE, TRUE,  4),
  ( 5, 1, 'Damas',             'damas',             3,    TRUE,  TRUE,  5),
  ( 6, 1, 'Joyalukkas',        'joyalukkas',        3,    TRUE,  TRUE,  6),
  ( 7, 1, 'ARY Gold',          'ary-gold',          1,    TRUE,  TRUE,  7),
  ( 8, 1, 'Hafeez Jewellers',  'hafeez-jewellers',  1,    FALSE, TRUE,  8),
  ( 9, 1, 'PAMP Suisse',       'pamp-suisse',       37,   TRUE,  TRUE,  9),
  (10, 1, 'Valcambi',          'valcambi',          37,   TRUE,  TRUE, 10),
  (11, 1, 'Perth Mint',        'perth-mint',        8,    TRUE,  TRUE, 11),
  (12, 1, 'Emirates Gold',     'emirates-gold',     3,    TRUE,  TRUE, 12),
  (13, 1, 'Argor-Heraeus',     'argor-heraeus',     37,   FALSE, TRUE, 13),
  (14, 1, 'Credit Suisse',     'credit-suisse',     37,   FALSE, TRUE, 14),
  (15, 1, 'Local Goldsmith',   'local-goldsmith',   NULL, TRUE,  TRUE, 15)
ON DUPLICATE KEY UPDATE
  marketplace_id = VALUES(marketplace_id), name = VALUES(name), slug = VALUES(slug),
  country_id = VALUES(country_id), is_popular = VALUES(is_popular),
  is_active = VALUES(is_active), sort_order = VALUES(sort_order);
