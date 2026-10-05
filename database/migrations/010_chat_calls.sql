-- =============================================================================
-- 010  Chat & calling
--      (§12 Chat System — text/images/video/voice/documents/location,
--       read & typing & online status, edit/delete/block/report, AI translation;
--       §13 Calling — voice, video, call history, masked calling)
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Conversations. `listing` threads are the common case (buyer ↔ seller about
-- one listing); direct/support/group/system reuse the same engine.
-- last_message_* are denormalised so the inbox is one indexed read.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversations (
  id                   BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)         NOT NULL,
  marketplace_id       TINYINT UNSIGNED NULL,
  listing_id           BIGINT UNSIGNED  NULL,
  kind                 ENUM('direct','listing','support','group','system')
                         NOT NULL DEFAULT 'listing',
  subject              VARCHAR(191)     NULL,
  created_by           BIGINT UNSIGNED  NULL,
  status               ENUM('active','archived','closed','blocked') NOT NULL DEFAULT 'active',
  -- Denormalised pointer, no FK on purpose: conversations ↔ messages would be a
  -- cyclic constraint on the hottest write path. Maintained by the chat service.
  last_message_id      BIGINT UNSIGNED  NULL,
  last_message_at      TIMESTAMP        NULL,
  last_message_preview VARCHAR(255)     NULL,
  message_count        INT UNSIGNED     NOT NULL DEFAULT 0,
  created_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_conversations_uuid (uuid),
  -- Inbox ordering (joined from conversation_participants)
  KEY idx_conversations_recent (status, last_message_at),
  KEY idx_conversations_listing (listing_id, kind),
  KEY idx_conversations_marketplace (marketplace_id, last_message_at),
  CONSTRAINT fk_conversations_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  -- A removed listing must not erase the negotiation history
  CONSTRAINT fk_conversations_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_conversations_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Messages. client_message_id is the client outbox key (§26 Offline Support):
-- a retried send is idempotent because it collides on the unique index.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messages (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)        NOT NULL,
  conversation_id      BIGINT UNSIGNED NOT NULL,
  sender_id            BIGINT UNSIGNED NULL,         -- NULL = system message
  kind                 ENUM('text','image','video','voice','document','location',
                            'contact','offer','listing','system','call_log')
                         NOT NULL DEFAULT 'text',
  body                 TEXT            NULL,
  reply_to_id          BIGINT UNSIGNED NULL,
  forwarded_from_id    BIGINT UNSIGNED NULL,
  offer_id             BIGINT UNSIGNED NULL,         -- kind='offer' → listing_offers
  listing_id           BIGINT UNSIGNED NULL,         -- kind='listing' share card
  -- §12 Location sharing
  latitude             DECIMAL(10,7)   NULL,
  longitude            DECIMAL(10,7)   NULL,
  location_label       VARCHAR(191)    NULL,
  is_edited            BOOLEAN         NOT NULL DEFAULT FALSE,
  edited_at            TIMESTAMP       NULL,
  deleted_at           TIMESTAMP       NULL,
  deleted_for_everyone BOOLEAN         NOT NULL DEFAULT FALSE,
  delivered_at         TIMESTAMP       NULL,
  read_at              TIMESTAMP       NULL,
  client_message_id    CHAR(36)        NULL,
  status               ENUM('queued','sent','delivered','read','failed') NOT NULL DEFAULT 'sent',
  created_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_messages_uuid (uuid),
  UNIQUE KEY uk_messages_client_id (client_message_id),
  KEY idx_messages_conversation (conversation_id, created_at),
  KEY idx_messages_sender (sender_id, created_at),
  KEY idx_messages_undelivered (conversation_id, status, created_at),
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Keep the thread readable after an account is deleted
  CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_messages_reply_to FOREIGN KEY (reply_to_id)
    REFERENCES messages (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_messages_forwarded_from FOREIGN KEY (forwarded_from_id)
    REFERENCES messages (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_messages_offer FOREIGN KEY (offer_id)
    REFERENCES listing_offers (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_messages_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Participants. Per-user thread state: unread badge, mute, pin, archive,
-- typing (§12 Typing Status) and the read cursor.
-- `participant_role` avoids a bare `role` column, matching business_members.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id      BIGINT UNSIGNED NOT NULL,
  user_id              BIGINT UNSIGNED NOT NULL,
  participant_role     ENUM('member','owner','agent','moderator') NOT NULL DEFAULT 'member',
  joined_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at              TIMESTAMP       NULL,
  last_read_message_id BIGINT UNSIGNED NULL,
  unread_count         INT UNSIGNED    NOT NULL DEFAULT 0,
  is_muted             BOOLEAN         NOT NULL DEFAULT FALSE,
  muted_until          TIMESTAMP       NULL,
  is_pinned            BOOLEAN         NOT NULL DEFAULT FALSE,
  is_archived          BOOLEAN         NOT NULL DEFAULT FALSE,
  is_typing            BOOLEAN         NOT NULL DEFAULT FALSE,
  typing_at            TIMESTAMP       NULL,
  notification_level   ENUM('all','mentions','none') NOT NULL DEFAULT 'all',
  PRIMARY KEY (conversation_id, user_id),
  -- The inbox query: my threads, pinned first, unarchived
  KEY idx_conversation_participants_inbox (user_id, is_archived, is_pinned),
  KEY idx_conversation_participants_unread (user_id, unread_count),
  CONSTRAINT fk_conversation_participants_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_conversation_participants_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_conversation_participants_read_cursor FOREIGN KEY (last_read_message_id)
    REFERENCES messages (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Attachments (§12 Images / Video / Voice / Documents). waveform holds the
-- rendered amplitude array for voice notes so the client draws it offline.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_attachments (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id    BIGINT UNSIGNED NOT NULL,
  kind          ENUM('image','video','audio','document','other') NOT NULL DEFAULT 'image',
  url           VARCHAR(512)    NOT NULL,
  thumb_url     VARCHAR(512)    NULL,
  file_name     VARCHAR(255)    NULL,
  mime_type     VARCHAR(96)     NULL,
  size_bytes    INT UNSIGNED    NULL,
  width         SMALLINT UNSIGNED NULL,
  height        SMALLINT UNSIGNED NULL,
  duration_ms   INT UNSIGNED    NULL,
  waveform      JSON            NULL,
  upload_status ENUM('uploading','processing','ready','failed') NOT NULL DEFAULT 'ready',
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_message_attachments_message (message_id, kind),
  CONSTRAINT fk_message_attachments_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §12 AI Translation. One cached row per (message, reader language) so a
-- thread is translated once, not once per open. Language codes come from the
-- provider and are intentionally not FK'd to `languages`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS message_translations (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id      BIGINT UNSIGNED NOT NULL,
  target_language VARCHAR(10)     NOT NULL,
  translated_body TEXT            NOT NULL,
  source_language VARCHAR(10)     NULL,
  provider        VARCHAR(32)     NULL,
  confidence      DECIMAL(5,4)    NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_message_translations (message_id, target_language),
  CONSTRAINT fk_message_translations_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Emoji reactions. PK includes the emoji so one user can add several, and
-- removing a reaction is a delete by exact key.
CREATE TABLE IF NOT EXISTS message_reactions (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  emoji      VARCHAR(16)     NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id, emoji),
  KEY idx_message_reactions_user (user_id),
  CONSTRAINT fk_message_reactions_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_message_reactions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §12 Read Status. Per-reader receipts; group threads need one row per member.
CREATE TABLE IF NOT EXISTS message_read_receipts (
  message_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  read_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id),
  KEY idx_message_read_receipts_user (user_id, read_at),
  CONSTRAINT fk_message_read_receipts_message FOREIGN KEY (message_id)
    REFERENCES messages (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_message_read_receipts_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §12 Block. Checked before message send, call connect and contact reveal.
CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id BIGINT UNSIGNED NOT NULL,
  blocked_id BIGINT UNSIGNED NOT NULL,
  reason     VARCHAR(255)    NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  KEY idx_blocked_users_blocked (blocked_id),
  CONSTRAINT fk_blocked_users_blocker FOREIGN KEY (blocker_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_blocked_users_blocked FOREIGN KEY (blocked_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
  -- Self-block is rejected in the service layer: MySQL forbids a CHECK on a
  -- column that also carries a cascading foreign key.
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §12 Online Status. is_visible is the privacy toggle: when false the API
-- reports 'offline' regardless of the real status.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_presence (
  user_id      BIGINT UNSIGNED NOT NULL,
  status       ENUM('online','away','busy','offline') NOT NULL DEFAULT 'offline',
  last_seen_at TIMESTAMP       NULL,
  is_visible   BOOLEAN         NOT NULL DEFAULT TRUE,
  device_id    BIGINT UNSIGNED NULL,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_user_presence_status (status, last_seen_at),
  CONSTRAINT fk_user_presence_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_presence_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Canned seller replies. user_id NULL = platform default offered to everyone
-- (per marketplace + language), so a new market ships with usable defaults.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quick_replies (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id        BIGINT UNSIGNED  NULL,
  marketplace_id TINYINT UNSIGNED NULL,
  text           VARCHAR(500)     NOT NULL,
  language       VARCHAR(10)      NOT NULL,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  usage_count    INT UNSIGNED     NOT NULL DEFAULT 0,
  is_active      BOOLEAN          NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  KEY idx_quick_replies_owner (user_id, is_active, sort_order),
  KEY idx_quick_replies_defaults (marketplace_id, language, is_active),
  CONSTRAINT fk_quick_replies_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_quick_replies_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_quick_replies_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §13 Masked Calling. The proxy number is what the other party dials; the real
-- number never leaves this table. active_proxy_number is generated so the
-- unique index only constrains live mappings — revoked rows drop out of it and
-- the proxy number can be recycled.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS masked_numbers (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid                CHAR(36)        NOT NULL,
  user_id             BIGINT UNSIGNED NOT NULL,
  listing_id          BIGINT UNSIGNED NULL,
  proxy_number        VARCHAR(24)     NOT NULL,
  real_number         VARCHAR(24)     NOT NULL,
  provider            VARCHAR(32)     NULL,
  provider_ref        VARCHAR(128)    NULL,
  purpose             ENUM('listing_contact','support','viewing','delivery','other')
                        NOT NULL DEFAULT 'listing_contact',
  expires_at          TIMESTAMP       NULL,
  revoked_at          TIMESTAMP       NULL,
  call_count          INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  active_proxy_number VARCHAR(24)     GENERATED ALWAYS AS
                        (IF(revoked_at IS NULL, proxy_number, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uk_masked_numbers_uuid (uuid),
  UNIQUE KEY uk_masked_numbers_active (active_proxy_number),
  KEY idx_masked_numbers_user (user_id, revoked_at),
  KEY idx_masked_numbers_listing (listing_id),
  KEY idx_masked_numbers_expiry (expires_at),
  CONSTRAINT fk_masked_numbers_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_masked_numbers_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §13 Voice / Video / Call History. One row per call attempt — missed and
-- declined calls are history too, which is what the call log screen reads.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calls (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)        NOT NULL,
  conversation_id   BIGINT UNSIGNED NULL,
  caller_id         BIGINT UNSIGNED NOT NULL,
  callee_id         BIGINT UNSIGNED NOT NULL,
  kind              ENUM('voice','video') NOT NULL DEFAULT 'voice',
  direction         ENUM('outgoing','incoming') NOT NULL DEFAULT 'outgoing',
  status            ENUM('ringing','answered','missed','declined','busy','failed',
                         'ended','cancelled') NOT NULL DEFAULT 'ringing',
  is_masked         BOOLEAN         NOT NULL DEFAULT FALSE,
  masked_number_id  BIGINT UNSIGNED NULL,
  provider          VARCHAR(32)     NULL,
  provider_call_id  VARCHAR(128)    NULL,
  started_at        TIMESTAMP       NULL,
  answered_at       TIMESTAMP       NULL,
  ended_at          TIMESTAMP       NULL,
  duration_secs     INT UNSIGNED    NOT NULL DEFAULT 0,
  end_reason        VARCHAR(64)     NULL,
  quality_score     DECIMAL(5,2)    NULL,
  recording_url     VARCHAR(512)    NULL,
  recording_consent BOOLEAN         NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_calls_uuid (uuid),
  KEY idx_calls_caller (caller_id, created_at),
  KEY idx_calls_callee (callee_id, created_at),
  KEY idx_calls_conversation (conversation_id, created_at),
  KEY idx_calls_provider (provider_call_id),
  KEY idx_calls_missed (callee_id, status, created_at),
  CONSTRAINT fk_calls_conversation FOREIGN KEY (conversation_id)
    REFERENCES conversations (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_calls_caller FOREIGN KEY (caller_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_calls_callee FOREIGN KEY (callee_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_calls_masked_number FOREIGN KEY (masked_number_id)
    REFERENCES masked_numbers (id) ON DELETE SET NULL ON UPDATE CASCADE
  -- Self-call is rejected in the service layer: MySQL forbids a CHECK on a
  -- column that also carries a cascading foreign key.
) ENGINE = InnoDB;

-- Group / multi-party video calls: one row per leg, so a participant who drops
-- and rejoins is two legs rather than a lost interval.
CREATE TABLE IF NOT EXISTS call_participants (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_id         BIGINT UNSIGNED NOT NULL,
  user_id         BIGINT UNSIGNED NOT NULL,
  joined_at       TIMESTAMP       NULL,
  left_at         TIMESTAMP       NULL,
  duration_secs   INT UNSIGNED    NOT NULL DEFAULT 0,
  device_id       BIGINT UNSIGNED NULL,
  network_quality ENUM('excellent','good','fair','poor','unknown') NOT NULL DEFAULT 'unknown',
  PRIMARY KEY (id),
  KEY idx_call_participants_call (call_id, user_id),
  KEY idx_call_participants_user (user_id, joined_at),
  CONSTRAINT fk_call_participants_call FOREIGN KEY (call_id)
    REFERENCES calls (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_call_participants_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_call_participants_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;
