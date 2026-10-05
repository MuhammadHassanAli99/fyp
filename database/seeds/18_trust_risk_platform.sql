-- =============================================================================
-- 18  Trust & Risk Platform seeds (idempotent)
-- =============================================================================

USE marketplace;

INSERT INTO risk_policy_thresholds
  (code, name, allow_max, monitor_max, step_up_max, review_max, restriction_max, whitelist_score_reduction, is_active, notes)
VALUES
  ('default',  'Default risk policy',           29.99, 44.99, 64.99, 79.99, 89.99, 20.00, TRUE, 'VPN/root/emulator never auto-block'),
  ('login',    'Suspicious login',              29.99, 39.99, 54.99, 74.99, 89.99, 15.00, TRUE, 'MEDIUM → verification, HIGH → MFA'),
  ('payment',  'Payment / payout',              24.99, 39.99, 59.99, 74.99, 89.99, 10.00, TRUE, 'High-value charges prefer review'),
  ('listing',  'Listing publish gate',          34.99, 49.99, 64.99, 84.99, 94.99, 15.00, TRUE, 'Do not block listing create on the request path'),
  ('review',   'Review authenticity',           34.99, 49.99, 64.99, 79.99, 94.99, 10.00, TRUE, 'AI never auto-deletes a review'),
  ('kyc',      'Identity / document',           19.99, 39.99, 54.99, 69.99, 89.99, 5.00,  TRUE, 'AI cannot certify document authenticity')
ON DUPLICATE KEY UPDATE
  allow_max = VALUES(allow_max),
  monitor_max = VALUES(monitor_max),
  step_up_max = VALUES(step_up_max),
  review_max = VALUES(review_max),
  restriction_max = VALUES(restriction_max),
  is_active = TRUE;

INSERT INTO risk_models (model_id, name, feature_version, status) VALUES
  ('rules-v1',          'Weighted rules (authoritative)', 'v1', 'active'),
  ('heuristic-risk-v1', 'Statistical heuristic (shadow)', 'v1', 'shadow')
ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status);

INSERT INTO risk_model_versions (model_id, version, status, metrics, feature_version) VALUES
  ('rules-v1',          '1.0.0', 'active', CAST('{"precision":null,"source":"rules"}' AS JSON), 'v1'),
  ('heuristic-risk-v1', '1.0.0', 'shadow', CAST('{"precision":null,"source":"heuristic"}' AS JSON), 'v1')
ON DUPLICATE KEY UPDATE status = VALUES(status);

INSERT INTO risk_signals (code, name, description, category, weight, severity, is_active, auto_action) VALUES
  ('listing_velocity',          'Listing velocity',            'Many listings in a short window',                 'velocity',  18.000, 'medium',   TRUE, 'review'),
  ('review_velocity',           'Review velocity',             'Many reviews in a short window',                  'velocity',  16.000, 'medium',   TRUE, 'review'),
  ('message_velocity',          'Message velocity',            'Burst of outbound messages',                      'velocity',  12.000, 'low',      TRUE, 'none'),
  ('favorite_velocity',         'Favorite velocity',           'Rapid favorite activity',                         'velocity',   8.000, 'low',      TRUE, 'none'),
  ('password_reset_burst',      'Password reset burst',        'Repeated password-reset requests',                'behavior',  20.000, 'medium',   TRUE, 'challenge'),
  ('account_change_burst',      'Account change burst',        'Email/phone/MFA changed close together',          'behavior',  28.000, 'high',     TRUE, 'challenge'),
  ('shared_ip_accounts',        'Shared IP accounts',          'Several accounts on one IP (signal, not fraud)',  'network',   10.000, 'low',      TRUE, 'none'),
  ('shared_device_accounts',    'Shared device accounts',      'Several accounts on one device (signal)',         'identity',  14.000, 'medium',   TRUE, 'none'),
  ('device_debugging',          'Debugger attached',           'Client reports a debugger',                       'device',    12.000, 'low',      TRUE, 'none'),
  ('device_automation',         'Automation indicator',        'Client reports UI automation',                    'device',    18.000, 'medium',   TRUE, 'none'),
  ('whitelist_trusted_user',    'Trusted user',                'Configurable risk reduction, not a full bypass',  'identity', -20.000, 'info',     TRUE, 'none'),
  ('whitelist_trusted_device',  'Trusted device',              'Configurable risk reduction for this device',     'device',   -15.000, 'info',     TRUE, 'none'),
  ('whitelist_verified_business','Verified business',          'Verified dealer/agency/shop risk reduction',      'identity', -12.000, 'info',     TRUE, 'none'),
  ('ato_sequence',              'Account-takeover sequence',   'Reset + new device + contact change',             'behavior',  40.000, 'high',     TRUE, 'review'),
  ('duplicate_listing',         'Duplicate listing',           'Similar listing already exists',                  'content',   22.000, 'medium',   TRUE, 'review'),
  ('stolen_media',              'Reused listing photo',        'Image hash matches another listing',              'content',   24.000, 'high',     TRUE, 'review'),
  ('unverified_review',         'Review without a sale',       'Review is not transaction-verified',              'content',   12.000, 'low',      TRUE, 'none'),
  ('kyc_missing',               'KYC missing',                 'Jurisdiction requires KYC and it is not verified','identity',  25.000, 'medium',   TRUE, 'review'),
  ('aml_match',                 'AML match',                   'Sanctions/PEP screening hit (manual review)',     'identity',  80.000, 'critical', TRUE, 'review'),
  ('gps_spoof_suspected',       'Location spoofing signal',    'GPS mock / rapid jumps (signal, not fraud)',      'geo',       16.000, 'medium',   TRUE, 'none'),
  ('new_device',                'Unseen device',               'First login from this installation (signal)',     'device',     8.000, 'low',      TRUE, 'none'),
  ('suspicious_price',          'Suspicious ask vs estimate',  'Price is far from automated estimate (signal)',   'content',   16.000, 'medium',   TRUE, 'none'),
  ('duplicate_vin',             'Duplicate VIN',               'Same VIN on another active listing',              'content',   28.000, 'high',     TRUE, 'review'),
  ('mileage_anomaly',           'Mileage anomaly',             'Odometer change looks inconsistent',              'content',   18.000, 'high',     TRUE, 'review'),
  ('impossible_vehicle',        'Implausible vehicle year',    'Model year is not plausible',                     'content',   22.000, 'high',     TRUE, 'review')
ON DUPLICATE KEY UPDATE
  weight = VALUES(weight),
  severity = VALUES(severity),
  is_active = TRUE;

INSERT INTO permissions (id, code, resource, action, description) VALUES
  (300, 'risk.view',           'risk', 'view',      'View own coarse risk/verification state'),
  (301, 'risk.view_any',       'risk', 'view_any',  'View Trust & Safety queues and decisions'),
  (302, 'risk.manage',         'risk', 'manage',    'Change risk policy, lists and cases'),
  (303, 'kyc.view_any',        'kyc',  'view_any',  'View KYC cases'),
  (304, 'kyc.review',          'kyc',  'review',    'Approve or reject KYC'),
  (305, 'aml.view_any',        'aml',  'view_any',  'View AML cases'),
  (306, 'aml.review',          'aml',  'review',    'Review AML matches')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN (
    'risk.view_any','risk.manage','kyc.view_any','kyc.review','aml.view_any','aml.review',
    'fraud_case.view_any','sanction.view_any'
  )
 WHERE r.code IN ('admin','super_admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN (
    'risk.view_any','kyc.view_any','kyc.review','aml.view_any','aml.review',
    'fraud_case.view_any','fraud_case.update','sanction.view_any'
  )
 WHERE r.code = 'fraud_analyst';

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.code IN ('sanction.create','sanction.update','fraud_case.create')
 WHERE r.code = 'fraud_analyst';
