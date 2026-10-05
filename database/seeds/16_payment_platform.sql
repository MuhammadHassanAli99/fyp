-- =============================================================================
-- 16  Payment platform catalogue (idempotent)
--     Providers vs methods: Stripe/PayPal/bank/regional are PROVIDERS.
--     Card, Google Pay, Apple Pay, bank transfer and wallets are METHODS.
-- =============================================================================

USE marketplace;

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- Gateways (providers). Drivers register in code; these rows decide offer.
-- Existing stripe/paypal/apple_pay/google_play/manual rows are updated in place.
-- apple_pay / google_play remain store-billing providers (IAP), not wallet methods.
-- -----------------------------------------------------------------------------
INSERT INTO payment_gateways (
  code, name, kind, supports_recurring, supports_refund, supported_countries, supported_currencies,
  config, fee_percent, fee_fixed, is_active, is_test_mode, sort_order
) VALUES
  ('manual', 'Manual settlement', 'cash', FALSE, TRUE, NULL, NULL,
    JSON_OBJECT('methods', JSON_ARRAY('card'), 'public', TRUE), 0.000, 0.0000, TRUE, TRUE, 99),
  ('stripe', 'Stripe', 'card', TRUE, TRUE, NULL,
    JSON_ARRAY('USD','EUR','GBP','CAD','AUD','AED','SAR','INR','SGD','JPY','TRY'),
    JSON_OBJECT('methods', JSON_ARRAY('card','google_pay','apple_pay')), 2.900, 0.3000, TRUE, TRUE, 1),
  ('paypal', 'PayPal', 'wallet', TRUE, TRUE, NULL,
    JSON_ARRAY('USD','EUR','GBP','CAD','AUD'),
    JSON_OBJECT('methods', JSON_ARRAY('paypal')), 3.400, 0.3000, TRUE, TRUE, 2),
  ('apple_pay', 'Apple In-App Purchase', 'wallet', TRUE, TRUE, NULL, NULL,
    JSON_OBJECT('methods', JSON_ARRAY('apple_pay'), 'billing', 'store'), 15.000, 0.0000, TRUE, TRUE, 3),
  ('google_play', 'Google Play Billing', 'wallet', TRUE, TRUE, NULL, NULL,
    JSON_OBJECT('methods', JSON_ARRAY('google_pay'), 'billing', 'store'), 15.000, 0.0000, TRUE, TRUE, 4),
  ('bank_transfer', 'Bank transfer', 'bank', FALSE, TRUE, NULL, NULL,
    JSON_OBJECT('methods', JSON_ARRAY('bank_transfer'), 'async', TRUE), 0.000, 0.0000, TRUE, TRUE, 5),
  ('jazzcash', 'JazzCash', 'wallet', FALSE, TRUE, JSON_ARRAY('PK'), JSON_ARRAY('PKR'),
    JSON_OBJECT('methods', JSON_ARRAY('regional_wallet')), 1.500, 0.0000, TRUE, TRUE, 10),
  ('easypaisa', 'Easypaisa', 'wallet', FALSE, TRUE, JSON_ARRAY('PK'), JSON_ARRAY('PKR'),
    JSON_OBJECT('methods', JSON_ARRAY('regional_wallet')), 1.500, 0.0000, TRUE, TRUE, 11),
  ('mada', 'Mada', 'card', TRUE, TRUE, JSON_ARRAY('SA'), JSON_ARRAY('SAR'),
    JSON_OBJECT('methods', JSON_ARRAY('card','regional_wallet')), 1.750, 0.0000, TRUE, TRUE, 12),
  ('fawry', 'Fawry', 'wallet', FALSE, TRUE, JSON_ARRAY('EG'), JSON_ARRAY('EGP'),
    JSON_OBJECT('methods', JSON_ARRAY('regional_wallet')), 2.250, 0.0000, TRUE, TRUE, 13),
  ('razorpay', 'Razorpay', 'card', TRUE, TRUE, JSON_ARRAY('IN'), JSON_ARRAY('INR'),
    JSON_OBJECT('methods', JSON_ARRAY('card','upi','regional_wallet')), 2.000, 0.0000, TRUE, TRUE, 14),
  ('payfast', 'PayFast', 'wallet', TRUE, TRUE, JSON_ARRAY('ZA'), JSON_ARRAY('ZAR'),
    JSON_OBJECT('methods', JSON_ARRAY('card','regional_wallet')), 2.900, 0.0000, TRUE, TRUE, 15),
  ('mercadopago', 'Mercado Pago', 'wallet', TRUE, TRUE, JSON_ARRAY('BR','AR','MX','CL','CO'),
    JSON_ARRAY('BRL','ARS','MXN','CLP','COP'),
    JSON_OBJECT('methods', JSON_ARRAY('card','regional_wallet')), 3.990, 0.0000, TRUE, TRUE, 16)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  kind = VALUES(kind),
  supports_recurring = VALUES(supports_recurring),
  supports_refund = VALUES(supports_refund),
  supported_countries = VALUES(supported_countries),
  supported_currencies = VALUES(supported_currencies),
  config = VALUES(config),
  is_active = VALUES(is_active),
  is_test_mode = VALUES(is_test_mode),
  sort_order = VALUES(sort_order);

-- Pakistan / Saudi / UAE / India / Egypt regional offer (country_id from 01_reference).
INSERT INTO regional_payment_methods (country_id, currency, provider_code, payment_method, is_enabled, sort_order)
SELECT c.id, x.currency, x.provider_code, x.payment_method, TRUE, x.sort_order
FROM countries c
JOIN (
  SELECT 'PK' iso2, 'PKR' currency, 'jazzcash' provider_code, 'regional_wallet' payment_method, 1 sort_order
  UNION ALL SELECT 'PK', 'PKR', 'easypaisa', 'regional_wallet', 2
  UNION ALL SELECT 'PK', 'PKR', 'bank_transfer', 'bank_transfer', 3
  UNION ALL SELECT 'PK', 'USD', 'stripe', 'card', 4
  UNION ALL SELECT 'SA', 'SAR', 'mada', 'card', 1
  UNION ALL SELECT 'SA', 'SAR', 'stripe', 'card', 2
  UNION ALL SELECT 'AE', 'AED', 'stripe', 'card', 1
  UNION ALL SELECT 'AE', 'AED', 'stripe', 'google_pay', 2
  UNION ALL SELECT 'IN', 'INR', 'razorpay', 'card', 1
  UNION ALL SELECT 'IN', 'INR', 'razorpay', 'upi', 2
  UNION ALL SELECT 'EG', 'EGP', 'fawry', 'regional_wallet', 1
  UNION ALL SELECT 'US', 'USD', 'stripe', 'card', 1
  UNION ALL SELECT 'US', 'USD', 'stripe', 'google_pay', 2
  UNION ALL SELECT 'US', 'USD', 'stripe', 'apple_pay', 3
  UNION ALL SELECT 'US', 'USD', 'paypal', 'paypal', 4
  UNION ALL SELECT 'US', 'USD', 'bank_transfer', 'bank_transfer', 5
  UNION ALL SELECT 'GB', 'GBP', 'stripe', 'card', 1
  UNION ALL SELECT 'GB', 'GBP', 'paypal', 'paypal', 2
  UNION ALL SELECT 'DE', 'EUR', 'stripe', 'card', 1
  UNION ALL SELECT 'DE', 'EUR', 'paypal', 'paypal', 2
) x ON x.iso2 = c.iso2
ON DUPLICATE KEY UPDATE is_enabled = TRUE, sort_order = VALUES(sort_order);

-- -----------------------------------------------------------------------------
-- Risk catalogue. risk_events.signal_code FKs here, so risk-guard codes must exist.
-- -----------------------------------------------------------------------------
INSERT INTO risk_signals (code, name, description, category, weight, severity, is_active, auto_action) VALUES
  ('ip_blacklisted',           'IP blacklisted',              'IP is on the deny list',                    'network',  100.000, 'critical', TRUE, 'block'),
  ('device_blacklisted',       'Device blacklisted',          'Device fingerprint is denied',              'device',   100.000, 'critical', TRUE, 'block'),
  ('user_blacklisted',         'User blacklisted',            'Account is denied',                         'identity', 100.000, 'critical', TRUE, 'block'),
  ('ip_tor',                   'Tor exit',                    'Request from a Tor exit node',              'network',   35.000, 'high',     TRUE, 'review'),
  ('ip_proxy',                 'Proxy',                       'Request from a known proxy',                'network',   20.000, 'medium',   TRUE, 'none'),
  ('ip_vpn',                   'VPN',                         'Request from a VPN',                        'network',   12.000, 'low',      TRUE, 'none'),
  ('ip_datacenter',            'Datacenter IP',               'Request from a hosting range',              'network',   18.000, 'medium',   TRUE, 'none'),
  ('ip_abuser',                'Abusive IP',                  'IP has an abuse reputation',                'network',   45.000, 'high',     TRUE, 'review'),
  ('ip_threat_critical',       'Critical IP threat',          'Threat intel marked this IP critical',      'network',   50.000, 'critical', TRUE, 'review'),
  ('ip_threat_high',           'High IP threat',              'Threat intel marked this IP high',          'network',   30.000, 'high',     TRUE, 'none'),
  ('device_emulator',          'Emulator',                    'Client reports an emulator',                'device',    22.000, 'medium',   TRUE, 'none'),
  ('device_rooted',            'Rooted device',               'Client reports root',                       'device',    15.000, 'medium',   TRUE, 'none'),
  ('device_jailbroken',        'Jailbroken device',           'Client reports jailbreak',                  'device',    15.000, 'medium',   TRUE, 'none'),
  ('device_bot',               'Bot device',                  'Fingerprint classified as a bot',           'device',    40.000, 'high',     TRUE, 'review'),
  ('device_many_accounts',     'Many accounts on device',     'Ten or more accounts on one install',       'identity',  35.000, 'high',     TRUE, 'review'),
  ('device_several_accounts',  'Several accounts on device',  'Five or more accounts on one install',      'identity',  18.000, 'medium',   TRUE, 'none'),
  ('user_risk_critical',       'Critical user risk',          'Standing risk score is critical',           'identity',  60.000, 'critical', TRUE, 'review'),
  ('user_risk_high',           'High user risk',              'Standing risk score is high',               'identity',  35.000, 'high',     TRUE, 'none'),
  ('user_risk_medium',         'Medium user risk',            'Standing risk score is elevated',           'identity',  12.000, 'medium',   TRUE, 'none'),
  ('account_very_new',         'Very new account',            'Account is less than one hour old',         'identity',   8.000, 'low',      TRUE, 'none'),
  ('recent_failures',          'Recent login failures',       'Several failed logins on this account',     'behavior',  10.000, 'low',      TRUE, 'none'),
  ('impossible_travel',        'Impossible travel',           'Country changed within two hours',          'geo',       28.000, 'high',     TRUE, 'challenge'),
  ('active_sanction',          'Active sanction',             'User is suspended or banned',               'identity', 100.000, 'critical', TRUE, 'block'),
  ('payment_velocity',         'Payment velocity',            'Many payment attempts in a short window',   'payment',   25.000, 'medium',   TRUE, 'challenge'),
  ('payment_failed_burst',     'Failed payment burst',        'Repeated failed charges',                   'payment',   22.000, 'medium',   TRUE, 'challenge'),
  ('payment_high_amount',      'High amount',                 'Charge is unusually large for this user',   'payment',   18.000, 'medium',   TRUE, 'review'),
  ('payment_new_account',      'New account paying',          'First payments on a young account',         'payment',   10.000, 'low',      TRUE, 'none'),
  ('payment_country_mismatch', 'Billing country mismatch',    'Billing country differs from session',      'payment',   16.000, 'medium',   TRUE, 'challenge'),
  ('payment_amount_mismatch',  'Provider amount mismatch',    'Webhook amount did not match the order',    'payment',   80.000, 'critical', TRUE, 'review'),
  ('payment_currency_mismatch','Provider currency mismatch',  'Webhook currency did not match the order',  'payment',   80.000, 'critical', TRUE, 'review')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  weight = VALUES(weight),
  severity = VALUES(severity),
  is_active = TRUE;

INSERT INTO notification_categories
  (code, name, description, group_code, default_push, default_email, default_sms, default_in_app, is_transactional, policy_group, marketplace_scope, sort_order, is_active)
VALUES
  ('payment.pending',        'Payment pending',        'A payment is awaiting confirmation',     'billing', TRUE,  FALSE, FALSE, TRUE, TRUE, 'TRANSACTIONAL', 'GENERAL', 19, TRUE),
  ('payment.refund_started', 'Refund started',         'A refund was submitted to the provider', 'billing', TRUE,  FALSE, FALSE, TRUE, TRUE, 'TRANSACTIONAL', 'GENERAL', 22, TRUE),
  ('payment.refund_failed',  'Refund failed',          'A refund could not be completed',        'billing', TRUE,  TRUE,  FALSE, TRUE, TRUE, 'TRANSACTIONAL', 'GENERAL', 23, TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = TRUE;

INSERT INTO notification_templates
  (category_code, channel, language, subject, title, body, action_url, variables, is_active, version)
VALUES
  ('payment.pending',        'in_app', 'en', NULL, 'Payment processing', 'We are confirming {{amount}} {{currency}}.', '/checkout/{{orderUuid}}', '["amount","currency","orderUuid"]', TRUE, 1),
  ('payment.refund_started', 'in_app', 'en', NULL, 'Refund started', '{{amount}} {{currency}} is being refunded.', '/checkout/{{orderUuid}}', '["amount","currency","orderUuid"]', TRUE, 1),
  ('payment.refund_failed',  'in_app', 'en', NULL, 'Refund failed', 'A refund could not be completed.', '/checkout/{{orderUuid}}', '["orderUuid"]', TRUE, 1)
ON DUPLICATE KEY UPDATE body = VALUES(body), action_url = VALUES(action_url), is_active = TRUE;

UPDATE notification_templates
   SET action_url = '/checkout/{{orderUuid}}'
 WHERE category_code IN ('payment.succeeded','payment.failed','payment.refund','payment.invoice')
   AND channel = 'in_app';

INSERT INTO scheduled_jobs (code, name, cron, is_enabled) VALUES
  ('payment.expire',          'Expire unpaid payment intents',              '*/5 * * * *', TRUE),
  ('payment.webhook.retry',   'Retry failed provider webhook events',       '* * * * *', TRUE),
  ('payment.reconciliation',  'Snapshot internal vs provider mismatches',   '15 * * * *', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name), cron = VALUES(cron), is_enabled = VALUES(is_enabled);
