-- =============================================================================
-- 23  Customer Support Platform catalogue (idempotent)
--     One shared support system for Gold, Property, Vehicles, payments,
--     subscriptions, listings, accounts, fraud, KYC, ads and technical.
--     No schema changes — uses 018_support_cms + 015 chatbot + 010/028 chat.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Departments live as category.auto_assign_team (not hardcoded in application).
-- Parent rows are departments; children are subcategories.
-- -----------------------------------------------------------------------------
INSERT INTO support_categories
  (code, name, description, parent_id, marketplace_id, default_priority,
   sla_first_response_minutes, sla_resolution_minutes, auto_assign_team, sort_order, is_active)
VALUES
  ('general',        'General Support',        'Anything that does not fit a specialist queue', NULL, NULL, 'normal', 240, 1440, 'general',        10, TRUE),
  ('billing',        'Billing',                'Invoices, tax, payout questions',               NULL, NULL, 'high',   120,  720, 'billing',        20, TRUE),
  ('payments',       'Payments',               'Charges, failed payments, refunds',             NULL, NULL, 'high',    60,  480, 'payments',       21, TRUE),
  ('subscriptions',  'Subscriptions',          'Plans, entitlements, renewals',                 NULL, NULL, 'normal', 180,  960, 'subscriptions',  22, TRUE),
  ('gold',           'Gold',                   'Certificates, hallmark, bullion listings',      NULL, 1,    'normal', 180,  960, 'gold',           30, TRUE),
  ('property',       'Property',               'Listings, viewings, verification',              NULL, 2,    'normal', 180, 1440, 'property',       31, TRUE),
  ('vehicles',       'Vehicles',               'VIN, import, dealer, inspection',               NULL, 3,    'normal', 180, 1440, 'vehicles',       32, TRUE),
  ('vehicle_parts',  'Vehicle Parts',          'OEM / aftermarket parts',                       NULL, 3,    'normal', 240, 1440, 'vehicle_parts',  33, TRUE),
  ('kyc',            'KYC',                    'Identity and business verification',            NULL, NULL, 'high',    60,  480, 'kyc',            40, TRUE),
  ('fraud',          'Fraud',                  'Scams, takeover, suspicious activity',          NULL, NULL, 'urgent',  30,  240, 'fraud',          41, TRUE),
  ('trust_safety',   'Trust & Safety',         'Abuse, sanctions, policy enforcement',          NULL, NULL, 'urgent',  30,  240, 'trust_safety',   42, TRUE),
  ('technical',      'Technical Support',      'App, web, performance, uploads',                NULL, NULL, 'normal', 240, 1440, 'technical',      50, TRUE),
  ('accounts',       'Account Support',        'Email, phone, access, recovery',                NULL, NULL, 'high',    60,  480, 'accounts',       51, TRUE),
  ('seller',         'Seller Support',         'Seller dashboard and listing ops',              NULL, NULL, 'normal', 180,  960, 'seller',         60, TRUE),
  ('dealer',         'Dealer Support',         'Vehicle dealers',                               NULL, 3,    'normal', 180,  960, 'dealer',         61, TRUE),
  ('agency',         'Agency Support',         'Property agencies',                             NULL, 2,    'normal', 180,  960, 'agency',         62, TRUE),
  ('advertising',    'Advertising',            'Campaigns, billing for ads',                    NULL, NULL, 'normal', 240, 1440, 'advertising',    70, TRUE),
  ('legal',          'Legal',                  'Legal holds, regulatory, DSAR',                 NULL, NULL, 'urgent',  60,  720, 'legal',          80, TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  default_priority = VALUES(default_priority),
  sla_first_response_minutes = VALUES(sla_first_response_minutes),
  sla_resolution_minutes = VALUES(sla_resolution_minutes),
  auto_assign_team = VALUES(auto_assign_team),
  is_active = VALUES(is_active);

INSERT INTO support_categories
  (code, name, description, parent_id, marketplace_id, default_priority, sla_first_response_minutes, sla_resolution_minutes, auto_assign_team, sort_order, is_active)
SELECT 'payments.refund', 'Refunds', 'Refund and chargeback disputes', id, NULL, 'urgent', 30, 240, 'payments', 1, TRUE
  FROM support_categories WHERE code = 'payments'
ON DUPLICATE KEY UPDATE name = VALUES(name), auto_assign_team = VALUES(auto_assign_team);

INSERT INTO support_categories
  (code, name, description, parent_id, marketplace_id, default_priority, sla_first_response_minutes, sla_resolution_minutes, auto_assign_team, sort_order, is_active)
SELECT 'gold.certificate', 'Gold certificates', 'Hallmark and certificate questions', id, 1, 'high', 120, 720, 'gold', 1, TRUE
  FROM support_categories WHERE code = 'gold'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO support_categories
  (code, name, description, parent_id, marketplace_id, default_priority, sla_first_response_minutes, sla_resolution_minutes, auto_assign_team, sort_order, is_active)
SELECT 'vehicles.import', 'Vehicle import', 'Import, customs, VIN', id, 3, 'high', 120, 960, 'vehicles', 1, TRUE
  FROM support_categories WHERE code = 'vehicles'
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO support_categories
  (code, name, description, parent_id, marketplace_id, default_priority, sla_first_response_minutes, sla_resolution_minutes, auto_assign_team, sort_order, is_active)
SELECT 'property.verification', 'Property verification', 'Ownership and listing checks', id, 2, 'high', 120, 960, 'property', 1, TRUE
  FROM support_categories WHERE code = 'property'
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- -----------------------------------------------------------------------------
-- Knowledge base — public approved content only (AI must not see staff runbooks)
-- -----------------------------------------------------------------------------
INSERT INTO kb_categories (code, name, description, parent_id, marketplace_id, sort_order, is_active)
VALUES
  ('payments', 'Payments', 'Paying, refunds and invoices', NULL, NULL, 10, TRUE),
  ('subscriptions', 'Subscriptions', 'Plans and entitlements', NULL, NULL, 11, TRUE),
  ('gold', 'Gold', 'Buying and selling gold', NULL, 1, 20, TRUE),
  ('property', 'Property', 'Homes, rentals and agencies', NULL, 2, 21, TRUE),
  ('vehicles', 'Vehicles', 'Cars, VIN and import', NULL, 3, 22, TRUE),
  ('accounts', 'Accounts', 'Sign-in, verification, privacy', NULL, NULL, 30, TRUE),
  ('security', 'Security', 'Devices, MFA, suspicious activity', NULL, NULL, 31, TRUE),
  ('listings', 'Listings', 'Posting, editing, promotions', NULL, NULL, 40, TRUE),
  ('fraud', 'Fraud & safety', 'Scams and reporting', NULL, NULL, 41, TRUE),
  ('kyc', 'Verification (KYC)', 'Identity and business checks', NULL, NULL, 42, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_active = VALUES(is_active);

INSERT INTO kb_articles
  (uuid, slug, category_id, title, excerpt, body, language, status, visibility, marketplace_id, tags, search_keywords, published_at)
SELECT * FROM (
  SELECT
    'a1111111-1111-4111-8111-111111111001' AS uuid,
    'how-payments-work' AS slug,
    (SELECT id FROM kb_categories WHERE code = 'payments') AS category_id,
    'How payments work' AS title,
    'Checkout is confirmed only after the payment provider or staff settles the order. The app never marks a payment successful by itself.' AS excerpt,
    'Payments are handled by one Payment Platform for Gold, Property and Vehicles.\n\n1. You create an order.\n2. The provider (card, wallet, bank transfer) authorises or records the attempt.\n3. The order status updates when the server receives a verified webhook or a staff confirmation for bank transfer.\n\nRefunds and chargebacks are handled by Billing / Payments support after account verification. The AI assistant cannot issue a refund.' AS body,
    'en' AS language, 'published' AS status, 'public' AS visibility, NULL AS marketplace_id,
    CAST('["payments","checkout"]' AS JSON) AS tags, 'payment checkout refund invoice' AS search_keywords, CURRENT_TIMESTAMP AS published_at
  UNION ALL SELECT
    'a1111111-1111-4111-8111-111111111002', 'subscription-plans',
    (SELECT id FROM kb_categories WHERE code = 'subscriptions'),
    'Subscription plans',
    'Features are gated by entitlement codes such as ai_tools or active_listings, never by hard-coded plan names in the app.',
    'Plans range from Free to Enterprise. Priority support shortens first-response SLA. Dedicated support is an Enterprise entitlement. Cancel and resume from Profile → Subscription. Billing questions belong on a Payments ticket.',
    'en', 'published', 'public', NULL, CAST('["subscriptions"]' AS JSON), 'plan quota entitlement priority support', CURRENT_TIMESTAMP
  UNION ALL SELECT
    'a1111111-1111-4111-8111-111111111003', 'gold-certificates',
    (SELECT id FROM kb_categories WHERE code = 'gold'),
    'Gold certificates and hallmarks',
    'Listings can attach certificate documents. Authenticity tools are risk-support only and never prove physical gold is genuine.',
    'When buying gold, check weight, karat, hallmark photos and any certificate the seller uploaded. Report suspected fake gold from the listing using Help & Support (category Gold). Do not complete the deal off-platform.',
    'en', 'published', 'public', 1, CAST('["gold","certificate"]' AS JSON), 'gold hallmark karat certificate fake', CURRENT_TIMESTAMP
  UNION ALL SELECT
    'a1111111-1111-4111-8111-111111111004', 'property-verification',
    (SELECT id FROM kb_categories WHERE code = 'property'),
    'Property listing verification',
    'Property documents are reviewed before some listings go live. Viewings stay on the listing record.',
    'Sellers upload ownership or agency documents during posting. Buyers should use in-app chat and viewing requests. Report a listing from the listing page if documents look wrong. Verification teams handle the Property verification queue.',
    'en', 'published', 'public', 2, CAST('["property"]' AS JSON), 'property documents viewing agency', CURRENT_TIMESTAMP
  UNION ALL SELECT
    'a1111111-1111-4111-8111-111111111005', 'vehicle-vin-import',
    (SELECT id FROM kb_categories WHERE code = 'vehicles'),
    'Vehicle VIN and import',
    'VIN checks use ISO 3779 structure. Import and customs are specialist queues, not a chatbot decision.',
    'Enter the VIN on the vehicle listing when available. Import, duties and logistics are handled by Vehicle specialists after you open a ticket from the listing. Never send passport scans in public chat.',
    'en', 'published', 'public', 3, CAST('["vehicles","vin"]' AS JSON), 'vin import customs dealer inspection', CURRENT_TIMESTAMP
  UNION ALL SELECT
    'a1111111-1111-4111-8111-111111111006', 'account-security',
    (SELECT id FROM kb_categories WHERE code = 'security'),
    'Account security and recovery',
    'Support cannot reset your password or change email just because someone asks in chat. Use in-app recovery and MFA.',
    'If you suspect account takeover, use Security → Devices, change your password, and open a Fraud ticket. Agents must verify the account owner. The AI assistant will escalate takeover, KYC and AML issues instead of acting.',
    'en', 'published', 'public', NULL, CAST('["security","account"]' AS JSON), 'password mfa takeover hacked devices', CURRENT_TIMESTAMP
  UNION ALL SELECT
    'a1111111-1111-4111-8111-111111111007', 'report-fraud',
    (SELECT id FROM kb_categories WHERE code = 'fraud'),
    'How to report fraud',
    'Report listings, chats and payments from the related screen so the ticket keeps context.',
    'Use Help & Support on the listing, payment, or conversation. Trust & Safety reviews fraud reports. Ordinary agents do not see raw fraud scores. Never pay off-platform or by gift card.',
    'en', 'published', 'public', NULL, CAST('["fraud"]' AS JSON), 'scam phishing fake seller report', CURRENT_TIMESTAMP
  UNION ALL SELECT
    'a1111111-1111-4111-8111-111111111008', 'kyc-verification',
    (SELECT id FROM kb_categories WHERE code = 'kyc'),
    'Identity verification (KYC)',
    'Upload documents in Profile → Verification. Support cannot bypass KYC from chat.',
    'Verification status is decided by the verification team. If a document is rejected, the reason is shown on the verification screen. Open a KYC ticket only after you have uploaded a clearer document.',
    'en', 'published', 'logged_in', NULL, CAST('["kyc"]' AS JSON), 'kyc identity passport document', CURRENT_TIMESTAMP
) AS seed
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  excerpt = VALUES(excerpt),
  body = VALUES(body),
  status = VALUES(status),
  visibility = VALUES(visibility),
  published_at = VALUES(published_at);

UPDATE kb_categories c
   SET article_count = (SELECT COUNT(*) FROM kb_articles a WHERE a.category_id = c.id AND a.status = 'published');

-- FAQs have no unique key; delete the seed questions then insert.
DELETE FROM faqs WHERE question IN (
  'How do I contact a human agent?',
  'Can the chatbot refund me?',
  'Where is live chat?',
  'Is the community forum official support?'
);

INSERT INTO faqs (question, answer, category_id, marketplace_id, language, sort_order, is_active)
SELECT q.question, q.answer, c.id, q.marketplace_id, 'en', q.sort_order, TRUE
FROM (
  SELECT 'How do I contact a human agent?' AS question,
         'Open Help & Support from Profile, a listing, a payment or a subscription. Sensitive issues skip the bot and become a ticket.' AS answer,
         'accounts' AS cat, NULL AS marketplace_id, 1 AS sort_order
  UNION ALL SELECT 'Can the chatbot refund me?',
         'No. Refunds require a verified Payments ticket. The assistant will escalate instead of promising money back.',
         'payments', NULL, 2
  UNION ALL SELECT 'Where is live chat?',
         'Help & Support → Live chat reuses the existing conversation system (type support) and links the thread to your ticket.',
         'accounts', NULL, 3
  UNION ALL SELECT 'Is the community forum official support?',
         'No. The forum is community discussion with moderation. Official cases stay on tickets.',
         'accounts', NULL, 4
) q
JOIN kb_categories c ON c.code = q.cat;

-- -----------------------------------------------------------------------------
-- Community forum (separate from tickets)
-- -----------------------------------------------------------------------------
INSERT INTO forum_categories (code, name, description, marketplace_id, is_moderated, min_trust_band, sort_order, is_active)
VALUES
  ('general', 'General', 'Marketplace talk that is not a private ticket', NULL, TRUE, 'new', 10, TRUE),
  ('gold', 'Gold', 'Hallmarks, making, local markets', 1, TRUE, 'new', 20, TRUE),
  ('property', 'Property', 'Buying, renting, neighbourhoods', 2, TRUE, 'bronze', 21, TRUE),
  ('vehicles', 'Vehicles', 'Reviews, import stories, parts', 3, TRUE, 'new', 22, TRUE),
  ('announcements', 'Announcements', 'Official posts only', NULL, TRUE, 'platinum', 1, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- Canned replies + agent roster (demo support.agent@aurelia.test = 9306)
-- -----------------------------------------------------------------------------
INSERT INTO support_canned_responses (category_id, code, title, body, language, is_active)
SELECT id, 'ack.received', 'We received your request',
       'Thanks, we have your request. A specialist in this queue will reply within the SLA for your plan.',
       'en', TRUE
  FROM support_categories WHERE code = 'general' LIMIT 1
ON DUPLICATE KEY UPDATE body = VALUES(body);

INSERT INTO support_canned_responses (category_id, code, title, body, language, is_active)
SELECT id, 'verify.account', 'Need verification',
       'For payments or account changes we must verify the account owner. Please complete the in-app verification step. We cannot bypass this in chat.',
       'en', TRUE
  FROM support_categories WHERE code = 'accounts' LIMIT 1
ON DUPLICATE KEY UPDATE body = VALUES(body);

INSERT INTO support_agents (user_id, display_name, teams, languages, marketplaces, max_concurrent_tickets, status, is_active)
SELECT u.id, 'Support Agent',
       CAST('["general","billing","payments","gold","property","vehicles","technical","accounts"]' AS JSON),
       CAST('["en","ar","ur"]' AS JSON),
       CAST('[1,2,3]' AS JSON),
       30, 'available', TRUE
  FROM users u WHERE u.email = 'support.agent@aurelia.test'
ON DUPLICATE KEY UPDATE
  teams = VALUES(teams), languages = VALUES(languages), marketplaces = VALUES(marketplaces),
  status = VALUES(status), is_active = VALUES(is_active);

INSERT INTO support_agents (user_id, display_name, teams, languages, marketplaces, max_concurrent_tickets, status, is_active)
SELECT u.id, 'Support Admin',
       CAST('["general","billing","payments","gold","property","vehicles","kyc","fraud","trust_safety","legal","technical","accounts"]' AS JSON),
       CAST('["en"]' AS JSON),
       CAST('[1,2,3]' AS JSON),
       50, 'available', TRUE
  FROM users u WHERE u.email = 'super.admin@aurelia.test'
ON DUPLICATE KEY UPDATE teams = VALUES(teams), status = VALUES(status), is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- Notifications — reuse Notification Platform, do not add a second bus
-- -----------------------------------------------------------------------------
INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, policy_group, marketplace_scope, sort_order, is_active)
VALUES
  ('support.ticket_created',   'Ticket created',     'A support ticket was opened',           'support', TRUE, TRUE,  FALSE, TRUE, TRUE,  'SYSTEM', 'GENERAL', 80, TRUE),
  ('support.agent_assigned',   'Agent assigned',     'A ticket was assigned to an agent',     'support', TRUE, FALSE, FALSE, TRUE, TRUE,  'SYSTEM', 'GENERAL', 81, TRUE),
  ('support.agent_replied',    'Agent replied',      'Support replied to a ticket',           'support', TRUE, TRUE,  FALSE, TRUE, TRUE,  'SYSTEM', 'GENERAL', 82, TRUE),
  ('support.customer_replied', 'Customer replied',   'The customer replied on a ticket',      'support', TRUE, FALSE, FALSE, TRUE, TRUE,  'SYSTEM', 'GENERAL', 83, TRUE),
  ('support.ticket_resolved',  'Ticket resolved',    'A ticket was marked resolved',          'support', TRUE, TRUE,  FALSE, TRUE, TRUE,  'SYSTEM', 'GENERAL', 84, TRUE),
  ('support.ticket_reopened',  'Ticket reopened',    'A ticket was reopened',                 'support', TRUE, TRUE,  FALSE, TRUE, TRUE,  'SYSTEM', 'GENERAL', 85, TRUE),
  ('support.sla_warning',      'SLA warning',        'A ticket is breaching its SLA',         'support', TRUE, TRUE,  FALSE, TRUE, TRUE,  'SYSTEM', 'GENERAL', 86, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), is_active = VALUES(is_active);

INSERT INTO notification_templates
  (category_code, channel, language, subject, title, body, action_url, variables, is_active, version)
VALUES
  ('support.ticket_created',   'in_app', 'en', NULL, 'Support ticket opened', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.ticket_created',   'push',   'en', NULL, 'Support ticket opened', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.ticket_created',   'email',  'en', 'Support ticket opened', 'Support ticket opened', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.agent_assigned',   'in_app', 'en', NULL, 'Ticket assigned', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.agent_assigned',   'push',   'en', NULL, 'Ticket assigned', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.agent_replied',    'in_app', 'en', NULL, 'Support replied', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.agent_replied',    'push',   'en', NULL, 'Support replied', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.agent_replied',    'email',  'en', 'Support replied', 'Support replied', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.customer_replied', 'in_app', 'en', NULL, 'Customer replied', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.ticket_resolved',  'in_app', 'en', NULL, 'Ticket resolved', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.ticket_resolved',  'push',   'en', NULL, 'Ticket resolved', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.ticket_reopened',  'in_app', 'en', NULL, 'Ticket reopened', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.sla_warning',      'in_app', 'en', NULL, 'SLA warning', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1),
  ('support.sla_warning',      'push',   'en', NULL, 'SLA warning', '{{body}}', '/support/tickets/{{entityId}}', '["body","entityId"]', TRUE, 1)
ON DUPLICATE KEY UPDATE body = VALUES(body), action_url = VALUES(action_url), is_active = VALUES(is_active);

INSERT INTO scheduled_jobs (code, name, cron, is_enabled)
VALUES
  ('tickets.autoclose', 'Auto-close resolved tickets after 7 days', '0 * * * *', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_enabled = VALUES(is_enabled);
