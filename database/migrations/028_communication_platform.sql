-- =============================================================================
-- 028  Communication Platform (chat + calling)
--      Additive only. Extends 010_chat_calls without dropping tables or data.
--      One shared conversation/call engine, marketplace-aware context.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Conversations: marketplace-aware type, optional business, JSON metadata.
-- -----------------------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN conversation_type ENUM(
      'buyer_seller','buyer_dealer','buyer_agent','rental','auction','support','system'
    ) NOT NULL DEFAULT 'buyer_seller' AFTER kind,
  ADD COLUMN business_id BIGINT UNSIGNED NULL AFTER listing_id,
  ADD COLUMN metadata JSON NULL AFTER last_message_preview;

ALTER TABLE conversations
  ADD KEY idx_conversations_type (conversation_type, status, last_message_at),
  ADD KEY idx_conversations_business (business_id);

ALTER TABLE conversations
  ADD CONSTRAINT fk_conversations_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Messages: revision/audit, location accuracy, typed deletion, metadata.
-- `audio` is a first-class kind (distinct from voice notes).
-- -----------------------------------------------------------------------------
ALTER TABLE messages
  MODIFY COLUMN kind ENUM(
      'text','image','video','voice','audio','document','location',
      'contact','offer','listing','system','call_log'
    ) NOT NULL DEFAULT 'text';

ALTER TABLE messages
  ADD COLUMN metadata JSON NULL AFTER location_label,
  ADD COLUMN location_accuracy DECIMAL(8,2) NULL AFTER longitude,
  ADD COLUMN location_at TIMESTAMP NULL AFTER location_label,
  ADD COLUMN deleted_by BIGINT UNSIGNED NULL AFTER deleted_at,
  ADD COLUMN deletion_type ENUM('none','for_me','for_everyone') NOT NULL DEFAULT 'none' AFTER deleted_for_everyone,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE messages
  ADD CONSTRAINT fk_messages_deleted_by FOREIGN KEY (deleted_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Delete-for-me: hide a row from one participant without rewriting history.
CREATE TABLE IF NOT EXISTS message_hides (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  hidden_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id),
  KEY idx_message_hides_user (user_id, hidden_at),
  CONSTRAINT fk_message_hides_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_message_hides_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Edit history. Original body is preserved so moderation can audit silently-edited spam.
CREATE TABLE IF NOT EXISTS message_revisions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id  BIGINT UNSIGNED NOT NULL,
  body        TEXT            NULL,
  edited_by   BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_message_revisions_message (message_id, created_at),
  CONSTRAINT fk_message_revisions_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_message_revisions_editor FOREIGN KEY (edited_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Attachments: object-storage key, malware scan, codec, private thumbnail key.
-- url/thumb_url remain for legacy rows; new writes prefer storage_key.
-- -----------------------------------------------------------------------------
ALTER TABLE message_attachments
  ADD COLUMN storage_key VARCHAR(512) NULL AFTER url,
  ADD COLUMN thumbnail_key VARCHAR(512) NULL AFTER thumb_url,
  ADD COLUMN scan_status ENUM('pending','clean','suspicious','blocked','skipped')
    NOT NULL DEFAULT 'pending' AFTER upload_status,
  ADD COLUMN codec VARCHAR(32) NULL AFTER duration_ms;

ALTER TABLE message_attachments
  ADD KEY idx_message_attachments_storage (storage_key(191));

-- -----------------------------------------------------------------------------
-- Read cursor: last_read_at for multi-device sync without touching every message.
-- -----------------------------------------------------------------------------
ALTER TABLE conversation_participants
  ADD COLUMN last_read_at TIMESTAMP NULL AFTER last_read_message_id;

-- Per-device inbox/read cursor so Android + web stay reconciled.
CREATE TABLE IF NOT EXISTS conversation_device_cursors (
  user_id              BIGINT UNSIGNED NOT NULL,
  device_id            BIGINT UNSIGNED NOT NULL,
  conversation_id      BIGINT UNSIGNED NULL,
  last_read_message_id BIGINT UNSIGNED NULL,
  last_sync_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, device_id),
  KEY idx_conv_device_cursors_conv (conversation_id, last_sync_at),
  CONSTRAINT fk_conv_device_cursors_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_conv_device_cursors_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_conv_device_cursors_conv FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Calls: listing/marketplace context, signalling state, ring timeout.
-- Keep legacy statuses (answered, declined) so existing rows remain valid.
-- -----------------------------------------------------------------------------
ALTER TABLE calls
  MODIFY COLUMN status ENUM(
      'idle','ringing','accepted','answered','rejected','declined','busy',
      'cancelled','connecting','connected','failed','ended','missed','timeout'
    ) NOT NULL DEFAULT 'ringing';

ALTER TABLE calls
  ADD COLUMN listing_id BIGINT UNSIGNED NULL AFTER conversation_id,
  ADD COLUMN marketplace_id TINYINT UNSIGNED NULL AFTER listing_id,
  ADD COLUMN signaling_state ENUM('none','offer','answer','ice','connected')
    NOT NULL DEFAULT 'none' AFTER status,
  ADD COLUMN timeout_at TIMESTAMP NULL AFTER started_at,
  ADD COLUMN ice_restart_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER quality_score;

ALTER TABLE calls
  ADD KEY idx_calls_listing (listing_id, created_at),
  ADD KEY idx_calls_active (status, started_at),
  ADD CONSTRAINT fk_calls_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_calls_marketplace FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Masked calling sessions. Real numbers never leave masked_numbers / this table
-- via the API. Flutter only sees session uuid + expiry + status.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS masked_call_sessions (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid               CHAR(36)        NOT NULL,
  listing_id         BIGINT UNSIGNED NULL,
  conversation_id    BIGINT UNSIGNED NULL,
  caller_id          BIGINT UNSIGNED NOT NULL,
  callee_id          BIGINT UNSIGNED NOT NULL,
  masked_number_id   BIGINT UNSIGNED NULL,
  provider           VARCHAR(32)     NOT NULL DEFAULT 'log',
  provider_session_id VARCHAR(128)   NULL,
  status             ENUM('allocated','ringing','bridged','ended','expired','revoked','failed')
                       NOT NULL DEFAULT 'allocated',
  expires_at         TIMESTAMP       NULL,
  started_at         TIMESTAMP       NULL,
  ended_at           TIMESTAMP       NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_masked_call_sessions_uuid (uuid),
  KEY idx_masked_call_sessions_caller (caller_id, created_at),
  KEY idx_masked_call_sessions_listing (listing_id, status),
  KEY idx_masked_call_sessions_expiry (expires_at, status),
  CONSTRAINT fk_masked_call_sessions_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_masked_call_sessions_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_masked_call_sessions_caller FOREIGN KEY (caller_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_masked_call_sessions_callee FOREIGN KEY (callee_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_masked_call_sessions_number FOREIGN KEY (masked_number_id)
    REFERENCES masked_numbers (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Communication audit. Never store message bodies, tokens, or phone numbers.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communication_audit_logs (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_id    BIGINT UNSIGNED NULL,
  action      VARCHAR(64)     NOT NULL,
  entity_type VARCHAR(48)     NOT NULL,
  entity_id   BIGINT UNSIGNED NULL,
  metadata    JSON            NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_comm_audit_actor (actor_id, created_at),
  KEY idx_comm_audit_entity (entity_type, entity_id, created_at),
  KEY idx_comm_audit_action (action, created_at),
  CONSTRAINT fk_comm_audit_actor FOREIGN KEY (actor_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Reports may target a conversation as a whole (moderation still reviews messages).
-- -----------------------------------------------------------------------------
ALTER TABLE content_reports
  MODIFY COLUMN entity_type ENUM(
      'listing','user','review','message','media','business','ad_creative',
      'forum_post','conversation'
    ) NOT NULL;

ALTER TABLE moderation_queue
  MODIFY COLUMN entity_type ENUM(
      'listing','user','review','message','media','business','ad_creative',
      'forum_post','conversation'
    ) NOT NULL;

-- -----------------------------------------------------------------------------
-- Notification catalogue for chat / calls. Missing row = category defaults.
-- Push copy is deliberately generic — never put message bodies in the seed.
-- -----------------------------------------------------------------------------
INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, sort_order, is_active)
VALUES
  ('chat.message',  'Chat message',  'A new message in a conversation', 'chat', TRUE, FALSE, FALSE, TRUE, FALSE, 40, TRUE),
  ('chat.call',     'Incoming call', 'Someone is calling you',          'chat', TRUE, FALSE, FALSE, TRUE, FALSE, 41, TRUE),
  ('chat.missed',   'Missed call',   'You missed a voice or video call','chat', TRUE, FALSE, FALSE, TRUE, FALSE, 42, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  is_active = VALUES(is_active);

INSERT INTO notification_templates
  (category_code, channel, language, title, body, action_url, variables, is_active, version)
VALUES
  ('chat.message', 'in_app', 'en', 'New message', 'You have a new message.', '/chat/{{conversationUuid}}', '["conversationUuid"]', TRUE, 1),
  ('chat.message', 'push',   'en', 'New message', 'You have a new message.', '/chat/{{conversationUuid}}', '["conversationUuid"]', TRUE, 1),
  ('chat.call',    'in_app', 'en', 'Incoming call', 'Someone is calling you.', '/calls/{{callUuid}}', '["callUuid"]', TRUE, 1),
  ('chat.call',    'push',   'en', 'Incoming call', 'Someone is calling you.', '/calls/{{callUuid}}', '["callUuid"]', TRUE, 1),
  ('chat.missed',  'in_app', 'en', 'Missed call', 'You missed a call.', '/calls/history', '["callUuid"]', TRUE, 1),
  ('chat.missed',  'push',   'en', 'Missed call', 'You missed a call.', '/calls/history', '["callUuid"]', TRUE, 1)
ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), is_active = VALUES(is_active);
