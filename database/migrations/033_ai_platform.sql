-- =============================================================================
-- 033  AI platform (additive on 015/016/012)
--      Central AI Gateway / Orchestrator / Model Router support.
--      Does NOT create a second Gold/Property/Vehicle AI system, vector DB,
--      or duplicate of ai_jobs / risk_scores / duplicate_detections.
-- =============================================================================

USE marketplace;

-- Audit fields the job ledger was missing for human override + confidence bands.
ALTER TABLE ai_jobs
  ADD COLUMN confidence DECIMAL(5,2) NULL AFTER cache_hit,
  ADD COLUMN decision VARCHAR(32) NULL AFTER confidence,
  ADD COLUMN reviewed_by BIGINT UNSIGNED NULL AFTER decision,
  ADD COLUMN reviewed_at TIMESTAMP NULL AFTER reviewed_by,
  ADD COLUMN review_reason VARCHAR(255) NULL AFTER reviewed_at;

ALTER TABLE ai_jobs
  ADD KEY idx_ai_jobs_decision (decision, created_at),
  ADD CONSTRAINT fk_ai_jobs_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Thumbnail / card already exist; large keeps the enhancement ladder complete
-- without overwriting original_url.
ALTER TABLE listing_media
  ADD COLUMN large_url VARCHAR(512) NULL AFTER card_url;

-- VIN / certificate methods were written by listings.engine as 'vin' which is
-- not in the original ENUM and was silently dropped. Expand the vocabulary.
ALTER TABLE duplicate_detections
  MODIFY COLUMN method ENUM(
    'text_hash','text_embedding','image_hash','image_embedding',
    'contact_match','composite','vin','certificate','location_price','structured'
  ) NOT NULL;

-- Configurable confidence cutoffs. Application code must not hard-code
-- "if plan == professional" or magic 0.85 reject floors.
CREATE TABLE IF NOT EXISTS ai_confidence_thresholds (
  capability     VARCHAR(48)   NOT NULL,
  high_min       DECIMAL(5,2)  NOT NULL DEFAULT 80.00,
  medium_min     DECIMAL(5,2)  NOT NULL DEFAULT 50.00,
  auto_action    ENUM('none','allow','review','reject') NOT NULL DEFAULT 'none',
  notes          VARCHAR(255)  NULL,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (capability)
) ENGINE = InnoDB;
