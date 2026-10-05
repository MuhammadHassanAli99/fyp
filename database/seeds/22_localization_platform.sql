-- =============================================================================
-- 22  Localization platform: holiday calendars + versioned legal documents.
--     Reuses holidays and legal_documents from 001. Idempotent. No schema change.
-- =============================================================================

-- Recurring holidays for launch markets (projected onto the requested year by the API).
INSERT INTO holidays (country_id, name, holiday_date, is_recurring) VALUES
  (1, 'Pakistan Day',              '2026-03-23', TRUE),
  (1, 'Independence Day',          '2026-08-14', TRUE),
  (1, 'Iqbal Day',                 '2026-11-09', TRUE),
  (1, 'Quaid-e-Azam Day',          '2026-12-25', TRUE),
  (2, 'Republic Day',              '2026-01-26', TRUE),
  (2, 'Independence Day',          '2026-08-15', TRUE),
  (2, 'Gandhi Jayanti',            '2026-10-02', TRUE),
  (3, 'UAE National Day',          '2026-12-02', TRUE),
  (4, 'Saudi National Day',        '2026-09-23', TRUE),
  (5, 'Independence Day',          '2026-07-04', TRUE),
  (5, 'Thanksgiving (observed)',   '2026-11-26', FALSE),
  (6, 'Christmas Day',             '2026-12-25', TRUE),
  (6, 'Boxing Day',                '2026-12-26', TRUE),
  (11, 'German Unity Day',         '2026-10-03', TRUE),
  (9, 'Republic Day',              '2026-10-29', TRUE)
ON DUPLICATE KEY UPDATE is_recurring = VALUES(is_recurring);

-- Global legal documents. Country-specific rows may overlay these later.
-- kind mapping (existing ENUM, no migration):
--   terms           Terms & Conditions / Buyer Agreement
--   privacy         Privacy Policy
--   cookies         Cookie Policy
--   refund          Refund Policy
--   listing_policy  Marketplace Rules
--   aml             Gold Terms
--   dsa             Property Terms
--   eula            Seller Agreement / Vehicle Terms
INSERT INTO legal_documents (kind, country_id, language, version, title, body, is_current, published_at) VALUES
  ('terms', NULL, 'en', '2026.1', 'Terms & Conditions',
   'These terms govern use of the AURELIA marketplace across Gold, Property and Vehicles. Listings, payments, chat and subscriptions are provided as-is subject to regional law.',
   TRUE, CURRENT_TIMESTAMP),
  ('privacy', NULL, 'en', '2026.1', 'Privacy Policy',
   'We process account, listing and transaction data to operate the marketplace. You may request export or erasure where GDPR, CCPA or similar laws apply to your country.',
   TRUE, CURRENT_TIMESTAMP),
  ('cookies', NULL, 'en', '2026.1', 'Cookie Policy',
   'Essential cookies keep you signed in. Analytics and advertising cookies are optional and recorded as separate consents.',
   TRUE, CURRENT_TIMESTAMP),
  ('refund', NULL, 'en', '2026.1', 'Refund Policy',
   'Subscription and advertisement charges follow the plan terms. Listing purchases between buyers and sellers are settled per marketplace rules and escrow where required.',
   TRUE, CURRENT_TIMESTAMP),
  ('listing_policy', NULL, 'en', '2026.1', 'Marketplace Rules',
   'Sellers must post accurate listings, required documents and lawful media. Fraud, duplicate ads and prohibited goods are removed. Gold, property and vehicle categories each have additional regional rules.',
   TRUE, CURRENT_TIMESTAMP),
  ('aml', NULL, 'en', '2026.1', 'Gold Terms',
   'High-value gold trades may require KYC, AML screening, physical verification or escrow according to the destination country compliance table. Authenticity assessments are not a guarantee of purity.',
   TRUE, CURRENT_TIMESTAMP),
  ('dsa', NULL, 'en', '2026.1', 'Property Terms',
   'Property listings must include lawful ownership or agency authority. Area is stored in square metres; localized units are display only. Regional documentation requirements apply.',
   TRUE, CURRENT_TIMESTAMP),
  ('eula', NULL, 'en', '2026.1', 'Seller Agreement',
   'Sellers grant AURELIA a licence to display listing content. Vehicle import/export and registration remain the seller and buyer responsibility under destination-country rules.',
   TRUE, CURRENT_TIMESTAMP),
  ('terms', NULL, 'ar', '2026.1', 'الشروط والأحكام',
   'تحكم هذه الشروط استخدام سوق أوريليا للذهب والعقارات والمركبات.',
   TRUE, CURRENT_TIMESTAMP),
  ('privacy', NULL, 'ar', '2026.1', 'سياسة الخصوصية',
   'نعالج بيانات الحساب والإعلانات والمعاملات لتشغيل السوق، مع حقوق الوصول والمسح حيث ينطبق القانون.',
   TRUE, CURRENT_TIMESTAMP),
  ('terms', NULL, 'ur', '2026.1', 'شرائط و ضوابط',
   'یہ شرائط سونے، پراپرٹی اور گاڑیوں کی مارکیٹ پلیس کے استعمال پر لاگو ہیں۔',
   TRUE, CURRENT_TIMESTAMP),
  ('privacy', NULL, 'ur', '2026.1', 'رازداری کی پالیسی',
   'ہم اکاؤنٹ، لسٹنگ اور لین دین کا ڈیٹا مارکیٹ پلیس چلانے کے لیے استعمال کرتے ہیں۔',
   TRUE, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  title = VALUES(title), body = VALUES(body), is_current = VALUES(is_current), published_at = VALUES(published_at);
