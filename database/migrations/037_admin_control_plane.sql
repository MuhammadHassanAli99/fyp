-- =============================================================================
-- 037  Admin Control Plane: scoped RBAC, company structure, salesman CRM,
--      four-eyes approvals, async reports, CMS versions.
--      Additive on 003/018/021. Does NOT duplicate users, sessions, businesses,
--      roles, payments, risk, reviews, ads, notifications, or audit_logs.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Scoped role assignments. user_roles PK is (user_id, role_id) so a user cannot
-- hold the same role twice with different country/company scopes. This table is
-- the control-plane grant: one row per (user, role, scope).
-- Legacy user_roles rows remain valid and are treated as GLOBAL (or MARKETPLACE
-- when marketplace_id is set).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_role_assignments (
  id              BIGINT UNSIGNED   NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)          NOT NULL,
  user_id         BIGINT UNSIGNED   NOT NULL,
  role_id         SMALLINT UNSIGNED NOT NULL,
  scope_type      ENUM(
                    'GLOBAL','COUNTRY','REGION','PROVINCE','STATE','CITY',
                    'MARKETPLACE','CATEGORY','COMPANY','DEPARTMENT','TEAM','OWN','ASSIGNED'
                  ) NOT NULL DEFAULT 'GLOBAL',
  country_id      SMALLINT UNSIGNED NULL,
  region_id       INT UNSIGNED      NULL,
  city_id         INT UNSIGNED      NULL,
  marketplace_id  TINYINT UNSIGNED  NULL,
  category_id     INT UNSIGNED      NULL,
  business_id     BIGINT UNSIGNED   NULL,
  department_id   BIGINT UNSIGNED   NULL,
  team_id         BIGINT UNSIGNED   NULL,
  granted_by      BIGINT UNSIGNED   NULL,
  granted_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      TIMESTAMP         NULL,
  revoked_at      TIMESTAMP         NULL,
  reason          VARCHAR(255)      NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_role_assignments_uuid (uuid),
  KEY idx_ura_user (user_id, revoked_at, expires_at),
  KEY idx_ura_role (role_id, scope_type),
  KEY idx_ura_country (country_id),
  KEY idx_ura_marketplace (marketplace_id),
  KEY idx_ura_business (business_id),
  CONSTRAINT fk_ura_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ura_role FOREIGN KEY (role_id)
    REFERENCES roles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ura_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ura_region FOREIGN KEY (region_id)
    REFERENCES regions (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ura_city FOREIGN KEY (city_id)
    REFERENCES cities (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ura_marketplace FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ura_category FOREIGN KEY (category_id)
    REFERENCES categories (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_ura_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ura_granted_by FOREIGN KEY (granted_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Company structure: departments and teams (one employee system for every kind)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_departments (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid         CHAR(36)        NOT NULL,
  business_id  BIGINT UNSIGNED NOT NULL,
  code         VARCHAR(64)     NOT NULL,
  name         VARCHAR(128)    NOT NULL,
  kind         ENUM('sales','finance','support','marketing','operations','other')
                 NOT NULL DEFAULT 'other',
  manager_user_id BIGINT UNSIGNED NULL,
  is_active    BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_business_departments_uuid (uuid),
  UNIQUE KEY uk_business_departments_code (business_id, code),
  KEY idx_business_departments_kind (business_id, kind, is_active),
  CONSTRAINT fk_bdept_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bdept_manager FOREIGN KEY (manager_user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS business_teams (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)        NOT NULL,
  business_id     BIGINT UNSIGNED NOT NULL,
  department_id   BIGINT UNSIGNED NOT NULL,
  name            VARCHAR(128)    NOT NULL,
  manager_user_id BIGINT UNSIGNED NULL,
  is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_business_teams_uuid (uuid),
  KEY idx_business_teams_dept (department_id, is_active),
  KEY idx_business_teams_biz (business_id),
  CONSTRAINT fk_bteam_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bteam_dept FOREIGN KEY (department_id)
    REFERENCES business_departments (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_bteam_manager FOREIGN KEY (manager_user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS business_team_members (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id    BIGINT UNSIGNED NOT NULL,
  user_id    BIGINT UNSIGNED NOT NULL,
  joined_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at    TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_business_team_members (team_id, user_id),
  KEY idx_business_team_members_user (user_id),
  CONSTRAINT fk_btm_team FOREIGN KEY (team_id)
    REFERENCES business_teams (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_btm_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

ALTER TABLE business_members
  ADD COLUMN department_id BIGINT UNSIGNED NULL AFTER member_role,
  ADD COLUMN team_id       BIGINT UNSIGNED NULL AFTER department_id,
  ADD COLUMN reports_to    BIGINT UNSIGNED NULL AFTER team_id,
  ADD COLUMN member_status ENUM('invited','active','disabled') NOT NULL DEFAULT 'active' AFTER reports_to;

ALTER TABLE business_members
  ADD CONSTRAINT fk_bm_department FOREIGN KEY (department_id)
    REFERENCES business_departments (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_bm_team FOREIGN KEY (team_id)
    REFERENCES business_teams (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_bm_reports_to FOREIGN KEY (reports_to)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE business_profiles
  MODIFY COLUMN kind ENUM(
    'company','dealer','agency','builder','gold_shop','showroom','broker',
    'vehicle_company','property_company','marketplace_partner','advertising_partner'
  ) NOT NULL;

ALTER TABLE user_role_assignments
  ADD CONSTRAINT fk_ura_department FOREIGN KEY (department_id)
    REFERENCES business_departments (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_ura_team FOREIGN KEY (team_id)
    REFERENCES business_teams (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Listing assignments (salesman OWN/ASSIGNED scope)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS listing_assignments (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  listing_id   BIGINT UNSIGNED NOT NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  business_id  BIGINT UNSIGNED NULL,
  assigned_by  BIGINT UNSIGNED NULL,
  assigned_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at   TIMESTAMP       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_listing_assignments (listing_id, user_id),
  KEY idx_listing_assignments_user (user_id, revoked_at),
  KEY idx_listing_assignments_biz (business_id, revoked_at),
  CONSTRAINT fk_la_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_la_user FOREIGN KEY (user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_la_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_la_assigned_by FOREIGN KEY (assigned_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Salesman CRM (company-scoped; not a second listing or payment engine)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales_leads (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid              CHAR(36)        NOT NULL,
  business_id       BIGINT UNSIGNED NOT NULL,
  assigned_to       BIGINT UNSIGNED NULL,
  customer_user_id  BIGINT UNSIGNED NULL,
  listing_id        BIGINT UNSIGNED NULL,
  marketplace_id    TINYINT UNSIGNED NULL,
  source            VARCHAR(64)     NULL,
  status            ENUM('new','contacted','qualified','appointment','quoted','won','lost')
                      NOT NULL DEFAULT 'new',
  title             VARCHAR(191)    NOT NULL,
  notes             TEXT            NULL,
  expected_value    DECIMAL(18,2)   NULL,
  currency          CHAR(3)         NULL,
  country_id        SMALLINT UNSIGNED NULL,
  next_follow_up_at TIMESTAMP       NULL,
  closed_at         TIMESTAMP       NULL,
  created_by        BIGINT UNSIGNED NULL,
  created_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sales_leads_uuid (uuid),
  KEY idx_sales_leads_assignee (assigned_to, status),
  KEY idx_sales_leads_biz (business_id, status, created_at),
  KEY idx_sales_leads_listing (listing_id),
  CONSTRAINT fk_slead_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_slead_assignee FOREIGN KEY (assigned_to)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_slead_customer FOREIGN KEY (customer_user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_slead_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_slead_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_slead_country FOREIGN KEY (country_id)
    REFERENCES countries (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_slead_creator FOREIGN KEY (created_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS sales_lead_events (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id     BIGINT UNSIGNED NOT NULL,
  actor_id    BIGINT UNSIGNED NULL,
  event_type  VARCHAR(48)     NOT NULL,
  body        TEXT            NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sales_lead_events_lead (lead_id, created_at),
  CONSTRAINT fk_sle_lead FOREIGN KEY (lead_id)
    REFERENCES sales_leads (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sle_actor FOREIGN KEY (actor_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS sales_appointments (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid         CHAR(36)        NOT NULL,
  lead_id      BIGINT UNSIGNED NOT NULL,
  business_id  BIGINT UNSIGNED NOT NULL,
  listing_id   BIGINT UNSIGNED NULL,
  salesman_id  BIGINT UNSIGNED NOT NULL,
  customer_user_id BIGINT UNSIGNED NULL,
  scheduled_for TIMESTAMP      NOT NULL,
  location     VARCHAR(255)    NULL,
  status       ENUM('scheduled','completed','cancelled','no_show') NOT NULL DEFAULT 'scheduled',
  notes        TEXT            NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sales_appointments_uuid (uuid),
  KEY idx_sales_appointments_when (salesman_id, scheduled_for),
  KEY idx_sales_appointments_lead (lead_id),
  CONSTRAINT fk_sapp_lead FOREIGN KEY (lead_id)
    REFERENCES sales_leads (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sapp_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sapp_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_sapp_salesman FOREIGN KEY (salesman_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_sapp_customer FOREIGN KEY (customer_user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS sales_notes (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id      BIGINT UNSIGNED NULL,
  listing_id   BIGINT UNSIGNED NULL,
  customer_user_id BIGINT UNSIGNED NULL,
  business_id  BIGINT UNSIGNED NOT NULL,
  author_id    BIGINT UNSIGNED NOT NULL,
  body         TEXT            NOT NULL,
  created_at   TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sales_notes_lead (lead_id, created_at),
  KEY idx_sales_notes_author (author_id, created_at),
  CONSTRAINT fk_snote_lead FOREIGN KEY (lead_id)
    REFERENCES sales_leads (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_snote_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_snote_customer FOREIGN KEY (customer_user_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_snote_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_snote_author FOREIGN KEY (author_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS sales_quotes (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          CHAR(36)        NOT NULL,
  lead_id       BIGINT UNSIGNED NOT NULL,
  business_id   BIGINT UNSIGNED NOT NULL,
  listing_id    BIGINT UNSIGNED NULL,
  salesman_id   BIGINT UNSIGNED NOT NULL,
  amount        DECIMAL(18,2)   NOT NULL,
  currency      CHAR(3)         NOT NULL,
  status        ENUM('draft','sent','accepted','rejected','expired') NOT NULL DEFAULT 'draft',
  valid_until   DATE            NULL,
  notes         TEXT            NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sales_quotes_uuid (uuid),
  KEY idx_sales_quotes_lead (lead_id, status),
  CONSTRAINT fk_squote_lead FOREIGN KEY (lead_id)
    REFERENCES sales_leads (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_squote_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_squote_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_squote_salesman FOREIGN KEY (salesman_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS sales_commissions (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid          CHAR(36)        NOT NULL,
  business_id   BIGINT UNSIGNED NOT NULL,
  salesman_id   BIGINT UNSIGNED NOT NULL,
  order_id      BIGINT UNSIGNED NULL,
  listing_id    BIGINT UNSIGNED NULL,
  lead_id       BIGINT UNSIGNED NULL,
  amount        DECIMAL(18,2)   NOT NULL,
  currency      CHAR(3)         NOT NULL,
  rate_bps      INT UNSIGNED    NULL,
  status        ENUM('accrued','approved','paid','void') NOT NULL DEFAULT 'accrued',
  period_start  DATE            NULL,
  period_end    DATE            NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_sales_commissions_uuid (uuid),
  KEY idx_sales_commissions_salesman (salesman_id, status, created_at),
  KEY idx_sales_commissions_biz (business_id, status),
  CONSTRAINT fk_scomm_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_scomm_salesman FOREIGN KEY (salesman_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_scomm_order FOREIGN KEY (order_id)
    REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_scomm_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_scomm_lead FOREIGN KEY (lead_id)
    REFERENCES sales_leads (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS sales_targets (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_id   BIGINT UNSIGNED NOT NULL,
  salesman_id   BIGINT UNSIGNED NULL,
  team_id       BIGINT UNSIGNED NULL,
  period_start  DATE            NOT NULL,
  period_end    DATE            NOT NULL,
  metric        ENUM('revenue','units','leads_won','listings') NOT NULL DEFAULT 'revenue',
  target_value  DECIMAL(18,2)   NOT NULL,
  currency      CHAR(3)         NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sales_targets_who (business_id, salesman_id, period_start),
  CONSTRAINT fk_stgt_business FOREIGN KEY (business_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_stgt_salesman FOREIGN KEY (salesman_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_stgt_team FOREIGN KEY (team_id)
    REFERENCES business_teams (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Four-eyes privileged actions. Execution happens only after a second admin
-- with the same permission approves. Ordinary admins cannot delete these rows.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS privileged_action_requests (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)        NOT NULL,
  action          VARCHAR(96)     NOT NULL,
  permission_code VARCHAR(96)     NOT NULL,
  resource_type   VARCHAR(64)     NOT NULL,
  resource_id     VARCHAR(64)     NULL,
  payload_json    JSON            NULL,
  reason          VARCHAR(500)    NOT NULL,
  status          ENUM('pending','approved','rejected','executed','cancelled','expired')
                    NOT NULL DEFAULT 'pending',
  requested_by    BIGINT UNSIGNED NOT NULL,
  decided_by      BIGINT UNSIGNED NULL,
  decided_at      TIMESTAMP       NULL,
  executed_at     TIMESTAMP       NULL,
  decision_reason VARCHAR(500)    NULL,
  expires_at      TIMESTAMP       NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_par_uuid (uuid),
  KEY idx_par_status (status, created_at),
  KEY idx_par_actor (requested_by, created_at),
  KEY idx_par_resource (resource_type, resource_id),
  CONSTRAINT fk_par_requested FOREIGN KEY (requested_by)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_par_decided FOREIGN KEY (decided_by)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Async admin reports (never run expensive aggregations on the request thread)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_report_jobs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uuid            CHAR(36)        NOT NULL,
  report_type     VARCHAR(64)     NOT NULL,
  filters_json    JSON            NULL,
  status          ENUM('queued','running','succeeded','failed','cancelled')
                    NOT NULL DEFAULT 'queued',
  requested_by    BIGINT UNSIGNED NOT NULL,
  row_count       INT UNSIGNED    NULL,
  result_json     JSON            NULL,
  error           VARCHAR(500)    NULL,
  started_at      TIMESTAMP       NULL,
  finished_at     TIMESTAMP       NULL,
  created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_report_jobs_uuid (uuid),
  KEY idx_admin_report_jobs_status (status, created_at),
  KEY idx_admin_report_jobs_user (requested_by, created_at),
  CONSTRAINT fk_arj_user FOREIGN KEY (requested_by)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- CMS version history (content states beyond draft/published/archived)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cms_page_versions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  page_id     BIGINT UNSIGNED NOT NULL,
  version     INT UNSIGNED    NOT NULL,
  title       VARCHAR(255)    NOT NULL,
  body        MEDIUMTEXT      NULL,
  status      VARCHAR(32)     NOT NULL,
  editor_id   BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cms_page_versions (page_id, version),
  KEY idx_cms_page_versions_page (page_id, created_at),
  CONSTRAINT fk_cpv_page FOREIGN KEY (page_id)
    REFERENCES cms_pages (id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cpv_editor FOREIGN KEY (editor_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

ALTER TABLE cms_pages
  MODIFY COLUMN status ENUM('draft','in_review','scheduled','published','archived')
    NOT NULL DEFAULT 'draft';

ALTER TABLE cms_pages
  ADD COLUMN scheduled_at TIMESTAMP NULL AFTER published_at;

CREATE TABLE IF NOT EXISTS translation_versions (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  language    VARCHAR(10)     NOT NULL,
  namespace   VARCHAR(64)     NOT NULL,
  trans_key   VARCHAR(191)    NOT NULL,
  value       TEXT            NOT NULL,
  version     INT UNSIGNED    NOT NULL,
  editor_id   BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_translation_versions_key (language, namespace, trans_key, version),
  CONSTRAINT fk_tv_language FOREIGN KEY (language)
    REFERENCES languages (code) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tv_editor FOREIGN KEY (editor_id)
    REFERENCES users (id) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE = InnoDB;

-- -----------------------------------------------------------------------------
-- Audit enrichment. Existing rows stay valid; new privileged writes populate
-- the extra columns. Ordinary admins still cannot DELETE from this table.
-- -----------------------------------------------------------------------------
ALTER TABLE audit_logs
  ADD COLUMN organization_id BIGINT UNSIGNED NULL AFTER actor_id,
  ADD COLUMN role_code       VARCHAR(64)     NULL AFTER organization_id,
  ADD COLUMN permission_code VARCHAR(96)     NULL AFTER role_code,
  ADD COLUMN reason          VARCHAR(500)    NULL AFTER permission_code,
  ADD COLUMN session_id      BIGINT UNSIGNED NULL AFTER request_id,
  ADD COLUMN device_id       BIGINT UNSIGNED NULL AFTER session_id;

ALTER TABLE audit_logs
  ADD KEY idx_audit_org (organization_id, created_at),
  ADD CONSTRAINT fk_audit_org FOREIGN KEY (organization_id)
    REFERENCES business_profiles (id) ON DELETE SET NULL ON UPDATE CASCADE;

-- Country extras used by the admin country editor (ISO/phone/currency already exist)
ALTER TABLE countries
  ADD COLUMN number_format JSON NULL AFTER time_format;

-- Notification broadcasts may target role/company/marketplace via segment_query.
-- No schema change: scheduled_notifications.segment_query is already JSON.
