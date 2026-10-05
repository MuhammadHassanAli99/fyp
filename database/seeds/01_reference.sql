-- =============================================================================
-- 01  Reference data: platforms, currencies, languages, countries, geography,
--     units, FX, taxes, runtime settings, feature flags, cron registry
--     Satisfies spec §1 (country/language/currency/location), §27 (platforms),
--     §28 (localization: taxes, units, address & phone formats, time zones).
--     Re-runnable: every insert is keyed on the primary/unique key.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1. Client platforms (§27 Cross-Platform Features)
-- -----------------------------------------------------------------------------
INSERT INTO platforms (id, code, name, is_active) VALUES
  (1, 'web',     'Web',     TRUE),
  (2, 'android', 'Android', TRUE),
  (3, 'ios',     'iOS',     TRUE),
  (4, 'windows', 'Windows', TRUE),
  (5, 'macos',   'macOS',   TRUE),
  (6, 'linux',   'Linux',   TRUE)
ON DUPLICATE KEY UPDATE
  code = VALUES(code), name = VALUES(name), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 2. Currencies (§1 Currency) — the 11 named in the spec plus every currency
--    used by a seeded country. decimal_digits: 0 for JPY/KRW/VND/CLP,
--    3 for the Gulf/Maghreb dinars, 2 elsewhere.
-- -----------------------------------------------------------------------------
INSERT INTO currencies (code, numeric_code, name, symbol, symbol_position, decimal_digits, thousands_sep, decimal_sep, is_active) VALUES
  -- Spec §1 named currencies
  ('USD', 840, 'US Dollar',            '$',     'prefix', 2, ',', '.', TRUE),
  ('EUR', 978, 'Euro',                 '€',     'prefix', 2, '.', ',', TRUE),
  ('GBP', 826, 'British Pound',        '£',     'prefix', 2, ',', '.', TRUE),
  ('PKR', 586, 'Pakistani Rupee',      '₨',     'prefix', 2, ',', '.', TRUE),
  ('INR', 356, 'Indian Rupee',         '₹',     'prefix', 2, ',', '.', TRUE),
  ('SAR', 682, 'Saudi Riyal',          'SR',    'prefix', 2, ',', '.', TRUE),
  ('AED', 784, 'UAE Dirham',           'د.إ',   'prefix', 2, ',', '.', TRUE),
  ('CAD', 124, 'Canadian Dollar',      'C$',    'prefix', 2, ',', '.', TRUE),
  ('AUD',  36, 'Australian Dollar',    'A$',    'prefix', 2, ',', '.', TRUE),
  ('TRY', 949, 'Turkish Lira',         '₺',     'prefix', 2, '.', ',', TRUE),
  ('JPY', 392, 'Japanese Yen',         '¥',     'prefix', 0, ',', '.', TRUE),
  -- Asia-Pacific
  ('CNY', 156, 'Chinese Yuan',         '¥',     'prefix', 2, ',', '.', TRUE),
  ('MYR', 458, 'Malaysian Ringgit',    'RM',    'prefix', 2, ',', '.', TRUE),
  ('IDR', 360, 'Indonesian Rupiah',    'Rp',    'prefix', 2, '.', ',', TRUE),
  ('THB', 764, 'Thai Baht',            '฿',     'prefix', 2, ',', '.', TRUE),
  ('PHP', 608, 'Philippine Peso',      '₱',     'prefix', 2, ',', '.', TRUE),
  ('BDT',  50, 'Bangladeshi Taka',     '৳',     'prefix', 2, ',', '.', TRUE),
  ('LKR', 144, 'Sri Lankan Rupee',     'Rs',    'prefix', 2, ',', '.', TRUE),
  ('NPR', 524, 'Nepalese Rupee',       'रू',    'prefix', 2, ',', '.', TRUE),
  ('SGD', 702, 'Singapore Dollar',     'S$',    'prefix', 2, ',', '.', TRUE),
  ('HKD', 344, 'Hong Kong Dollar',     'HK$',   'prefix', 2, ',', '.', TRUE),
  ('KRW', 410, 'South Korean Won',     '₩',     'prefix', 0, ',', '.', TRUE),
  ('TWD', 901, 'New Taiwan Dollar',    'NT$',   'prefix', 2, ',', '.', TRUE),
  ('VND', 704, 'Vietnamese Dong',      '₫',     'suffix', 0, '.', ',', TRUE),
  ('NZD', 554, 'New Zealand Dollar',   'NZ$',   'prefix', 2, ',', '.', TRUE),
  ('MMK', 104, 'Myanmar Kyat',         'K',     'prefix', 2, ',', '.', TRUE),
  -- Middle East
  ('QAR', 634, 'Qatari Riyal',         'QR',    'prefix', 2, ',', '.', TRUE),
  ('KWD', 414, 'Kuwaiti Dinar',        'د.ك',   'prefix', 3, ',', '.', TRUE),
  ('BHD',  48, 'Bahraini Dinar',       'د.ب',   'prefix', 3, ',', '.', TRUE),
  ('OMR', 512, 'Omani Rial',           'ر.ع.',  'prefix', 3, ',', '.', TRUE),
  ('JOD', 400, 'Jordanian Dinar',      'د.ا',   'prefix', 3, ',', '.', TRUE),
  ('ILS', 376, 'Israeli New Shekel',   '₪',     'prefix', 2, ',', '.', TRUE),
  ('IQD', 368, 'Iraqi Dinar',          'ع.د',   'prefix', 3, ',', '.', TRUE),
  ('LBP', 422, 'Lebanese Pound',       'ل.ل',   'prefix', 2, ',', '.', TRUE),
  ('AFN', 971, 'Afghan Afghani',       '؋',     'prefix', 2, ',', '.', TRUE),
  -- Africa
  ('ZAR', 710, 'South African Rand',   'R',     'prefix', 2, ',', '.', TRUE),
  ('EGP', 818, 'Egyptian Pound',       'E£',    'prefix', 2, ',', '.', TRUE),
  ('NGN', 566, 'Nigerian Naira',       '₦',     'prefix', 2, ',', '.', TRUE),
  ('KES', 404, 'Kenyan Shilling',      'KSh',   'prefix', 2, ',', '.', TRUE),
  ('MAD', 504, 'Moroccan Dirham',      'د.م.',  'prefix', 2, ',', '.', TRUE),
  ('DZD',  12, 'Algerian Dinar',       'د.ج',   'prefix', 2, ',', '.', TRUE),
  ('TND', 788, 'Tunisian Dinar',       'د.ت',   'prefix', 3, ',', '.', TRUE),
  ('LRD', 430, 'Liberian Dollar',      'L$',    'prefix', 2, ',', '.', TRUE),
  -- Europe & Central Asia
  ('CHF', 756, 'Swiss Franc',          'CHF',   'prefix', 2, ',', '.', TRUE),
  ('SEK', 752, 'Swedish Krona',        'kr',    'suffix', 2, ' ', ',', TRUE),
  ('NOK', 578, 'Norwegian Krone',      'kr',    'suffix', 2, ' ', ',', TRUE),
  ('DKK', 208, 'Danish Krone',         'kr',    'suffix', 2, '.', ',', TRUE),
  ('PLN', 985, 'Polish Zloty',         'zł',    'suffix', 2, ' ', ',', TRUE),
  ('CZK', 203, 'Czech Koruna',         'Kč',    'suffix', 2, ' ', ',', TRUE),
  ('HUF', 348, 'Hungarian Forint',     'Ft',    'suffix', 2, ' ', ',', TRUE),
  ('RON', 946, 'Romanian Leu',         'lei',   'suffix', 2, '.', ',', TRUE),
  ('RUB', 643, 'Russian Ruble',        '₽',     'prefix', 2, ' ', ',', TRUE),
  ('UAH', 980, 'Ukrainian Hryvnia',    '₴',     'prefix', 2, ' ', ',', TRUE),
  ('KZT', 398, 'Kazakhstani Tenge',    '₸',     'suffix', 2, ' ', ',', TRUE),
  ('UZS', 860, 'Uzbekistani Som',      'soʻm',  'prefix', 2, ' ', ',', TRUE),
  ('AZN', 944, 'Azerbaijani Manat',    '₼',     'prefix', 2, ',', '.', TRUE),
  ('GEL', 981, 'Georgian Lari',        '₾',     'prefix', 2, ',', '.', TRUE),
  -- Americas
  ('BRL', 986, 'Brazilian Real',       'R$',    'prefix', 2, '.', ',', TRUE),
  ('MXN', 484, 'Mexican Peso',         'Mex$',  'prefix', 2, ',', '.', TRUE),
  ('ARS',  32, 'Argentine Peso',       'AR$',   'prefix', 2, '.', ',', TRUE),
  ('CLP', 152, 'Chilean Peso',         'CL$',   'prefix', 0, '.', ',', TRUE),
  ('COP', 170, 'Colombian Peso',       'CO$',   'prefix', 2, '.', ',', TRUE),
  ('PEN', 604, 'Peruvian Sol',         'S/',    'prefix', 2, ',', '.', TRUE)
ON DUPLICATE KEY UPDATE
  numeric_code = VALUES(numeric_code), name = VALUES(name), symbol = VALUES(symbol),
  symbol_position = VALUES(symbol_position), decimal_digits = VALUES(decimal_digits),
  thousands_sep = VALUES(thousands_sep), decimal_sep = VALUES(decimal_sep),
  is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 3. Languages (§1 Language) — the 11 named in the spec plus the languages of
--    the most populous countries. direction='rtl' for ar/ur/fa/he/ps/ku.
-- -----------------------------------------------------------------------------
INSERT INTO languages (code, name, native_name, direction, is_active, is_default, sort_order) VALUES
  ('en', 'English',            'English',           'ltr', TRUE, TRUE,  1),
  ('ar', 'Arabic',             'العربية',            'rtl', TRUE, FALSE, 2),
  ('ur', 'Urdu',               'اردو',               'rtl', TRUE, FALSE, 3),
  ('hi', 'Hindi',              'हिन्दी',              'ltr', TRUE, FALSE, 4),
  ('fr', 'French',             'Français',          'ltr', TRUE, FALSE, 5),
  ('de', 'German',             'Deutsch',           'ltr', TRUE, FALSE, 6),
  ('es', 'Spanish',            'Español',           'ltr', TRUE, FALSE, 7),
  ('zh', 'Chinese',            '中文',               'ltr', TRUE, FALSE, 8),
  ('ja', 'Japanese',           '日本語',              'ltr', TRUE, FALSE, 9),
  ('tr', 'Turkish',            'Türkçe',            'ltr', TRUE, FALSE, 10),
  ('ru', 'Russian',            'Русский',           'ltr', TRUE, FALSE, 11),
  ('pt', 'Portuguese',         'Português',         'ltr', TRUE, FALSE, 12),
  ('it', 'Italian',            'Italiano',          'ltr', TRUE, FALSE, 13),
  ('id', 'Indonesian',         'Bahasa Indonesia',  'ltr', TRUE, FALSE, 14),
  ('ms', 'Malay',              'Bahasa Melayu',     'ltr', TRUE, FALSE, 15),
  ('bn', 'Bengali',            'বাংলা',              'ltr', TRUE, FALSE, 16),
  ('fa', 'Persian',            'فارسی',              'rtl', TRUE, FALSE, 17),
  ('he', 'Hebrew',             'עברית',              'rtl', TRUE, FALSE, 18),
  ('ko', 'Korean',             '한국어',              'ltr', TRUE, FALSE, 19),
  ('th', 'Thai',               'ไทย',                'ltr', TRUE, FALSE, 20),
  ('vi', 'Vietnamese',         'Tiếng Việt',        'ltr', TRUE, FALSE, 21),
  ('nl', 'Dutch',              'Nederlands',        'ltr', TRUE, FALSE, 22),
  ('pl', 'Polish',             'Polski',            'ltr', TRUE, FALSE, 23),
  ('sv', 'Swedish',            'Svenska',           'ltr', TRUE, FALSE, 24),
  ('uk', 'Ukrainian',          'Українська',        'ltr', TRUE, FALSE, 25),
  ('sw', 'Swahili',            'Kiswahili',         'ltr', TRUE, FALSE, 26),
  ('ta', 'Tamil',              'தமிழ்',              'ltr', TRUE, FALSE, 27),
  ('te', 'Telugu',             'తెలుగు',             'ltr', TRUE, FALSE, 28),
  ('pa', 'Punjabi',            'ਪੰਜਾਬੀ',              'ltr', TRUE, FALSE, 29),
  ('ps', 'Pashto',             'پښتو',               'rtl', TRUE, FALSE, 30),
  ('ku', 'Kurdish (Sorani)',   'کوردی',              'rtl', TRUE, FALSE, 31),
  ('az', 'Azerbaijani',        'Azərbaycan dili',   'ltr', TRUE, FALSE, 32),
  ('uz', 'Uzbek',              'Oʻzbekcha',         'ltr', TRUE, FALSE, 33),
  ('kk', 'Kazakh',             'Қазақша',           'ltr', TRUE, FALSE, 34),
  ('ro', 'Romanian',           'Română',            'ltr', TRUE, FALSE, 35),
  ('el', 'Greek',              'Ελληνικά',          'ltr', TRUE, FALSE, 36),
  ('cs', 'Czech',              'Čeština',           'ltr', TRUE, FALSE, 37),
  ('hu', 'Hungarian',          'Magyar',            'ltr', TRUE, FALSE, 38),
  ('da', 'Danish',             'Dansk',             'ltr', TRUE, FALSE, 39),
  ('nb', 'Norwegian Bokmal',   'Norsk bokmål',      'ltr', TRUE, FALSE, 40),
  ('fi', 'Finnish',            'Suomi',             'ltr', TRUE, FALSE, 41)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), native_name = VALUES(native_name), direction = VALUES(direction),
  is_active = VALUES(is_active), is_default = VALUES(is_default), sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 4. Countries (§1, §28) — ids are pinned: PK=1, IN=2, AE=3, SA=4, US=5, GB=6
--    so every later seed can reference the launch markets by number.
--    area_unit is the DEFAULT DISPLAY unit; gold_weight_unit is tola in South
--    Asia, troy ounce in the US/UK, gram elsewhere. requires_kyc/aml is TRUE
--    for the gold-trade-regulated markets (§19 KYC / AML where required).
-- -----------------------------------------------------------------------------
INSERT INTO countries (id, iso2, iso3, name, native_name, dial_code, flag_emoji, default_currency, default_language, default_timezone, measurement_system, area_unit, weight_unit, distance_unit, gold_weight_unit, address_format, phone_format, postal_code_regex, date_format, time_format, first_day_of_week, vat_rate, requires_kyc, requires_aml, is_active, sort_order) VALUES
  -- Primary launch markets
  ( 1, 'PK', 'PAK', 'Pakistan',              'پاکستان',              '+92',  '🇵🇰', 'PKR', 'ur', 'Asia/Karachi',        'metric',   'sqft', 'kg', 'km', 'tola',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '### #######',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'hh:mm a', 1, 18.000, FALSE, FALSE, TRUE,  1),
  ( 2, 'IN', 'IND', 'India',                 'भारत',                 '+91',  '🇮🇳', 'INR', 'hi', 'Asia/Kolkata',        'metric',   'sqft', 'kg', 'km', 'tola',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '##### #####',   '^[1-9][0-9]{5}$',                                'dd/MM/yyyy', 'hh:mm a', 1, 18.000, TRUE,  TRUE,  TRUE,  2),
  ( 3, 'AE', 'ARE', 'United Arab Emirates',  'الإمارات العربية المتحدة', '+971', '🇦🇪', 'AED', 'ar', 'Asia/Dubai',      'metric',   'sqft', 'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","country"]',              '## ### ####',   NULL,                                             'dd/MM/yyyy', 'HH:mm',   6,  5.000, TRUE,  TRUE,  TRUE,  3),
  ( 4, 'SA', 'SAU', 'Saudi Arabia',          'المملكة العربية السعودية', '+966', '🇸🇦', 'SAR', 'ar', 'Asia/Riyadh',     'metric',   'sqft', 'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '## ### ####',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   6, 15.000, TRUE,  TRUE,  TRUE,  4),
  ( 5, 'US', 'USA', 'United States',         'United States',        '+1',   '🇺🇸', 'USD', 'en', 'America/New_York',    'imperial', 'sqft', 'lb', 'mi', 'ounce', '["address_line1","address_line2","city","region","postal_code","country"]',        '(###) ###-####','^[0-9]{5}(-[0-9]{4})?$',                         'MM/dd/yyyy', 'hh:mm a', 0,  0.000, TRUE,  TRUE,  TRUE,  5),
  ( 6, 'GB', 'GBR', 'United Kingdom',        'United Kingdom',       '+44',  '🇬🇧', 'GBP', 'en', 'Europe/London',       'metric',   'sqm',  'kg', 'mi', 'ounce', '["address_line1","address_line2","city","region","postal_code","country"]',        '#### ######',   '^[A-Z]{1,2}[0-9R][0-9A-Z]?[ ]?[0-9][ABD-HJLNP-UW-Z]{2}$', 'dd/MM/yyyy', 'HH:mm', 1, 20.000, TRUE, TRUE, TRUE, 6),
  -- Rest of the world
  ( 7, 'CA', 'CAN', 'Canada',                'Canada',               '+1',   '🇨🇦', 'CAD', 'en', 'America/Toronto',     'metric',   'sqft', 'kg', 'km', 'gram',  '["address_line1","address_line2","city","region","postal_code","country"]',        '(###) ###-####','^[A-Z][0-9][A-Z][ ]?[0-9][A-Z][0-9]$',           'dd/MM/yyyy', 'hh:mm a', 0,  5.000, FALSE, FALSE, TRUE, 10),
  ( 8, 'AU', 'AUS', 'Australia',             'Australia',            '+61',  '🇦🇺', 'AUD', 'en', 'Australia/Sydney',    'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","region","postal_code","country"]',        '#### ### ###',  '^[0-9]{4}$',                                     'dd/MM/yyyy', 'hh:mm a', 1, 10.000, FALSE, FALSE, TRUE, 11),
  ( 9, 'TR', 'TUR', 'Turkey',                'Türkiye',              '+90',  '🇹🇷', 'TRY', 'tr', 'Europe/Istanbul',     'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '### ### ####',  '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 20.000, TRUE,  TRUE,  TRUE, 12),
  (10, 'JP', 'JPN', 'Japan',                 '日本',                  '+81',  '🇯🇵', 'JPY', 'ja', 'Asia/Tokyo',          'metric',   'sqm',  'kg', 'km', 'gram',  '["country","region","city","address_line1","address_line2","postal_code"]',        '##-####-####',  '^[0-9]{3}-[0-9]{4}$',                            'yyyy-MM-dd', 'HH:mm',   0, 10.000, FALSE, FALSE, TRUE, 13),
  (11, 'DE', 'DEU', 'Germany',               'Deutschland',          '+49',  '🇩🇪', 'EUR', 'de', 'Europe/Berlin',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '#### #######',  '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 19.000, FALSE, FALSE, TRUE, 14),
  (12, 'FR', 'FRA', 'France',                'France',               '+33',  '🇫🇷', 'EUR', 'fr', 'Europe/Paris',        'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '## ## ## ## ##','^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 20.000, FALSE, FALSE, TRUE, 15),
  (13, 'ES', 'ESP', 'Spain',                 'España',               '+34',  '🇪🇸', 'EUR', 'es', 'Europe/Madrid',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ### ###',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 21.000, FALSE, FALSE, TRUE, 16),
  (14, 'IT', 'ITA', 'Italy',                 'Italia',               '+39',  '🇮🇹', 'EUR', 'it', 'Europe/Rome',         'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ### ####',  '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 22.000, FALSE, FALSE, TRUE, 17),
  (15, 'NL', 'NLD', 'Netherlands',           'Nederland',            '+31',  '🇳🇱', 'EUR', 'nl', 'Europe/Amsterdam',    'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '## ########',   '^[0-9]{4}[ ]?[A-Z]{2}$',                         'dd/MM/yyyy', 'HH:mm',   1, 21.000, FALSE, FALSE, TRUE, 18),
  (16, 'CN', 'CHN', 'China',                 '中国',                  '+86',  '🇨🇳', 'CNY', 'zh', 'Asia/Shanghai',       'metric',   'sqm',  'kg', 'km', 'gram',  '["country","region","city","address_line1","address_line2","postal_code"]',        '### #### ####', '^[0-9]{6}$',                                     'yyyy-MM-dd', 'HH:mm',   1, 13.000, FALSE, FALSE, TRUE, 19),
  (17, 'RU', 'RUS', 'Russia',                'Россия',               '+7',   '🇷🇺', 'RUB', 'ru', 'Europe/Moscow',       'metric',   'sqm',  'kg', 'km', 'gram',  '["country","postal_code","region","city","address_line1","address_line2"]',        '### ###-##-##', '^[0-9]{6}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 20.000, FALSE, FALSE, TRUE, 20),
  (18, 'BR', 'BRA', 'Brazil',                'Brasil',               '+55',  '🇧🇷', 'BRL', 'pt', 'America/Sao_Paulo',   'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '(##) #####-####','^[0-9]{5}-?[0-9]{3}$',                          'dd/MM/yyyy', 'HH:mm',   0, 17.000, FALSE, FALSE, TRUE, 21),
  (19, 'ZA', 'ZAF', 'South Africa',          'South Africa',         '+27',  '🇿🇦', 'ZAR', 'en', 'Africa/Johannesburg', 'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '## ### ####',   '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 15.000, FALSE, FALSE, TRUE, 22),
  (20, 'EG', 'EGY', 'Egypt',                 'مصر',                  '+20',  '🇪🇬', 'EGP', 'ar', 'Africa/Cairo',        'metric',   'sqft', 'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '## ########',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   6, 14.000, FALSE, FALSE, TRUE, 23),
  (21, 'NG', 'NGA', 'Nigeria',               'Nigeria',              '+234', '🇳🇬', 'NGN', 'en', 'Africa/Lagos',        'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '### ### ####',  '^[0-9]{6}$',                                     'dd/MM/yyyy', 'HH:mm',   1,  7.500, FALSE, FALSE, TRUE, 24),
  (22, 'KE', 'KEN', 'Kenya',                 'Kenya',                '+254', '🇰🇪', 'KES', 'sw', 'Africa/Nairobi',      'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '### ######',    '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 16.000, FALSE, FALSE, TRUE, 25),
  (23, 'MY', 'MYS', 'Malaysia',              'Malaysia',             '+60',  '🇲🇾', 'MYR', 'ms', 'Asia/Kuala_Lumpur',   'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","region","country"]',        '##-### ####',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1,  8.000, FALSE, FALSE, TRUE, 26),
  (24, 'ID', 'IDN', 'Indonesia',             'Indonesia',            '+62',  '🇮🇩', 'IDR', 'id', 'Asia/Jakarta',        'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '###-####-####', '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 11.000, FALSE, FALSE, TRUE, 27),
  (25, 'TH', 'THA', 'Thailand',              'ประเทศไทย',             '+66',  '🇹🇭', 'THB', 'th', 'Asia/Bangkok',        'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '##-###-####',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   0,  7.000, FALSE, FALSE, TRUE, 28),
  (26, 'PH', 'PHL', 'Philippines',           'Pilipinas',            '+63',  '🇵🇭', 'PHP', 'en', 'Asia/Manila',         'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '### ### ####',  '^[0-9]{4}$',                                     'dd/MM/yyyy', 'hh:mm a', 0, 12.000, FALSE, FALSE, TRUE, 29),
  (27, 'BD', 'BGD', 'Bangladesh',            'বাংলাদেশ',              '+880', '🇧🇩', 'BDT', 'bn', 'Asia/Dhaka',          'metric',   'sqft', 'kg', 'km', 'tola',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '####-######',   '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   0, 15.000, FALSE, FALSE, TRUE, 30),
  (28, 'LK', 'LKA', 'Sri Lanka',             'ශ්‍රී ලංකා',              '+94',  '🇱🇰', 'LKR', 'en', 'Asia/Colombo',        'metric',   'sqft', 'kg', 'km', 'tola',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '## ### ####',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 18.000, FALSE, FALSE, TRUE, 31),
  (29, 'QA', 'QAT', 'Qatar',                 'قطر',                  '+974', '🇶🇦', 'QAR', 'ar', 'Asia/Qatar',          'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","country"]',                        '#### ####',     NULL,                                             'dd/MM/yyyy', 'HH:mm',   6,  0.000, FALSE, FALSE, TRUE, 32),
  (30, 'KW', 'KWT', 'Kuwait',                'الكويت',                '+965', '🇰🇼', 'KWD', 'ar', 'Asia/Kuwait',         'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","postal_code","country"]',          '#### ####',     '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   6,  0.000, FALSE, FALSE, TRUE, 33),
  (31, 'BH', 'BHR', 'Bahrain',               'البحرين',               '+973', '🇧🇭', 'BHD', 'ar', 'Asia/Bahrain',        'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","postal_code","country"]',          '#### ####',     '^[0-9]{3,4}$',                                   'dd/MM/yyyy', 'HH:mm',   6, 10.000, FALSE, FALSE, TRUE, 34),
  (32, 'OM', 'OMN', 'Oman',                  'عمان',                 '+968', '🇴🇲', 'OMR', 'ar', 'Asia/Muscat',         'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","postal_code","country"]',          '#### ####',     '^[0-9]{3}$',                                     'dd/MM/yyyy', 'HH:mm',   6,  5.000, FALSE, FALSE, TRUE, 35),
  (33, 'JO', 'JOR', 'Jordan',                'الأردن',                '+962', '🇯🇴', 'JOD', 'ar', 'Asia/Amman',          'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","postal_code","country"]',          '# #### ####',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   6, 16.000, FALSE, FALSE, TRUE, 36),
  (34, 'MA', 'MAR', 'Morocco',               'المغرب',                '+212', '🇲🇦', 'MAD', 'ar', 'Africa/Casablanca',   'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '###-######',    '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   6, 20.000, FALSE, FALSE, TRUE, 37),
  (35, 'DZ', 'DZA', 'Algeria',               'الجزائر',               '+213', '🇩🇿', 'DZD', 'ar', 'Africa/Algiers',      'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ## ## ##',  '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   6, 19.000, FALSE, FALSE, TRUE, 38),
  (36, 'TN', 'TUN', 'Tunisia',               'تونس',                 '+216', '🇹🇳', 'TND', 'ar', 'Africa/Tunis',        'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '## ### ###',    '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   6, 19.000, FALSE, FALSE, TRUE, 39),
  (37, 'CH', 'CHE', 'Switzerland',           'Schweiz',              '+41',  '🇨🇭', 'CHF', 'de', 'Europe/Zurich',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '## ### ## ##',  '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   1,  8.100, TRUE,  TRUE,  TRUE, 40),
  (38, 'SE', 'SWE', 'Sweden',                'Sverige',              '+46',  '🇸🇪', 'SEK', 'sv', 'Europe/Stockholm',    'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '##-### ## ##',  '^[0-9]{3}[ ]?[0-9]{2}$',                         'dd/MM/yyyy', 'HH:mm',   1, 25.000, FALSE, FALSE, TRUE, 41),
  (39, 'NO', 'NOR', 'Norway',                'Norge',                '+47',  '🇳🇴', 'NOK', 'nb', 'Europe/Oslo',         'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ## ###',    '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 25.000, FALSE, FALSE, TRUE, 42),
  (40, 'DK', 'DNK', 'Denmark',               'Danmark',              '+45',  '🇩🇰', 'DKK', 'da', 'Europe/Copenhagen',   'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '## ## ## ##',   '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 25.000, FALSE, FALSE, TRUE, 43),
  (41, 'PL', 'POL', 'Poland',                'Polska',               '+48',  '🇵🇱', 'PLN', 'pl', 'Europe/Warsaw',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ### ###',   '^[0-9]{2}-[0-9]{3}$',                            'dd/MM/yyyy', 'HH:mm',   1, 23.000, FALSE, FALSE, TRUE, 44),
  (42, 'CZ', 'CZE', 'Czechia',               'Česko',                '+420', '🇨🇿', 'CZK', 'cs', 'Europe/Prague',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ### ###',   '^[0-9]{3}[ ]?[0-9]{2}$',                         'dd/MM/yyyy', 'HH:mm',   1, 21.000, FALSE, FALSE, TRUE, 45),
  (43, 'HU', 'HUN', 'Hungary',               'Magyarország',         '+36',  '🇭🇺', 'HUF', 'hu', 'Europe/Budapest',     'metric',   'sqm',  'kg', 'km', 'gram',  '["country","city","address_line1","address_line2","postal_code"]',                '## ### ####',   '^[0-9]{4}$',                                     'yyyy-MM-dd', 'HH:mm',   1, 27.000, FALSE, FALSE, TRUE, 46),
  (44, 'RO', 'ROU', 'Romania',               'România',              '+40',  '🇷🇴', 'RON', 'ro', 'Europe/Bucharest',    'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","region","country"]',        '### ### ###',   '^[0-9]{6}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 19.000, FALSE, FALSE, TRUE, 47),
  (45, 'UA', 'UKR', 'Ukraine',               'Україна',              '+380', '🇺🇦', 'UAH', 'uk', 'Europe/Kyiv',         'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","region","postal_code","country"]',        '## ### ## ##',  '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 20.000, FALSE, FALSE, TRUE, 48),
  (46, 'KZ', 'KAZ', 'Kazakhstan',            'Қазақстан',            '+7',   '🇰🇿', 'KZT', 'kk', 'Asia/Almaty',         'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","region","postal_code","country"]',        '### ### ####',  '^[0-9]{6}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 12.000, FALSE, FALSE, TRUE, 49),
  (47, 'SG', 'SGP', 'Singapore',             'Singapore',            '+65',  '🇸🇬', 'SGD', 'en', 'Asia/Singapore',      'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","country"]',                        '#### ####',     '^[0-9]{6}$',                                     'dd/MM/yyyy', 'hh:mm a', 1,  9.000, TRUE,  TRUE,  TRUE, 50),
  (48, 'HK', 'HKG', 'Hong Kong',             '香港',                  '+852', '🇭🇰', 'HKD', 'zh', 'Asia/Hong_Kong',      'metric',   'sqft', 'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","country"]',                        '#### ####',     NULL,                                             'dd/MM/yyyy', 'HH:mm',   0,  0.000, TRUE,  TRUE,  TRUE, 51),
  (49, 'KR', 'KOR', 'South Korea',           '대한민국',               '+82',  '🇰🇷', 'KRW', 'ko', 'Asia/Seoul',          'metric',   'sqm',  'kg', 'km', 'gram',  '["country","region","city","address_line1","address_line2","postal_code"]',        '##-####-####',  '^[0-9]{5}$',                                     'yyyy-MM-dd', 'HH:mm',   0, 10.000, FALSE, FALSE, TRUE, 52),
  (50, 'NZ', 'NZL', 'New Zealand',           'New Zealand',          '+64',  '🇳🇿', 'NZD', 'en', 'Pacific/Auckland',    'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","postal_code","country"]',                '## ### ####',   '^[0-9]{4}$',                                     'dd/MM/yyyy', 'hh:mm a', 1, 15.000, FALSE, FALSE, TRUE, 53),
  (51, 'MX', 'MEX', 'Mexico',                'México',               '+52',  '🇲🇽', 'MXN', 'es', 'America/Mexico_City', 'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","postal_code","city","region","country"]', '## #### ####',  '^[0-9]{5}$',                                     'dd/MM/yyyy', 'hh:mm a', 0, 16.000, FALSE, FALSE, TRUE, 54),
  (52, 'AR', 'ARG', 'Argentina',             'Argentina',            '+54',  '🇦🇷', 'ARS', 'es', 'America/Argentina/Buenos_Aires', 'metric', 'sqm', 'kg', 'km', 'gram', '["address_line1","address_line2","postal_code","city","region","country"]', '## ####-####',  '^[A-Z]?[0-9]{4}[A-Z]{0,3}$',                     'dd/MM/yyyy', 'HH:mm',   0, 21.000, FALSE, FALSE, TRUE, 55),
  (53, 'CL', 'CHL', 'Chile',                 'Chile',                '+56',  '🇨🇱', 'CLP', 'es', 'America/Santiago',    'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","region","country"]',        '# #### ####',   '^[0-9]{7}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 19.000, FALSE, FALSE, TRUE, 56),
  (54, 'CO', 'COL', 'Colombia',              'Colombia',             '+57',  '🇨🇴', 'COP', 'es', 'America/Bogota',      'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","region","postal_code","country"]',        '### ### ####',  '^[0-9]{6}$',                                     'dd/MM/yyyy', 'hh:mm a', 0, 19.000, FALSE, FALSE, TRUE, 57),
  (55, 'PE', 'PER', 'Peru',                  'Perú',                 '+51',  '🇵🇪', 'PEN', 'es', 'America/Lima',        'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","region","postal_code","country"]',        '### ### ###',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'hh:mm a', 0, 18.000, FALSE, FALSE, TRUE, 58),
  (56, 'VN', 'VNM', 'Vietnam',               'Việt Nam',             '+84',  '🇻🇳', 'VND', 'vi', 'Asia/Ho_Chi_Minh',    'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '### ### ####',  '^[0-9]{6}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 10.000, FALSE, FALSE, TRUE, 59),
  (57, 'TW', 'TWN', 'Taiwan',                '臺灣',                  '+886', '🇹🇼', 'TWD', 'zh', 'Asia/Taipei',         'metric',   'sqm',  'kg', 'km', 'gram',  '["country","region","city","address_line1","address_line2","postal_code"]',        '### ### ###',   '^[0-9]{3}([0-9]{2})?$',                          'yyyy-MM-dd', 'HH:mm',   0,  5.000, FALSE, FALSE, TRUE, 60),
  (58, 'IL', 'ISR', 'Israel',                'ישראל',                 '+972', '🇮🇱', 'ILS', 'he', 'Asia/Jerusalem',      'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","postal_code","country"]',                '##-###-####',   '^[0-9]{5,7}$',                                   'dd/MM/yyyy', 'HH:mm',   0, 17.000, FALSE, FALSE, TRUE, 61),
  (59, 'NP', 'NPL', 'Nepal',                 'नेपाल',                 '+977', '🇳🇵', 'NPR', 'hi', 'Asia/Kathmandu',      'metric',   'sqft', 'kg', 'km', 'tola',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '###-#######',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   0, 13.000, FALSE, FALSE, TRUE, 62),
  (60, 'AF', 'AFG', 'Afghanistan',           'افغانستان',             '+93',  '🇦🇫', 'AFN', 'ps', 'Asia/Kabul',          'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '## ### ####',   '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   6, 10.000, FALSE, FALSE, TRUE, 63),
  (61, 'IQ', 'IRQ', 'Iraq',                  'العراق',                '+964', '🇮🇶', 'IQD', 'ar', 'Asia/Baghdad',        'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '### ### ####',  '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   6,  0.000, FALSE, FALSE, TRUE, 64),
  (62, 'LB', 'LBN', 'Lebanon',               'لبنان',                 '+961', '🇱🇧', 'LBP', 'ar', 'Asia/Beirut',         'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","area","city","postal_code","country"]',          '## ### ###',    '^[0-9]{4}([ ]?[0-9]{4})?$',                      'dd/MM/yyyy', 'HH:mm',   1, 11.000, FALSE, FALSE, TRUE, 65),
  (63, 'UZ', 'UZB', 'Uzbekistan',            'Oʻzbekiston',          '+998', '🇺🇿', 'UZS', 'uz', 'Asia/Tashkent',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","region","postal_code","country"]',        '## ### ## ##',  '^[0-9]{6}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 12.000, FALSE, FALSE, TRUE, 66),
  (64, 'AZ', 'AZE', 'Azerbaijan',            'Azərbaycan',           '+994', '🇦🇿', 'AZN', 'az', 'Asia/Baku',           'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","postal_code","country"]',                '## ### ## ##',  '^AZ[ ]?[0-9]{4}$',                               'dd/MM/yyyy', 'HH:mm',   1, 18.000, FALSE, FALSE, TRUE, 67),
  (65, 'GE', 'GEO', 'Georgia',               'Georgia',              '+995', '🇬🇪', 'GEL', 'en', 'Asia/Tbilisi',        'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","postal_code","country"]',                '### ## ## ##',  '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 18.000, FALSE, FALSE, TRUE, 68),
  (66, 'GR', 'GRC', 'Greece',                'Ελλάδα',               '+30',  '🇬🇷', 'EUR', 'el', 'Europe/Athens',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ### ####',  '^[0-9]{3}[ ]?[0-9]{2}$',                         'dd/MM/yyyy', 'HH:mm',   1, 24.000, FALSE, FALSE, TRUE, 69),
  (67, 'PT', 'PRT', 'Portugal',              'Portugal',             '+351', '🇵🇹', 'EUR', 'pt', 'Europe/Lisbon',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ### ###',   '^[0-9]{4}-[0-9]{3}$',                            'dd/MM/yyyy', 'HH:mm',   1, 23.000, FALSE, FALSE, TRUE, 70),
  (68, 'IE', 'IRL', 'Ireland',               'Éire',                 '+353', '🇮🇪', 'EUR', 'en', 'Europe/Dublin',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","city","region","postal_code","country"]',        '## ### ####',   '^[A-Z][0-9][0-9W][ ]?[0-9A-Z]{4}$',              'dd/MM/yyyy', 'HH:mm',   1, 23.000, FALSE, FALSE, TRUE, 71),
  (69, 'BE', 'BEL', 'Belgium',               'België',               '+32',  '🇧🇪', 'EUR', 'nl', 'Europe/Brussels',     'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ## ## ##',  '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 21.000, FALSE, FALSE, TRUE, 72),
  (70, 'AT', 'AUT', 'Austria',               'Österreich',           '+43',  '🇦🇹', 'EUR', 'de', 'Europe/Vienna',       'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '### ### ####',  '^[0-9]{4}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 20.000, FALSE, FALSE, TRUE, 73),
  (71, 'FI', 'FIN', 'Finland',               'Suomi',                '+358', '🇫🇮', 'EUR', 'fi', 'Europe/Helsinki',     'metric',   'sqm',  'kg', 'km', 'gram',  '["address_line1","address_line2","postal_code","city","country"]',                '## ### ####',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1, 25.500, FALSE, FALSE, TRUE, 74),
  (72, 'MM', 'MMR', 'Myanmar',               'Myanmar',              '+95',  '🇲🇲', 'MMK', 'en', 'Asia/Yangon',         'imperial', 'sqft', 'lb', 'mi', 'gram',  '["address_line1","address_line2","area","city","region","postal_code","country"]', '## ### ####',   '^[0-9]{5}$',                                     'dd/MM/yyyy', 'HH:mm',   1,  5.000, FALSE, FALSE, TRUE, 75),
  (73, 'LR', 'LBR', 'Liberia',               'Liberia',              '+231', '🇱🇷', 'LRD', 'en', 'Africa/Monrovia',     'imperial', 'sqft', 'lb', 'mi', 'ounce', '["address_line1","address_line2","area","city","region","country"]',              '## ### ####',   NULL,                                             'dd/MM/yyyy', 'HH:mm',   1, 10.000, FALSE, FALSE, TRUE, 76)
ON DUPLICATE KEY UPDATE
  iso2 = VALUES(iso2), iso3 = VALUES(iso3), name = VALUES(name), native_name = VALUES(native_name),
  dial_code = VALUES(dial_code), flag_emoji = VALUES(flag_emoji),
  default_currency = VALUES(default_currency), default_language = VALUES(default_language),
  default_timezone = VALUES(default_timezone), measurement_system = VALUES(measurement_system),
  area_unit = VALUES(area_unit), weight_unit = VALUES(weight_unit), distance_unit = VALUES(distance_unit),
  gold_weight_unit = VALUES(gold_weight_unit), address_format = VALUES(address_format),
  phone_format = VALUES(phone_format), postal_code_regex = VALUES(postal_code_regex),
  date_format = VALUES(date_format), time_format = VALUES(time_format),
  first_day_of_week = VALUES(first_day_of_week), vat_rate = VALUES(vat_rate),
  requires_kyc = VALUES(requires_kyc), requires_aml = VALUES(requires_aml),
  is_active = VALUES(is_active), sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- 5. Multi-language / multi-currency countries (§1 Regional translations)
-- -----------------------------------------------------------------------------
INSERT INTO country_languages (country_id, language, is_primary) VALUES
  ( 1, 'ur', TRUE),  ( 1, 'en', FALSE), ( 1, 'pa', FALSE), ( 1, 'ps', FALSE),
  ( 2, 'hi', TRUE),  ( 2, 'en', FALSE), ( 2, 'ta', FALSE), ( 2, 'te', FALSE), ( 2, 'bn', FALSE), ( 2, 'pa', FALSE), ( 2, 'ur', FALSE),
  ( 3, 'ar', TRUE),  ( 3, 'en', FALSE), ( 3, 'ur', FALSE), ( 3, 'hi', FALSE),
  ( 4, 'ar', TRUE),  ( 4, 'en', FALSE), ( 4, 'ur', FALSE),
  ( 5, 'en', TRUE),  ( 5, 'es', FALSE),
  ( 6, 'en', TRUE),  ( 6, 'ur', FALSE), ( 6, 'pl', FALSE),
  ( 7, 'en', TRUE),  ( 7, 'fr', FALSE),
  ( 8, 'en', TRUE),
  ( 9, 'tr', TRUE),  ( 9, 'en', FALSE), ( 9, 'ar', FALSE), ( 9, 'ku', FALSE),
  (10, 'ja', TRUE),  (10, 'en', FALSE),
  (11, 'de', TRUE),  (11, 'en', FALSE), (11, 'tr', FALSE),
  (12, 'fr', TRUE),  (12, 'en', FALSE), (12, 'ar', FALSE),
  (13, 'es', TRUE),  (13, 'en', FALSE),
  (14, 'it', TRUE),  (14, 'en', FALSE),
  (15, 'nl', TRUE),  (15, 'en', FALSE),
  (16, 'zh', TRUE),  (16, 'en', FALSE),
  (17, 'ru', TRUE),  (17, 'en', FALSE),
  (18, 'pt', TRUE),  (18, 'en', FALSE),
  (19, 'en', TRUE),  (19, 'sw', FALSE),
  (20, 'ar', TRUE),  (20, 'en', FALSE),
  (21, 'en', TRUE),
  (22, 'sw', TRUE),  (22, 'en', FALSE),
  (23, 'ms', TRUE),  (23, 'en', FALSE), (23, 'zh', FALSE), (23, 'ta', FALSE),
  (24, 'id', TRUE),  (24, 'en', FALSE),
  (25, 'th', TRUE),  (25, 'en', FALSE),
  (26, 'en', TRUE),
  (27, 'bn', TRUE),  (27, 'en', FALSE),
  (28, 'en', TRUE),  (28, 'ta', FALSE),
  (29, 'ar', TRUE),  (29, 'en', FALSE), (29, 'hi', FALSE),
  (30, 'ar', TRUE),  (30, 'en', FALSE),
  (31, 'ar', TRUE),  (31, 'en', FALSE),
  (32, 'ar', TRUE),  (32, 'en', FALSE),
  (33, 'ar', TRUE),  (33, 'en', FALSE),
  (34, 'ar', TRUE),  (34, 'fr', FALSE),
  (35, 'ar', TRUE),  (35, 'fr', FALSE),
  (36, 'ar', TRUE),  (36, 'fr', FALSE),
  (37, 'de', TRUE),  (37, 'fr', FALSE), (37, 'it', FALSE), (37, 'en', FALSE),
  (38, 'sv', TRUE),  (38, 'en', FALSE),
  (39, 'nb', TRUE),  (39, 'en', FALSE),
  (40, 'da', TRUE),  (40, 'en', FALSE),
  (41, 'pl', TRUE),  (41, 'en', FALSE),
  (42, 'cs', TRUE),  (42, 'en', FALSE),
  (43, 'hu', TRUE),  (43, 'en', FALSE),
  (44, 'ro', TRUE),  (44, 'en', FALSE),
  (45, 'uk', TRUE),  (45, 'ru', FALSE), (45, 'en', FALSE),
  (46, 'kk', TRUE),  (46, 'ru', FALSE), (46, 'en', FALSE),
  (47, 'en', TRUE),  (47, 'zh', FALSE), (47, 'ms', FALSE), (47, 'ta', FALSE),
  (48, 'zh', TRUE),  (48, 'en', FALSE),
  (49, 'ko', TRUE),  (49, 'en', FALSE),
  (50, 'en', TRUE),
  (51, 'es', TRUE),  (51, 'en', FALSE),
  (52, 'es', TRUE),
  (53, 'es', TRUE),
  (54, 'es', TRUE),
  (55, 'es', TRUE),
  (56, 'vi', TRUE),  (56, 'en', FALSE),
  (57, 'zh', TRUE),  (57, 'en', FALSE),
  (58, 'he', TRUE),  (58, 'ar', FALSE), (58, 'en', FALSE), (58, 'ru', FALSE),
  (59, 'hi', TRUE),  (59, 'en', FALSE),
  (60, 'ps', TRUE),  (60, 'fa', FALSE), (60, 'ur', FALSE),
  (61, 'ar', TRUE),  (61, 'ku', FALSE), (61, 'en', FALSE),
  (62, 'ar', TRUE),  (62, 'fr', FALSE), (62, 'en', FALSE),
  (63, 'uz', TRUE),  (63, 'ru', FALSE), (63, 'en', FALSE),
  (64, 'az', TRUE),  (64, 'ru', FALSE), (64, 'en', FALSE),
  (65, 'en', TRUE),  (65, 'ru', FALSE),
  (66, 'el', TRUE),  (66, 'en', FALSE),
  (67, 'pt', TRUE),  (67, 'en', FALSE),
  (68, 'en', TRUE),
  (69, 'nl', TRUE),  (69, 'fr', FALSE), (69, 'de', FALSE), (69, 'en', FALSE),
  (70, 'de', TRUE),  (70, 'en', FALSE),
  (71, 'fi', TRUE),  (71, 'sv', FALSE), (71, 'en', FALSE),
  (72, 'en', TRUE),
  (73, 'en', TRUE)
ON DUPLICATE KEY UPDATE is_primary = VALUES(is_primary);

-- Countries where a second currency is genuinely quoted in the market
INSERT INTO country_currencies (country_id, currency) VALUES
  ( 1, 'PKR'), ( 1, 'USD'),
  ( 2, 'INR'), ( 2, 'USD'),
  ( 3, 'AED'), ( 3, 'USD'), ( 3, 'SAR'),
  ( 4, 'SAR'), ( 4, 'USD'), ( 4, 'AED'),
  ( 5, 'USD'),
  ( 6, 'GBP'), ( 6, 'EUR'), ( 6, 'USD'),
  ( 7, 'CAD'), ( 7, 'USD'),
  ( 8, 'AUD'), ( 8, 'USD'),
  ( 9, 'TRY'), ( 9, 'USD'), ( 9, 'EUR'),
  (10, 'JPY'), (10, 'USD'),
  (11, 'EUR'), (11, 'USD'),
  (12, 'EUR'), (12, 'USD'),
  (13, 'EUR'), (14, 'EUR'), (15, 'EUR'),
  (16, 'CNY'), (16, 'USD'),
  (17, 'RUB'), (17, 'USD'),
  (18, 'BRL'), (18, 'USD'),
  (19, 'ZAR'), (19, 'USD'),
  (20, 'EGP'), (20, 'USD'),
  (21, 'NGN'), (21, 'USD'),
  (22, 'KES'), (22, 'USD'),
  (23, 'MYR'), (23, 'USD'),
  (24, 'IDR'), (24, 'USD'),
  (25, 'THB'), (26, 'PHP'),
  (27, 'BDT'), (27, 'USD'),
  (28, 'LKR'), (28, 'USD'),
  (29, 'QAR'), (29, 'USD'),
  (30, 'KWD'), (30, 'USD'),
  (31, 'BHD'), (31, 'USD'),
  (32, 'OMR'), (32, 'USD'),
  (33, 'JOD'), (33, 'USD'),
  (34, 'MAD'), (34, 'EUR'),
  (35, 'DZD'), (35, 'EUR'),
  (36, 'TND'), (36, 'EUR'),
  (37, 'CHF'), (37, 'EUR'),
  (38, 'SEK'), (38, 'EUR'),
  (39, 'NOK'), (39, 'EUR'),
  (40, 'DKK'), (40, 'EUR'),
  (41, 'PLN'), (41, 'EUR'),
  (42, 'CZK'), (42, 'EUR'),
  (43, 'HUF'), (43, 'EUR'),
  (44, 'RON'), (44, 'EUR'),
  (45, 'UAH'), (45, 'USD'),
  (46, 'KZT'), (46, 'USD'),
  (47, 'SGD'), (47, 'USD'),
  (48, 'HKD'), (48, 'USD'), (48, 'CNY'),
  (49, 'KRW'), (49, 'USD'),
  (50, 'NZD'), (51, 'MXN'), (51, 'USD'),
  (52, 'ARS'), (52, 'USD'),
  (53, 'CLP'), (54, 'COP'), (55, 'PEN'),
  (56, 'VND'), (56, 'USD'),
  (57, 'TWD'), (58, 'ILS'), (58, 'USD'),
  (59, 'NPR'), (59, 'USD'),
  (60, 'AFN'), (60, 'USD'),
  (61, 'IQD'), (61, 'USD'),
  (62, 'LBP'), (62, 'USD'),
  (63, 'UZS'), (63, 'USD'),
  (64, 'AZN'), (65, 'GEL'),
  (66, 'EUR'), (67, 'EUR'), (68, 'EUR'), (69, 'EUR'), (70, 'EUR'), (71, 'EUR'),
  (72, 'MMK'), (72, 'USD'),
  (73, 'LRD'), (73, 'USD')
ON DUPLICATE KEY UPDATE currency = VALUES(currency);

-- -----------------------------------------------------------------------------
-- 6. Measurement units (§28 Measurement units) — to_base_factor converts to the
--    canonical base: sqm for area, gram for weight, metre for distance, litre
--    for volume. The South Asian area units (marla/kanal/bigha) and gold units
--    (tola/ratti/masha/bhori/pavan) are what local sellers actually type in.
-- -----------------------------------------------------------------------------
INSERT INTO measurement_units (code, dimension, name, symbol, to_base_factor, is_active) VALUES
  -- area (base: square metre)
  ('sqm',        'area',     'Square Metre',      'm²',    1.0000000000,     TRUE),
  ('sqft',       'area',     'Square Foot',       'ft²',   0.0929030000,     TRUE),
  ('sqyd',       'area',     'Square Yard',       'yd²',   0.8361270000,     TRUE),
  ('marla',      'area',     'Marla',             'marla', 25.2929000000,    TRUE),
  ('kanal',      'area',     'Kanal',             'kanal', 505.8570000000,   TRUE),
  ('acre',       'area',     'Acre',              'ac',    4046.8600000000,  TRUE),
  ('hectare',    'area',     'Hectare',           'ha',    10000.0000000000, TRUE),
  ('bigha',      'area',     'Bigha',             'bigha', 1618.7400000000,  TRUE),
  ('cent',       'area',     'Cent',              'cent',  40.4686000000,    TRUE),
  ('ground',     'area',     'Ground',            'grnd',  222.9670000000,   TRUE),
  ('dunam',      'area',     'Dunam',             'dunam', 1000.0000000000,  TRUE),
  -- weight (base: gram) — troy ounce is the gold trade unit, avoirdupois is not
  ('gram',       'weight',   'Gram',              'g',     1.0000000000,     TRUE),
  ('kg',         'weight',   'Kilogram',          'kg',    1000.0000000000,  TRUE),
  ('tola',       'weight',   'Tola',              'tola',  11.6638000000,    TRUE),
  ('troy_ounce', 'weight',   'Troy Ounce',        'ozt',   31.1035000000,    TRUE),
  ('ounce',      'weight',   'Ounce',             'oz',    28.3495000000,    TRUE),
  ('pound',      'weight',   'Pound',             'lb',    453.5920000000,   TRUE),
  ('ratti',      'weight',   'Ratti',             'ratti', 0.1215000000,     TRUE),
  ('masha',      'weight',   'Masha',             'masha', 0.9720000000,     TRUE),
  ('carat',      'weight',   'Carat',             'ct',    0.2000000000,     TRUE),
  ('bhori',      'weight',   'Bhori',             'bhori', 11.6638000000,    TRUE),
  ('pavan',      'weight',   'Pavan',             'pavan', 8.0000000000,     TRUE),
  -- distance (base: metre)
  ('m',          'distance', 'Metre',             'm',     1.0000000000,     TRUE),
  ('km',         'distance', 'Kilometre',         'km',    1000.0000000000,  TRUE),
  ('mi',         'distance', 'Mile',              'mi',    1609.3400000000,  TRUE),
  ('ft',         'distance', 'Foot',              'ft',    0.3048000000,     TRUE),
  ('yd',         'distance', 'Yard',              'yd',    0.9144000000,     TRUE),
  -- volume (base: litre)
  ('l',          'volume',   'Litre',             'L',     1.0000000000,     TRUE),
  ('ml',         'volume',   'Millilitre',        'mL',    0.0010000000,     TRUE),
  ('gal',        'volume',   'Gallon (US)',       'gal',   3.7854100000,     TRUE)
ON DUPLICATE KEY UPDATE
  dimension = VALUES(dimension), name = VALUES(name), symbol = VALUES(symbol),
  to_base_factor = VALUES(to_base_factor), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 7. FX rates (§1 Live exchange rate) — USD-based seed values so price
--    conversion works before the fx.sync job first runs.
-- -----------------------------------------------------------------------------
INSERT INTO exchange_rates (base_currency, quote_currency, rate, provider) VALUES
  ('USD', 'USD',       1.0000000000, 'static'),
  ('USD', 'EUR',       0.9200000000, 'static'),
  ('USD', 'GBP',       0.7900000000, 'static'),
  ('USD', 'PKR',     280.0000000000, 'static'),
  ('USD', 'INR',      84.0000000000, 'static'),
  ('USD', 'SAR',       3.7500000000, 'static'),
  ('USD', 'AED',       3.6725000000, 'static'),
  ('USD', 'CAD',       1.3800000000, 'static'),
  ('USD', 'AUD',       1.5200000000, 'static'),
  ('USD', 'TRY',      34.0000000000, 'static'),
  ('USD', 'JPY',     155.0000000000, 'static'),
  ('USD', 'CNY',       7.2500000000, 'static'),
  ('USD', 'MYR',       4.4500000000, 'static'),
  ('USD', 'IDR',   15800.0000000000, 'static'),
  ('USD', 'THB',      34.5000000000, 'static'),
  ('USD', 'PHP',      57.5000000000, 'static'),
  ('USD', 'BDT',     120.0000000000, 'static'),
  ('USD', 'LKR',     295.0000000000, 'static'),
  ('USD', 'NPR',     134.0000000000, 'static'),
  ('USD', 'SGD',       1.3400000000, 'static'),
  ('USD', 'HKD',       7.7900000000, 'static'),
  ('USD', 'KRW',    1370.0000000000, 'static'),
  ('USD', 'TWD',      32.4000000000, 'static'),
  ('USD', 'VND',   25400.0000000000, 'static'),
  ('USD', 'NZD',       1.6600000000, 'static'),
  ('USD', 'MMK',    2100.0000000000, 'static'),
  ('USD', 'QAR',       3.6400000000, 'static'),
  ('USD', 'KWD',       0.3075000000, 'static'),
  ('USD', 'BHD',       0.3760000000, 'static'),
  ('USD', 'OMR',       0.3845000000, 'static'),
  ('USD', 'JOD',       0.7090000000, 'static'),
  ('USD', 'ILS',       3.6800000000, 'static'),
  ('USD', 'IQD',    1310.0000000000, 'static'),
  ('USD', 'LBP',   89500.0000000000, 'static'),
  ('USD', 'AFN',      68.5000000000, 'static'),
  ('USD', 'ZAR',      18.2000000000, 'static'),
  ('USD', 'EGP',      48.5000000000, 'static'),
  ('USD', 'NGN',    1550.0000000000, 'static'),
  ('USD', 'KES',     129.0000000000, 'static'),
  ('USD', 'MAD',       9.8500000000, 'static'),
  ('USD', 'DZD',     134.0000000000, 'static'),
  ('USD', 'TND',       3.1200000000, 'static'),
  ('USD', 'LRD',     195.0000000000, 'static'),
  ('USD', 'CHF',       0.8800000000, 'static'),
  ('USD', 'SEK',      10.6000000000, 'static'),
  ('USD', 'NOK',      10.9000000000, 'static'),
  ('USD', 'DKK',       6.8500000000, 'static'),
  ('USD', 'PLN',       3.9500000000, 'static'),
  ('USD', 'CZK',      23.2000000000, 'static'),
  ('USD', 'HUF',     365.0000000000, 'static'),
  ('USD', 'RON',       4.5800000000, 'static'),
  ('USD', 'RUB',      95.0000000000, 'static'),
  ('USD', 'UAH',      41.5000000000, 'static'),
  ('USD', 'KZT',     490.0000000000, 'static'),
  ('USD', 'UZS',   12800.0000000000, 'static'),
  ('USD', 'AZN',       1.7000000000, 'static'),
  ('USD', 'GEL',       2.7200000000, 'static'),
  ('USD', 'BRL',       5.5500000000, 'static'),
  ('USD', 'MXN',      19.5000000000, 'static'),
  ('USD', 'ARS',    1010.0000000000, 'static'),
  ('USD', 'CLP',     950.0000000000, 'static'),
  ('USD', 'COP',    4300.0000000000, 'static'),
  ('USD', 'PEN',       3.7500000000, 'static')
ON DUPLICATE KEY UPDATE rate = VALUES(rate), provider = VALUES(provider), fetched_at = CURRENT_TIMESTAMP;

-- -----------------------------------------------------------------------------
-- 8. Tax rules (§28 Country-specific taxes) — applied to what the platform
--    actually charges for: subscriptions and advertising.
-- -----------------------------------------------------------------------------
INSERT INTO tax_rules (id, country_id, region_id, code, name, kind, rate, applies_to, is_inclusive, effective_from, is_active) VALUES
  ( 1,  1, NULL, 'PK_GST_SUB',  'Pakistan Sales Tax on Services', 'sales_tax', 18.000, 'subscription',   FALSE, '2026-01-01', TRUE),
  ( 2,  1, NULL, 'PK_GST_ADV',  'Pakistan Sales Tax on Services', 'sales_tax', 18.000, 'advertisement',  FALSE, '2026-01-01', TRUE),
  ( 3,  2, NULL, 'IN_GST_SUB',  'India GST',                      'gst',       18.000, 'subscription',   FALSE, '2026-01-01', TRUE),
  ( 4,  2, NULL, 'IN_GST_ADV',  'India GST',                      'gst',       18.000, 'advertisement',  FALSE, '2026-01-01', TRUE),
  ( 5,  3, NULL, 'AE_VAT_SUB',  'UAE VAT',                        'vat',        5.000, 'subscription',   FALSE, '2026-01-01', TRUE),
  ( 6,  3, NULL, 'AE_VAT_ADV',  'UAE VAT',                        'vat',        5.000, 'advertisement',  FALSE, '2026-01-01', TRUE),
  ( 7,  4, NULL, 'SA_VAT_SUB',  'Saudi Arabia VAT',               'vat',       15.000, 'subscription',   FALSE, '2026-01-01', TRUE),
  ( 8,  4, NULL, 'SA_VAT_ADV',  'Saudi Arabia VAT',               'vat',       15.000, 'advertisement',  FALSE, '2026-01-01', TRUE),
  ( 9,  6, NULL, 'GB_VAT_SUB',  'UK VAT',                         'vat',       20.000, 'subscription',   FALSE, '2026-01-01', TRUE),
  (10,  6, NULL, 'GB_VAT_ADV',  'UK VAT',                         'vat',       20.000, 'advertisement',  FALSE, '2026-01-01', TRUE),
  (11, 11, NULL, 'DE_VAT_SUB',  'Germany Umsatzsteuer',           'vat',       19.000, 'subscription',   FALSE, '2026-01-01', TRUE),
  (12, 11, NULL, 'DE_VAT_ADV',  'Germany Umsatzsteuer',           'vat',       19.000, 'advertisement',  FALSE, '2026-01-01', TRUE),
  (13,  9, NULL, 'TR_KDV_SUB',  'Turkey KDV',                     'vat',       20.000, 'subscription',   FALSE, '2026-01-01', TRUE),
  (14,  9, NULL, 'TR_KDV_ADV',  'Turkey KDV',                     'vat',       20.000, 'advertisement',  FALSE, '2026-01-01', TRUE),
  (15,  5, NULL, 'US_ST_SUB',   'US Sales Tax (nexus states)',    'sales_tax',  0.000, 'subscription',   FALSE, '2026-01-01', TRUE),
  (16,  5, NULL, 'US_ST_ADV',   'US Sales Tax (nexus states)',    'sales_tax',  0.000, 'advertisement',  FALSE, '2026-01-01', TRUE)
ON DUPLICATE KEY UPDATE
  country_id = VALUES(country_id), code = VALUES(code), name = VALUES(name), kind = VALUES(kind),
  rate = VALUES(rate), applies_to = VALUES(applies_to), is_inclusive = VALUES(is_inclusive),
  effective_from = VALUES(effective_from), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 9. Public app settings — the payload every client pulls at bootstrap.
--    compare.max_items = 6 and ai_min/max 3..4 implement the spec's opening
--    requirement: "when user enter 3 or 4 cars name for compare then AI ...".
-- -----------------------------------------------------------------------------
INSERT INTO app_settings (setting_key, setting_value, scope, description, is_public) VALUES
  ('listing.max_media',           CAST('20' AS JSON),                   'global', 'Maximum images + videos per listing',                 TRUE),
  ('listing.default_ttl_days',    CAST('30' AS JSON),                   'global', 'Days a published listing stays live before expiry',   TRUE),
  ('compare.max_items',           CAST('6' AS JSON),                    'global', 'Maximum listings the compare tray can hold',          TRUE),
  ('compare.ai_min_items',        CAST('2' AS JSON),                    'global', 'Minimum selections that trigger the AI comparison',   TRUE),
  ('compare.ai_max_items',        CAST('4' AS JSON),                    'global', 'Maximum selections the AI comparison accepts',        TRUE),
  ('chat.max_attachment_mb',      CAST('25' AS JSON),                   'global', 'Per-attachment size ceiling in chat',                 TRUE),
  ('search.max_saved',            CAST('50' AS JSON),                   'global', 'Hard ceiling on saved searches per user',             TRUE),
  ('support.email',               CAST('"support@marketplace.com"' AS JSON), 'global', 'Support inbox shown in the help centre',         TRUE),
  ('support.whatsapp',            CAST('"+971500000000"' AS JSON),      'global', 'WhatsApp support number (§29)',                       TRUE),
  ('app.min_supported_version',   CAST('"1.0.0"' AS JSON),              'global', 'Oldest client build the API still serves',            TRUE),
  ('app.force_update_below',      CAST('"0.9.0"' AS JSON),              'global', 'Clients below this version get a blocking update',    TRUE)
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value), description = VALUES(description), is_public = VALUES(is_public);

-- -----------------------------------------------------------------------------
-- 10. Feature flags (§18 AI Features, §9 Search) — AI and search ship enabled;
--     escrow, wallet and the ads platform stay dark until they are built out.
-- -----------------------------------------------------------------------------
INSERT INTO feature_flags (code, description, is_enabled, rollout_percent, target_countries, target_platforms, min_app_version) VALUES
  ('ai_compare',              'AI comparison when 3-4 listings are selected',   TRUE,  100, NULL, NULL, '1.0.0'),
  ('ai_description',          'AI listing description generator',               TRUE,  100, NULL, NULL, '1.0.0'),
  ('ai_image_enhance',        'AI image enhancement on upload',                 TRUE,   50, NULL, NULL, '1.0.0'),
  ('voice_search',            'Voice-driven search',                            TRUE,  100, NULL, '["android","ios"]', '1.0.0'),
  ('image_search',            'Reverse image search',                           TRUE,  100, NULL, NULL, '1.0.0'),
  ('ai_search',               'Natural-language / semantic search',             TRUE,  100, NULL, NULL, '1.0.0'),
  ('auctions',                'Gold auction operation',                         TRUE,  100, '["PK","IN","AE","SA"]', NULL, '1.0.0'),
  ('masked_calling',          'Privacy-preserving proxy calls',                 TRUE,   75, '["PK","IN","AE","SA"]', NULL, '1.0.0'),
  ('video_calls',             'In-app video calls for viewings',                TRUE,   50, NULL, NULL, '1.0.0'),
  ('wallet',                  'Platform wallet + top-ups',                      FALSE,   0, NULL, NULL, NULL),
  ('ads_platform',            'Self-serve advertising campaigns',               FALSE,   0, NULL, NULL, NULL),
  ('forum',                   'Community forum (§29)',                          FALSE,   0, NULL, NULL, NULL),
  ('property_valuation',      'AI property valuation',                          TRUE,  100, NULL, NULL, '1.0.0'),
  ('vehicle_inspection',      'Third-party vehicle inspection booking',         TRUE,  100, '["PK","IN","AE"]', NULL, '1.0.0'),
  ('gold_authenticity_check', 'Fake-gold detection support',                    TRUE,  100, NULL, NULL, '1.0.0'),
  ('escrow',                  'Escrowed settlement for high-value trades',      FALSE,   0, NULL, NULL, NULL)
ON DUPLICATE KEY UPDATE
  description = VALUES(description), is_enabled = VALUES(is_enabled),
  rollout_percent = VALUES(rollout_percent), target_countries = VALUES(target_countries),
  target_platforms = VALUES(target_platforms), min_app_version = VALUES(min_app_version);

-- -----------------------------------------------------------------------------
-- 11. Cron registry (§22 System Health) — the scheduler reads this table, so
--     adding a job is a seed row rather than a deploy.
-- -----------------------------------------------------------------------------
INSERT INTO scheduled_jobs (code, name, cron, is_enabled) VALUES
  ('fx.sync',                  'Sync foreign-exchange rates',             '0 */6 * * *',  TRUE),
  ('gold.rates.sync',          'Sync live gold rates',                    '*/15 * * * *', TRUE),
  ('listings.expire',          'Expire listings past their TTL',          '0 * * * *',    TRUE),
  ('listings.promotion.expire','Expire featured / boosted promotions',    '*/10 * * * *', TRUE),
  ('saved_searches.run',       'Run saved searches and queue alerts',     '*/30 * * * *', TRUE),
  ('notifications.digest',     'Send the daily notification digest',      '0 8 * * *',    TRUE),
  ('analytics.rollup',         'Roll up daily analytics aggregates',      '30 0 * * *',   TRUE),
  ('trending.compute',         'Recompute trending searches and listings','0 */2 * * *',  TRUE),
  ('outbox.dispatch',          'Dispatch transactional outbox events',    '* * * * *',    TRUE),
  ('sessions.prune',           'Prune expired sessions and tokens',       '0 3 * * *',    TRUE),
  ('risk.rescore',             'Recompute user risk / trust scores',      '0 4 * * *',    TRUE),
  ('price_index.compute',      'Rebuild property and vehicle price index','0 2 * * *',    TRUE),
  ('ai.market_analysis',       'Weekly AI market analysis report',        '0 5 * * 1',    TRUE),
  ('subscriptions.renew',      'Renew and expire subscriptions',          '0 1 * * *',    TRUE),
  ('tickets.sla_check',        'Check support ticket SLA breaches',       '*/15 * * * *', TRUE),
  ('moderation.sla_check',     'Check moderation queue SLA breaches',     '*/20 * * * *', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), cron = VALUES(cron), is_enabled = VALUES(is_enabled);

-- -----------------------------------------------------------------------------
-- 12. Geography: regions (§1 Province / State) for the six launch markets
-- -----------------------------------------------------------------------------
INSERT INTO regions (id, country_id, parent_id, code, name, type, latitude, longitude, is_active) VALUES
  -- Pakistan
  ( 1,  1, NULL, 'PB',  'Punjab',                       'province',  31.1704000,  72.7097000, TRUE),
  ( 2,  1, NULL, 'SD',  'Sindh',                        'province',  25.8943000,  68.5247000, TRUE),
  ( 3,  1, NULL, 'KP',  'Khyber Pakhtunkhwa',           'province',  34.9526000,  72.3311000, TRUE),
  ( 4,  1, NULL, 'BA',  'Balochistan',                  'province',  28.4907000,  65.0958000, TRUE),
  ( 5,  1, NULL, 'IS',  'Islamabad Capital Territory',  'territory', 33.6844000,  73.0479000, TRUE),
  -- India
  (10,  2, NULL, 'MH',  'Maharashtra',                  'state',     19.7515000,  75.7139000, TRUE),
  (11,  2, NULL, 'DL',  'Delhi',                        'territory', 28.7041000,  77.1025000, TRUE),
  (12,  2, NULL, 'KA',  'Karnataka',                    'state',     15.3173000,  75.7139000, TRUE),
  (13,  2, NULL, 'TN',  'Tamil Nadu',                   'state',     11.1271000,  78.6569000, TRUE),
  (14,  2, NULL, 'TG',  'Telangana',                    'state',     18.1124000,  79.0193000, TRUE),
  (15,  2, NULL, 'GJ',  'Gujarat',                      'state',     22.2587000,  71.1924000, TRUE),
  (16,  2, NULL, 'UP',  'Uttar Pradesh',                'state',     26.8467000,  80.9462000, TRUE),
  (17,  2, NULL, 'WB',  'West Bengal',                  'state',     22.9868000,  87.8550000, TRUE),
  (18,  2, NULL, 'RJ',  'Rajasthan',                    'state',     27.0238000,  74.2179000, TRUE),
  -- United Arab Emirates
  (20,  3, NULL, 'DU',  'Dubai',                        'region',    25.2048000,  55.2708000, TRUE),
  (21,  3, NULL, 'AZ',  'Abu Dhabi',                    'region',    24.4539000,  54.3773000, TRUE),
  (22,  3, NULL, 'SH',  'Sharjah',                      'region',    25.3463000,  55.4209000, TRUE),
  (23,  3, NULL, 'AJ',  'Ajman',                        'region',    25.4052000,  55.5136000, TRUE),
  (24,  3, NULL, 'RK',  'Ras Al Khaimah',               'region',    25.7895000,  55.9432000, TRUE),
  -- Saudi Arabia
  (30,  4, NULL, 'RD',  'Riyadh Province',              'province',  24.7136000,  46.6753000, TRUE),
  (31,  4, NULL, 'MK',  'Makkah Province',              'province',  21.3891000,  39.8579000, TRUE),
  (32,  4, NULL, 'EP',  'Eastern Province',             'province',  26.4207000,  50.0888000, TRUE),
  (33,  4, NULL, 'MD',  'Madinah Province',             'province',  24.5247000,  39.5692000, TRUE),
  -- United States
  (40,  5, NULL, 'CA',  'California',                   'state',     36.7783000,-119.4179000, TRUE),
  (41,  5, NULL, 'TX',  'Texas',                        'state',     31.9686000, -99.9018000, TRUE),
  (42,  5, NULL, 'NY',  'New York',                     'state',     43.2994000, -74.2179000, TRUE),
  (43,  5, NULL, 'FL',  'Florida',                      'state',     27.6648000, -81.5158000, TRUE),
  (44,  5, NULL, 'IL',  'Illinois',                     'state',     40.6331000, -89.3985000, TRUE),
  -- United Kingdom
  (50,  6, NULL, 'ENG', 'England',                      'region',    52.3555000,  -1.1743000, TRUE),
  (51,  6, NULL, 'SCT', 'Scotland',                     'region',    56.4907000,  -4.2026000, TRUE),
  (52,  6, NULL, 'WLS', 'Wales',                        'region',    52.1307000,  -3.7837000, TRUE)
ON DUPLICATE KEY UPDATE
  country_id = VALUES(country_id), code = VALUES(code), name = VALUES(name), type = VALUES(type),
  latitude = VALUES(latitude), longitude = VALUES(longitude), is_active = VALUES(is_active);

-- Cities (§1 Manual city selection). is_popular drives the "top cities" chips.
INSERT INTO cities (id, country_id, region_id, name, slug, latitude, longitude, population, timezone, is_popular, is_active) VALUES
  -- Pakistan
  (101,  1,  2, 'Karachi',        'karachi',         24.8607000,  67.0011000, 16000000, 'Asia/Karachi',     TRUE,  TRUE),
  (102,  1,  1, 'Lahore',         'lahore',          31.5204000,  74.3587000, 13000000, 'Asia/Karachi',     TRUE,  TRUE),
  (103,  1,  5, 'Islamabad',      'islamabad',       33.6844000,  73.0479000,  1200000, 'Asia/Karachi',     TRUE,  TRUE),
  (104,  1,  1, 'Rawalpindi',     'rawalpindi',      33.5651000,  73.0169000,  2300000, 'Asia/Karachi',     TRUE,  TRUE),
  (105,  1,  1, 'Faisalabad',     'faisalabad',      31.4180000,  73.0790000,  3600000, 'Asia/Karachi',     FALSE, TRUE),
  (106,  1,  1, 'Multan',         'multan',          30.1575000,  71.5249000,  2000000, 'Asia/Karachi',     FALSE, TRUE),
  (107,  1,  3, 'Peshawar',       'peshawar',        34.0151000,  71.5249000,  2000000, 'Asia/Karachi',     FALSE, TRUE),
  (108,  1,  4, 'Quetta',         'quetta',          30.1798000,  66.9750000,  1100000, 'Asia/Karachi',     FALSE, TRUE),
  (109,  1,  1, 'Gujranwala',     'gujranwala',      32.1877000,  74.1945000,  2000000, 'Asia/Karachi',     FALSE, TRUE),
  (110,  1,  1, 'Sialkot',        'sialkot',         32.4945000,  74.5229000,   900000, 'Asia/Karachi',     FALSE, TRUE),
  (111,  1,  2, 'Hyderabad',      'hyderabad',       25.3960000,  68.3578000,  1700000, 'Asia/Karachi',     FALSE, TRUE),
  (112,  1,  1, 'Bahawalpur',     'bahawalpur',      29.3956000,  71.6836000,   760000, 'Asia/Karachi',     FALSE, TRUE),
  -- India
  (121,  2, 10, 'Mumbai',         'mumbai',          19.0760000,  72.8777000, 20400000, 'Asia/Kolkata',     TRUE,  TRUE),
  (122,  2, 11, 'Delhi',          'delhi',           28.6139000,  77.2090000, 32900000, 'Asia/Kolkata',     TRUE,  TRUE),
  (123,  2, 12, 'Bangalore',      'bangalore',       12.9716000,  77.5946000, 13600000, 'Asia/Kolkata',     TRUE,  TRUE),
  (124,  2, 13, 'Chennai',        'chennai',         13.0827000,  80.2707000, 11500000, 'Asia/Kolkata',     FALSE, TRUE),
  (125,  2, 14, 'Hyderabad',      'hyderabad',       17.3850000,  78.4867000, 10500000, 'Asia/Kolkata',     TRUE,  TRUE),
  (126,  2, 15, 'Ahmedabad',      'ahmedabad',       23.0225000,  72.5714000,  8400000, 'Asia/Kolkata',     FALSE, TRUE),
  (127,  2, 10, 'Pune',           'pune',            18.5204000,  73.8567000,  7200000, 'Asia/Kolkata',     FALSE, TRUE),
  (128,  2, 17, 'Kolkata',        'kolkata',         22.5726000,  88.3639000, 15300000, 'Asia/Kolkata',     FALSE, TRUE),
  (129,  2, 18, 'Jaipur',         'jaipur',          26.9124000,  75.7873000,  4100000, 'Asia/Kolkata',     FALSE, TRUE),
  (130,  2, 16, 'Lucknow',        'lucknow',         26.8467000,  80.9462000,  3700000, 'Asia/Kolkata',     FALSE, TRUE),
  -- United Arab Emirates
  (141,  3, 20, 'Dubai',          'dubai',           25.2048000,  55.2708000,  3600000, 'Asia/Dubai',       TRUE,  TRUE),
  (142,  3, 21, 'Abu Dhabi',      'abu-dhabi',       24.4539000,  54.3773000,  1800000, 'Asia/Dubai',       TRUE,  TRUE),
  (143,  3, 22, 'Sharjah',        'sharjah',         25.3463000,  55.4209000,  1800000, 'Asia/Dubai',       TRUE,  TRUE),
  (144,  3, 23, 'Ajman',          'ajman',           25.4052000,  55.5136000,   540000, 'Asia/Dubai',       FALSE, TRUE),
  (145,  3, 21, 'Al Ain',         'al-ain',          24.2075000,  55.7447000,   770000, 'Asia/Dubai',       FALSE, TRUE),
  (146,  3, 24, 'Ras Al Khaimah', 'ras-al-khaimah',  25.7895000,  55.9432000,   350000, 'Asia/Dubai',       FALSE, TRUE),
  -- Saudi Arabia
  (151,  4, 30, 'Riyadh',         'riyadh',          24.7136000,  46.6753000,  7600000, 'Asia/Riyadh',      TRUE,  TRUE),
  (152,  4, 31, 'Jeddah',         'jeddah',          21.4858000,  39.1925000,  4700000, 'Asia/Riyadh',      TRUE,  TRUE),
  (153,  4, 31, 'Mecca',          'mecca',           21.3891000,  39.8579000,  2100000, 'Asia/Riyadh',      FALSE, TRUE),
  (154,  4, 33, 'Medina',         'medina',          24.5247000,  39.5692000,  1500000, 'Asia/Riyadh',      FALSE, TRUE),
  (155,  4, 32, 'Dammam',         'dammam',          26.4207000,  50.0888000,  1250000, 'Asia/Riyadh',      TRUE,  TRUE),
  (156,  4, 32, 'Khobar',         'khobar',          26.2794000,  50.2083000,   700000, 'Asia/Riyadh',      FALSE, TRUE),
  -- United States
  (161,  5, 40, 'Los Angeles',    'los-angeles',     34.0522000,-118.2437000,  3900000, 'America/Los_Angeles', TRUE,  TRUE),
  (162,  5, 42, 'New York',       'new-york',        40.7128000, -74.0060000,  8300000, 'America/New_York',    TRUE,  TRUE),
  (163,  5, 41, 'Houston',        'houston',         29.7604000, -95.3698000,  2300000, 'America/Chicago',     TRUE,  TRUE),
  (164,  5, 43, 'Miami',          'miami',           25.7617000, -80.1918000,   450000, 'America/New_York',    FALSE, TRUE),
  (165,  5, 44, 'Chicago',        'chicago',         41.8781000, -87.6298000,  2700000, 'America/Chicago',     TRUE,  TRUE),
  (166,  5, 41, 'Dallas',         'dallas',          32.7767000, -96.7970000,  1300000, 'America/Chicago',     FALSE, TRUE),
  -- United Kingdom
  (171,  6, 50, 'London',         'london',          51.5074000,  -0.1278000,  9000000, 'Europe/London',    TRUE,  TRUE),
  (172,  6, 50, 'Manchester',     'manchester',      53.4808000,  -2.2426000,   553000, 'Europe/London',    TRUE,  TRUE),
  (173,  6, 50, 'Birmingham',     'birmingham',      52.4862000,  -1.8904000,  1140000, 'Europe/London',    TRUE,  TRUE),
  (174,  6, 51, 'Glasgow',        'glasgow',         55.8642000,  -4.2518000,   635000, 'Europe/London',    FALSE, TRUE),
  (175,  6, 50, 'Leeds',          'leeds',           53.8008000,  -1.5491000,   810000, 'Europe/London',    FALSE, TRUE)
ON DUPLICATE KEY UPDATE
  country_id = VALUES(country_id), region_id = VALUES(region_id), name = VALUES(name), slug = VALUES(slug),
  latitude = VALUES(latitude), longitude = VALUES(longitude), population = VALUES(population),
  timezone = VALUES(timezone), is_popular = VALUES(is_popular), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- 13. Areas / neighbourhoods — the level property buyers actually search at.
-- -----------------------------------------------------------------------------
INSERT INTO areas (id, city_id, parent_id, name, slug, latitude, longitude, is_active) VALUES
  -- Karachi
  (1001, 101, NULL, 'DHA Karachi',              'dha',                 24.8008000, 67.0432000, TRUE),
  (1002, 101, NULL, 'Clifton',                  'clifton',             24.8138000, 67.0300000, TRUE),
  (1003, 101, NULL, 'Gulshan-e-Iqbal',          'gulshan-e-iqbal',     24.9215000, 67.0947000, TRUE),
  (1004, 101, NULL, 'North Nazimabad',          'north-nazimabad',     24.9425000, 67.0384000, TRUE),
  (1005, 101, NULL, 'Bahria Town Karachi',      'bahria-town',         25.0107000, 67.3126000, TRUE),
  (1006, 101, NULL, 'Malir',                    'malir',               24.8965000, 67.2050000, TRUE),
  -- Lahore
  (1011, 102, NULL, 'DHA Lahore',               'dha',                 31.4697000, 74.4114000, TRUE),
  (1012, 102, NULL, 'Gulberg',                  'gulberg',             31.5150000, 74.3487000, TRUE),
  (1013, 102, NULL, 'Model Town',               'model-town',          31.4818000, 74.3239000, TRUE),
  (1014, 102, NULL, 'Johar Town',               'johar-town',          31.4697000, 74.2728000, TRUE),
  (1015, 102, NULL, 'Bahria Town Lahore',       'bahria-town',         31.3676000, 74.1846000, TRUE),
  (1016, 102, NULL, 'Askari',                   'askari',              31.5013000, 74.3963000, TRUE),
  -- Islamabad
  (1021, 103, NULL, 'F-6',                      'f-6',                 33.7294000, 73.0805000, TRUE),
  (1022, 103, NULL, 'F-7',                      'f-7',                 33.7226000, 73.0562000, TRUE),
  (1023, 103, NULL, 'F-8',                      'f-8',                 33.7104000, 73.0398000, TRUE),
  (1024, 103, NULL, 'F-10',                     'f-10',                33.6960000, 73.0170000, TRUE),
  (1025, 103, NULL, 'F-11',                     'f-11',                33.6874000, 72.9971000, TRUE),
  (1026, 103, NULL, 'G-9',                      'g-9',                 33.6900000, 73.0400000, TRUE),
  (1027, 103, NULL, 'G-10',                     'g-10',                33.6820000, 73.0170000, TRUE),
  (1028, 103, NULL, 'G-11',                     'g-11',                33.6760000, 73.0060000, TRUE),
  (1029, 103, NULL, 'G-13',                     'g-13',                33.6540000, 72.9700000, TRUE),
  (1030, 103, NULL, 'E-11',                     'e-11',                33.7017000, 72.9691000, TRUE),
  (1031, 103, NULL, 'Bahria Town Islamabad',    'bahria-town',         33.5240000, 73.1450000, TRUE),
  (1032, 103, NULL, 'DHA Islamabad',            'dha',                 33.5350000, 73.1780000, TRUE),
  -- Dubai
  (1041, 141, NULL, 'Downtown Dubai',           'downtown-dubai',      25.1972000, 55.2744000, TRUE),
  (1042, 141, NULL, 'Dubai Marina',             'dubai-marina',        25.0805000, 55.1403000, TRUE),
  (1043, 141, NULL, 'Jumeirah Lake Towers',     'jlt',                 25.0693000, 55.1409000, TRUE),
  (1044, 141, NULL, 'Business Bay',             'business-bay',        25.1857000, 55.2766000, TRUE),
  (1045, 141, NULL, 'Deira',                    'deira',               25.2697000, 55.3095000, TRUE),
  (1046, 141, NULL, 'Jumeirah',                 'jumeirah',            25.2048000, 55.2445000, TRUE),
  (1047, 141, NULL, 'Palm Jumeirah',            'palm-jumeirah',       25.1124000, 55.1390000, TRUE),
  -- Mumbai
  (1051, 121, NULL, 'Andheri',                  'andheri',             19.1136000, 72.8697000, TRUE),
  (1052, 121, NULL, 'Bandra',                   'bandra',              19.0596000, 72.8295000, TRUE),
  (1053, 121, NULL, 'Powai',                    'powai',               19.1176000, 72.9060000, TRUE),
  (1054, 121, NULL, 'Thane',                    'thane',               19.2183000, 72.9781000, TRUE),
  (1055, 121, NULL, 'Navi Mumbai',              'navi-mumbai',         19.0330000, 73.0297000, TRUE)
ON DUPLICATE KEY UPDATE
  city_id = VALUES(city_id), name = VALUES(name), slug = VALUES(slug),
  latitude = VALUES(latitude), longitude = VALUES(longitude), is_active = VALUES(is_active);
