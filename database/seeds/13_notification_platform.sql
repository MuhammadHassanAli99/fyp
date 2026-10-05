-- =============================================================================
-- 13  Notification Platform catalogue (idempotent)
--     Policy groups, security/account/payment categories, multilingual templates,
--     jobs, optional premium alert entitlement.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Backfill policy + marketplace on existing catalogue rows.
-- -----------------------------------------------------------------------------
UPDATE notification_categories SET policy_group = 'SECURITY', marketplace_scope = 'GENERAL'
 WHERE code LIKE 'auth.%' OR code LIKE 'security.%' OR code LIKE 'account.%' OR group_code IN ('account','security');

UPDATE notification_categories SET policy_group = 'TRANSACTIONAL', marketplace_scope = 'GENERAL'
 WHERE is_transactional = 1 AND policy_group = 'MARKETPLACE';

UPDATE notification_categories SET policy_group = 'SOCIAL', marketplace_scope = 'GENERAL'
 WHERE group_code IN ('chat','social');

UPDATE notification_categories SET policy_group = 'MARKETPLACE', marketplace_scope = 'GOLD'
 WHERE group_code = 'gold';

UPDATE notification_categories SET policy_group = 'MARKETPLACE', marketplace_scope = 'PROPERTY'
 WHERE group_code = 'property';

UPDATE notification_categories SET policy_group = 'MARKETPLACE', marketplace_scope = 'VEHICLE'
 WHERE group_code IN ('vehicles','vehicle');

UPDATE notification_categories SET policy_group = 'MARKETPLACE', marketplace_scope = 'GENERAL'
 WHERE group_code IN ('listings','search');

UPDATE notification_categories SET policy_group = 'SYSTEM', marketplace_scope = 'GENERAL'
 WHERE group_code IN ('system','support');

UPDATE notifications n
  JOIN notification_categories c ON c.code = n.category_code
   SET n.marketplace = c.marketplace_scope
 WHERE n.marketplace = 'GENERAL' AND c.marketplace_scope <> 'GENERAL';

-- -----------------------------------------------------------------------------
-- Shared account / money / trust categories. Marketplace events already seeded
-- by gold/property/vehicle/listing/search/chat seeds.
-- -----------------------------------------------------------------------------
INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, policy_group, marketplace_scope, sort_order, is_active)
VALUES
  ('account.welcome',            'Welcome',                 'Welcome after registration',                    'account', TRUE,  TRUE,  FALSE, TRUE, FALSE, 'SYSTEM',         'GENERAL', 10, TRUE),
  ('account.email_verified',     'Email verified',          'Email address confirmed',                       'account', TRUE,  TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 11, TRUE),
  ('account.phone_verified',     'Phone verified',          'Phone number confirmed',                        'account', TRUE,  FALSE, TRUE,  TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 12, TRUE),
  ('account.password_changed',   'Password changed',        'Password was changed',                          'account', TRUE,  TRUE,  TRUE,  TRUE, TRUE,  'SECURITY',       'GENERAL', 13, TRUE),
  ('security.new_device',        'New device',              'A new device signed in',                        'security', TRUE, TRUE,  TRUE,  TRUE, TRUE,  'SECURITY',       'GENERAL', 14, TRUE),
  ('security.login',             'New sign-in',             'A sign-in from a recognised device',            'security', TRUE, FALSE, FALSE, TRUE, TRUE,  'SECURITY',       'GENERAL', 15, TRUE),
  ('security.suspicious_login',  'Suspicious sign-in',      'Unusual account activity',                      'security', TRUE, TRUE,  TRUE,  TRUE, TRUE,  'SECURITY',       'GENERAL', 16, TRUE),
  ('security.mfa',               'Multi-factor',            'MFA challenge or recovery',                     'security', TRUE, TRUE,  TRUE,  TRUE, TRUE,  'SECURITY',       'GENERAL', 17, TRUE),
  ('security.fraud',             'Security alert',          'Account protection alert (no internal scores)', 'security', TRUE, TRUE,  TRUE,  TRUE, TRUE,  'SECURITY',       'GENERAL', 18, TRUE),
  ('payment.succeeded',          'Payment received',        'A payment succeeded',                           'billing', TRUE,  TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 20, TRUE),
  ('payment.failed',             'Payment failed',          'A payment could not be completed',              'billing', TRUE,  TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 21, TRUE),
  ('payment.refund',             'Refund issued',           'A refund was issued',                           'billing', TRUE,  TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 22, TRUE),
  ('payment.invoice',            'Invoice',                 'An invoice is available',                       'billing', FALSE, TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 23, TRUE),
  ('subscription.started',       'Subscription started',    'A plan became active',                          'billing', TRUE,  TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 24, TRUE),
  ('subscription.renewed',       'Subscription renewed',    'A plan renewed',                                'billing', TRUE,  TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 25, TRUE),
  ('subscription.cancelled',     'Subscription cancelled',  'A plan was cancelled',                          'billing', TRUE,  TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 26, TRUE),
  ('subscription.expired',       'Subscription expired',    'A plan expired',                                'billing', TRUE,  TRUE,  FALSE, TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 27, TRUE),
  ('subscription.expiring',      'Subscription expiring',   'A plan will expire soon',                       'billing', TRUE,  TRUE,  FALSE, TRUE, FALSE, 'TRANSACTIONAL',  'GENERAL', 28, TRUE),
  ('subscription.payment_failed','Subscription payment',    'A subscription charge failed',                  'billing', TRUE,  TRUE,  TRUE,  TRUE, TRUE,  'TRANSACTIONAL',  'GENERAL', 29, TRUE),
  ('review.published',           'New review',              'Someone reviewed you or a listing',             'social',  TRUE,  FALSE, FALSE, TRUE, FALSE, 'SOCIAL',         'GENERAL', 30, TRUE),
  ('favorite.added',             'Listing liked',           'Someone saved your listing',                    'social',  TRUE,  FALSE, FALSE, TRUE, FALSE, 'SOCIAL',         'GENERAL', 31, TRUE),
  ('system.announcement',        'Announcement',            'Platform announcement',                         'system',  TRUE,  TRUE,  FALSE, TRUE, FALSE, 'SYSTEM',         'GENERAL', 5,  TRUE),
  ('system.sync',                'Background sync',         'Silent cache / unread refresh',                 'system',  TRUE,  FALSE, FALSE, FALSE,FALSE, 'SYSTEM',         'GENERAL', 6,  TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  policy_group = VALUES(policy_group),
  marketplace_scope = VALUES(marketplace_scope),
  is_active = VALUES(is_active);

-- -----------------------------------------------------------------------------
-- English templates (v1). Other languages fall back to en in the renderer.
-- Variables are declared so the renderer can refuse unknown placeholders.
-- -----------------------------------------------------------------------------
INSERT INTO notification_templates
  (category_code, channel, language, subject, title, body, action_url, variables, is_active, version)
VALUES
  ('security.new_device',       'in_app', 'en', NULL, 'New device signed in', 'A new device was used to access your account. If this was not you, change your password.', '/security/devices', '["deviceName"]', TRUE, 1),
  ('security.new_device',       'push',   'en', NULL, 'New device signed in', 'A new device was used to access your account.', '/security/devices', '["deviceName"]', TRUE, 1),
  ('security.new_device',       'email',  'en', 'New device signed in', 'New device signed in', 'A new device was used to access your account. If this was not you, change your password immediately.', '/security/devices', '["deviceName"]', TRUE, 1),
  ('security.new_device',       'sms',    'en', NULL, NULL, 'A new device signed in to your {{appName}} account. If this was not you, change your password.', NULL, '["appName"]', TRUE, 1),
  ('security.suspicious_login', 'in_app', 'en', NULL, 'Unusual sign-in activity', 'We noticed unusual activity on your account. Review your devices.', '/security/devices', '[]', TRUE, 1),
  ('security.suspicious_login', 'push',   'en', NULL, 'Unusual sign-in activity', 'Review your recent account activity.', '/security/devices', '[]', TRUE, 1),
  ('security.suspicious_login', 'email',  'en', 'Unusual sign-in activity', 'Unusual sign-in activity', 'We noticed unusual activity on your account. Review your devices and change your password if needed.', '/security/devices', '[]', TRUE, 1),
  ('security.suspicious_login', 'sms',    'en', NULL, NULL, 'Unusual activity on your {{appName}} account. Review your devices if this was not you.', NULL, '["appName"]', TRUE, 1),
  ('security.fraud',            'in_app', 'en', NULL, 'Security alert', 'We took extra steps to protect your account. Review recent activity.', '/security/devices', '[]', TRUE, 1),
  ('security.fraud',            'push',   'en', NULL, 'Security alert', 'Review recent activity on your account.', '/security/devices', '[]', TRUE, 1),
  ('security.fraud',            'email',  'en', 'Security alert', 'Security alert', 'We took extra steps to protect your account. Review recent activity and contact support if you did not take this action.', '/security/devices', '[]', TRUE, 1),
  ('account.password_changed',  'in_app', 'en', NULL, 'Password changed', 'Your password was changed. If this was not you, reset it now.', '/security/devices', '[]', TRUE, 1),
  ('account.password_changed',  'email',  'en', 'Your password was changed', 'Password changed', 'Your password was changed. If this was not you, reset it immediately.', '/login', '[]', TRUE, 1),
  ('account.welcome',           'in_app', 'en', NULL, 'Welcome to {{appName}}', 'Your account is ready. Choose Gold, Property or Vehicles to get started.', '/marketplace', '["appName"]', TRUE, 1),
  ('account.welcome',           'email',  'en', 'Welcome to {{appName}}', 'Welcome', 'Your account is ready. Choose Gold, Property or Vehicles to get started.', '/marketplace', '["appName"]', TRUE, 1),
  ('account.email_verified',    'in_app', 'en', NULL, 'Email verified', 'Your email address is confirmed.', '/profile', '[]', TRUE, 1),
  ('account.phone_verified',    'in_app', 'en', NULL, 'Phone verified', 'Your phone number is confirmed.', '/profile', '[]', TRUE, 1),
  ('payment.succeeded',         'in_app', 'en', NULL, 'Payment received', '{{amount}} {{currency}} was received.', '/listing/{{listingId}}', '["amount","currency","listingId"]', TRUE, 1),
  ('payment.succeeded',         'email',  'en', 'Payment received', 'Payment received', '{{amount}} {{currency}} was received.', NULL, '["amount","currency"]', TRUE, 1),
  ('payment.failed',            'in_app', 'en', NULL, 'Payment failed', 'A payment could not be completed. You can retry from the order.', NULL, '["reason"]', TRUE, 1),
  ('payment.failed',            'email',  'en', 'Payment failed', 'Payment failed', 'A payment could not be completed.', NULL, '[]', TRUE, 1),
  ('payment.refund',            'in_app', 'en', NULL, 'Refund issued', '{{amount}} {{currency}} was refunded.', NULL, '["amount","currency"]', TRUE, 1),
  ('payment.invoice',           'email',  'en', 'Your invoice', 'Invoice', 'An invoice for {{amount}} {{currency}} is available in your account.', NULL, '["amount","currency"]', TRUE, 1),
  ('subscription.started',      'in_app', 'en', NULL, 'Plan activated', '{{planCode}} is now active.', '/profile', '["planCode"]', TRUE, 1),
  ('subscription.renewed',      'in_app', 'en', NULL, 'Plan renewed', '{{planCode}} renewed until {{periodEnd}}.', '/profile', '["planCode","periodEnd"]', TRUE, 1),
  ('subscription.cancelled',    'in_app', 'en', NULL, 'Plan cancelled', '{{planCode}} will end on {{endsAt}}.', '/profile', '["planCode","endsAt"]', TRUE, 1),
  ('subscription.expired',      'in_app', 'en', NULL, 'Plan expired', '{{planCode}} has expired.', '/profile', '["planCode"]', TRUE, 1),
  ('subscription.expiring',     'in_app', 'en', NULL, 'Plan ending soon', '{{planCode}} expires on {{endsAt}}.', '/profile', '["planCode","endsAt"]', TRUE, 1),
  ('subscription.payment_failed','in_app','en', NULL, 'Subscription payment failed', 'Update your payment method to keep {{planCode}}.', '/profile', '["planCode"]', TRUE, 1),
  ('review.published',          'in_app', 'en', NULL, 'New review', 'You received a new review.', '/profile', '["rating"]', TRUE, 1),
  ('favorite.added',            'in_app', 'en', NULL, 'Someone saved your listing', '{{count}} people saved your listing.', '/listing/{{listingId}}', '["count","listingId"]', TRUE, 1),
  ('favorite.added',            'push',   'en', NULL, 'Someone saved your listing', '{{count}} people saved your listing.', '/listing/{{listingId}}', '["count","listingId"]', TRUE, 1),
  ('listing.price_changed',     'push',   'en', NULL, 'Price changed', '{{title}} is now {{price}} {{currency}}.', '/listing/{{listingId}}', '["title","price","currency","listingId"]', TRUE, 1),
  ('chat.message',              'silent', 'en', NULL, NULL, 'sync', '/chat/{{conversationUuid}}', '["conversationUuid"]', TRUE, 1),
  ('system.sync',               'silent', 'en', NULL, NULL, 'sync', NULL, '["kind"]', TRUE, 1),
  ('system.announcement',       'in_app', 'en', NULL, '{{title}}', '{{body}}', NULL, '["title","body"]', TRUE, 1),
  ('gold.price.alert',          'push',   'en', NULL, 'Gold price alert', 'Gold rates were updated.', '/home', '[]', TRUE, 1),
  ('property.search',           'push',   'en', NULL, 'New matching property', '{{title}} matches your saved search.', '/listing/{{listingId}}', '["title","listingId"]', TRUE, 1),
  ('vehicle.search',            'push',   'en', NULL, 'New matching vehicle', '{{title}} matches your saved search.', '/listing/{{listingId}}', '["title","listingId"]', TRUE, 1)
ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), subject = VALUES(subject), is_active = VALUES(is_active);

-- Arabic (security + transactional core)
INSERT INTO notification_templates
  (category_code, channel, language, subject, title, body, action_url, variables, is_active, version)
VALUES
  ('security.new_device', 'in_app', 'ar', NULL, 'جهاز جديد', 'تم تسجيل الدخول من جهاز جديد. إذا لم يكن أنت فغيّر كلمة المرور.', '/security/devices', '["deviceName"]', TRUE, 1),
  ('security.new_device', 'push',   'ar', NULL, 'جهاز جديد', 'تم تسجيل الدخول من جهاز جديد.', '/security/devices', '["deviceName"]', TRUE, 1),
  ('security.new_device', 'email',  'ar', 'جهاز جديد', 'جهاز جديد', 'تم تسجيل الدخول من جهاز جديد. إذا لم يكن أنت فغيّر كلمة المرور فوراً.', '/security/devices', '["deviceName"]', TRUE, 1),
  ('account.welcome',     'in_app', 'ar', NULL, 'مرحباً بك في {{appName}}', 'حسابك جاهز. اختر الذهب أو العقار أو المركبات للبدء.', '/marketplace', '["appName"]', TRUE, 1)
ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), is_active = VALUES(is_active);

INSERT INTO notification_templates
  (category_code, channel, language, subject, title, body, action_url, variables, is_active, version)
VALUES
  ('security.new_device', 'in_app', 'ur', NULL, 'نیا آلہ', 'آپ کے اکاؤنٹ میں نئے آلے سے لاگ ان ہوا۔ اگر یہ آپ نہیں تھے تو پاس ورڈ تبدیل کریں۔', '/security/devices', '["deviceName"]', TRUE, 1),
  ('security.new_device', 'push',   'ur', NULL, 'نیا آلہ', 'آپ کے اکاؤنٹ میں نئے آلے سے لاگ ان ہوا۔', '/security/devices', '["deviceName"]', TRUE, 1)
ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), is_active = VALUES(is_active);

INSERT INTO features (code, name, description, unit, is_metered, reset_period, sort_order) VALUES
  ('instant_marketplace_alerts', 'Instant marketplace alerts', 'Instant saved-search and price-drop pushes (digest always available)', 'boolean', FALSE, 'none', 60),
  ('notification_email_digest',  'Email notification digest',  'Daily/weekly email digest of marketplace alerts', 'boolean', FALSE, 'none', 61)
ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description);

INSERT INTO plan_features (plan_id, feature_code, limit_value, is_unlimited, is_enabled) VALUES
  (1, 'instant_marketplace_alerts', NULL, FALSE, FALSE),
  (1, 'notification_email_digest',  NULL, FALSE, TRUE),
  (2, 'instant_marketplace_alerts', NULL, FALSE, TRUE),
  (2, 'notification_email_digest',  NULL, FALSE, TRUE)
ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled);

INSERT INTO scheduled_jobs (code, name, cron, is_enabled) VALUES
  ('notifications.deliver',     'Process notification channel jobs',     '* * * * *', TRUE),
  ('notifications.scheduled',   'Dispatch due scheduled notifications',  '* * * * *', TRUE),
  ('notifications.digest',      'Flush batched notification digests',    '0 * * * *', TRUE),
  ('notifications.metrics',     'Roll up notification delivery metrics', '5 * * * *', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), cron = VALUES(cron), is_enabled = VALUES(is_enabled);
