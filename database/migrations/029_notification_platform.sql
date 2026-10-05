-- =============================================================================
-- 029  Notification Platform
--      Additive on 011_notifications. One shared NotificationService for Gold,
--      Property, Vehicles, chat, calling, payments, auth, fraud and system.
--      Never resets data. Never duplicates user_devices or a second realtime bus.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Category policy + marketplace scope. Existing rows keep working; seed 13
-- backfills policy_group from group_code / is_transactional.
-- -----------------------------------------------------------------------------
ALTER TABLE notification_categories
  ADD COLUMN policy_group ENUM('SECURITY','TRANSACTIONAL','MARKETPLACE','SOCIAL','MARKETING','SYSTEM')
    NOT NULL DEFAULT 'MARKETPLACE' AFTER is_transactional,
  ADD COLUMN marketplace_scope ENUM('GOLD','PROPERTY','VEHICLE','GENERAL')
    NOT NULL DEFAULT 'GENERAL' AFTER policy_group,
  ADD KEY idx_notification_categories_policy (policy_group, marketplace_scope, is_active);

-- -----------------------------------------------------------------------------
-- Templates: silent channel + keep version uniqueness (already on 011).
-- -----------------------------------------------------------------------------
ALTER TABLE notification_templates
  MODIFY COLUMN channel ENUM('push','email','sms','in_app','whatsapp','silent') NOT NULL;

-- -----------------------------------------------------------------------------
-- In-app inbox: marketplace context, deep links, grouping, idempotency.
-- -----------------------------------------------------------------------------
ALTER TABLE notifications
  ADD COLUMN marketplace ENUM('GOLD','PROPERTY','VEHICLE','GENERAL')
    NOT NULL DEFAULT 'GENERAL' AFTER category_code,
  ADD COLUMN event_type VARCHAR(96) NULL AFTER marketplace,
  ADD COLUMN entity_type VARCHAR(48) NULL AFTER event_type,
  ADD COLUMN entity_id VARCHAR(64) NULL AFTER entity_type,
  ADD COLUMN deep_link VARCHAR(191) NULL AFTER action_target,
  ADD COLUMN template_id INT UNSIGNED NULL AFTER deep_link,
  ADD COLUMN template_version SMALLINT UNSIGNED NULL AFTER template_id,
  ADD COLUMN icon VARCHAR(64) NULL AFTER image_url,
  ADD COLUMN idempotency_key VARCHAR(191) NULL AFTER group_key,
  ADD COLUMN item_count INT UNSIGNED NOT NULL DEFAULT 1 AFTER idempotency_key,
  ADD COLUMN scheduled_at TIMESTAMP NULL AFTER expires_at,
  ADD KEY idx_notifications_marketplace (user_id, marketplace, created_at),
  ADD KEY idx_notifications_event (user_id, event_type, created_at),
  ADD KEY idx_notifications_entity (entity_type, entity_id),
  ADD UNIQUE KEY uk_notifications_idempotency (idempotency_key),
  ADD CONSTRAINT fk_notifications_template FOREIGN KEY (template_id)
    REFERENCES notification_templates (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE notifications
  MODIFY COLUMN action_type ENUM(
      'none','listing','chat','offer','subscription','payment',
      'verification','review','ad','support','external',
      'auction','call','search','security','favorite','system'
    ) NOT NULL DEFAULT 'none';

-- -----------------------------------------------------------------------------
-- Delivery tracking: queued/retrying/cancelled/expired + silent channel.
-- -----------------------------------------------------------------------------
ALTER TABLE notification_deliveries
  MODIFY COLUMN channel ENUM('push','email','sms','in_app','whatsapp','silent') NOT NULL;

ALTER TABLE notification_deliveries
  MODIFY COLUMN status ENUM(
      'pending','queued','processing','sent','delivered','failed','bounced','rejected',
      'opened','clicked','retrying','cancelled','expired'
    ) NOT NULL DEFAULT 'pending';

ALTER TABLE notification_deliveries
  ADD COLUMN idempotency_key VARCHAR(191) NULL AFTER provider_message_id,
  ADD UNIQUE KEY uk_notification_deliveries_idempotency (idempotency_key);

ALTER TABLE scheduled_notifications
  MODIFY COLUMN channel ENUM('push','email','sms','in_app','whatsapp','silent') NOT NULL DEFAULT 'push';

ALTER TABLE scheduled_notifications
  ADD COLUMN timezone VARCHAR(64) NULL AFTER timezone_strategy,
  ADD COLUMN expires_at TIMESTAMP NULL AFTER scheduled_for,
  ADD COLUMN priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal' AFTER channel;

-- -----------------------------------------------------------------------------
-- Push: reuse user_devices. Additive enable flag; invalid tokens are deactivated.
-- -----------------------------------------------------------------------------
ALTER TABLE user_devices
  ADD COLUMN push_enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER push_provider,
  ADD KEY idx_devices_push_active (user_id, push_enabled, status);

-- -----------------------------------------------------------------------------
-- Channel job queue (MySQL-backed; Redis is unused in this deployment).
-- Workers claim with FOR UPDATE SKIP LOCKED.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_jobs (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)        NOT NULL,
  notification_id   BIGINT UNSIGNED NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  channel           VARCHAR(16)     NOT NULL,
  priority          ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status            ENUM('queued','processing','sent','failed','retrying','cancelled','expired')
                      NOT NULL DEFAULT 'queued',
  attempts          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts      TINYINT UNSIGNED NOT NULL DEFAULT 5,
  available_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at         TIMESTAMP       NULL,
  last_error        VARCHAR(500)    NULL,
  error_code        VARCHAR(64)     NULL,
  payload           JSON            NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notification_jobs_uuid (uuid),
  KEY idx_notification_jobs_queue (status, available_at, priority),
  KEY idx_notification_jobs_user (user_id, channel, created_at),
  KEY idx_notification_jobs_notification (notification_id),
  CONSTRAINT fk_notification_jobs_notification FOREIGN KEY (notification_id)
    REFERENCES notifications (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_notification_jobs_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS notification_dead_letters (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id            BIGINT UNSIGNED NULL,
  notification_id   BIGINT UNSIGNED NULL,
  user_id           BIGINT UNSIGNED NULL,
  channel           VARCHAR(16)     NOT NULL,
  error_code        VARCHAR(64)     NULL,
  reason            VARCHAR(500)    NOT NULL,
  payload           JSON            NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notification_dlq_created (created_at),
  KEY idx_notification_dlq_channel (channel, created_at),
  CONSTRAINT fk_notification_dlq_job FOREIGN KEY (job_id)
    REFERENCES notification_jobs (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Channel-level idempotency (event + user + category + channel).
CREATE TABLE IF NOT EXISTS notification_idempotency (
  idempotency_key   VARCHAR(191)    NOT NULL,
  notification_id   BIGINT UNSIGNED NULL,
  user_id           BIGINT UNSIGNED NOT NULL,
  channel           VARCHAR(16)     NOT NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (idempotency_key),
  KEY idx_notification_idempotency_user (user_id, created_at),
  CONSTRAINT fk_notification_idempotency_notification FOREIGN KEY (notification_id)
    REFERENCES notifications (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Daily rollups. No private message bodies.
CREATE TABLE IF NOT EXISTS notification_metrics_daily (
  day               DATE            NOT NULL,
  channel           VARCHAR(16)     NOT NULL,
  category_code     VARCHAR(64)     NOT NULL DEFAULT '',
  created_count     INT UNSIGNED    NOT NULL DEFAULT 0,
  queued_count      INT UNSIGNED    NOT NULL DEFAULT 0,
  sent_count        INT UNSIGNED    NOT NULL DEFAULT 0,
  delivered_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  failed_count      INT UNSIGNED    NOT NULL DEFAULT 0,
  retried_count     INT UNSIGNED    NOT NULL DEFAULT 0,
  read_count        INT UNSIGNED    NOT NULL DEFAULT 0,
  latency_ms_sum    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  latency_samples   INT UNSIGNED    NOT NULL DEFAULT 0,
  PRIMARY KEY (day, channel, category_code)
) ENGINE = InnoDB;
