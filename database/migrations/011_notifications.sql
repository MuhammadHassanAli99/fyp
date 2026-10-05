-- =============================================================================
-- 011  Notifications
--      (§14 Notifications — Push / SMS / Email / In-app / Silent / Scheduled,
--       plus preferences, quiet hours, templates and digests)
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Notification catalogue. Every notification the platform can send is a row
-- here, which is what makes the preference screen generated rather than coded.
-- Transactional categories (payment receipt, security alert) ignore
-- unsubscribes — the flag is checked before any preference lookup.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_categories (
  code             VARCHAR(64)  NOT NULL,     -- listing.published | chat.message | payment.paid
  name             VARCHAR(128) NOT NULL,
  description      VARCHAR(255) NULL,
  group_code       VARCHAR(48)  NULL,         -- UI grouping: listings | chat | billing | account
  default_push     BOOLEAN      NOT NULL DEFAULT TRUE,
  default_email    BOOLEAN      NOT NULL DEFAULT FALSE,
  default_sms      BOOLEAN      NOT NULL DEFAULT FALSE,
  default_in_app   BOOLEAN      NOT NULL DEFAULT TRUE,
  is_transactional BOOLEAN      NOT NULL DEFAULT FALSE,
  sort_order       SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  PRIMARY KEY (code),
  KEY idx_notification_categories_group (group_code, sort_order)
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Per-channel, per-language copy. Versioned so a template can be edited
-- without rewriting history, and `variables` declares the placeholders the
-- renderer is allowed to substitute.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_code        VARCHAR(64)  NOT NULL,
  channel              ENUM('push','email','sms','in_app','whatsapp') NOT NULL,
  language             VARCHAR(10)  NOT NULL,
  subject              VARCHAR(255) NULL,      -- email only
  title                VARCHAR(255) NULL,
  body                 TEXT         NOT NULL,
  action_url           VARCHAR(512) NULL,
  action_label         VARCHAR(96)  NULL,
  image_url            VARCHAR(512) NULL,
  variables            JSON         NULL,      -- ["listingTitle","price","buyerName"]
  provider_template_id VARCHAR(128) NULL,      -- pre-approved WhatsApp/SMS template ref
  is_active            BOOLEAN      NOT NULL DEFAULT TRUE,
  version              SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notification_templates (category_code, channel, language, version),
  KEY idx_notification_templates_active (category_code, channel, language, is_active),
  CONSTRAINT fk_notification_templates_category FOREIGN KEY (category_code)
    REFERENCES notification_categories (code) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notification_templates_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- The in-app notification centre. One row per user-visible notification;
-- channel fan-out is recorded separately in notification_deliveries.
-- group_key is the collapse key ("3 new messages" instead of three rows).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          CHAR(36)        NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  category_code VARCHAR(64)     NOT NULL,
  title         VARCHAR(255)    NOT NULL,
  body          TEXT            NULL,
  image_url     VARCHAR(512)    NULL,
  action_type   ENUM('none','listing','chat','offer','subscription','payment',
                     'verification','review','ad','support','external')
                  NOT NULL DEFAULT 'none',
  action_target VARCHAR(191)    NULL,          -- id, uuid or deep link
  data          JSON            NULL,          -- extra payload for the client
  priority      ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  is_silent     BOOLEAN         NOT NULL DEFAULT FALSE,   -- §14 Silent: no sound/banner
  group_key     VARCHAR(96)     NULL,
  read_at       TIMESTAMP       NULL,
  seen_at       TIMESTAMP       NULL,          -- appeared in the list
  clicked_at    TIMESTAMP       NULL,
  dismissed_at  TIMESTAMP       NULL,
  expires_at    TIMESTAMP       NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notifications_uuid (uuid),
  -- Notification centre feed + unread badge
  KEY idx_notifications_inbox (user_id, read_at, created_at),
  KEY idx_notifications_user_category (user_id, category_code),
  KEY idx_notifications_group (user_id, group_key),
  KEY idx_notifications_expiry (expires_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notifications_category FOREIGN KEY (category_code)
    REFERENCES notification_categories (code) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Per-channel delivery attempts: provider ids for support, error codes for
-- retries, and cost so SMS/WhatsApp spend is attributable. High-volume log,
-- so the currency column carries no FK.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  notification_id     BIGINT UNSIGNED NOT NULL,
  channel             ENUM('push','email','sms','in_app','whatsapp') NOT NULL,
  provider            VARCHAR(32)     NULL,
  destination         VARCHAR(191)    NULL,     -- token, email or phone actually used
  device_id           BIGINT UNSIGNED NULL,
  status              ENUM('pending','sent','delivered','failed','bounced','rejected',
                           'opened','clicked') NOT NULL DEFAULT 'pending',
  provider_message_id VARCHAR(191)    NULL,
  error_code          VARCHAR(64)     NULL,
  error_message       VARCHAR(500)    NULL,
  attempts            TINYINT UNSIGNED NOT NULL DEFAULT 0,
  sent_at             TIMESTAMP       NULL,
  delivered_at        TIMESTAMP       NULL,
  opened_at           TIMESTAMP       NULL,
  cost                DECIMAL(12,6)   NULL,
  currency            CHAR(3)         NULL,
  created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notification_deliveries_notification (notification_id, channel),
  -- Retry worker polls by status + age
  KEY idx_notification_deliveries_queue (status, created_at),
  KEY idx_notification_deliveries_provider (provider_message_id),
  CONSTRAINT fk_notification_deliveries_notification FOREIGN KEY (notification_id)
    REFERENCES notifications (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notification_deliveries_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Explicit opt-in/out per category. A missing row means "use the category
-- defaults", so the table only stores deviations from default.
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id       BIGINT UNSIGNED NOT NULL,
  category_code VARCHAR(64)     NOT NULL,
  push          BOOLEAN         NOT NULL DEFAULT TRUE,
  email         BOOLEAN         NOT NULL DEFAULT FALSE,
  sms           BOOLEAN         NOT NULL DEFAULT FALSE,
  in_app        BOOLEAN         NOT NULL DEFAULT TRUE,
  whatsapp      BOOLEAN         NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, category_code),
  CONSTRAINT fk_notification_preferences_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notification_preferences_category FOREIGN KEY (category_code)
    REFERENCES notification_categories (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Do-not-disturb window, evaluated in the user's timezone. allow_urgent lets
-- security and payment alerts through anyway.
CREATE TABLE IF NOT EXISTS notification_quiet_hours (
  user_id      BIGINT UNSIGNED NOT NULL,
  is_enabled   BOOLEAN         NOT NULL DEFAULT FALSE,
  start_time   TIME            NULL,
  end_time     TIME            NULL,           -- may wrap past midnight
  timezone     VARCHAR(64)     NULL,
  allow_urgent BOOLEAN         NOT NULL DEFAULT TRUE,
  days_of_week JSON            NULL,           -- [1,2,3,4,5]; NULL = every day
  PRIMARY KEY (user_id),
  CONSTRAINT fk_notification_quiet_hours_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §14 Scheduled. Covers both "remind this user at 09:00" and admin campaigns
-- to a segment. timezone_strategy decides whether scheduled_for is absolute
-- UTC or fanned out per recipient's local clock.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)        NOT NULL,
  user_id           BIGINT UNSIGNED NULL,      -- set when audience='user'
  audience          ENUM('user','segment','all') NOT NULL DEFAULT 'user',
  segment_query     JSON            NULL,      -- filter describing the segment
  category_code     VARCHAR(64)     NOT NULL,
  template_id       INT UNSIGNED    NULL,
  channel           ENUM('push','email','sms','in_app','whatsapp') NOT NULL DEFAULT 'push',
  payload           JSON            NULL,      -- template variable values
  scheduled_for     TIMESTAMP       NOT NULL,
  timezone_strategy ENUM('utc','user_local') NOT NULL DEFAULT 'utc',
  status            ENUM('scheduled','processing','sent','cancelled','failed')
                      NOT NULL DEFAULT 'scheduled',
  recurrence_cron   VARCHAR(64)     NULL,      -- NULL = one shot
  sent_count        INT UNSIGNED    NOT NULL DEFAULT 0,
  failed_count      INT UNSIGNED    NOT NULL DEFAULT 0,
  created_by        BIGINT UNSIGNED NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at      TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_scheduled_notifications_uuid (uuid),
  -- Dispatcher polls due rows
  KEY idx_scheduled_notifications_due (status, scheduled_for),
  KEY idx_scheduled_notifications_user (user_id, status),
  CONSTRAINT fk_scheduled_notifications_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_scheduled_notifications_category FOREIGN KEY (category_code)
    REFERENCES notification_categories (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_scheduled_notifications_template FOREIGN KEY (template_id)
    REFERENCES notification_templates (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_scheduled_notifications_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Batching. Instead of 40 saved-search pushes, one digest row accumulates the
-- items and is flushed on its own schedule.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_digests (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       BIGINT UNSIGNED NOT NULL,
  category_code VARCHAR(64)     NOT NULL,
  frequency     ENUM('daily','weekly') NOT NULL DEFAULT 'daily',
  payload       JSON            NOT NULL,      -- accumulated items
  item_count    INT UNSIGNED    NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMP       NOT NULL,
  sent_at       TIMESTAMP       NULL,
  PRIMARY KEY (id),
  -- Open digest to append to, then the flush sweep
  KEY idx_notification_digests_open (user_id, category_code, sent_at),
  KEY idx_notification_digests_due (sent_at, scheduled_for),
  CONSTRAINT fk_notification_digests_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_notification_digests_category FOREIGN KEY (category_code)
    REFERENCES notification_categories (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Web Push endpoints (browser targets). Mobile push tokens live on
-- user_devices; the Web Push protocol needs the extra key material.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  device_id    BIGINT UNSIGNED NULL,
  endpoint     VARCHAR(512)    NOT NULL,
  p256dh       VARCHAR(255)    NULL,
  auth_key     VARCHAR(255)    NULL,
  provider     VARCHAR(32)     NOT NULL DEFAULT 'webpush',
  is_active    BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_push_subscriptions_endpoint (endpoint(191)),
  KEY idx_push_subscriptions_user (user_id, is_active),
  CONSTRAINT fk_push_subscriptions_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_push_subscriptions_device FOREIGN KEY (device_id)
    REFERENCES user_devices (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- In-app banners / modals (release notes, maintenance, plan promos). Targeting
-- is JSON id lists so a campaign can be aimed at a country, platform,
-- subscription plan or marketplace without extra tables.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS in_app_announcements (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid               CHAR(36)        NOT NULL,
  title              VARCHAR(191)    NOT NULL,
  body               TEXT            NULL,
  kind               ENUM('banner','modal','tooltip','card') NOT NULL DEFAULT 'banner',
  placement          VARCHAR(64)     NULL,      -- home_top | listing_detail | inbox
  target_countries   JSON            NULL,
  target_platforms   JSON            NULL,
  target_plans       JSON            NULL,
  target_marketplaces JSON           NULL,
  action_url         VARCHAR(512)    NULL,
  action_label       VARCHAR(96)     NULL,
  image_url          VARCHAR(512)    NULL,
  starts_at          TIMESTAMP       NULL,
  ends_at            TIMESTAMP       NULL,
  is_dismissible     BOOLEAN         NOT NULL DEFAULT TRUE,
  priority           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active          BOOLEAN         NOT NULL DEFAULT TRUE,
  view_count         INT UNSIGNED    NOT NULL DEFAULT 0,
  click_count        INT UNSIGNED    NOT NULL DEFAULT 0,
  created_by         BIGINT UNSIGNED NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_in_app_announcements_uuid (uuid),
  -- What the client asks for on every cold start
  KEY idx_in_app_announcements_live (is_active, starts_at, ends_at, priority),
  KEY idx_in_app_announcements_placement (placement, is_active),
  CONSTRAINT fk_in_app_announcements_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;
