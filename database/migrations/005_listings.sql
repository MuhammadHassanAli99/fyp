-- =============================================================================
-- 005  Listings: the universal spine (§8 Listing System)
--      Core columns are marketplace-agnostic. Module specifics live in
--      *_listing_details (006-008); admin-defined extras live in EAV.
-- =============================================================================

USE marketplace;

CREATE TABLE IF NOT EXISTS listings (
  id               BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)         NOT NULL,
  reference_code   VARCHAR(24)      NOT NULL,          -- human-quotable, e.g. "GLD-8F2K19"
  marketplace_id   TINYINT UNSIGNED NOT NULL,
  category_id      INT UNSIGNED     NOT NULL,
  user_id          BIGINT UNSIGNED  NOT NULL,
  business_id      BIGINT UNSIGNED  NULL,
  operation        ENUM('buy','sell','rent','auction','exchange') NOT NULL DEFAULT 'sell',

  -- Content
  title            VARCHAR(191)     NOT NULL,
  slug             VARCHAR(220)     NOT NULL,
  description      MEDIUMTEXT       NULL,
  language         VARCHAR(10)      NULL,
  condition_code   ENUM('new','like_new','excellent','good','fair','used','refurbished',
                        'for_parts','under_construction') NULL,

  -- Money: original values are authoritative; conversion happens per-request
  price            DECIMAL(18,2)    NULL,
  currency         CHAR(3)          NULL,
  price_type       ENUM('fixed','negotiable','on_call','starting_from','auction','free')
                     NOT NULL DEFAULT 'fixed',
  price_period     ENUM('total','per_month','per_week','per_day','per_night','per_hour',
                        'per_year','per_gram','per_tola','per_ounce','per_sqft','per_sqm',
                        'per_marla','per_kanal') NOT NULL DEFAULT 'total',
  -- Normalised to platform base currency at publish time, for cross-currency sorting
  price_base       DECIMAL(18,2)    NULL,
  price_negotiable BOOLEAN          NOT NULL DEFAULT FALSE,
  installments_available BOOLEAN    NOT NULL DEFAULT FALSE,

  -- Location (§1 Location, §11 Maps)
  country_id       SMALLINT UNSIGNED NOT NULL,
  region_id        INT UNSIGNED     NULL,
  city_id          INT UNSIGNED     NULL,
  area_id          INT UNSIGNED     NULL,
  address          VARCHAR(255)     NULL,
  postal_code      VARCHAR(24)      NULL,
  latitude         DECIMAL(10,7)    NULL,
  longitude        DECIMAL(10,7)    NULL,
  hide_exact_location BOOLEAN       NOT NULL DEFAULT FALSE,

  -- Lifecycle (§8) — enforced as a state machine in the service layer
  status           ENUM('draft','pending_review','published','rejected','expired',
                        'sold','rented','reserved','archived','removed')
                     NOT NULL DEFAULT 'draft',
  rejection_reason VARCHAR(500)     NULL,
  published_at     TIMESTAMP        NULL,
  expires_at       TIMESTAMP        NULL,
  renewed_at       TIMESTAMP        NULL,
  renewal_count    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  sold_at          TIMESTAMP        NULL,
  archived_at      TIMESTAMP        NULL,

  -- Promotion (§8 Featured / Boosted, §16 subscription benefits)
  is_featured      BOOLEAN          NOT NULL DEFAULT FALSE,
  featured_until   TIMESTAMP        NULL,
  is_boosted       BOOLEAN          NOT NULL DEFAULT FALSE,
  boosted_until    TIMESTAMP        NULL,
  is_urgent        BOOLEAN          NOT NULL DEFAULT FALSE,
  bump_at          TIMESTAMP        NULL,             -- last "bump up" for feed ordering
  search_rank      DECIMAL(8,4)     NOT NULL DEFAULT 1.0000,

  -- Counters (denormalised for feed sorting; updated by jobs/triggers)
  view_count       INT UNSIGNED     NOT NULL DEFAULT 0,
  unique_view_count INT UNSIGNED    NOT NULL DEFAULT 0,
  favorite_count   INT UNSIGNED     NOT NULL DEFAULT 0,
  lead_count       INT UNSIGNED     NOT NULL DEFAULT 0,
  share_count      INT UNSIGNED     NOT NULL DEFAULT 0,
  contact_reveal_count INT UNSIGNED NOT NULL DEFAULT 0,
  media_count      SMALLINT UNSIGNED NOT NULL DEFAULT 0,

  -- Quality / trust (§18, §19)
  completeness_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  quality_score    DECIMAL(5,2)     NULL,
  ai_flags         JSON             NULL,              -- {"duplicate":0.12,"spam":0.03,...}
  moderation_state ENUM('not_required','clean','flagged','under_review','actioned')
                     NOT NULL DEFAULT 'not_required',
  is_verified      BOOLEAN          NOT NULL DEFAULT FALSE,   -- inspected / documents checked

  -- Contact preferences per listing
  contact_phone    VARCHAR(24)      NULL,
  contact_whatsapp VARCHAR(24)      NULL,
  allow_chat       BOOLEAN          NOT NULL DEFAULT TRUE,
  allow_calls      BOOLEAN          NOT NULL DEFAULT TRUE,
  allow_offers     BOOLEAN          NOT NULL DEFAULT TRUE,

  source           ENUM('app','web','api','import','crawler') NOT NULL DEFAULT 'app',
  created_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at       TIMESTAMP        NULL,

  PRIMARY KEY (id),
  UNIQUE KEY uk_listings_uuid (uuid),
  UNIQUE KEY uk_listings_reference (reference_code),
  UNIQUE KEY uk_listings_slug (marketplace_id, slug),

  -- The feed: marketplace + status + ordering
  KEY idx_listings_feed (marketplace_id, status, is_featured, bump_at, published_at),
  KEY idx_listings_category_feed (category_id, status, price_base),
  KEY idx_listings_location_feed (country_id, city_id, status, published_at),
  KEY idx_listings_owner (user_id, status, created_at),
  KEY idx_listings_business (business_id, status),
  KEY idx_listings_operation (marketplace_id, operation, status),
  KEY idx_listings_price (marketplace_id, status, price_base),
  KEY idx_listings_geo (latitude, longitude),
  KEY idx_listings_expiry (status, expires_at),
  KEY idx_listings_promotion (is_featured, featured_until, is_boosted, boosted_until),
  KEY idx_listings_moderation (moderation_state, created_at),

  CONSTRAINT fk_listings_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_listings_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_listings_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_listings_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_listings_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_listings_city FOREIGN KEY (city_id)
    REFERENCES cities (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_listings_area FOREIGN KEY (area_id)
    REFERENCES areas (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_listings_price CHECK (price IS NULL OR price >= 0)
) ENGINE = InnoDB;

-- Full-text search over title + description (§9 Marketplace Search)
ALTER TABLE listings ADD FULLTEXT KEY ft_listings_text (title, description);

-- -----------------------------------------------------------------------------
-- EAV attribute values.
-- Split typed columns so range filters stay index-friendly.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_attribute_values (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id   BIGINT UNSIGNED NOT NULL,
  attribute_id INT UNSIGNED    NOT NULL,
  value_text   VARCHAR(500)    NULL,
  value_number DECIMAL(20,4)   NULL,
  value_bool   BOOLEAN         NULL,
  value_date   DATE            NULL,
  value_json   JSON            NULL,          -- multi_enum selections
  option_id    INT UNSIGNED    NULL,          -- when the value is an enum option
  unit_code    VARCHAR(24)     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_lav_listing_attr (listing_id, attribute_id),
  KEY idx_lav_attr_number (attribute_id, value_number),
  KEY idx_lav_attr_text (attribute_id, value_text(64)),
  KEY idx_lav_attr_option (attribute_id, option_id),
  KEY idx_lav_attr_bool (attribute_id, value_bool),
  CONSTRAINT fk_lav_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_lav_attribute FOREIGN KEY (attribute_id)
    REFERENCES attributes (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_lav_option FOREIGN KEY (option_id)
    REFERENCES attribute_options (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Media (§16 more images / video upload, §18 image enhancement)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_media (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id    BIGINT UNSIGNED NOT NULL,
  kind          ENUM('image','video','tour_360','floor_plan','audio') NOT NULL DEFAULT 'image',
  url           VARCHAR(512)    NOT NULL,
  thumb_url     VARCHAR(512)    NULL,
  card_url      VARCHAR(512)    NULL,
  width         SMALLINT UNSIGNED NULL,
  height        SMALLINT UNSIGNED NULL,
  duration_secs SMALLINT UNSIGNED NULL,
  size_bytes    INT UNSIGNED    NULL,
  mime_type     VARCHAR(96)     NULL,
  caption       VARCHAR(191)    NULL,
  is_primary    BOOLEAN         NOT NULL DEFAULT FALSE,
  sort_order    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  -- AI (§18)
  is_ai_enhanced BOOLEAN        NOT NULL DEFAULT FALSE,
  original_url  VARCHAR(512)    NULL,
  perceptual_hash CHAR(64)      NULL,          -- §19 image similarity detection
  ai_labels     JSON            NULL,
  nsfw_score    DECIMAL(5,4)    NULL,
  status        ENUM('uploading','processing','ready','failed','rejected') NOT NULL DEFAULT 'ready',
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_listing_media_listing (listing_id, sort_order),
  KEY idx_listing_media_primary (listing_id, is_primary),
  KEY idx_listing_media_phash (perceptual_hash),
  CONSTRAINT fk_listing_media_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Documents (§6 ownership papers / maps / approvals; §7 registration papers)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_documents (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id   BIGINT UNSIGNED NOT NULL,
  doc_type     ENUM('ownership','title_deed','map','site_plan','approval','noc','tax_receipt',
                    'registration','transfer_letter','inspection','certificate','assay',
                    'invoice','insurance','other') NOT NULL,
  title        VARCHAR(191)    NULL,
  file_url     VARCHAR(512)    NOT NULL,
  file_hash    CHAR(64)        NULL,
  mime_type    VARCHAR(96)     NULL,
  size_bytes   INT UNSIGNED    NULL,
  is_public    BOOLEAN         NOT NULL DEFAULT FALSE,   -- private until buyer is serious
  verified_at  TIMESTAMP       NULL,
  verified_by  BIGINT UNSIGNED NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_listing_docs_listing (listing_id, doc_type),
  CONSTRAINT fk_listing_docs_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Status history — full audit of the state machine
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_status_history (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id  BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(24)     NULL,
  to_status   VARCHAR(24)     NOT NULL,
  actor_id    BIGINT UNSIGNED NULL,
  actor_type  ENUM('owner','moderator','system','job','ai') NOT NULL DEFAULT 'owner',
  reason      VARCHAR(500)    NULL,
  metadata    JSON            NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_listing_status_history (listing_id, created_at),
  CONSTRAINT fk_listing_status_history_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Engagement: views, leads, contact reveals (§23 Seller Dashboard, §24 Analytics)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_views (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id  BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NULL,
  guest_uuid  CHAR(36)        NULL,
  device_id   BIGINT UNSIGNED NULL,
  source      ENUM('feed','search','category','similar','share','ad','direct','saved_search','compare')
                NOT NULL DEFAULT 'direct',
  country_id  SMALLINT UNSIGNED NULL,
  city_id     INT UNSIGNED    NULL,
  platform_id TINYINT UNSIGNED NULL,
  duration_ms INT UNSIGNED    NULL,
  ip_hash     CHAR(64)        NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_listing_views_listing (listing_id, created_at),
  KEY idx_listing_views_user (user_id, created_at),
  KEY idx_listing_views_dedupe (listing_id, ip_hash, created_at),
  CONSTRAINT fk_listing_views_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS listing_leads (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id  BIGINT UNSIGNED NOT NULL,
  seller_id   BIGINT UNSIGNED NOT NULL,
  buyer_id    BIGINT UNSIGNED NULL,
  channel     ENUM('chat','call','whatsapp','email','sms','form','offer') NOT NULL,
  status      ENUM('new','contacted','negotiating','won','lost','spam') NOT NULL DEFAULT 'new',
  message     VARCHAR(1000)   NULL,
  contact_name VARCHAR(128)   NULL,
  contact_phone VARCHAR(24)   NULL,
  contact_email VARCHAR(191)  NULL,
  offer_amount DECIMAL(18,2)  NULL,
  offer_currency CHAR(3)      NULL,
  quality_score TINYINT UNSIGNED NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_leads_listing (listing_id, created_at),
  KEY idx_leads_seller (seller_id, status, created_at),
  KEY idx_leads_buyer (buyer_id, created_at),
  CONSTRAINT fk_leads_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_leads_seller FOREIGN KEY (seller_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Paid promotions on a listing (§8 Featured/Boosted, §16, §17)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_promotions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id   BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  kind         ENUM('feature','boost','urgent','bump','top_of_search','homepage','story')
                 NOT NULL,
  source       ENUM('purchase','subscription_quota','promo','admin') NOT NULL DEFAULT 'purchase',
  order_id     BIGINT UNSIGNED NULL,
  amount       DECIMAL(18,2)   NULL,
  currency     CHAR(3)         NULL,
  starts_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at      TIMESTAMP       NOT NULL,
  status       ENUM('scheduled','active','expired','cancelled','refunded') NOT NULL DEFAULT 'active',
  impressions  INT UNSIGNED    NOT NULL DEFAULT 0,
  clicks       INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_promotions_listing (listing_id, status),
  KEY idx_promotions_active (status, ends_at),
  KEY idx_promotions_user (user_id, created_at),
  CONSTRAINT fk_promotions_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_promotions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Price change history — powers "price dropped" badges and trend analytics
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_price_history (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id BIGINT UNSIGNED NOT NULL,
  old_price  DECIMAL(18,2)   NULL,
  new_price  DECIMAL(18,2)   NOT NULL,
  currency   CHAR(3)         NOT NULL,
  changed_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_price_history_listing (listing_id, created_at),
  CONSTRAINT fk_price_history_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Drafts synced from the client outbox (§26 Offline Support / Background Sync)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_drafts (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          CHAR(36)        NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  marketplace_id TINYINT UNSIGNED NOT NULL,
  category_id   INT UNSIGNED    NULL,
  payload       JSON            NOT NULL,
  step          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  client_updated_at TIMESTAMP   NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_listing_drafts_uuid (uuid),
  KEY idx_listing_drafts_user (user_id, updated_at),
  CONSTRAINT fk_listing_drafts_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Auctions (§5 Gold: Buy / Sell / Auction — engine is generic so any
-- marketplace can enable it via marketplaces.config)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auctions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)        NOT NULL,
  listing_id      BIGINT UNSIGNED NOT NULL,
  start_price     DECIMAL(18,2)   NOT NULL,
  reserve_price   DECIMAL(18,2)   NULL,
  buy_now_price   DECIMAL(18,2)   NULL,
  bid_increment   DECIMAL(18,2)   NOT NULL DEFAULT 1.00,
  currency        CHAR(3)         NOT NULL,
  current_bid     DECIMAL(18,2)   NULL,
  bid_count       INT UNSIGNED    NOT NULL DEFAULT 0,
  starts_at       TIMESTAMP       NOT NULL,
  ends_at         TIMESTAMP       NOT NULL,
  anti_snipe_secs SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status          ENUM('scheduled','live','ended','sold','unsold','cancelled') NOT NULL DEFAULT 'scheduled',
  winner_id       BIGINT UNSIGNED NULL,
  requires_deposit BOOLEAN        NOT NULL DEFAULT FALSE,
  deposit_amount  DECIMAL(18,2)   NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_auctions_uuid (uuid),
  UNIQUE KEY uk_auctions_listing (listing_id),
  KEY idx_auctions_status (status, ends_at),
  CONSTRAINT fk_auctions_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_auctions_winner FOREIGN KEY (winner_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS auction_bids (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  auction_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  amount     DECIMAL(18,2)   NOT NULL,
  max_amount DECIMAL(18,2)   NULL,             -- proxy bidding ceiling
  is_auto    BOOLEAN         NOT NULL DEFAULT FALSE,
  status     ENUM('active','outbid','won','lost','retracted','invalid') NOT NULL DEFAULT 'active',
  ip_address VARBINARY(16)   NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bids_auction (auction_id, amount),
  KEY idx_bids_user (user_id, created_at),
  CONSTRAINT fk_bids_auction FOREIGN KEY (auction_id)
    REFERENCES auctions (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bids_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Offers / negotiation, independent of chat
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_offers (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id  BIGINT UNSIGNED NOT NULL,
  buyer_id    BIGINT UNSIGNED NOT NULL,
  seller_id   BIGINT UNSIGNED NOT NULL,
  amount      DECIMAL(18,2)   NOT NULL,
  currency    CHAR(3)         NOT NULL,
  message     VARCHAR(500)    NULL,
  status      ENUM('pending','countered','accepted','rejected','withdrawn','expired')
                NOT NULL DEFAULT 'pending',
  parent_id   BIGINT UNSIGNED NULL,            -- counter-offer chain
  expires_at  TIMESTAMP       NULL,
  responded_at TIMESTAMP      NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_offers_listing (listing_id, status),
  KEY idx_offers_buyer (buyer_id, created_at),
  KEY idx_offers_seller (seller_id, status),
  CONSTRAINT fk_offers_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_offers_buyer FOREIGN KEY (buyer_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_offers_parent FOREIGN KEY (parent_id)
    REFERENCES listing_offers (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;
