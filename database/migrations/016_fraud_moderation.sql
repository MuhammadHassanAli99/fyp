-- =============================================================================
-- 016  Fraud prevention & moderation: fingerprints, IP reputation, risk engine,
--      access lists, behaviour/velocity/geo anomalies, duplicate & fake
--      detection, investigation cases, moderation queue, reports, sanctions
--      (§19 Fraud Prevention & Security, §22 Content Moderation)
--
-- Two deliberate FK choices in this file:
--   * evidence tables keep user_id ON DELETE SET NULL, so a fraud record
--     survives account erasure in de-identified form (§25 retention vs GDPR);
--   * behavior_events carries no FKs at all — it is a firehose sized for
--     ingest throughput and independent retention pruning.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- §19 Device Fingerprinting. One row per distinct browser/app fingerprint,
-- independent of user_devices: the point is to recognise a device *before* and
-- *across* accounts. distinct_user_count is the multi-account tripwire.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_fingerprints (
  id                  BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  fingerprint_hash    CHAR(64)          NOT NULL,   -- SHA-256 over the component set
  components          JSON              NULL,       -- raw signals, kept for re-derivation
  platform_id         TINYINT UNSIGNED  NULL,
  user_agent          VARCHAR(512)      NULL,
  screen_resolution   VARCHAR(24)       NULL,
  timezone            VARCHAR(64)       NULL,
  canvas_hash         CHAR(64)          NULL,
  webgl_hash          CHAR(64)          NULL,
  audio_hash          CHAR(64)          NULL,
  font_hash           CHAR(64)          NULL,
  is_rooted           BOOLEAN           NOT NULL DEFAULT FALSE,
  is_jailbroken       BOOLEAN           NOT NULL DEFAULT FALSE,
  is_emulator         BOOLEAN           NOT NULL DEFAULT FALSE,
  is_bot              BOOLEAN           NOT NULL DEFAULT FALSE,
  distinct_user_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  risk_score          DECIMAL(5,2)      NULL,
  first_seen_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_device_fingerprints_hash (fingerprint_hash),
  -- Admin sweep for shared devices and integrity-failing devices
  KEY idx_device_fingerprints_shared (distinct_user_count, risk_score),
  KEY idx_device_fingerprints_integrity (is_emulator, is_bot, last_seen_at),
  CONSTRAINT fk_device_fingerprints_platform FOREIGN KEY (platform_id)
    REFERENCES platforms (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §19 Multiple Account Detection: the fingerprint↔user join. Reading it in
-- either direction answers "how many accounts on this device" and
-- "how many devices for this account".
CREATE TABLE IF NOT EXISTS fingerprint_users (
  fingerprint_hash CHAR(64)        NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL,
  first_seen_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  session_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (fingerprint_hash, user_id),
  KEY idx_fingerprint_users_user (user_id, last_seen_at),
  CONSTRAINT fk_fingerprint_users_fingerprint FOREIGN KEY (fingerprint_hash)
    REFERENCES device_fingerprints (fingerprint_hash) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fingerprint_users_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §19 IP Tracking / VPN & Proxy Detection. Cache of third-party enrichment,
-- keyed on the binary IP so IPv4 and IPv6 share one table. expires_at drives
-- re-lookup; ip_text is kept for human-readable admin screens.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ip_reputation (
  ip_address          VARBINARY(16)     NOT NULL,
  ip_text             VARCHAR(45)       NOT NULL,
  country_id          SMALLINT UNSIGNED NULL,
  asn                 INT UNSIGNED      NULL,
  asn_org             VARCHAR(160)      NULL,
  is_vpn              BOOLEAN           NOT NULL DEFAULT FALSE,
  is_proxy            BOOLEAN           NOT NULL DEFAULT FALSE,
  is_tor              BOOLEAN           NOT NULL DEFAULT FALSE,
  is_datacenter       BOOLEAN           NOT NULL DEFAULT FALSE,
  is_relay            BOOLEAN           NOT NULL DEFAULT FALSE,
  is_abuser           BOOLEAN           NOT NULL DEFAULT FALSE,
  threat_level        ENUM('none','low','medium','high','critical') NOT NULL DEFAULT 'none',
  risk_score          DECIMAL(5,2)      NULL,
  provider            VARCHAR(48)       NULL,
  distinct_user_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  checked_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at          TIMESTAMP         NULL,
  PRIMARY KEY (ip_address),
  KEY idx_ip_reputation_threat (threat_level, risk_score),
  KEY idx_ip_reputation_refresh (expires_at),
  KEY idx_ip_reputation_asn (asn),
  CONSTRAINT fk_ip_reputation_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- The rule catalogue. Weights and auto_action live in data, not code, so risk
-- policy is tunable from the admin panel without a deploy (§19 Risk Scoring).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_signals (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(64)       NOT NULL,
  name        VARCHAR(128)      NOT NULL,
  description VARCHAR(500)      NULL,
  category    ENUM('identity','device','network','behavior','content','payment',
                   'velocity','geo') NOT NULL,
  weight      DECIMAL(6,3)      NOT NULL DEFAULT 0.000,
  severity    ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'low',
  is_active   BOOLEAN           NOT NULL DEFAULT TRUE,
  auto_action ENUM('none','challenge','review','block','ban') NOT NULL DEFAULT 'none',
  created_at  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_risk_signals_code (code),
  KEY idx_risk_signals_active (category, is_active, severity)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Every risk evaluation, append-only. This is the audit trail behind a block:
-- when a user disputes a suspension we replay these rows. signal_code is
-- RESTRICT because the catalogue is deactivated, never deleted.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_events (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid           CHAR(36)          NOT NULL,
  subject_kind   ENUM('user','device','listing','payment','session','message','review') NOT NULL,
  subject_id     BIGINT UNSIGNED   NOT NULL,
  user_id        BIGINT UNSIGNED   NULL,
  device_id      BIGINT UNSIGNED   NULL,
  signal_code    VARCHAR(64)       NOT NULL,
  score_delta    DECIMAL(6,3)      NOT NULL DEFAULT 0.000,
  ip_address     VARBINARY(16)     NULL,
  country_id     SMALLINT UNSIGNED NULL,   -- no FK: high-volume append-only table
  context        JSON              NULL,
  decision       ENUM('allow','challenge','review','block','ban') NOT NULL DEFAULT 'allow',
  was_overridden BOOLEAN           NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_risk_events_uuid (uuid),
  KEY idx_risk_events_subject (subject_kind, subject_id, created_at),
  KEY idx_risk_events_user (user_id, created_at),
  KEY idx_risk_events_decision (decision, created_at),
  KEY idx_risk_events_signal (signal_code, created_at),
  KEY idx_risk_events_device (device_id, created_at),
  CONSTRAINT fk_risk_events_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_risk_events_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_risk_events_signal FOREIGN KEY (signal_code)
    REFERENCES risk_signals (code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Current standing per subject — the value the request pipeline reads on every
-- risk-guarded route, so it must be a single indexed row lookup.
CREATE TABLE IF NOT EXISTS risk_scores (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_kind  ENUM('user','device','listing','payment','session','message','review') NOT NULL,
  subject_id    BIGINT UNSIGNED NOT NULL,
  score         DECIMAL(5,2)    NOT NULL DEFAULT 0.00,
  band          ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  factors       JSON            NULL,   -- {"signal_code": contribution}
  signal_count  INT UNSIGNED    NOT NULL DEFAULT 0,
  last_event_at TIMESTAMP       NULL,
  computed_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_risk_scores_subject (subject_kind, subject_id),
  KEY idx_risk_scores_band (band, score)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §19 Blacklist / Whitelist, unified. One table because every entry answers the
-- same question ("is this value allowed?") and the guard needs one lookup path.
-- NULL expires_at = permanent. A NULL-free UNIQUE key makes the admin upsert safe.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_lists (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  list_kind  ENUM('blacklist','whitelist','greylist') NOT NULL,
  entry_kind ENUM('ip','ip_range','email','email_domain','phone','device','user','country',
                  'asn','keyword','url','iban','card_fingerprint') NOT NULL,
  value_text VARCHAR(255)    NOT NULL,
  reason     VARCHAR(500)    NULL,
  source     ENUM('manual','automated','partner','regulator') NOT NULL DEFAULT 'manual',
  severity   ENUM('info','low','medium','high','critical') NOT NULL DEFAULT 'medium',
  expires_at TIMESTAMP       NULL,
  added_by   BIGINT UNSIGNED NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_access_lists_entry (list_kind, entry_kind, value_text),
  -- The hot path: "is this value listed right now?"
  KEY idx_access_lists_lookup (entry_kind, value_text, list_kind, expires_at),
  KEY idx_access_lists_expiry (expires_at),
  CONSTRAINT fk_access_lists_added_by FOREIGN KEY (added_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §19 Behavior Analysis. Highest-volume table in the schema: intentionally two
-- indexes only, and no foreign keys, so ingest stays cheap and old partitions
-- can be pruned without touching parent tables.
-- session_id is the client session id, the same value as analytics_events.session_id.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS behavior_events (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NULL,
  guest_uuid      CHAR(36)        NULL,
  session_id      VARCHAR(64)     NULL,
  device_id       BIGINT UNSIGNED NULL,
  action          VARCHAR(64)     NOT NULL,
  target_type     VARCHAR(48)     NULL,
  target_id       BIGINT UNSIGNED NULL,
  sequence_number INT UNSIGNED    NOT NULL DEFAULT 0,   -- ordinal within the session
  dwell_ms        INT UNSIGNED    NULL,
  is_anomalous    BOOLEAN         NOT NULL DEFAULT FALSE,
  anomaly_score   DECIMAL(5,4)    NULL,
  context         JSON            NULL,
  ip_address      VARBINARY(16)   NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_behavior_events_user (user_id, created_at),
  KEY idx_behavior_events_session (session_id, sequence_number)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Sliding-window abuse counters (posting, messaging, login, contact reveals).
-- subject_id is text because the subject may be an IP, an email or a user id.
-- The UNIQUE key is the upsert target: one row per window bucket.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS velocity_counters (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_kind   ENUM('user','guest','ip','device','fingerprint','email','phone','session')
                   NOT NULL,
  subject_id     VARCHAR(96)     NOT NULL,
  action         VARCHAR(64)     NOT NULL,
  window_start   TIMESTAMP       NOT NULL,
  window_seconds INT UNSIGNED    NOT NULL,
  counter        INT UNSIGNED    NOT NULL DEFAULT 0,
  threshold      INT UNSIGNED    NULL,
  breached_at    TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_velocity_counters_window (subject_kind, subject_id, action, window_start),
  KEY idx_velocity_counters_breached (breached_at),
  -- Expired-bucket cleanup
  KEY idx_velocity_counters_sweep (window_start)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §19 GPS Analysis / impossible travel. Storing both endpoints and the derived
-- speed means an alert is explainable to the user and to a reviewer.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS geo_anomalies (
  id                  BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  user_id             BIGINT UNSIGNED   NULL,
  session_id          BIGINT UNSIGNED   NULL,
  previous_country_id SMALLINT UNSIGNED NULL,
  current_country_id  SMALLINT UNSIGNED NULL,
  previous_lat        DECIMAL(10,7)     NULL,
  previous_lng        DECIMAL(10,7)     NULL,
  current_lat         DECIMAL(10,7)     NULL,
  current_lng         DECIMAL(10,7)     NULL,
  distance_km         DECIMAL(12,3)     NULL,
  elapsed_minutes     INT UNSIGNED      NULL,
  implied_speed_kmh   DECIMAL(12,3)     NULL,
  is_impossible_travel BOOLEAN          NOT NULL DEFAULT FALSE,
  gps_mock_suspected  BOOLEAN           NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_geo_anomalies_user (user_id, created_at),
  KEY idx_geo_anomalies_flagged (is_impossible_travel, gps_mock_suspected, created_at),
  KEY idx_geo_anomalies_session (session_id),
  CONSTRAINT fk_geo_anomalies_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_geo_anomalies_session FOREIGN KEY (session_id)
    REFERENCES user_sessions (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_geo_anomalies_prev_country FOREIGN KEY (previous_country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_geo_anomalies_curr_country FOREIGN KEY (current_country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §19 Account Takeover Detection. Separate from risk_events because an ATO
-- alert has its own lifecycle: notify, challenge, revoke, resolve, and it is
-- reviewed for false positives to tune the triggers.
CREATE TABLE IF NOT EXISTS account_takeover_alerts (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NULL,
  session_id        BIGINT UNSIGNED NULL,
  trigger_kind      ENUM('new_device','new_country','impossible_travel','credential_stuffing',
                         'password_change','email_change','phone_change','mass_action',
                         'session_reuse') NOT NULL,
  risk_score        DECIMAL(5,2)    NULL,
  evidence          JSON            NULL,
  action_taken      ENUM('none','notified','challenged','session_revoked','account_locked')
                      NOT NULL DEFAULT 'none',
  notified_at       TIMESTAMP       NULL,
  resolved_at       TIMESTAMP       NULL,
  resolved_by       BIGINT UNSIGNED NULL,
  is_false_positive BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ato_alerts_user (user_id, created_at),
  KEY idx_ato_alerts_open (resolved_at, risk_score),
  KEY idx_ato_alerts_trigger (trigger_kind, created_at),
  KEY idx_ato_alerts_session (session_id),
  CONSTRAINT fk_ato_alerts_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ato_alerts_session FOREIGN KEY (session_id)
    REFERENCES user_sessions (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ato_alerts_resolver FOREIGN KEY (resolved_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §19 Duplicate Listing Detection. method is part of the UNIQUE key so text and
-- image detectors can both report the same pair without fighting each other.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS duplicate_detections (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id             BIGINT UNSIGNED NOT NULL,
  duplicate_of_listing_id BIGINT UNSIGNED NOT NULL,
  similarity             DECIMAL(5,4)    NOT NULL,
  method                 ENUM('text_hash','text_embedding','image_hash','image_embedding',
                              'contact_match','composite') NOT NULL,
  matched_fields         JSON            NULL,
  status                 ENUM('detected','confirmed','dismissed','actioned')
                           NOT NULL DEFAULT 'detected',
  reviewed_by            BIGINT UNSIGNED NULL,
  reviewed_at            TIMESTAMP       NULL,
  created_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_duplicate_detections_pair (listing_id, duplicate_of_listing_id, method),
  KEY idx_duplicate_detections_original (duplicate_of_listing_id),
  KEY idx_duplicate_detections_queue (status, similarity, created_at),
  KEY idx_duplicate_detections_reviewer (reviewed_by),
  CONSTRAINT fk_duplicate_detections_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_duplicate_detections_original FOREIGN KEY (duplicate_of_listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_duplicate_detections_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
  -- The listing_id <> duplicate_of_listing_id guard lives in the detection
  -- service: MySQL forbids a CHECK on a column with a cascading foreign key.
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §19 Image Similarity Detection. Three perceptual hashes because each catches
-- a different manipulation (crop, recolour, watermark); sha256 catches exact
-- re-uploads. first_seen_listing_id is what makes "stolen photos" provable.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_hashes (
  id                     BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  media_id               BIGINT UNSIGNED   NOT NULL,
  listing_id             BIGINT UNSIGNED   NULL,
  phash                  CHAR(64)          NULL,
  dhash                  CHAR(64)          NULL,
  ahash                  CHAR(64)          NULL,
  sha256                 CHAR(64)          NULL,
  embedding_id           BIGINT UNSIGNED   NULL,
  is_stock_image         BOOLEAN           NOT NULL DEFAULT FALSE,
  reverse_search_hits    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  first_seen_listing_id  BIGINT UNSIGNED   NULL,
  created_at             TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_media_hashes_media (media_id),
  KEY idx_media_hashes_phash (phash),
  KEY idx_media_hashes_sha256 (sha256),
  KEY idx_media_hashes_listing (listing_id),
  KEY idx_media_hashes_first_seen (first_seen_listing_id),
  KEY idx_media_hashes_embedding (embedding_id),
  CONSTRAINT fk_media_hashes_media FOREIGN KEY (media_id)
    REFERENCES listing_media (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_media_hashes_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_media_hashes_first_seen FOREIGN KEY (first_seen_listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_media_hashes_embedding FOREIGN KEY (embedding_id)
    REFERENCES ai_embeddings (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §19 Fake Review / Fake Listing Detection, unified. One table because the
-- review workflow (detected → confirmed/dismissed → actioned) is identical
-- regardless of what was faked.
CREATE TABLE IF NOT EXISTS fake_detections (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_kind    ENUM('listing','review','user','business','message') NOT NULL,
  target_id      BIGINT UNSIGNED NOT NULL,
  detection_kind ENUM('fake_listing','fake_review','fake_account','review_ring','price_bait',
                      'stolen_media','impersonation','scam_pattern') NOT NULL,
  confidence     DECIMAL(5,4)    NOT NULL,
  evidence       JSON            NULL,
  model          VARCHAR(96)     NULL,
  status         ENUM('detected','confirmed','dismissed','actioned') NOT NULL DEFAULT 'detected',
  reviewed_by    BIGINT UNSIGNED NULL,
  reviewed_at    TIMESTAMP       NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fake_detections_target (target_kind, target_id, detection_kind),
  -- Reviewer queue: worst first
  KEY idx_fake_detections_queue (status, confidence, created_at),
  KEY idx_fake_detections_kind (detection_kind, created_at),
  KEY idx_fake_detections_reviewer (reviewed_by),
  CONSTRAINT fk_fake_detections_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- The investigation workflow. A case groups many signals/detections under one
-- human-quotable case_number, and records the money at stake plus the outcome
-- for regulator reporting (§19 AML, §25 compliance).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fraud_cases (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid           CHAR(36)        NOT NULL,
  case_number    VARCHAR(24)     NOT NULL,   -- e.g. "FRD-2026-000184"
  subject_kind   ENUM('user','device','listing','payment','session','message','review',
                      'business') NOT NULL,
  subject_id     BIGINT UNSIGNED NOT NULL,
  user_id        BIGINT UNSIGNED NULL,
  category       ENUM('fake_listing','payment_fraud','account_takeover','scam',
                      'money_laundering','identity_fraud','abuse','other') NOT NULL,
  severity       ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  status         ENUM('open','investigating','pending_info','escalated','resolved','closed',
                      'false_positive') NOT NULL DEFAULT 'open',
  assigned_to    BIGINT UNSIGNED NULL,
  risk_score     DECIMAL(5,2)    NULL,
  summary        VARCHAR(500)    NULL,
  findings       TEXT            NULL,
  resolution     ENUM('no_action','warning','listing_removed','account_suspended',
                      'account_banned','refund_issued','reported_to_authority') NULL,
  estimated_loss DECIMAL(18,2)   NULL,
  currency       CHAR(3)         NULL,
  opened_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at    TIMESTAMP       NULL,
  resolved_by    BIGINT UNSIGNED NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_fraud_cases_uuid (uuid),
  UNIQUE KEY uk_fraud_cases_number (case_number),
  -- Investigator worklist
  KEY idx_fraud_cases_queue (status, severity, opened_at),
  KEY idx_fraud_cases_assignee (assigned_to, status),
  KEY idx_fraud_cases_subject (subject_kind, subject_id),
  KEY idx_fraud_cases_user (user_id, status),
  KEY idx_fraud_cases_category (category, opened_at),
  CONSTRAINT fk_fraud_cases_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_fraud_cases_assignee FOREIGN KEY (assigned_to)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_fraud_cases_resolver FOREIGN KEY (resolved_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_fraud_cases_currency FOREIGN KEY (currency)
    REFERENCES currencies (code) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Investigator notes. is_internal hides a note from any customer-facing export.
CREATE TABLE IF NOT EXISTS fraud_case_notes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  case_id     BIGINT UNSIGNED NOT NULL,
  author_id   BIGINT UNSIGNED NULL,
  note        TEXT            NOT NULL,
  is_internal BOOLEAN         NOT NULL DEFAULT TRUE,
  attachments JSON            NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fraud_case_notes_case (case_id, created_at),
  KEY idx_fraud_case_notes_author (author_id),
  CONSTRAINT fk_fraud_case_notes_case FOREIGN KEY (case_id)
    REFERENCES fraud_cases (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_fraud_case_notes_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §22 Moderation queue. claimed_at + assigned_to implement claim-then-work so
-- two moderators never review the same item; sla_due_at drives escalation.
-- (entity_type, entity_id) is a plain index, not UNIQUE: MySQL would let
-- duplicate open items through anyway once status differed, so the "one open
-- item per entity" rule is enforced in the service layer.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS moderation_queue (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid           CHAR(36)         NOT NULL,
  entity_type    ENUM('listing','user','review','message','media','business','ad_creative',
                      'forum_post') NOT NULL,
  entity_id      BIGINT UNSIGNED  NOT NULL,
  marketplace_id TINYINT UNSIGNED NULL,
  reason         ENUM('ai_flagged','user_reported','keyword_match','new_seller','high_value',
                      'duplicate','manual','appeal','random_audit') NOT NULL,
  priority       ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  ai_score       DECIMAL(5,4)     NULL,
  ai_labels      JSON             NULL,
  report_count   INT UNSIGNED     NOT NULL DEFAULT 0,
  status         ENUM('pending','claimed','in_review','approved','rejected','escalated','expired')
                   NOT NULL DEFAULT 'pending',
  assigned_to    BIGINT UNSIGNED  NULL,
  claimed_at     TIMESTAMP        NULL,
  sla_due_at     TIMESTAMP        NULL,
  resolved_at    TIMESTAMP        NULL,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_moderation_queue_uuid (uuid),
  -- Queue polling: next item by priority then age
  KEY idx_moderation_queue_poll (status, priority, created_at),
  KEY idx_moderation_queue_entity (entity_type, entity_id),
  KEY idx_moderation_queue_assignee (assigned_to, status),
  KEY idx_moderation_queue_sla (status, sla_due_at),
  KEY idx_moderation_queue_mp (marketplace_id, status, priority),
  CONSTRAINT fk_moderation_queue_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_moderation_queue_assignee FOREIGN KEY (assigned_to)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Every moderator decision, append-only. previous_state is what makes "restore"
-- and appeal review possible after a destructive action.
CREATE TABLE IF NOT EXISTS moderation_actions (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  queue_id       BIGINT UNSIGNED NULL,   -- NULL when acted on directly, outside the queue
  moderator_id   BIGINT UNSIGNED NULL,
  entity_type    VARCHAR(48)     NOT NULL,
  entity_id      BIGINT UNSIGNED NOT NULL,
  action         ENUM('approve','reject','hide','remove','edit','warn','suspend','ban','unban',
                      'restore','escalate','request_changes','verify','feature_block') NOT NULL,
  reason_code    VARCHAR(64)     NULL,
  notes          VARCHAR(1000)   NULL,
  duration_hours INT UNSIGNED    NULL,   -- for time-boxed suspensions
  notify_user    BOOLEAN         NOT NULL DEFAULT TRUE,
  previous_state JSON            NULL,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_moderation_actions_entity (entity_type, entity_id, created_at),
  KEY idx_moderation_actions_moderator (moderator_id, created_at),
  KEY idx_moderation_actions_queue (queue_id),
  KEY idx_moderation_actions_kind (action, created_at),
  CONSTRAINT fk_moderation_actions_queue FOREIGN KEY (queue_id)
    REFERENCES moderation_queue (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_moderation_actions_moderator FOREIGN KEY (moderator_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §12/§20 Report. User-submitted reports on any entity; many reports collapse
-- into one moderation_queue item via queue_id, which is why report_count lives
-- on the queue row.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_reports (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)        NOT NULL,
  reporter_id     BIGINT UNSIGNED NULL,
  guest_uuid      CHAR(36)        NULL,
  entity_type     ENUM('listing','user','review','message','media','business','ad_creative',
                       'forum_post') NOT NULL,
  entity_id       BIGINT UNSIGNED NOT NULL,
  reason_code     ENUM('spam','fraud','scam','fake','offensive','adult','violence','copyright',
                       'wrong_category','wrong_price','sold_already','duplicate','misleading',
                       'personal_info','harassment','other') NOT NULL,
  description     VARCHAR(1000)   NULL,
  evidence_urls   JSON            NULL,
  status          ENUM('pending','triaged','upheld','dismissed','duplicate')
                    NOT NULL DEFAULT 'pending',
  queue_id        BIGINT UNSIGNED NULL,
  resolution_note VARCHAR(500)    NULL,
  reviewed_by     BIGINT UNSIGNED NULL,
  reviewed_at     TIMESTAMP       NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_content_reports_uuid (uuid),
  KEY idx_content_reports_entity (entity_type, entity_id, status),
  KEY idx_content_reports_triage (status, created_at),
  KEY idx_content_reports_reporter (reporter_id, created_at),
  KEY idx_content_reports_queue (queue_id),
  KEY idx_content_reports_reviewer (reviewed_by),
  CONSTRAINT fk_content_reports_reporter FOREIGN KEY (reporter_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_content_reports_queue FOREIGN KEY (queue_id)
    REFERENCES moderation_queue (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_content_reports_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §22 Banned Words. severity separates "warn the poster" from "block the post";
-- replacement supports masking instead of rejection. NULL language /
-- marketplace_id mean "everywhere" — MySQL treats those NULLs as distinct in the
-- UNIQUE key, so the admin layer checks for an existing row before inserting.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS banned_terms (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  term           VARCHAR(191)     NOT NULL,
  language       VARCHAR(10)      NULL,
  marketplace_id TINYINT UNSIGNED NULL,
  severity       ENUM('warn','flag','block') NOT NULL DEFAULT 'flag',
  match_kind     ENUM('exact','substring','regex','fuzzy') NOT NULL DEFAULT 'substring',
  applies_to     ENUM('title','description','message','review','username','all')
                   NOT NULL DEFAULT 'all',
  replacement    VARCHAR(96)      NULL,
  is_active      BOOLEAN          NOT NULL DEFAULT TRUE,
  created_by     BIGINT UNSIGNED  NULL,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_banned_terms_term (term, language, marketplace_id),
  -- The scan loads the active set for one language/marketplace/field
  KEY idx_banned_terms_scan (is_active, language, marketplace_id, applies_to),
  KEY idx_banned_terms_creator (created_by),
  CONSTRAINT fk_banned_terms_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_banned_terms_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_banned_terms_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Versioned auto-moderation policy: rules as data, so thresholds are tunable
-- and a bad policy version is identifiable after the fact (§22).
CREATE TABLE IF NOT EXISTS moderation_policies (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(96)       NOT NULL,
  name        VARCHAR(160)      NOT NULL,
  entity_type VARCHAR(48)       NOT NULL,
  description TEXT              NULL,
  rules       JSON              NOT NULL,
  auto_action ENUM('none','flag','hold','reject') NOT NULL DEFAULT 'flag',
  threshold   DECIMAL(5,4)      NULL,
  is_active   BOOLEAN           NOT NULL DEFAULT TRUE,
  version     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  created_at  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_moderation_policies_code (code, version),
  KEY idx_moderation_policies_active (entity_type, is_active, version)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- The enforcement record. Separate from moderation_actions because a sanction
-- has duration and an appeal lifecycle: the policy layer reads active sanctions
-- on every post/chat attempt (§22 Suspension, §19 enforcement).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sanctions (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  user_id              BIGINT UNSIGNED NOT NULL,
  kind                 ENUM('warning','listing_limit','posting_ban','chat_ban','suspension',
                            'ban','shadowban') NOT NULL,
  reason_code          VARCHAR(64)     NULL,
  description          VARCHAR(500)    NULL,
  case_id              BIGINT UNSIGNED NULL,
  moderation_action_id BIGINT UNSIGNED NULL,
  starts_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at              TIMESTAMP       NULL,
  is_permanent         BOOLEAN         NOT NULL DEFAULT FALSE,
  appeal_status        ENUM('none','submitted','under_review','granted','denied')
                         NOT NULL DEFAULT 'none',
  appeal_note          VARCHAR(1000)   NULL,
  lifted_at            TIMESTAMP       NULL,
  lifted_by            BIGINT UNSIGNED NULL,
  created_by           BIGINT UNSIGNED NULL,
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_sanctions_uuid (uuid),
  -- The gate check: active sanctions of a given kind for this user
  KEY idx_user_sanctions_active (user_id, kind, lifted_at, ends_at),
  KEY idx_user_sanctions_expiry (ends_at, lifted_at),
  KEY idx_user_sanctions_appeals (appeal_status, created_at),
  KEY idx_user_sanctions_case (case_id),
  KEY idx_user_sanctions_action (moderation_action_id),
  CONSTRAINT fk_user_sanctions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_sanctions_case FOREIGN KEY (case_id)
    REFERENCES fraud_cases (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_user_sanctions_action FOREIGN KEY (moderation_action_id)
    REFERENCES moderation_actions (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_user_sanctions_lifter FOREIGN KEY (lifted_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_user_sanctions_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;
