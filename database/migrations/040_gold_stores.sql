-- =============================================================================
-- 040  Gold Marketplace stores (brand / shop storefronts)
--      Gold shops are business_profiles(kind=gold_shop). A public storefront
--      (brand) unlocks only after a proper application and a minimum number of
--      properly posted gold ads. Personal ads remain business_id IS NULL.
-- =============================================================================

USE marketplace;

ALTER TABLE gold_shop_profiles
  ADD COLUMN min_listings_required TINYINT UNSIGNED NOT NULL DEFAULT 3
    AFTER notes,
  ADD COLUMN storefront_status ENUM(
      'draft',
      'pending_review',
      'building',
      'active',
      'suspended'
    ) NOT NULL DEFAULT 'draft' AFTER min_listings_required,
  ADD COLUMN proper_listing_count INT UNSIGNED NOT NULL DEFAULT 0
    AFTER storefront_status,
  ADD COLUMN application_submitted_at TIMESTAMP NULL
    AFTER proper_listing_count,
  ADD COLUMN storefront_unlocked_at TIMESTAMP NULL
    AFTER application_submitted_at,
  ADD COLUMN application_notes VARCHAR(1000) NULL
    AFTER storefront_unlocked_at;

ALTER TABLE gold_shop_profiles
  ADD CONSTRAINT chk_gold_shop_min_listings
    CHECK (min_listings_required BETWEEN 3 AND 4);

-- Backfill existing gold shops so owners can finish the store process.
INSERT INTO gold_shop_profiles (business_id, min_listings_required, storefront_status)
SELECT bp.id, 3, 'draft'
  FROM business_profiles bp
 WHERE bp.kind = 'gold_shop'
   AND NOT EXISTS (
     SELECT 1 FROM gold_shop_profiles gsp WHERE gsp.business_id = bp.id
   );

-- Active businesses that already look like shops start in "building" until
-- they reach the minimum properly posted ads.
UPDATE gold_shop_profiles gsp
  JOIN business_profiles bp ON bp.id = gsp.business_id
   SET gsp.storefront_status = 'building',
       gsp.application_submitted_at = COALESCE(gsp.application_submitted_at, bp.created_at)
 WHERE bp.kind = 'gold_shop'
   AND bp.status = 'active'
   AND gsp.storefront_status = 'draft';
