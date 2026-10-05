-- =============================================================================
-- 018  Customer support & CMS: ticketing, agents, canned responses, knowledge
--      base, FAQs, community forum, CMS pages/banners/blocks, contact form
--      (§29 Customer Support, §22 CMS / Content Management)
--
-- The support_tickets ↔ chatbot_sessions handoff is a genuine cycle
-- (a bot session escalates to a ticket; a ticket links back to its transcript),
-- so neither side declares a FK — see the notes on those columns.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Ticket taxonomy. SLA targets live on the category so routing and escalation
-- are configuration, not code (§29 SLA Management).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_categories (
  id                        SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code                      VARCHAR(64)       NOT NULL,
  name                      VARCHAR(128)      NOT NULL,
  description               VARCHAR(500)      NULL,
  parent_id                 SMALLINT UNSIGNED NULL,
  marketplace_id            TINYINT UNSIGNED  NULL,
  default_priority          ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  sla_first_response_minutes INT UNSIGNED     NULL,
  sla_resolution_minutes    INT UNSIGNED      NULL,
  auto_assign_team          VARCHAR(64)       NULL,
  icon                      VARCHAR(64)       NULL,
  sort_order                SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active                 BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_support_categories_code (code),
  KEY idx_support_categories_tree (parent_id, sort_order),
  KEY idx_support_categories_active (marketplace_id, is_active, sort_order),
  CONSTRAINT fk_support_categories_parent FOREIGN KEY (parent_id)
    REFERENCES support_categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_support_categories_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §29 Ticket System. guest_email/guest_name exist because support must work
-- before login (a locked-out user cannot open an authenticated ticket).
-- related_entity_* links a ticket to the listing/order it is about, kept
-- polymorphic so no FK.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_tickets (
  id                   BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid                 CHAR(36)          NOT NULL,
  ticket_number        VARCHAR(24)       NOT NULL,   -- e.g. "SUP-2026-014922"
  user_id              BIGINT UNSIGNED   NULL,
  guest_email          VARCHAR(191)      NULL,
  guest_name           VARCHAR(128)      NULL,
  category_id          SMALLINT UNSIGNED NULL,
  marketplace_id       TINYINT UNSIGNED  NULL,
  subject              VARCHAR(255)      NOT NULL,
  description          TEXT              NULL,
  channel              ENUM('in_app','email','phone','whatsapp','live_chat','chatbot','social',
                            'web_form') NOT NULL DEFAULT 'in_app',
  priority             ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status               ENUM('new','open','pending_customer','pending_internal','on_hold',
                            'resolved','closed','reopened') NOT NULL DEFAULT 'new',
  assigned_to          BIGINT UNSIGNED   NULL,
  assigned_team        VARCHAR(64)       NULL,
  related_entity_type  VARCHAR(48)       NULL,
  related_entity_id    BIGINT UNSIGNED   NULL,
  -- forward reference: no FK, resolved in application layer (cycle with chatbot_sessions, 015)
  chatbot_session_id   BIGINT UNSIGNED   NULL,
  language             VARCHAR(10)       NULL,
  country_id           SMALLINT UNSIGNED NULL,
  first_response_at    TIMESTAMP         NULL,
  resolved_at          TIMESTAMP         NULL,
  closed_at            TIMESTAMP         NULL,
  reopen_count         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  sla_breached         BOOLEAN           NOT NULL DEFAULT FALSE,
  satisfaction_rating  TINYINT UNSIGNED  NULL,   -- 1..5, collected on close
  satisfaction_comment VARCHAR(500)      NULL,
  tags                 JSON              NULL,
  created_at           TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_support_tickets_uuid (uuid),
  UNIQUE KEY uk_support_tickets_number (ticket_number),
  -- Agent queue polling
  KEY idx_support_tickets_queue (status, priority, created_at),
  KEY idx_support_tickets_assignee (assigned_to, status),
  KEY idx_support_tickets_user (user_id, created_at),
  KEY idx_support_tickets_guest (guest_email),
  KEY idx_support_tickets_category (category_id, status),
  KEY idx_support_tickets_entity (related_entity_type, related_entity_id),
  KEY idx_support_tickets_sla (sla_breached, status, created_at),
  KEY idx_support_tickets_chatbot (chatbot_session_id),
  CONSTRAINT fk_support_tickets_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_support_tickets_category FOREIGN KEY (category_id)
    REFERENCES support_categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_support_tickets_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_support_tickets_assignee FOREIGN KEY (assigned_to)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_support_tickets_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Thread. is_internal_note keeps agent-only context in the same thread without
-- ever exposing it to the customer; translated_body supports cross-language
-- support (§12 Auto Translation).
CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id        BIGINT UNSIGNED NOT NULL,
  author_id        BIGINT UNSIGNED NULL,
  author_kind      ENUM('customer','agent','system','ai') NOT NULL DEFAULT 'customer',
  body             MEDIUMTEXT      NOT NULL,
  is_internal_note BOOLEAN         NOT NULL DEFAULT FALSE,
  channel          ENUM('in_app','email','phone','whatsapp','live_chat','chatbot','social',
                        'web_form') NULL,
  language         VARCHAR(10)     NULL,
  translated_body  TEXT            NULL,
  created_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_ticket_messages_ticket (ticket_id, created_at),
  KEY idx_support_ticket_messages_author (author_id, created_at),
  CONSTRAINT fk_support_ticket_messages_ticket FOREIGN KEY (ticket_id)
    REFERENCES support_tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_support_ticket_messages_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- ticket_id is denormalised alongside message_id so attachments can be listed
-- for a whole ticket without joining the message thread.
CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  message_id  BIGINT UNSIGNED NULL,
  ticket_id   BIGINT UNSIGNED NOT NULL,
  file_url    VARCHAR(512)    NOT NULL,
  file_name   VARCHAR(191)    NULL,
  mime_type   VARCHAR(96)     NULL,
  size_bytes  INT UNSIGNED    NULL,
  uploaded_by BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_ticket_attachments_ticket (ticket_id, created_at),
  KEY idx_support_ticket_attachments_message (message_id),
  KEY idx_support_ticket_attachments_uploader (uploaded_by),
  CONSTRAINT fk_support_ticket_attachments_message FOREIGN KEY (message_id)
    REFERENCES support_ticket_messages (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_support_ticket_attachments_ticket FOREIGN KEY (ticket_id)
    REFERENCES support_tickets (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_support_ticket_attachments_uploader FOREIGN KEY (uploaded_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Agent roster. teams/languages/marketplaces are JSON because routing is
-- multi-valued; current_ticket_count vs max_concurrent_tickets is what the
-- round-robin assigner reads.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS support_agents (
  user_id                 BIGINT UNSIGNED   NOT NULL,
  display_name            VARCHAR(128)      NULL,
  teams                   JSON              NULL,
  languages               JSON              NULL,
  marketplaces            JSON              NULL,
  max_concurrent_tickets  SMALLINT UNSIGNED NOT NULL DEFAULT 20,
  current_ticket_count    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  status                  ENUM('available','busy','away','offline') NOT NULL DEFAULT 'offline',
  avg_resolution_minutes  INT UNSIGNED      NULL,
  satisfaction_avg        DECIMAL(3,2)      NULL,
  is_active               BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  -- Assigner: who is available and has spare capacity
  KEY idx_support_agents_availability (is_active, status, current_ticket_count),
  CONSTRAINT fk_support_agents_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Macros. usage_count surfaces which replies actually get used, so the library
-- can be pruned instead of growing forever.
CREATE TABLE IF NOT EXISTS support_canned_responses (
  id          BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  category_id SMALLINT UNSIGNED NULL,
  code        VARCHAR(64)       NOT NULL,
  title       VARCHAR(191)      NOT NULL,
  body        TEXT              NOT NULL,
  language    VARCHAR(10)       NOT NULL,
  usage_count INT UNSIGNED      NOT NULL DEFAULT 0,
  created_by  BIGINT UNSIGNED   NULL,
  is_active   BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_support_canned_responses_code (code, language),
  KEY idx_support_canned_responses_picker (category_id, language, is_active),
  KEY idx_support_canned_responses_creator (created_by),
  CONSTRAINT fk_support_canned_responses_category FOREIGN KEY (category_id)
    REFERENCES support_categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_support_canned_responses_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_support_canned_responses_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §29 Knowledge Base. article_count is denormalised so category listings do not
-- count articles on every render.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kb_categories (
  id             SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(64)       NOT NULL,
  name           VARCHAR(128)      NOT NULL,
  description    VARCHAR(500)      NULL,
  parent_id      SMALLINT UNSIGNED NULL,
  marketplace_id TINYINT UNSIGNED  NULL,
  icon           VARCHAR(64)       NULL,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  article_count  INT UNSIGNED      NOT NULL DEFAULT 0,
  is_active      BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_kb_categories_code (code),
  KEY idx_kb_categories_tree (parent_id, sort_order),
  KEY idx_kb_categories_active (marketplace_id, is_active, sort_order),
  CONSTRAINT fk_kb_categories_parent FOREIGN KEY (parent_id)
    REFERENCES kb_categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_kb_categories_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Help articles. visibility gates staff runbooks from public content;
-- helpful_count / not_helpful_count identify articles that need rewriting.
CREATE TABLE IF NOT EXISTS kb_articles (
  id                 BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid               CHAR(36)          NOT NULL,
  slug               VARCHAR(200)      NOT NULL,
  category_id        SMALLINT UNSIGNED NULL,
  title              VARCHAR(255)      NOT NULL,
  excerpt            VARCHAR(500)      NULL,
  body               MEDIUMTEXT        NULL,
  language           VARCHAR(10)       NULL,
  status             ENUM('draft','review','published','archived') NOT NULL DEFAULT 'draft',
  visibility         ENUM('public','logged_in','staff') NOT NULL DEFAULT 'public',
  marketplace_id     TINYINT UNSIGNED  NULL,
  country_ids        JSON              NULL,   -- NULL = every country
  tags               JSON              NULL,
  view_count         INT UNSIGNED      NOT NULL DEFAULT 0,
  helpful_count      INT UNSIGNED      NOT NULL DEFAULT 0,
  not_helpful_count  INT UNSIGNED      NOT NULL DEFAULT 0,
  search_keywords    VARCHAR(500)      NULL,   -- synonyms the body does not contain
  related_article_ids JSON             NULL,
  author_id          BIGINT UNSIGNED   NULL,
  reviewed_by        BIGINT UNSIGNED   NULL,
  published_at       TIMESTAMP         NULL,
  created_at         TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_kb_articles_uuid (uuid),
  UNIQUE KEY uk_kb_articles_slug (slug),
  KEY idx_kb_articles_browse (category_id, status, visibility),
  KEY idx_kb_articles_published (status, published_at),
  KEY idx_kb_articles_author (author_id),
  KEY idx_kb_articles_mp (marketplace_id, status),
  CONSTRAINT fk_kb_articles_category FOREIGN KEY (category_id)
    REFERENCES kb_categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_kb_articles_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_kb_articles_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_kb_articles_reviewer FOREIGN KEY (reviewed_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Full-text search over the help centre (§29 Search Help)
ALTER TABLE kb_articles ADD FULLTEXT KEY ft_kb_articles_text (title, excerpt, body);

-- Localised article bodies. PK is (article_id, language) so the resolver reads
-- one row; is_machine_translated flags copy awaiting human review.
CREATE TABLE IF NOT EXISTS kb_article_translations (
  article_id            BIGINT UNSIGNED NOT NULL,
  language              VARCHAR(10)     NOT NULL,
  title                 VARCHAR(255)    NOT NULL,
  excerpt               VARCHAR(500)    NULL,
  body                  MEDIUMTEXT      NULL,
  is_machine_translated BOOLEAN         NOT NULL DEFAULT FALSE,
  published_at          TIMESTAMP       NULL,
  PRIMARY KEY (article_id, language),
  KEY idx_kb_article_translations_language (language),
  CONSTRAINT fk_kb_article_translations_article FOREIGN KEY (article_id)
    REFERENCES kb_articles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_kb_article_translations_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- "Was this helpful?" — guests included, because most help traffic is logged out.
CREATE TABLE IF NOT EXISTS kb_article_feedback (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  article_id BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NULL,
  guest_uuid CHAR(36)        NULL,
  is_helpful BOOLEAN         NOT NULL,
  comment    VARCHAR(500)    NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_kb_article_feedback_article (article_id, is_helpful),
  KEY idx_kb_article_feedback_user (user_id),
  CONSTRAINT fk_kb_article_feedback_article FOREIGN KEY (article_id)
    REFERENCES kb_articles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_kb_article_feedback_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Short Q&A pairs, grouped under the knowledge-base taxonomy. Kept apart from
-- kb_articles because FAQs render inline (accordion) and have no body/workflow.
CREATE TABLE IF NOT EXISTS faqs (
  id             BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  question       VARCHAR(500)      NOT NULL,
  answer         TEXT              NOT NULL,
  category_id    SMALLINT UNSIGNED NULL,
  marketplace_id TINYINT UNSIGNED  NULL,
  language       VARCHAR(10)       NULL,
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  view_count     INT UNSIGNED      NOT NULL DEFAULT 0,
  is_active      BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_faqs_render (marketplace_id, language, is_active, sort_order),
  KEY idx_faqs_category (category_id, sort_order),
  CONSTRAINT fk_faqs_category FOREIGN KEY (category_id)
    REFERENCES kb_categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_faqs_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §29 Community Forum. min_trust_band reuses the trust_scores bands from 003 so
-- new accounts cannot post into high-value categories.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forum_categories (
  id             SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code           VARCHAR(64)       NOT NULL,
  name           VARCHAR(128)      NOT NULL,
  description    VARCHAR(500)      NULL,
  marketplace_id TINYINT UNSIGNED  NULL,
  icon           VARCHAR(64)       NULL,
  topic_count    INT UNSIGNED      NOT NULL DEFAULT 0,
  post_count     INT UNSIGNED      NOT NULL DEFAULT 0,
  is_moderated   BOOLEAN           NOT NULL DEFAULT TRUE,
  min_trust_band ENUM('new','bronze','silver','gold','platinum') NOT NULL DEFAULT 'new',
  sort_order     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_active      BOOLEAN           NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_forum_categories_code (code),
  KEY idx_forum_categories_active (marketplace_id, is_active, sort_order),
  CONSTRAINT fk_forum_categories_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Threads. last_post_at/last_post_by are denormalised because the category
-- listing is sorted by activity and must not aggregate forum_posts.
CREATE TABLE IF NOT EXISTS forum_topics (
  id                 BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid               CHAR(36)          NOT NULL,
  slug               VARCHAR(220)      NOT NULL,
  category_id        SMALLINT UNSIGNED NOT NULL,
  author_id          BIGINT UNSIGNED   NULL,
  title              VARCHAR(255)      NOT NULL,
  body               MEDIUMTEXT        NULL,
  kind               ENUM('discussion','question','poll','announcement') NOT NULL DEFAULT 'discussion',
  status             ENUM('open','answered','closed','hidden','deleted') NOT NULL DEFAULT 'open',
  is_pinned          BOOLEAN           NOT NULL DEFAULT FALSE,
  is_locked          BOOLEAN           NOT NULL DEFAULT FALSE,
  view_count         INT UNSIGNED      NOT NULL DEFAULT 0,
  reply_count        INT UNSIGNED      NOT NULL DEFAULT 0,
  vote_count         INT               NOT NULL DEFAULT 0,   -- signed: downvotes apply
  last_post_at       TIMESTAMP         NULL,
  last_post_by       BIGINT UNSIGNED   NULL,
  accepted_answer_id BIGINT UNSIGNED   NULL,   -- FK added after forum_posts exists
  tags               JSON              NULL,
  language           VARCHAR(10)       NULL,
  created_at         TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_forum_topics_uuid (uuid),
  -- Category listing: pinned first, then most recent activity
  KEY idx_forum_topics_listing (category_id, status, is_pinned, last_post_at),
  KEY idx_forum_topics_author (author_id, created_at),
  KEY idx_forum_topics_slug (slug),
  KEY idx_forum_topics_unanswered (kind, status, created_at),
  KEY idx_forum_topics_accepted (accepted_answer_id),
  CONSTRAINT fk_forum_topics_category FOREIGN KEY (category_id)
    REFERENCES forum_categories (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_forum_topics_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_forum_topics_last_post_by FOREIGN KEY (last_post_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Replies, threaded via parent_id. Deleting a parent re-parents its children to
-- the topic root rather than destroying the sub-thread.
CREATE TABLE IF NOT EXISTS forum_posts (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  topic_id           BIGINT UNSIGNED NOT NULL,
  author_id          BIGINT UNSIGNED NULL,
  parent_id          BIGINT UNSIGNED NULL,
  body               MEDIUMTEXT      NOT NULL,
  is_accepted_answer BOOLEAN         NOT NULL DEFAULT FALSE,
  vote_count         INT             NOT NULL DEFAULT 0,
  status             ENUM('published','hidden','deleted') NOT NULL DEFAULT 'published',
  edited_at          TIMESTAMP       NULL,
  created_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_forum_posts_topic (topic_id, status, created_at),
  KEY idx_forum_posts_author (author_id, created_at),
  KEY idx_forum_posts_parent (parent_id),
  CONSTRAINT fk_forum_posts_topic FOREIGN KEY (topic_id)
    REFERENCES forum_topics (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_forum_posts_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_forum_posts_parent FOREIGN KEY (parent_id)
    REFERENCES forum_posts (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Deferred to break the forum_topics ⇄ forum_posts cycle at create time.
ALTER TABLE forum_topics
  ADD CONSTRAINT fk_forum_topics_accepted_answer FOREIGN KEY (accepted_answer_id)
    REFERENCES forum_posts (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Votes on either a topic or a post; UNIQUE is the one-vote-per-user guard.
-- target_id is polymorphic, so no FK on it.
CREATE TABLE IF NOT EXISTS forum_votes (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  target_kind ENUM('topic','post') NOT NULL,
  target_id   BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NOT NULL,
  vote        TINYINT         NOT NULL,   -- +1 | -1
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_forum_votes_target_user (target_kind, target_id, user_id),
  KEY idx_forum_votes_user (user_id, created_at),
  CONSTRAINT fk_forum_votes_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT chk_forum_votes_value CHECK (vote IN (-1, 1))
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- §22 CMS. country_ids scopes legal/landing content per market; visibility
-- separates public pages from staff-only ones.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_pages (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)         NOT NULL,
  slug            VARCHAR(200)     NOT NULL,
  title           VARCHAR(255)     NOT NULL,
  body            MEDIUMTEXT       NULL,
  kind            ENUM('page','landing','help','legal','blog') NOT NULL DEFAULT 'page',
  template        VARCHAR(64)      NULL,
  status          ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  visibility      ENUM('public','logged_in','staff') NOT NULL DEFAULT 'public',
  country_ids     JSON             NULL,
  marketplace_id  TINYINT UNSIGNED NULL,
  seo_title       VARCHAR(255)     NULL,
  seo_description VARCHAR(500)     NULL,
  seo_image_url   VARCHAR(512)     NULL,
  author_id       BIGINT UNSIGNED  NULL,
  published_at    TIMESTAMP        NULL,
  created_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cms_pages_uuid (uuid),
  UNIQUE KEY uk_cms_pages_slug (slug),
  KEY idx_cms_pages_published (status, kind, published_at),
  KEY idx_cms_pages_mp (marketplace_id, status),
  KEY idx_cms_pages_author (author_id),
  CONSTRAINT fk_cms_pages_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_cms_pages_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS cms_page_translations (
  page_id         BIGINT UNSIGNED NOT NULL,
  language        VARCHAR(10)     NOT NULL,
  title           VARCHAR(255)    NOT NULL,
  body            MEDIUMTEXT      NULL,
  seo_title       VARCHAR(255)    NULL,
  seo_description VARCHAR(500)    NULL,
  PRIMARY KEY (page_id, language),
  KEY idx_cms_page_translations_language (language),
  CONSTRAINT fk_cms_page_translations_page FOREIGN KEY (page_id)
    REFERENCES cms_pages (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cms_page_translations_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- §22 Banner Management. Targeting is JSON so a campaign can be scoped by
-- country, platform and language without three join tables; priority breaks
-- ties when several banners match one placement.
CREATE TABLE IF NOT EXISTS cms_banners (
  id               BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid             CHAR(36)          NOT NULL,
  name             VARCHAR(160)      NOT NULL,
  placement        VARCHAR(64)       NOT NULL,   -- home.hero | search.top | listing.sidebar
  marketplace_id   TINYINT UNSIGNED  NULL,
  image_url        VARCHAR(512)      NULL,
  mobile_image_url VARCHAR(512)      NULL,
  title            VARCHAR(191)      NULL,
  subtitle         VARCHAR(255)      NULL,
  cta_label        VARCHAR(96)       NULL,
  cta_url          VARCHAR(512)      NULL,
  deep_link        VARCHAR(512)      NULL,
  target_countries JSON              NULL,
  target_platforms JSON              NULL,
  target_languages JSON              NULL,
  starts_at        TIMESTAMP         NULL,
  ends_at          TIMESTAMP         NULL,
  priority         SMALLINT UNSIGNED NOT NULL DEFAULT 100,
  impression_count INT UNSIGNED      NOT NULL DEFAULT 0,
  click_count      INT UNSIGNED      NOT NULL DEFAULT 0,
  is_active        BOOLEAN           NOT NULL DEFAULT TRUE,
  created_by       BIGINT UNSIGNED   NULL,
  created_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cms_banners_uuid (uuid),
  -- Serving lookup: live banners for a placement, best priority first
  KEY idx_cms_banners_serve (placement, is_active, starts_at, ends_at, priority),
  KEY idx_cms_banners_mp (marketplace_id, is_active),
  KEY idx_cms_banners_creator (created_by),
  CONSTRAINT fk_cms_banners_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cms_banners_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Reusable content fragments (footer blurbs, onboarding copy, legal snippets)
-- so marketing text is never hard-coded in the client.
CREATE TABLE IF NOT EXISTS cms_blocks (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  code           VARCHAR(96)      NOT NULL,
  name           VARCHAR(160)     NOT NULL,
  kind           ENUM('html','markdown','json','list') NOT NULL DEFAULT 'html',
  content        MEDIUMTEXT       NULL,
  marketplace_id TINYINT UNSIGNED NULL,
  language       VARCHAR(10)      NULL,
  is_active      BOOLEAN          NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- NULL language / marketplace_id mean "any"; MySQL treats those NULLs as
  -- distinct here, so the admin layer checks before inserting a variant.
  UNIQUE KEY uk_cms_blocks_code (code, language, marketplace_id),
  KEY idx_cms_blocks_lookup (code, is_active),
  CONSTRAINT fk_cms_blocks_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cms_blocks_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- Public contact form. spam_score gates auto-conversion into a ticket; ticket_id
-- records the conversion when it happens.
CREATE TABLE IF NOT EXISTS contact_submissions (
  id         BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  name       VARCHAR(128)      NOT NULL,
  email      VARCHAR(191)      NOT NULL,
  phone      VARCHAR(24)       NULL,
  subject    VARCHAR(255)      NULL,
  message    TEXT              NOT NULL,
  country_id SMALLINT UNSIGNED NULL,
  source     VARCHAR(48)       NULL,   -- web_form | landing:gold | partner_page
  ip_address VARBINARY(16)     NULL,
  spam_score DECIMAL(5,4)      NULL,
  status     ENUM('new','read','replied','spam','archived') NOT NULL DEFAULT 'new',
  -- forward reference: no FK, resolved in application layer (support_tickets)
  ticket_id  BIGINT UNSIGNED   NULL,
  created_at TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contact_submissions_triage (status, created_at),
  KEY idx_contact_submissions_email (email),
  KEY idx_contact_submissions_ticket (ticket_id),
  CONSTRAINT fk_contact_submissions_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;
