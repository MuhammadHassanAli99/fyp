-- =============================================================================
-- 014  Reviews & ratings: criteria, reviews, media, replies, votes, reports,
--      invitations, denormalised rating summaries
--      (§20 Reviews & Ratings — feeds §3 Trust Score and §23 Seller Dashboard)
--
-- FK policy in this file: owned children CASCADE, optional actors SET NULL,
-- catalogue parents RESTRICT.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Rating dimensions (§20 Detailed Ratings). Per-marketplace because
-- "price_fairness" matters for gold while "accuracy_of_description" matters for
-- property; marketplace_id NULL = the dimension applies everywhere.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_criteria (
  id             SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  marketplace_id TINYINT UNSIGNED  NULL,
  -- communication | accuracy_of_description | price_fairness | product_quality
  -- | professionalism | response_time | delivery
  code           VARCHAR(64)       NOT NULL,
  label          VARCHAR(96)       NOT NULL,
  -- Restricts which subject a dimension may be scored against
  applies_to     ENUM('seller','buyer','dealer','agency','gold_shop','listing','all')
                   NOT NULL DEFAULT 'all',
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active      BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_review_criteria_mp_code (marketplace_id, code),
  KEY idx_review_criteria_form (marketplace_id, applies_to, is_active, sort_order),
  CONSTRAINT fk_review_criteria_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- The review itself. Polymorphic subject so one engine covers seller, buyer,
-- dealer, agency, gold shop, listing and business reviews (§20).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id                     BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid                   CHAR(36)         NOT NULL,
  reviewer_id            BIGINT UNSIGNED  NOT NULL,
  subject_kind           ENUM('user','listing','business') NOT NULL,
  subject_user_id        BIGINT UNSIGNED  NULL,
  subject_listing_id     BIGINT UNSIGNED  NULL,
  subject_business_id    BIGINT UNSIGNED  NULL,
  marketplace_id         TINYINT UNSIGNED NULL,          -- NULL = cross-marketplace review of a person
  -- The hat the reviewer was wearing; drives which criteria the UI renders
  reviewer_role          ENUM('buyer','seller','renter','landlord','visitor') NOT NULL DEFAULT 'buyer',
  rating                 DECIMAL(3,2)     NOT NULL,      -- 1.00 .. 5.00
  title                  VARCHAR(191)     NULL,
  body                   TEXT             NULL,
  -- A verified review is weighted far higher in rating_summaries and trust score
  is_transaction_verified BOOLEAN         NOT NULL DEFAULT FALSE,
  transaction_reference  VARCHAR(96)      NULL,          -- order / deal / viewing reference
  language               VARCHAR(10)      NULL,
  status                 ENUM('pending','published','rejected','hidden','flagged')
                           NOT NULL DEFAULT 'pending',
  rejection_reason       VARCHAR(500)     NULL,
  -- Denormalised counters so review cards never aggregate votes at read time
  helpful_count          INT UNSIGNED     NOT NULL DEFAULT 0,
  not_helpful_count      INT UNSIGNED     NOT NULL DEFAULT 0,
  report_count           INT UNSIGNED     NOT NULL DEFAULT 0,
  reply_count            INT UNSIGNED     NOT NULL DEFAULT 0,
  is_anonymous           BOOLEAN          NOT NULL DEFAULT FALSE,
  -- §19 fake-review detection hooks, written by the AI pipeline
  ai_authenticity_score  DECIMAL(5,2)     NULL,
  ai_sentiment           ENUM('positive','neutral','negative','mixed') NULL,
  ai_flags               JSON             NULL,
  published_at           TIMESTAMP        NULL,
  created_at             TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at             TIMESTAMP        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_reviews_uuid (uuid),
  -- One review per reviewer per subject per transaction. NULL transaction
  -- references are treated as distinct by MySQL, so the service layer still
  -- enforces the "one unverified review per subject" rule.
  UNIQUE KEY uk_reviews_reviewer_subject (reviewer_id, subject_kind, subject_user_id,
                                          subject_listing_id, transaction_reference),
  KEY idx_reviews_subject_user (subject_kind, subject_user_id, status),
  KEY idx_reviews_subject_listing (subject_listing_id, status),
  KEY idx_reviews_subject_business (subject_business_id, status),
  KEY idx_reviews_reviewer (reviewer_id),
  KEY idx_reviews_moderation_queue (status, created_at),
  KEY idx_reviews_marketplace (marketplace_id, status, published_at),
  CONSTRAINT fk_reviews_reviewer FOREIGN KEY (reviewer_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_subject_user FOREIGN KEY (subject_user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_subject_listing FOREIGN KEY (subject_listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_subject_business FOREIGN KEY (subject_business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_reviews_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT chk_reviews_rating CHECK (rating >= 1.00 AND rating <= 5.00)
  -- "the populated subject column must agree with subject_kind" is enforced in
  -- the review service: MySQL forbids a CHECK on columns that also carry
  -- cascading foreign keys.
) ENGINE = InnoDB;

-- Per-dimension scores behind the headline rating
CREATE TABLE IF NOT EXISTS review_criteria_ratings (
  review_id   BIGINT UNSIGNED   NOT NULL,
  criteria_id SMALLINT UNSIGNED NOT NULL,
  rating      DECIMAL(3,2)      NOT NULL,
  PRIMARY KEY (review_id, criteria_id),
  KEY idx_review_criteria_ratings_criteria (criteria_id),
  CONSTRAINT fk_review_criteria_ratings_review FOREIGN KEY (review_id)
    REFERENCES reviews (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_criteria_ratings_criteria FOREIGN KEY (criteria_id)
    REFERENCES review_criteria (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT chk_review_criteria_rating CHECK (rating >= 1.00 AND rating <= 5.00)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §20 Photo Reviews / Video Reviews — attachments carry their own moderation
-- state because media clears at a different pace than the review text.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_media (
  id                BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  review_id         BIGINT UNSIGNED   NOT NULL,
  kind              ENUM('image','video') NOT NULL DEFAULT 'image',
  url               VARCHAR(512)      NOT NULL,
  thumb_url         VARCHAR(512)      NULL,
  width             SMALLINT UNSIGNED NULL,
  height            SMALLINT UNSIGNED NULL,
  duration_secs     SMALLINT UNSIGNED NULL,
  size_bytes        INT UNSIGNED      NULL,
  mime_type         VARCHAR(96)       NULL,
  sort_order        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  moderation_status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  nsfw_score        DECIMAL(5,4)      NULL,
  created_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_review_media_review (review_id, sort_order),
  KEY idx_review_media_moderation (moderation_status, created_at),
  CONSTRAINT fk_review_media_review FOREIGN KEY (review_id)
    REFERENCES reviews (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §20 Review Response — is_official marks the reviewed seller's own reply,
-- which the UI pins directly under the review.
CREATE TABLE IF NOT EXISTS review_replies (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  body        TEXT            NOT NULL,
  is_official BOOLEAN         NOT NULL DEFAULT FALSE,
  status      ENUM('published','hidden') NOT NULL DEFAULT 'published',
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at  TIMESTAMP       NULL,
  PRIMARY KEY (id),
  KEY idx_review_replies_review (review_id, status, created_at),
  KEY idx_review_replies_user (user_id, created_at),
  CONSTRAINT fk_review_replies_review FOREIGN KEY (review_id)
    REFERENCES reviews (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_replies_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §20 Review Helpfulness. PK is the dedupe: one vote per user per review.
CREATE TABLE IF NOT EXISTS review_votes (
  review_id  BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  is_helpful BOOLEAN         NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (review_id, user_id),
  KEY idx_review_votes_user (user_id),
  CONSTRAINT fk_review_votes_review FOREIGN KEY (review_id)
    REFERENCES reviews (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_votes_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §20 Review Reporting — feeds the §22 moderation queue
CREATE TABLE IF NOT EXISTS review_reports (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id   BIGINT UNSIGNED NOT NULL,
  reporter_id BIGINT UNSIGNED NOT NULL,
  reason_code ENUM('spam','fake','offensive','irrelevant','personal_info',
                   'conflict_of_interest','other') NOT NULL,
  description VARCHAR(1000)   NULL,
  status      ENUM('pending','reviewed','upheld','dismissed') NOT NULL DEFAULT 'pending',
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP       NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_review_reports_reporter (review_id, reporter_id),
  KEY idx_review_reports_queue (status, created_at),
  KEY idx_review_reports_reviewer (reviewed_by, reviewed_at),
  CONSTRAINT fk_review_reports_review FOREIGN KEY (review_id)
    REFERENCES reviews (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_reports_reporter FOREIGN KEY (reporter_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_reports_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Review volume is the hard part of a marketplace's reputation system: this is
-- the post-transaction nudge that produces it (§20 Review Invitations).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS review_invitations (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                CHAR(36)        NOT NULL,
  listing_id          BIGINT UNSIGNED NULL,
  seller_id           BIGINT UNSIGNED NOT NULL,
  buyer_id            BIGINT UNSIGNED NOT NULL,
  channel             ENUM('push','email','sms','in_app') NOT NULL DEFAULT 'push',
  sent_at             TIMESTAMP       NULL,
  reminded_at         TIMESTAMP       NULL,
  completed_review_id BIGINT UNSIGNED NULL,
  expires_at          TIMESTAMP       NULL,
  status              ENUM('pending','sent','completed','expired','declined')
                        NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_review_invitations_uuid (uuid),
  KEY idx_review_invitations_buyer (buyer_id, status),
  KEY idx_review_invitations_seller (seller_id, status),
  KEY idx_review_invitations_listing (listing_id),
  -- Reminder/expiry sweeper polls on this
  KEY idx_review_invitations_sweep (status, expires_at),
  KEY idx_review_invitations_review (completed_review_id),
  CONSTRAINT fk_review_invitations_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_invitations_seller FOREIGN KEY (seller_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_invitations_buyer FOREIGN KEY (buyer_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_invitations_review FOREIGN KEY (completed_review_id)
    REFERENCES reviews (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Denormalised aggregate: profile headers and listing cards read a single row
-- instead of aggregating the review table on every request.
-- marketplace_id 0 = summary across all marketplaces, so the UNIQUE key stays
-- enforceable (MySQL treats NULLs as distinct); hence no FK on that column.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rating_summaries (
  id                  BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  subject_kind        ENUM('user','listing','business') NOT NULL,
  subject_id          BIGINT UNSIGNED  NOT NULL,
  marketplace_id      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  review_count        INT UNSIGNED     NOT NULL DEFAULT 0,
  average_rating      DECIMAL(3,2)     NOT NULL DEFAULT 0.00,
  rating_1_count      INT UNSIGNED     NOT NULL DEFAULT 0,
  rating_2_count      INT UNSIGNED     NOT NULL DEFAULT 0,
  rating_3_count      INT UNSIGNED     NOT NULL DEFAULT 0,
  rating_4_count      INT UNSIGNED     NOT NULL DEFAULT 0,
  rating_5_count      INT UNSIGNED     NOT NULL DEFAULT 0,
  criteria_averages   JSON             NULL,   -- {"communication":4.6,"delivery":4.1}
  response_rate       DECIMAL(5,2)     NULL,
  avg_response_minutes INT UNSIGNED    NULL,
  recomputed_at       TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_rating_summaries_subject (subject_kind, subject_id, marketplace_id),
  -- Leaderboards / "top rated dealers" listings
  KEY idx_rating_summaries_ranking (subject_kind, marketplace_id, average_rating, review_count)
) ENGINE = InnoDB;
