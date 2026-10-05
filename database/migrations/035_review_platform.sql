-- =============================================================================
-- 035  Review Platform (additive on 014 / 016)
--      One review engine for Gold, Property and Vehicle. Does NOT create
--      gold_reviews / property_reviews / vehicle_reviews.
-- =============================================================================

USE marketplace;

ALTER TABLE reviews
  MODIFY COLUMN status ENUM(
    'pending','published','rejected','hidden','flagged',
    'under_review','removed','restored'
  ) NOT NULL DEFAULT 'pending';

ALTER TABLE reviews
  ADD COLUMN review_type ENUM(
    'buyer_to_seller','seller_to_buyer','buyer_to_dealer',
    'customer_to_agency','customer_to_gold_shop'
  ) NOT NULL DEFAULT 'buyer_to_seller' AFTER reviewer_role,
  ADD COLUMN entity_type ENUM(
    'user','seller','dealer','agency','gold_shop','listing','property','vehicle'
  ) NOT NULL DEFAULT 'user' AFTER review_type,
  ADD COLUMN entity_id BIGINT UNSIGNED NULL AFTER entity_type,
  ADD COLUMN verification_kind ENUM(
    'none','purchase','rental','transaction','interaction'
  ) NOT NULL DEFAULT 'none' AFTER is_transaction_verified,
  ADD COLUMN order_id BIGINT UNSIGNED NULL AFTER transaction_reference,
  ADD COLUMN listing_event_id BIGINT UNSIGNED NULL AFTER order_id,
  ADD COLUMN window_starts_at TIMESTAMP NULL AFTER listing_event_id,
  ADD COLUMN window_ends_at TIMESTAMP NULL AFTER window_starts_at,
  ADD COLUMN restored_at TIMESTAMP NULL AFTER deleted_at,
  ADD COLUMN restored_by BIGINT UNSIGNED NULL AFTER restored_at,
  ADD KEY idx_reviews_order (order_id),
  ADD KEY idx_reviews_type (review_type, status),
  ADD KEY idx_reviews_entity (entity_type, entity_id, status);

ALTER TABLE reviews
  ADD CONSTRAINT fk_reviews_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_reviews_restored_by FOREIGN KEY (restored_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE rating_summaries
  ADD COLUMN verified_review_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER review_count;

ALTER TABLE review_media
  ADD COLUMN object_key VARCHAR(512) NULL AFTER url,
  ADD COLUMN scan_status ENUM('pending','clean','blocked') NOT NULL DEFAULT 'pending' AFTER moderation_status,
  ADD COLUMN transcode_status ENUM('none','pending','processing','ready','failed') NOT NULL DEFAULT 'none'
    AFTER scan_status;

ALTER TABLE review_replies
  MODIFY COLUMN status ENUM('pending','published','hidden','rejected') NOT NULL DEFAULT 'pending';

ALTER TABLE review_reports
  MODIFY COLUMN reason_code ENUM(
    'spam','fake','offensive','irrelevant','personal_info','conflict_of_interest','other',
    'abuse','harassment','wrong_transaction','fraud','off_topic'
  ) NOT NULL;

CREATE TABLE IF NOT EXISTS review_audit (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id    BIGINT UNSIGNED NOT NULL,
  actor_id     BIGINT UNSIGNED NULL,
  action       VARCHAR(48)     NOT NULL,
  from_status  VARCHAR(32)     NULL,
  to_status    VARCHAR(32)     NULL,
  note         VARCHAR(500)    NULL,
  payload      JSON            NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_review_audit_review (review_id, created_at),
  CONSTRAINT fk_review_audit_review FOREIGN KEY (review_id)
    REFERENCES reviews (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_review_audit_actor FOREIGN KEY (actor_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;
