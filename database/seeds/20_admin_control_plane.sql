-- =============================================================================
-- 20  Admin Control Plane: extra roles/permissions, demo staff users, company
--     org chart and a scoped country admin. Idempotent.
--     Password for every demo account: Password123! (same scrypt as 06_demo).
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1. Configurable system roles. Authorization must never switch on these names;
--    they only exist so operators can assign permission packs. Ids 15–50.
-- -----------------------------------------------------------------------------
INSERT INTO roles (id, code, name, description, is_staff, is_system) VALUES
  (15, 'platform_admin',         'Platform Admin',         'Operational platform administrator',                 TRUE,  TRUE),
  (16, 'platform_manager',       'Platform Manager',       'Day-to-day platform operations',                     TRUE,  FALSE),
  (17, 'country_admin',          'Country Admin',          'Scoped to one or more countries',                    TRUE,  FALSE),
  (18, 'regional_admin',         'Regional Admin',         'Scoped to a region/province/state',                  TRUE,  FALSE),
  (19, 'city_admin',             'City Admin',             'Scoped to a city',                                   TRUE,  FALSE),
  (20, 'gold_admin',             'Gold Admin',             'Gold marketplace operations',                         TRUE,  FALSE),
  (21, 'property_admin',         'Property Admin',         'Property marketplace operations',                     TRUE,  FALSE),
  (22, 'vehicle_admin',          'Vehicle Admin',          'Vehicle marketplace operations',                      TRUE,  FALSE),
  (23, 'marketplace_manager',    'Marketplace Manager',    'Cross-marketplace catalog and listings',             TRUE,  FALSE),
  (24, 'senior_moderator',       'Senior Moderator',       'Moderation with escalate/override',                  TRUE,  FALSE),
  (25, 'trust_safety_analyst',   'Trust & Safety Analyst', 'Trust, risk and safety investigations',              TRUE,  FALSE),
  (26, 'kyc_analyst',            'KYC Analyst',            'Identity and business verification review',          TRUE,  FALSE),
  (27, 'aml_analyst',            'AML Analyst',            'Jurisdiction-gated AML reviews',                     TRUE,  FALSE),
  (28, 'finance_admin',          'Finance Admin',          'Full finance surface',                               TRUE,  FALSE),
  (29, 'finance_manager',        'Finance Manager',        'Payments, invoices, refunds',                        TRUE,  FALSE),
  (30, 'accountant',             'Accountant',             'Read-only finance plus invoices',                    TRUE,  FALSE),
  (31, 'payment_operator',       'Payment Operator',       'Reconcile payments and bank transfers',               TRUE,  FALSE),
  (32, 'refund_manager',         'Refund Manager',         'Create and approve refunds',                         TRUE,  FALSE),
  (33, 'sales_director',         'Sales Director',         'Company sales leadership (platform view)',            TRUE,  FALSE),
  (34, 'sales_manager',          'Sales Manager',          'Team sales management',                              FALSE, FALSE),
  (35, 'sales_executive',        'Sales Executive',        'Sales executive',                                    FALSE, FALSE),
  (36, 'salesman',               'Salesman',               'Company salesman — assigned leads and listings',      FALSE, FALSE),
  (37, 'support_admin',          'Support Admin',          'Support organisation admin',                         TRUE,  FALSE),
  (38, 'support_manager',        'Support Manager',        'Support queue manager',                              TRUE,  FALSE),
  (39, 'cms_admin',              'CMS Admin',              'CMS, banners, FAQ, legal pages',                     TRUE,  FALSE),
  (40, 'translation_manager',    'Translation Manager',    'Translation catalogue and variants',                 TRUE,  FALSE),
  (41, 'marketing_admin',        'Marketing Admin',        'Campaigns and broadcasts',                           TRUE,  FALSE),
  (42, 'campaign_manager',       'Campaign Manager',       'Ad campaign review',                                 TRUE,  FALSE),
  (43, 'company_owner',          'Company Owner',          'Owner of a business profile',                        FALSE, FALSE),
  (44, 'company_admin',          'Company Admin',          'Admin of a business profile',                        FALSE, FALSE),
  (45, 'company_manager',        'Company Manager',        'Manager inside a business',                          FALSE, FALSE),
  (46, 'company_salesman',       'Company Salesman',       'Salesperson inside a business',                      FALSE, FALSE),
  (47, 'company_finance',        'Company Finance',        'Finance role inside a business',                     FALSE, FALSE),
  (48, 'company_support',        'Company Support',        'Support role inside a business',                     FALSE, FALSE),
  (49, 'analyst',                'Analyst',                'Read-only analytics',                                TRUE,  FALSE),
  (50, 'report_viewer',          'Report Viewer',          'Read-only reports',                                  TRUE,  FALSE),
  (51, 'auditor',                'Auditor',                'Append-only audit trail access',                     TRUE,  TRUE)
ON DUPLICATE KEY UPDATE
  code = VALUES(code), name = VALUES(name), description = VALUES(description),
  is_staff = VALUES(is_staff), is_system = VALUES(is_system);

-- -----------------------------------------------------------------------------
-- 2. Extra permissions (ids 400+ avoid 02/11/18 grids). admin.view was referenced
--    by /admin/summary but never seeded.
-- -----------------------------------------------------------------------------
INSERT INTO permissions (id, code, resource, action, description) VALUES
  (400, 'admin.access',            'admin',        'access',     'Open the Admin Control Plane shell'),
  (401, 'admin.view',              'admin',        'view',       'View the platform admin dashboard'),
  (402, 'listing.feature',         'listing',      'feature',    'Feature a listing'),
  (403, 'listing.boost',           'listing',      'boost',      'Boost a listing'),
  (404, 'listing.suspend',         'listing',      'suspend',    'Suspend a listing'),
  (405, 'role.view_any',           'role',         'view_any',   'View roles'),
  (406, 'role.create',             'role',         'create',     'Create a role'),
  (407, 'role.update',             'role',         'update',     'Edit a role'),
  (408, 'role.assign',             'role',         'assign',     'Assign a role to a user'),
  (409, 'role.delete',             'role',         'delete',     'Delete a non-system role'),
  (410, 'permission.view_any',     'permission',   'view_any',   'View the permission catalogue'),
  (411, 'employee.view_any',       'employee',     'view_any',   'View company employees'),
  (412, 'employee.create',         'employee',     'create',     'Add a company employee'),
  (413, 'employee.update',         'employee',     'update',     'Edit a company employee'),
  (414, 'employee.disable',        'employee',     'disable',    'Disable a company employee'),
  (415, 'system_health.view',      'system_health','view',       'View system health (observability remains authoritative)'),
  (416, 'sales.view',              'sales',        'view',       'View own/assigned sales data'),
  (417, 'sales.view_any',          'sales',        'view_any',   'View sales data in scope'),
  (418, 'sales.manage',            'sales',        'manage',     'Manage leads, quotes and appointments'),
  (419, 'commission.view',         'commission',   'view',       'View own commission'),
  (420, 'commission.view_any',     'commission',   'view_any',   'View team/company commission'),
  (421, 'commission.manage',       'commission',   'manage',     'Approve or void commission'),
  (422, 'lead.view',               'lead',         'view',       'View assigned leads'),
  (423, 'lead.view_any',           'lead',         'view_any',   'View company leads'),
  (424, 'lead.create',             'lead',         'create',     'Create a lead'),
  (425, 'lead.update',             'lead',         'update',     'Update a lead'),
  (426, 'report.manage',           'report',       'manage',     'Queue asynchronous platform reports'),
  (427, 'approval.view',           'approval',     'view',       'View privileged action requests'),
  (428, 'approval.decide',         'approval',     'decide',     'Approve or reject a four-eyes request')
ON DUPLICATE KEY UPDATE
  code = VALUES(code), resource = VALUES(resource), action = VALUES(action),
  description = VALUES(description);

-- Every staff role can open the shell; dashboard still needs admin.view.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'admin.access'
WHERE r.is_staff = 1 OR r.code IN (
  'sales_manager','sales_executive','salesman',
  'company_owner','company_admin','company_manager','company_salesman','company_finance','company_support'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'admin.view'
WHERE r.code IN (
  'admin','super_admin','platform_admin','platform_manager','country_admin',
  'finance_admin','support_admin','cms_admin','analyst','auditor'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('listing.feature','listing.boost','listing.suspend')
WHERE r.code IN ('admin','super_admin','platform_admin','moderator','senior_moderator','marketplace_manager','gold_admin','property_admin','vehicle_admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('role.view_any','permission.view_any')
WHERE r.code IN ('admin','super_admin','platform_admin','auditor');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('role.create','role.update','role.assign','role.delete')
WHERE r.code IN ('admin','super_admin','platform_admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN (
  'employee.view_any','employee.create','employee.update','employee.disable',
  'business.view_any','business.update','business.approve','business.reject'
)
WHERE r.code IN ('admin','super_admin','platform_admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 15, p.id FROM permissions p WHERE p.code IN (
  'employee.view_any','employee.create','employee.update','employee.disable',
  'user.view_any','user.update','user.suspend','user.ban','listing.view_any',
  'listing.moderate','listing.approve','listing.reject','business.view_any',
  'category.view_any','country.view_any','analytics.view_any','admin.view','admin.access',
  'system_health.view','audit.view_any','ticket.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 16, p.id FROM permissions p WHERE p.code IN (
  'admin.access','admin.view','user.view_any','listing.view_any','business.view_any',
  'moderation.view_any','ticket.view_any','analytics.view_any'
);

-- Country / geo admins: user + listing + business + moderation in their scope
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'admin.access','user.view_any','user.suspend','listing.view_any','listing.moderate',
  'listing.approve','listing.reject','business.view_any','moderation.view_any',
  'ticket.view_any','analytics.view'
)
WHERE r.code IN ('country_admin','regional_admin','city_admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 20, p.id FROM permissions p WHERE p.code IN (
  'admin.access','listing.view_any','listing.moderate','listing.approve','listing.reject',
  'listing.feature','listing.boost','listing.suspend','category.view_any','moderation.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 21, p.id FROM permissions p WHERE p.code IN (
  'admin.access','listing.view_any','listing.moderate','listing.approve','listing.reject',
  'listing.feature','listing.boost','listing.suspend','category.view_any','moderation.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 22, p.id FROM permissions p WHERE p.code IN (
  'admin.access','listing.view_any','listing.moderate','listing.approve','listing.reject',
  'listing.feature','listing.boost','listing.suspend','category.view_any','moderation.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 23, p.id FROM permissions p WHERE p.code IN (
  'admin.access','listing.view_any','listing.moderate','listing.approve','listing.reject',
  'category.view_any','category.create','category.update','category.manage',
  'attribute.view_any','attribute.update'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 24, p.id FROM permissions p WHERE p.code IN (
  'admin.access','listing.view_any','listing.moderate','listing.approve','listing.reject','listing.suspend',
  'review.view_any','review.moderate','message.view_any','message.moderate',
  'moderation.view_any','moderation.moderate','moderation.approve','moderation.reject',
  'report.view_any','report.moderate','user.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'admin.access','risk.view_any','fraud_case.view_any','fraud_case.update','fraud_case.approve',
  'user.view_any','listing.view_any','audit.view_any'
)
WHERE r.code IN ('trust_safety_analyst','fraud_analyst');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 26, p.id FROM permissions p WHERE p.code IN (
  'admin.access','kyc.view_any','kyc.review','verification.view_any','verification.approve','verification.reject','user.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 27, p.id FROM permissions p WHERE p.code IN (
  'admin.access','aml.view_any','aml.review','kyc.view_any','user.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 28, p.id FROM permissions p WHERE p.code IN (
  'admin.access','admin.view','payment.view_any','payment.update','refund.view_any','refund.create','refund.approve',
  'invoice.view_any','invoice.create','order.view_any','subscription.view_any','subscription.manage',
  'payout.view_any','payout.approve','wallet.view_any','analytics.view_any','audit.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 29, p.id FROM permissions p WHERE p.code IN (
  'admin.access','payment.view_any','payment.update','refund.view_any','refund.create','refund.approve',
  'invoice.view_any','order.view_any','subscription.view_any','analytics.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 30, p.id FROM permissions p WHERE p.code IN (
  'admin.access','payment.view_any','invoice.view_any','invoice.create','order.view_any','refund.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 31, p.id FROM permissions p WHERE p.code IN (
  'admin.access','payment.view_any','payment.update','order.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 32, p.id FROM permissions p WHERE p.code IN (
  'admin.access','refund.view_any','refund.create','refund.approve','refund.reject','payment.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'admin.access','sales.view_any','sales.manage','lead.view_any','lead.create','lead.update',
  'commission.view_any','listing.view_any','listing.update','employee.view_any'
)
WHERE r.code IN ('sales_director','sales_manager');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'admin.access','sales.view','sales.manage','lead.view','lead.create','lead.update',
  'commission.view','listing.view','listing.update','listing.create'
)
WHERE r.code IN ('sales_executive','salesman','company_salesman');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'admin.access','ticket.view_any','ticket.update','ticket.manage','user.view_any','listing.view_any'
)
WHERE r.code IN ('support_admin','support_manager','support_agent');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 39, p.id FROM permissions p WHERE p.code IN (
  'admin.access','cms_page.view_any','cms_page.create','cms_page.update','cms_page.publish',
  'banner.view_any','banner.create','banner.update','banner.publish',
  'kb_article.view_any','kb_article.create','kb_article.update','kb_article.publish'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 40, p.id FROM permissions p WHERE p.code IN (
  'admin.access','translation.view_any','translation.create','translation.update','translation.manage',
  'language.view_any','language.update'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'admin.access','ad_campaign.view_any','ad_campaign.approve','ad_campaign.reject',
  'notification.view_any','notification.create','notification.manage'
)
WHERE r.code IN ('marketing_admin','campaign_manager');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'admin.access','business.view','business.update','employee.view_any','employee.create','employee.update',
  'listing.view','listing.create','listing.update','sales.view_any','lead.view_any'
)
WHERE r.code IN ('company_owner','company_admin','company_manager');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 47, p.id FROM permissions p WHERE p.code IN (
  'admin.access','commission.view_any','order.view','payment.view','invoice.view'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 48, p.id FROM permissions p WHERE p.code IN (
  'admin.access','ticket.view','ticket.create','ticket.update'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'admin.access','analytics.view_any','analytics.export','report.view_any','report.export','report.manage'
)
WHERE r.code IN ('analyst','report_viewer');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 51, p.id FROM permissions p WHERE p.code IN (
  'admin.access','audit.view_any','audit.export','user.view_any','analytics.view_any'
);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code IN ('system_health.view','approval.view')
WHERE r.is_staff = 1;

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON p.code = 'approval.decide'
WHERE r.code IN ('admin','super_admin','platform_admin','finance_admin','refund_manager');

-- Existing admin role (13) must receive admin.view / admin.access (the original gap).
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 13, p.id FROM permissions p WHERE p.code IN ('admin.view','admin.access','system_health.view','role.view_any','permission.view_any','role.assign','listing.feature','listing.boost','listing.suspend','employee.view_any','sales.view_any','report.manage','approval.view','approval.decide');

-- -----------------------------------------------------------------------------
-- 3. Demo staff + salesman accounts (ids 9301+)
-- -----------------------------------------------------------------------------
INSERT INTO users (
  id, uuid, email, phone_country_code, phone_number, phone_e164, username,
  password_hash, password_changed_at, account_type, status,
  country_id, language, currency, timezone, theme, measurement_system,
  email_verified_at, last_active_at
) VALUES
  (9301, 'c1111111-1111-4111-8111-111111111301', 'super.admin@aurelia.test', '+92', '3000000001', '+923000000001', 'super_admin',
   'scrypt$32768$8$1$tCeqj3czrM6i9l4ut+9yDg==$kixZFkzTkxKQRRdxYXALR+TkTbWdFz6ukHBmTXowEa2h/7ISul4joS0KGI881FfQ569794+XdoWQsyf2QXsz2g==',
   CURRENT_TIMESTAMP, 'individual', 'active', 1, 'en', 'PKR', 'Asia/Karachi', 'system', 'metric', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9302, 'c1111111-1111-4111-8111-111111111302', 'platform.admin@aurelia.test', '+92', '3000000002', '+923000000002', 'platform_admin',
   'scrypt$32768$8$1$tCeqj3czrM6i9l4ut+9yDg==$kixZFkzTkxKQRRdxYXALR+TkTbWdFz6ukHBmTXowEa2h/7ISul4joS0KGI881FfQ569794+XdoWQsyf2QXsz2g==',
   CURRENT_TIMESTAMP, 'individual', 'active', 1, 'en', 'PKR', 'Asia/Karachi', 'system', 'metric', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9303, 'c1111111-1111-4111-8111-111111111303', 'country.admin.pk@aurelia.test', '+92', '3000000003', '+923000000003', 'country_admin_pk',
   'scrypt$32768$8$1$tCeqj3czrM6i9l4ut+9yDg==$kixZFkzTkxKQRRdxYXALR+TkTbWdFz6ukHBmTXowEa2h/7ISul4joS0KGI881FfQ569794+XdoWQsyf2QXsz2g==',
   CURRENT_TIMESTAMP, 'individual', 'active', 1, 'en', 'PKR', 'Asia/Karachi', 'system', 'metric', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9304, 'c1111111-1111-4111-8111-111111111304', 'moderator@aurelia.test', '+92', '3000000004', '+923000000004', 'staff_moderator',
   'scrypt$32768$8$1$tCeqj3czrM6i9l4ut+9yDg==$kixZFkzTkxKQRRdxYXALR+TkTbWdFz6ukHBmTXowEa2h/7ISul4joS0KGI881FfQ569794+XdoWQsyf2QXsz2g==',
   CURRENT_TIMESTAMP, 'individual', 'active', 1, 'en', 'PKR', 'Asia/Karachi', 'system', 'metric', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9305, 'c1111111-1111-4111-8111-111111111305', 'finance.manager@aurelia.test', '+92', '3000000005', '+923000000005', 'finance_manager',
   'scrypt$32768$8$1$tCeqj3czrM6i9l4ut+9yDg==$kixZFkzTkxKQRRdxYXALR+TkTbWdFz6ukHBmTXowEa2h/7ISul4joS0KGI881FfQ569794+XdoWQsyf2QXsz2g==',
   CURRENT_TIMESTAMP, 'individual', 'active', 1, 'en', 'PKR', 'Asia/Karachi', 'system', 'metric', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9306, 'c1111111-1111-4111-8111-111111111306', 'support.agent@aurelia.test', '+92', '3000000006', '+923000000006', 'staff_support',
   'scrypt$32768$8$1$tCeqj3czrM6i9l4ut+9yDg==$kixZFkzTkxKQRRdxYXALR+TkTbWdFz6ukHBmTXowEa2h/7ISul4joS0KGI881FfQ569794+XdoWQsyf2QXsz2g==',
   CURRENT_TIMESTAMP, 'individual', 'active', 1, 'en', 'PKR', 'Asia/Karachi', 'system', 'metric', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9307, 'c1111111-1111-4111-8111-111111111307', 'auditor@aurelia.test', '+92', '3000000007', '+923000000007', 'staff_auditor',
   'scrypt$32768$8$1$tCeqj3czrM6i9l4ut+9yDg==$kixZFkzTkxKQRRdxYXALR+TkTbWdFz6ukHBmTXowEa2h/7ISul4joS0KGI881FfQ569794+XdoWQsyf2QXsz2g==',
   CURRENT_TIMESTAMP, 'individual', 'active', 1, 'en', 'PKR', 'Asia/Karachi', 'system', 'metric', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (9308, 'c1111111-1111-4111-8111-111111111308', 'salesman@aurelia.test', '+92', '3000000008', '+923000000008', 'company_salesman',
   'scrypt$32768$8$1$tCeqj3czrM6i9l4ut+9yDg==$kixZFkzTkxKQRRdxYXALR+TkTbWdFz6ukHBmTXowEa2h/7ISul4joS0KGI881FfQ569794+XdoWQsyf2QXsz2g==',
   CURRENT_TIMESTAMP, 'individual', 'active', 1, 'en', 'PKR', 'Asia/Karachi', 'system', 'metric', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  email = VALUES(email), password_hash = VALUES(password_hash), status = VALUES(status);

INSERT INTO user_profiles (user_id, display_name, first_name, last_name, bio, profile_completeness) VALUES
  (9301, 'Super Admin', 'Super', 'Admin', 'Seeded unrestricted operator', 90),
  (9302, 'Platform Admin', 'Platform', 'Admin', 'Seeded platform operator', 80),
  (9303, 'Country Admin PK', 'Country', 'Admin', 'Seeded Pakistan-scoped admin', 80),
  (9304, 'Moderator', 'Staff', 'Moderator', 'Seeded moderator', 70),
  (9305, 'Finance Manager', 'Finance', 'Manager', 'Seeded finance manager', 70),
  (9306, 'Support Agent', 'Support', 'Agent', 'Seeded support agent', 70),
  (9307, 'Auditor', 'Staff', 'Auditor', 'Seeded auditor (no delete on audit)', 70),
  (9308, 'Company Salesman', 'Amina', 'Saleem', 'Seeded company salesman', 70)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- Legacy user_roles (GLOBAL) for unrestricted staff
INSERT INTO user_roles (user_id, role_id, marketplace_id, granted_at) VALUES
  (9301, 14, NULL, CURRENT_TIMESTAMP),
  (9302, 15, NULL, CURRENT_TIMESTAMP),
  (9304,  9, NULL, CURRENT_TIMESTAMP),
  (9305, 29, NULL, CURRENT_TIMESTAMP),
  (9306,  8, NULL, CURRENT_TIMESTAMP),
  (9307, 51, NULL, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE granted_at = VALUES(granted_at);

-- Country admin: COUNTRY=Pakistan (id 1). Must not see other countries.
INSERT INTO user_role_assignments
  (uuid, user_id, role_id, scope_type, country_id, granted_by, granted_at)
VALUES
  ('d1111111-1111-4111-8111-111111111401', 9303, 17, 'COUNTRY', 1, 9301, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE scope_type = VALUES(scope_type), country_id = VALUES(country_id);

-- Gold marketplace-scoped moderator assignment (in addition to global moderator above we keep 9304 global)
INSERT INTO user_role_assignments
  (uuid, user_id, role_id, scope_type, marketplace_id, granted_by, granted_at)
VALUES
  ('d1111111-1111-4111-8111-111111111402', 9302, 20, 'MARKETPLACE', 1, 9301, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE marketplace_id = VALUES(marketplace_id);

-- -----------------------------------------------------------------------------
-- 4. Demo company with departments, team, salesman membership + scoped role
-- -----------------------------------------------------------------------------
INSERT INTO business_profiles (
  id, user_id, kind, legal_name, trade_name, slug, description, country_id, status, verified_at, marketplaces
) VALUES (
  9401, 9001, 'dealer', 'AURELIA Demo Motors', 'AURELIA Motors', 'aurelia-demo-motors',
  'Seeded dealer used by the Admin Control Plane salesman flow.',
  1, 'active', CURRENT_TIMESTAMP, JSON_ARRAY('vehicles')
)
ON DUPLICATE KEY UPDATE legal_name = VALUES(legal_name), status = VALUES(status);

INSERT INTO business_departments (id, uuid, business_id, code, name, kind, manager_user_id, is_active) VALUES
  (9501, 'e1111111-1111-4111-8111-111111111501', 9401, 'sales', 'Sales', 'sales', 9001, TRUE),
  (9502, 'e1111111-1111-4111-8111-111111111502', 9401, 'finance', 'Finance', 'finance', 9001, TRUE),
  (9503, 'e1111111-1111-4111-8111-111111111503', 9401, 'support', 'Support', 'support', 9001, TRUE),
  (9504, 'e1111111-1111-4111-8111-111111111504', 9401, 'marketing', 'Marketing', 'marketing', 9001, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind);

INSERT INTO business_teams (id, uuid, business_id, department_id, name, manager_user_id, is_active) VALUES
  (9601, 'e1111111-1111-4111-8111-111111111601', 9401, 9501, 'Retail Sales', 9001, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO business_members (business_id, user_id, member_role, can_post, can_reply, can_billing, accepted_at, department_id, team_id, reports_to, member_status)
VALUES
  (9401, 9001, 'owner', TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, 9501, 9601, NULL, 'active'),
  (9401, 9308, 'salesperson', TRUE, TRUE, FALSE, CURRENT_TIMESTAMP, 9501, 9601, 9001, 'active')
ON DUPLICATE KEY UPDATE member_role = VALUES(member_role), department_id = VALUES(department_id), team_id = VALUES(team_id), member_status = VALUES(member_status);

INSERT INTO business_team_members (team_id, user_id) VALUES (9601, 9308)
ON DUPLICATE KEY UPDATE team_id = VALUES(team_id);

INSERT INTO user_role_assignments
  (uuid, user_id, role_id, scope_type, business_id, department_id, team_id, granted_by, granted_at)
VALUES
  ('d1111111-1111-4111-8111-111111111403', 9308, 46, 'COMPANY', 9401, 9501, 9601, 9001, CURRENT_TIMESTAMP),
  ('d1111111-1111-4111-8111-111111111405', 9308, 46, 'ASSIGNED', 9401, 9501, 9601, 9001, CURRENT_TIMESTAMP),
  ('d1111111-1111-4111-8111-111111111404', 9001, 43, 'COMPANY', 9401, NULL, NULL, 9301, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE business_id = VALUES(business_id);

INSERT INTO listing_assignments (listing_id, user_id, business_id, assigned_by)
SELECT id, 9308, 9401, 9001 FROM listings WHERE user_id = 9001 AND marketplace_id = 3 AND deleted_at IS NULL
ON DUPLICATE KEY UPDATE assigned_by = VALUES(assigned_by);

INSERT INTO sales_leads (
  id, uuid, business_id, assigned_to, customer_user_id, listing_id, marketplace_id, source, status, title, expected_value, currency, country_id, created_by
)
SELECT 9701, 'f1111111-1111-4111-8111-111111111701', 9401, 9308, 9002, id, 3, 'seed', 'qualified',
       'Demo buyer interested in a vehicle listing', 2500000.00, 'PKR', 1, 9001
  FROM listings WHERE user_id = 9001 AND marketplace_id = 3 AND deleted_at IS NULL
 ORDER BY id LIMIT 1
ON DUPLICATE KEY UPDATE status = VALUES(status);

INSERT IGNORE INTO sales_targets (business_id, salesman_id, team_id, period_start, period_end, metric, target_value, currency)
VALUES (9401, 9308, 9601, DATE_FORMAT(CURRENT_DATE, '%Y-%m-01'), LAST_DAY(CURRENT_DATE), 'revenue', 5000000.00, 'PKR');
