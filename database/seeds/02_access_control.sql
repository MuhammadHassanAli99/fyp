-- =============================================================================
-- 02  Access control: roles, permissions, role grants, ABAC policies, badges
--     Satisfies spec §25 (RBAC + ABAC), §22 (Admin Panel actor roles),
--     §3 (Verified Badge / Trust Score badges).
--     `review_criteria` is NOT here: it carries an FK to `marketplaces`, so it
--     is seeded in 03_marketplaces.sql after the marketplace rows exist.
--     Re-runnable: reference rows use explicit ids, grants use INSERT IGNORE.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1. Roles. is_staff = reaches the admin panel; is_system = undeletable.
--    Seller-side roles mirror the §3 business kinds (dealer/agency/builder/
--    gold shop) so entitlements and badges can be driven off the role.
-- -----------------------------------------------------------------------------
INSERT INTO roles (id, code, name, description, is_staff, is_system) VALUES
  ( 1, 'user',           'User',            'Default role for every registered account',                  FALSE, TRUE),
  ( 2, 'seller',         'Seller',          'Individual posting listings for sale or rent',                FALSE, FALSE),
  ( 3, 'dealer',         'Dealer',          'Vehicle or gold dealer operating at volume',                  FALSE, FALSE),
  ( 4, 'agency',         'Agency',          'Real-estate agency with multiple agents',                     FALSE, FALSE),
  ( 5, 'builder',        'Builder',         'Developer selling new projects and off-plan units',           FALSE, FALSE),
  ( 6, 'gold_shop',      'Gold Shop',       'Licensed jeweller or bullion shop',                           FALSE, FALSE),
  ( 7, 'advertiser',     'Advertiser',      'Buys ad inventory without selling listings',                  FALSE, FALSE),
  ( 8, 'support_agent',  'Support Agent',   'Handles tickets and live chat (§29)',                         TRUE,  FALSE),
  ( 9, 'moderator',      'Moderator',       'Reviews listings, reviews and reports (§22 Moderation)',      TRUE,  FALSE),
  (10, 'fraud_analyst',  'Fraud Analyst',   'Works fraud cases and sanctions (§19)',                       TRUE,  FALSE),
  (11, 'finance',        'Finance',         'Payments, invoices, refunds and payouts (§22)',               TRUE,  FALSE),
  (12, 'content_manager','Content Manager', 'Taxonomy, translations, CMS and banners',                     TRUE,  FALSE),
  (13, 'admin',          'Administrator',   'Full operational access, no platform-config rights',          TRUE,  TRUE),
  (14, 'super_admin',    'Super Admin',     'Unrestricted: holds the wildcard permission',                 TRUE,  TRUE)
ON DUPLICATE KEY UPDATE
  code = VALUES(code), name = VALUES(name), description = VALUES(description),
  is_staff = VALUES(is_staff), is_system = VALUES(is_system);

-- -----------------------------------------------------------------------------
-- 2. Permission grid — one row per (resource, action). `view` is own-scope,
--    `view_any` is cross-tenant. Ids are pinned and grouped by resource so the
--    grants below stay readable and the grid can grow without renumbering.
-- -----------------------------------------------------------------------------
INSERT INTO permissions (id, code, resource, action, description) VALUES
  -- listing (§8 Listing System)
  (  1, 'listing.view',              'listing',      'view',      'View own listings'),
  (  2, 'listing.view_any',          'listing',      'view_any',  'View any listing regardless of owner or status'),
  (  3, 'listing.create',            'listing',      'create',    'Create a listing'),
  (  4, 'listing.update',            'listing',      'update',    'Edit a listing'),
  (  5, 'listing.delete',            'listing',      'delete',    'Delete or archive a listing'),
  (  6, 'listing.publish',           'listing',      'publish',   'Publish or renew a listing'),
  (  7, 'listing.moderate',          'listing',      'moderate',  'Act on a listing in the moderation queue'),
  (  8, 'listing.approve',           'listing',      'approve',   'Approve a pending listing'),
  (  9, 'listing.reject',            'listing',      'reject',    'Reject a pending listing'),
  ( 10, 'listing.export',            'listing',      'export',    'Export listings to CSV'),
  -- user (§22 User Management)
  ( 11, 'user.view',                 'user',         'view',      'View own profile'),
  ( 12, 'user.view_any',             'user',         'view_any',  'View any user profile'),
  ( 13, 'user.create',               'user',         'create',    'Create a user account'),
  ( 14, 'user.update',               'user',         'update',    'Edit a user account'),
  ( 15, 'user.delete',               'user',         'delete',    'Delete or anonymise a user account'),
  ( 16, 'user.suspend',              'user',         'suspend',   'Suspend a user account'),
  ( 17, 'user.ban',                  'user',         'ban',       'Permanently ban a user account'),
  ( 18, 'user.export',               'user',         'export',    'Export user data (GDPR §25)'),
  ( 19, 'user.manage',               'user',         'manage',    'Manage roles and entitlements of a user'),
  -- business (§3 Business profiles)
  ( 21, 'business.view',             'business',     'view',      'View own business profile'),
  ( 22, 'business.view_any',         'business',     'view_any',  'View any business profile'),
  ( 23, 'business.create',           'business',     'create',    'Create a business profile'),
  ( 24, 'business.update',           'business',     'update',    'Edit a business profile'),
  ( 25, 'business.delete',           'business',     'delete',    'Delete a business profile'),
  ( 26, 'business.approve',          'business',     'approve',   'Approve a business verification'),
  ( 27, 'business.reject',           'business',     'reject',    'Reject a business verification'),
  -- review (§20 Reviews)
  ( 31, 'review.view',               'review',       'view',      'View own reviews'),
  ( 32, 'review.view_any',           'review',       'view_any',  'View any review'),
  ( 33, 'review.create',             'review',       'create',    'Post a review'),
  ( 34, 'review.update',             'review',       'update',    'Edit a review'),
  ( 35, 'review.delete',             'review',       'delete',    'Delete a review'),
  ( 36, 'review.moderate',           'review',       'moderate',  'Act on a review in the moderation queue'),
  ( 37, 'review.approve',            'review',       'approve',   'Approve a pending review'),
  ( 38, 'review.reject',             'review',       'reject',    'Reject a pending review'),
  -- message (§12 Chat System)
  ( 41, 'message.view',              'message',      'view',      'View own conversations'),
  ( 42, 'message.view_any',          'message',      'view_any',  'View any conversation for investigation'),
  ( 43, 'message.delete',            'message',      'delete',    'Delete a message'),
  ( 44, 'message.moderate',          'message',      'moderate',  'Moderate reported chat content'),
  -- order / payment / invoice / refund (§17)
  ( 51, 'order.view',                'order',        'view',      'View own orders'),
  ( 52, 'order.view_any',            'order',        'view_any',  'View any order'),
  ( 53, 'order.create',              'order',        'create',    'Create an order'),
  ( 54, 'order.update',              'order',        'update',    'Amend an order'),
  ( 55, 'order.export',              'order',        'export',    'Export orders'),
  ( 56, 'payment.view',              'payment',      'view',      'View own payments'),
  ( 57, 'payment.view_any',          'payment',      'view_any',  'View any payment'),
  ( 58, 'payment.create',            'payment',      'create',    'Capture a payment'),
  ( 59, 'payment.update',            'payment',      'update',    'Reconcile or amend a payment'),
  ( 60, 'payment.export',            'payment',      'export',    'Export payments'),
  ( 61, 'invoice.view',              'invoice',      'view',      'View own invoices'),
  ( 62, 'invoice.view_any',          'invoice',      'view_any',  'View any invoice'),
  ( 63, 'invoice.create',            'invoice',      'create',    'Issue an invoice or credit note'),
  ( 64, 'invoice.export',            'invoice',      'export',    'Export invoices'),
  ( 65, 'refund.view',               'refund',       'view',      'View own refunds'),
  ( 66, 'refund.view_any',           'refund',       'view_any',  'View any refund'),
  ( 67, 'refund.create',             'refund',       'create',    'Request a refund'),
  ( 68, 'refund.approve',            'refund',       'approve',   'Approve a refund'),
  ( 69, 'refund.reject',             'refund',       'reject',    'Reject a refund'),
  -- subscription / plan / coupon (§16)
  ( 71, 'subscription.view',         'subscription', 'view',      'View own subscription'),
  ( 72, 'subscription.view_any',     'subscription', 'view_any',  'View any subscription'),
  ( 73, 'subscription.create',       'subscription', 'create',    'Start a subscription'),
  ( 74, 'subscription.update',       'subscription', 'update',    'Change plan, seats or renewal'),
  ( 75, 'subscription.delete',       'subscription', 'delete',    'Cancel a subscription immediately'),
  ( 76, 'subscription.manage',       'subscription', 'manage',    'Override entitlements and billing state'),
  ( 77, 'plan.view_any',             'plan',         'view_any',  'View all plans including private ones'),
  ( 78, 'plan.create',               'plan',         'create',    'Create a plan'),
  ( 79, 'plan.update',               'plan',         'update',    'Edit a plan or its prices'),
  ( 80, 'plan.delete',               'plan',         'delete',    'Retire a plan'),
  ( 81, 'plan.manage',               'plan',         'manage',    'Manage the full price book and entitlements'),
  ( 82, 'coupon.view_any',           'coupon',       'view_any',  'View all coupons'),
  ( 83, 'coupon.create',             'coupon',       'create',    'Create a coupon'),
  ( 84, 'coupon.update',             'coupon',       'update',    'Edit a coupon'),
  ( 85, 'coupon.delete',             'coupon',       'delete',    'Delete a coupon'),
  ( 86, 'coupon.manage',             'coupon',       'manage',    'Manage redemptions and overrides'),
  -- ad_campaign (§21 Advertisement System)
  ( 87, 'ad_campaign.view',          'ad_campaign',  'view',      'View own campaigns'),
  ( 88, 'ad_campaign.view_any',      'ad_campaign',  'view_any',  'View any campaign'),
  ( 89, 'ad_campaign.create',        'ad_campaign',  'create',    'Create a campaign'),
  ( 90, 'ad_campaign.update',        'ad_campaign',  'update',    'Edit a campaign or its budget'),
  ( 91, 'ad_campaign.delete',        'ad_campaign',  'delete',    'Delete a campaign'),
  ( 92, 'ad_campaign.approve',       'ad_campaign',  'approve',   'Approve creative for delivery'),
  ( 93, 'ad_campaign.reject',        'ad_campaign',  'reject',    'Reject creative'),
  -- taxonomy (§22 Category Management)
  ( 94, 'category.view_any',         'category',     'view_any',  'View the full category tree'),
  ( 95, 'category.create',           'category',     'create',    'Create a category'),
  ( 96, 'category.update',           'category',     'update',    'Edit a category'),
  ( 97, 'category.delete',           'category',     'delete',    'Delete a category'),
  ( 98, 'category.manage',           'category',     'manage',    'Reorder and restructure the tree'),
  ( 99, 'attribute.view_any',        'attribute',    'view_any',  'View all attributes'),
  (100, 'attribute.create',          'attribute',    'create',    'Create an attribute'),
  (101, 'attribute.update',          'attribute',    'update',    'Edit an attribute or its options'),
  (102, 'attribute.delete',          'attribute',    'delete',    'Delete an attribute'),
  (103, 'attribute.manage',          'attribute',    'manage',    'Bind attributes to categories'),
  -- platform configuration (§22 Country / Language / Currency Management)
  (104, 'marketplace.view_any',      'marketplace',  'view_any',  'View all marketplaces'),
  (105, 'marketplace.create',        'marketplace',  'create',    'Register a new marketplace module'),
  (106, 'marketplace.update',        'marketplace',  'update',    'Edit a marketplace'),
  (107, 'marketplace.manage',        'marketplace',  'manage',    'Toggle marketplaces and per-country launches'),
  (108, 'country.view_any',          'country',      'view_any',  'View all countries'),
  (109, 'country.create',            'country',      'create',    'Add a country'),
  (110, 'country.update',            'country',      'update',    'Edit a country'),
  (111, 'country.manage',            'country',      'manage',    'Manage regional regulations and tax rules'),
  (112, 'language.view_any',         'language',     'view_any',  'View all languages'),
  (113, 'language.create',           'language',     'create',    'Add a language'),
  (114, 'language.update',           'language',     'update',    'Edit a language'),
  (115, 'language.manage',           'language',     'manage',    'Enable, disable and reorder languages'),
  (116, 'currency.view_any',         'currency',     'view_any',  'View all currencies'),
  (117, 'currency.create',           'currency',     'create',    'Add a currency'),
  (118, 'currency.update',           'currency',     'update',    'Edit a currency'),
  (119, 'currency.manage',           'currency',     'manage',    'Manage FX providers and rates'),
  (120, 'translation.view_any',      'translation',  'view_any',  'View the translation catalogue'),
  (121, 'translation.create',        'translation',  'create',    'Add a translation key'),
  (122, 'translation.update',        'translation',  'update',    'Edit a translation'),
  (123, 'translation.manage',        'translation',  'manage',    'Bulk import and machine-translate'),
  -- moderation / reports (§22)
  (124, 'moderation.view',           'moderation',   'view',      'View assigned moderation items'),
  (125, 'moderation.view_any',       'moderation',   'view_any',  'View the whole moderation queue'),
  (126, 'moderation.moderate',       'moderation',   'moderate',  'Take a moderation action'),
  (127, 'moderation.approve',        'moderation',   'approve',   'Approve a queued item'),
  (128, 'moderation.reject',         'moderation',   'reject',    'Reject a queued item'),
  (129, 'report.view',               'report',       'view',      'View own submitted reports'),
  (130, 'report.view_any',           'report',       'view_any',  'View all user reports'),
  (131, 'report.moderate',           'report',       'moderate',  'Resolve a user report'),
  (132, 'report.export',             'report',       'export',    'Export reports'),
  -- fraud (§19 Fraud Prevention)
  (133, 'fraud_case.view',           'fraud_case',   'view',      'View assigned fraud cases'),
  (134, 'fraud_case.view_any',       'fraud_case',   'view_any',  'View all fraud cases'),
  (135, 'fraud_case.create',         'fraud_case',   'create',    'Open a fraud case'),
  (136, 'fraud_case.update',         'fraud_case',   'update',    'Work a fraud case'),
  (137, 'fraud_case.approve',        'fraud_case',   'approve',   'Confirm fraud and apply the action'),
  (138, 'fraud_case.reject',         'fraud_case',   'reject',    'Dismiss a fraud case as a false positive'),
  (139, 'sanction.view_any',         'sanction',     'view_any',  'View sanctions, blacklists and whitelists'),
  (140, 'sanction.create',           'sanction',     'create',    'Apply a sanction or blacklist entry'),
  (141, 'sanction.update',           'sanction',     'update',    'Amend a sanction'),
  (142, 'sanction.delete',           'sanction',     'delete',    'Lift a sanction'),
  (143, 'sanction.manage',           'sanction',     'manage',    'Manage sanction policies and thresholds'),
  -- support & content (§29, §22 CMS)
  (144, 'ticket.view',               'ticket',       'view',      'View own tickets'),
  (145, 'ticket.view_any',           'ticket',       'view_any',  'View all support tickets'),
  (146, 'ticket.create',             'ticket',       'create',    'Open a ticket'),
  (147, 'ticket.update',             'ticket',       'update',    'Reply to or reassign a ticket'),
  (148, 'ticket.delete',             'ticket',       'delete',    'Delete a ticket'),
  (149, 'ticket.manage',             'ticket',       'manage',    'Manage queues, SLAs and macros'),
  (150, 'kb_article.view',           'kb_article',   'view',      'Read published knowledge-base articles'),
  (151, 'kb_article.view_any',       'kb_article',   'view_any',  'View drafts and unpublished articles'),
  (152, 'kb_article.create',         'kb_article',   'create',    'Write a knowledge-base article'),
  (153, 'kb_article.update',         'kb_article',   'update',    'Edit a knowledge-base article'),
  (154, 'kb_article.delete',         'kb_article',   'delete',    'Delete a knowledge-base article'),
  (155, 'kb_article.publish',        'kb_article',   'publish',   'Publish a knowledge-base article'),
  (156, 'cms_page.view_any',         'cms_page',     'view_any',  'View all CMS pages'),
  (157, 'cms_page.create',           'cms_page',     'create',    'Create a CMS page'),
  (158, 'cms_page.update',           'cms_page',     'update',    'Edit a CMS page'),
  (159, 'cms_page.delete',           'cms_page',     'delete',    'Delete a CMS page'),
  (160, 'cms_page.publish',          'cms_page',     'publish',   'Publish a CMS page'),
  (161, 'banner.view_any',           'banner',       'view_any',  'View all banners'),
  (162, 'banner.create',             'banner',       'create',    'Create a banner'),
  (163, 'banner.update',             'banner',       'update',    'Edit a banner'),
  (164, 'banner.delete',             'banner',       'delete',    'Delete a banner'),
  (165, 'banner.publish',            'banner',       'publish',   'Schedule a banner live'),
  (166, 'notification.view_any',     'notification', 'view_any',  'View sent notifications and templates'),
  (167, 'notification.create',       'notification', 'create',    'Create a template or broadcast'),
  (168, 'notification.update',       'notification', 'update',    'Edit a template or broadcast'),
  (169, 'notification.delete',       'notification', 'delete',    'Delete a template or broadcast'),
  (170, 'notification.manage',       'notification', 'manage',    'Manage channels, categories and throttles'),
  -- analytics, audit, config (§24, §25)
  (171, 'analytics.view',            'analytics',    'view',      'View own dashboard (§23 Seller Dashboard)'),
  (172, 'analytics.view_any',        'analytics',    'view_any',  'View platform-wide analytics'),
  (173, 'analytics.export',          'analytics',    'export',    'Export analytics data'),
  (174, 'analytics.manage',          'analytics',    'manage',    'Manage dashboards and metric definitions'),
  (175, 'audit.view',                'audit',        'view',      'View audit entries for own account'),
  (176, 'audit.view_any',            'audit',        'view_any',  'View the full audit trail'),
  (177, 'audit.export',              'audit',        'export',    'Export the audit trail'),
  (178, 'setting.view_any',          'setting',      'view_any',  'View runtime settings'),
  (179, 'setting.update',            'setting',      'update',    'Change a runtime setting'),
  (180, 'setting.manage',            'setting',      'manage',    'Super-admin only: manage all platform settings'),
  (181, 'feature_flag.view_any',     'feature_flag', 'view_any',  'View feature flags'),
  (182, 'feature_flag.update',       'feature_flag', 'update',    'Change a flag rollout'),
  (183, 'feature_flag.manage',       'feature_flag', 'manage',    'Super-admin only: manage all feature flags'),
  -- AI, verification, money-out (§18, §3, §23)
  (184, 'ai.view_any',               'ai',           'view_any',  'View AI jobs, prompts and outputs'),
  (185, 'ai.create',                 'ai',           'create',    'Run an AI tool'),
  (186, 'ai.update',                 'ai',           'update',    'Edit prompts and model bindings'),
  (187, 'ai.manage',                 'ai',           'manage',    'Manage providers, budgets and guardrails'),
  (188, 'verification.view',         'verification', 'view',      'View own verification requests'),
  (189, 'verification.view_any',     'verification', 'view_any',  'View the verification queue'),
  (190, 'verification.approve',      'verification', 'approve',   'Approve an identity or business document'),
  (191, 'verification.reject',       'verification', 'reject',    'Reject an identity or business document'),
  (192, 'verification.manage',       'verification', 'manage',    'Manage document types and KYC levels'),
  (193, 'payout.view',               'payout',       'view',      'View own payouts'),
  (194, 'payout.view_any',           'payout',       'view_any',  'View all payouts'),
  (195, 'payout.create',             'payout',       'create',    'Request a payout'),
  (196, 'payout.approve',            'payout',       'approve',   'Approve a payout'),
  (197, 'payout.reject',             'payout',       'reject',    'Reject a payout'),
  (198, 'wallet.view',               'wallet',       'view',      'View own wallet'),
  (199, 'wallet.view_any',           'wallet',       'view_any',  'View any wallet'),
  (200, 'wallet.create',             'wallet',       'create',    'Top up or credit a wallet'),
  (201, 'wallet.update',             'wallet',       'update',    'Adjust a wallet balance'),
  (202, 'wallet.manage',             'wallet',       'manage',    'Manage wallet policy and holds'),
  -- Wildcard reserved for super_admin
  (999, '*',                         '*',            '*',         'Wildcard: grants every permission')
ON DUPLICATE KEY UPDATE
  code = VALUES(code), resource = VALUES(resource), action = VALUES(action),
  description = VALUES(description);

-- -----------------------------------------------------------------------------
-- 3. Role grants. Selected by permission code rather than hard-coded ids so a
--    renumbered grid cannot silently mis-grant. INSERT IGNORE on the composite
--    primary key keeps this re-runnable.
-- -----------------------------------------------------------------------------

-- 3a. user — own-scope basics for every signed-in account
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 1, p.id FROM permissions p WHERE p.code IN (
  'listing.view','listing.create','listing.update','listing.delete','listing.publish',
  'review.view','review.create','review.update','review.delete',
  'message.view','message.delete',
  'order.view','payment.view','invoice.view','refund.view','refund.create',
  'subscription.view','subscription.create','subscription.update',
  'ticket.view','ticket.create','ticket.update','kb_article.view',
  'business.view','business.create','business.update',
  'analytics.view','wallet.view','verification.view',
  'user.view','user.update','ai.create'
);

-- 3b. seller / dealer / agency / builder / gold_shop — user basics plus the
--     §23 Seller Dashboard surface (exports, promotions, payouts, campaigns)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN (
  'listing.view','listing.create','listing.update','listing.delete','listing.publish','listing.export',
  'review.view','review.create','review.update','review.delete',
  'message.view','message.delete',
  'order.view','payment.view','invoice.view','refund.view','refund.create',
  'subscription.view','subscription.create','subscription.update','subscription.delete',
  'ticket.view','ticket.create','ticket.update','kb_article.view',
  'business.view','business.create','business.update','business.delete',
  'ad_campaign.view','ad_campaign.create','ad_campaign.update','ad_campaign.delete',
  'analytics.view','analytics.export',
  'wallet.view','wallet.create','payout.view','payout.create',
  'verification.view','user.view','user.update','ai.create'
)
WHERE r.code IN ('seller','dealer','agency','builder','gold_shop');

-- 3c. advertiser — buys inventory (§21) but does not sell listings
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 7, p.id FROM permissions p WHERE p.code IN (
  'ad_campaign.view','ad_campaign.create','ad_campaign.update','ad_campaign.delete',
  'analytics.view','analytics.export',
  'order.view','payment.view','invoice.view','subscription.view','subscription.create',
  'listing.view','ticket.view','ticket.create','ticket.update','kb_article.view',
  'wallet.view','wallet.create','user.view','user.update','business.view','business.create','business.update'
);

-- 3d. support_agent — full ticket ownership plus read access to the context a
--     conversation needs (§29 Ticket System / Live Chat)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 8, p.id FROM permissions p WHERE p.code IN (
  'ticket.view','ticket.view_any','ticket.create','ticket.update','ticket.delete','ticket.manage',
  'user.view_any','listing.view_any','business.view_any','message.view_any',
  'order.view_any','payment.view_any','invoice.view_any','subscription.view_any',
  'verification.view_any','review.view_any','report.view_any',
  'kb_article.view','kb_article.view_any','analytics.view'
);

-- 3e. moderator — listing / review / message / report queues (§22 Moderation)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 9, p.id FROM permissions p WHERE p.code IN (
  'listing.view','listing.view_any','listing.moderate','listing.approve','listing.reject',
  'review.view','review.view_any','review.moderate','review.approve','review.reject',
  'message.view','message.view_any','message.moderate',
  'report.view','report.view_any','report.moderate',
  'moderation.view','moderation.view_any','moderation.moderate','moderation.approve','moderation.reject',
  'user.view_any','kb_article.view','ai.view_any'
);

-- 3f. fraud_analyst — cases, sanctions and the audit trail (§19)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 10, p.id FROM permissions p WHERE p.code IN (
  'fraud_case.view','fraud_case.view_any','fraud_case.create','fraud_case.update',
  'fraud_case.approve','fraud_case.reject',
  'sanction.view_any','sanction.create','sanction.update','sanction.delete','sanction.manage',
  'user.view_any','user.suspend','audit.view','audit.view_any','audit.export',
  'listing.view_any','review.view_any','message.view_any','report.view_any',
  'verification.view_any','payment.view_any','ai.view_any'
);

-- 3g. finance — the whole money surface (§17, §22 Payment Management)
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 11, p.id FROM permissions p WHERE p.code IN (
  'order.view','order.view_any','order.create','order.update','order.export',
  'payment.view','payment.view_any','payment.create','payment.update','payment.export',
  'invoice.view','invoice.view_any','invoice.create','invoice.export',
  'refund.view','refund.view_any','refund.create','refund.approve','refund.reject',
  'payout.view','payout.view_any','payout.create','payout.approve','payout.reject',
  'wallet.view','wallet.view_any','wallet.create','wallet.update','wallet.manage',
  'subscription.view','subscription.view_any','subscription.create','subscription.update',
  'subscription.delete','subscription.manage',
  'plan.view_any','plan.create','plan.update','plan.delete','plan.manage',
  'coupon.view_any','coupon.create','coupon.update','coupon.delete','coupon.manage',
  'user.view_any','analytics.view_any','analytics.export','audit.view_any'
);

-- 3h. content_manager — taxonomy, translations and everything published
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 12, p.id FROM permissions p WHERE p.code IN (
  'category.view_any','category.create','category.update','category.delete','category.manage',
  'attribute.view_any','attribute.create','attribute.update','attribute.delete','attribute.manage',
  'translation.view_any','translation.create','translation.update','translation.manage',
  'kb_article.view','kb_article.view_any','kb_article.create','kb_article.update',
  'kb_article.delete','kb_article.publish',
  'cms_page.view_any','cms_page.create','cms_page.update','cms_page.delete','cms_page.publish',
  'banner.view_any','banner.create','banner.update','banner.delete','banner.publish',
  'notification.view_any','notification.create','notification.update',
  'marketplace.view_any','country.view_any','language.view_any','currency.view_any',
  'listing.view_any','analytics.view'
);

-- 3i. admin — everything except the three super-admin-only capabilities
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 13, p.id FROM permissions p
WHERE p.code NOT IN ('*','setting.manage','feature_flag.manage','marketplace.manage');

-- 3j. super_admin — one wildcard row instead of 200 grants
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT 14, p.id FROM permissions p WHERE p.code = '*';

-- -----------------------------------------------------------------------------
-- 4. ABAC policies (§25 ABAC). The column is `condition_json` — `condition` is
--    reserved in MySQL 8. Lower `priority` is evaluated first, so a deny at 10
--    stops a listing being edited after it is sold, while the staff allow at 5
--    still lets support correct a sold listing.
-- -----------------------------------------------------------------------------
INSERT INTO access_policies (id, code, resource, action, effect, condition_json, priority, is_active, description) VALUES
  ( 1, 'listing.update.staff_override',  'listing',      'update',   'allow', '{"staff":true}',                                                        5, TRUE, 'Staff may edit a listing in any state'),
  ( 2, 'listing.update.deny_final',      'listing',      'update',   'deny',  '{"status":["sold","archived"]}',                                       10, TRUE, 'Nobody edits a sold or archived listing'),
  ( 3, 'listing.update.owner',           'listing',      'update',   'allow', '{"owner":true}',                                                       50, TRUE, 'Owner may edit their own listing'),
  ( 4, 'listing.update.permission',      'listing',      'update',   'allow', '{"permissions":["listing.update"]}',                                   60, TRUE, 'Holder of listing.update may edit'),
  ( 5, 'listing.delete.owner',           'listing',      'delete',   'allow', '{"owner":true,"status":["draft","rejected","expired","archived"]}',     50, TRUE, 'Owner may delete a listing that never went live or has ended'),
  ( 6, 'listing.publish.owner',          'listing',      'publish',  'allow', '{"owner":true}',                                                       50, TRUE, 'Owner may publish or renew their listing'),
  ( 7, 'listing.view.staff',             'listing',      'view',     'allow', '{"staff":true}',                                                       30, TRUE, 'Staff may view a listing in any state'),
  ( 8, 'listing.view.owner',             'listing',      'view',     'allow', '{"owner":true}',                                                       40, TRUE, 'Owner may view their own listing in any state'),
  ( 9, 'listing.view.published',         'listing',      'view',     'allow', '{"status":["published"]}',                                             50, TRUE, 'Anyone, including guests, may view a published listing'),
  (10, 'listing.moderate.permission',    'listing',      'moderate', 'allow', '{"permissions":["listing.moderate"]}',                                 50, TRUE, 'Moderators act on the listing queue'),
  (11, 'message.send.owner',             'message',      'send',     'allow', '{"owner":true}',                                                       50, TRUE, 'Only a participant may send into a conversation'),
  (12, 'conversation.view.owner',        'conversation', 'view',     'allow', '{"owner":true}',                                                       50, TRUE, 'Only a participant may read a conversation'),
  (13, 'review.create.trust_band',       'review',       'create',   'allow', '{"trustBand":["bronze","silver","gold","platinum"]}',                  50, TRUE, 'Brand-new accounts cannot review until they leave the new band'),
  (14, 'business.update.owner',          'business',     'update',   'allow', '{"owner":true}',                                                       50, TRUE, 'Business owner may edit their own profile'),
  (15, 'ai_tools.use.subscription_tier', 'ai_tools',     'use',      'allow', '{"subscriptionTier":["professional","business","enterprise"]}',         50, TRUE, 'AI tools are a paid entitlement (§16)')
ON DUPLICATE KEY UPDATE
  code = VALUES(code), resource = VALUES(resource), action = VALUES(action), effect = VALUES(effect),
  condition_json = VALUES(condition_json), priority = VALUES(priority),
  is_active = VALUES(is_active), description = VALUES(description);

-- -----------------------------------------------------------------------------
-- 5. Badges (§3 Verified Badge / Trust Score, §16 subscription badges).
--    `kind` tells the awarding job which signal grants the badge.
-- -----------------------------------------------------------------------------
INSERT INTO badges (id, code, name, description, icon, color, kind) VALUES
  ( 1, 'verified',         'Verified',          'Identity documents checked and approved',              'shield-check',   '#16A34A', 'verification'),
  ( 2, 'phone_verified',   'Phone Verified',    'Phone number confirmed by OTP',                        'phone-check',    '#0EA5E9', 'verification'),
  ( 3, 'email_verified',   'Email Verified',    'Email address confirmed',                              'mail-check',     '#0EA5E9', 'verification'),
  ( 4, 'id_verified',      'ID Verified',       'Government ID or passport verified',                   'id-card',        '#16A34A', 'verification'),
  ( 5, 'business_verified','Business Verified', 'Business licence and tax record verified',             'building-check', '#15803D', 'verification'),
  ( 6, 'premium',          'Premium',           'Active Professional subscription',                     'crown',          '#F59E0B', 'subscription'),
  ( 7, 'dealer',           'Dealer',            'Active Business subscription as a dealer',             'car-front',      '#7C3AED', 'subscription'),
  ( 8, 'agency',           'Agency',            'Active Enterprise subscription as an agency',          'briefcase',      '#4338CA', 'subscription'),
  ( 9, 'gold_shop',        'Gold Shop',         'Licensed jeweller or bullion dealer',                  'gem',            '#D4AF37', 'verification'),
  (10, 'builder',          'Builder',           'Verified property developer',                          'hard-hat',       '#EA580C', 'verification'),
  (11, 'top_seller',       'Top Seller',        'Top decile of completed sales this quarter',           'trophy',         '#F59E0B', 'performance'),
  (12, 'fast_responder',   'Fast Responder',    'Median first reply under 15 minutes',                  'zap',            '#0EA5E9', 'performance'),
  (13, 'trusted_seller',   'Trusted Seller',    'Rating above 4.5 across 20 or more reviews',           'heart-handshake', '#16A34A', 'performance'),
  (14, 'power_seller',     'Power Seller',      'Sustained high volume with no open disputes',          'flame',          '#DC2626', 'performance'),
  (15, 'veteran',          'Veteran',           'Account active for more than three years',            'medal',          '#64748B', 'tenure'),
  (16, 'early_adopter',    'Early Adopter',     'Joined during the launch window',                      'sparkles',       '#8B5CF6', 'tenure')
ON DUPLICATE KEY UPDATE
  code = VALUES(code), name = VALUES(name), description = VALUES(description),
  icon = VALUES(icon), color = VALUES(color), kind = VALUES(kind);
