import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { combineSignalWeights, decisionForScore, DEFAULT_THRESHOLDS, publicDecisionForUser, toLegacyDecision, toPaymentLegacyDecision } from './risk.policy';
import { NON_CONCLUSIVE_SIGNALS } from './risk.types';
import { assembleDecision } from './risk.engine';
import { isLikelyLegitimateShare, relationshipStrength } from './risk.graph';
import { nextDeviceState } from './risk.device';
import { reviewStateFrom } from './risk.review';
import { contentFingerprint } from './risk.image';
import { validateDocumentBuffer } from './risk.document';
import { marketplaceSignalToEngine } from './risk.listing';
import { PROPERTY_FRAUD_AUTO_BAN } from '../../marketplaces/property/property.rules';
import { VEHICLE_FRAUD_AUTO_BAN } from '../../marketplaces/vehicles/vehicles.rules';

describe('Trust & Risk policy', () => {
  it('never treats VPN/proxy/root/emulator/shared-device as automatic fraud', () => {
    const vpnOnly = combineSignalWeights([{ code: 'ip_vpn', weight: 12 }]);
    assert.equal(vpnOnly < 40, true);
    assert.equal(decisionForScore(vpnOnly, DEFAULT_THRESHOLDS), 'allow');

    const combo = combineSignalWeights([
      { code: 'ip_vpn', weight: 12 },
      { code: 'ip_proxy', weight: 20 },
      { code: 'device_emulator', weight: 22 },
      { code: 'device_rooted', weight: 15 },
      { code: 'shared_ip_accounts', weight: 10 },
      { code: 'shared_device_accounts', weight: 14 },
      { code: 'impossible_travel', weight: 28 },
    ]);
    assert.equal(combo, 39.99);
    assert.notEqual(decisionForScore(combo, DEFAULT_THRESHOLDS), 'block');
    assert.notEqual(decisionForScore(combo, DEFAULT_THRESHOLDS), 'temporary_restriction');
  });

  it('caps only-non-conclusive totals so they cannot reach block', () => {
    const codes = [...NON_CONCLUSIVE_SIGNALS].map((code) => ({ code, weight: 40 }));
    const score = combineSignalWeights(codes);
    assert.equal(score, 39.99);
  });

  it('maps bands from stored policy, not hard-coded 90/65/40', () => {
    assert.equal(decisionForScore(20, DEFAULT_THRESHOLDS), 'allow');
    assert.equal(decisionForScore(35, DEFAULT_THRESHOLDS), 'allow_with_monitoring');
    assert.equal(decisionForScore(50, DEFAULT_THRESHOLDS), 'step_up_verification');
    assert.equal(decisionForScore(70, DEFAULT_THRESHOLDS), 'review');
    assert.equal(decisionForScore(85, DEFAULT_THRESHOLDS), 'temporary_restriction');
    assert.equal(decisionForScore(91, DEFAULT_THRESHOLDS), 'block');
  });

  it('does not let a whitelist bypass blacklist or sanctions', () => {
    assert.equal(
      combineSignalWeights([
        { code: 'user_blacklisted', weight: 100 },
        { code: 'whitelist_trusted_user', weight: -20 },
      ]),
      100,
    );
    assert.equal(
      combineSignalWeights([
        { code: 'active_sanction', weight: 100 },
        { code: 'whitelist_trusted_device', weight: -15 },
      ]),
      100,
    );
  });

  it('keeps coarse user-facing states off the numeric score', () => {
    assert.equal(publicDecisionForUser('allow'), 'ok');
    assert.equal(publicDecisionForUser('allow_with_monitoring'), 'ok');
    assert.equal(publicDecisionForUser('step_up_verification'), 'verify');
    assert.equal(publicDecisionForUser('review'), 'verify');
    assert.equal(publicDecisionForUser('temporary_restriction'), 'restricted');
    assert.equal(publicDecisionForUser('block'), 'restricted');
  });
});

describe('shared device / IP graph', () => {
  it('treats family, office and dealership sharing as legitimate below the abuse band', () => {
    const family = relationshipStrength({
      sharedDevices: 1,
      sharedIps: 1,
      sharedPayments: 0,
      accountAgeHoursA: 4000,
      accountAgeHoursB: 8000,
      sameListingBurst: false,
    });
    assert.equal(isLikelyLegitimateShare(family, { sameFamilyOfficeHint: true }), true);

    const office = relationshipStrength({
      sharedDevices: 2,
      sharedIps: 4,
      sharedPayments: 0,
      accountAgeHoursA: 2000,
      accountAgeHoursB: 1500,
      sameListingBurst: false,
    });
    assert.equal(isLikelyLegitimateShare(office, { verifiedBusiness: true }), true);

    const dealership = relationshipStrength({
      sharedDevices: 3,
      sharedIps: 5,
      sharedPayments: 0,
      accountAgeHoursA: 9000,
      accountAgeHoursB: 12000,
      sameListingBurst: false,
    });
    assert.equal(isLikelyLegitimateShare(dealership, { verifiedBusiness: true }), true);
  });

  it('raises strength when two brand-new accounts share a device and burst listings', () => {
    const coordinated = relationshipStrength({
      sharedDevices: 1,
      sharedIps: 1,
      sharedPayments: 1,
      accountAgeHoursA: 3,
      accountAgeHoursB: 4,
      sameListingBurst: true,
    });
    assert.equal(isLikelyLegitimateShare(coordinated, {}), false);
  });
});

describe('login / ATO / device lifecycle', () => {
  it('marks an unseen device first_seen, not blocked', () => {
    assert.equal(
      nextDeviceState({ current: 'active', isNew: true, riskScore: 20, trusted: false }),
      'first_seen',
    );
  });

  it('does not block on a new-device signal alone', () => {
    const score = combineSignalWeights([{ code: 'new_device', weight: 8 }]);
    assert.equal(decisionForScore(score, DEFAULT_THRESHOLDS), 'allow');
  });

  it('steps up when an ATO sequence is conclusive', () => {
    const score = combineSignalWeights([
      { code: 'ato_sequence', weight: 40 },
      { code: 'new_device', weight: 8 },
      { code: 'impossible_travel', weight: 28 },
    ]);
    assert.equal(score >= 40, true);
    assert.equal(decisionForScore(score, DEFAULT_THRESHOLDS), 'review');
  });
});

describe('reviews, listings, documents, payments', () => {
  it('never auto-deletes a review; REJECTED is a review state', () => {
    assert.equal(reviewStateFrom(0.2, 'allow'), 'NORMAL');
    assert.equal(reviewStateFrom(0.3, 'allow'), 'SUSPICIOUS');
    assert.equal(reviewStateFrom(0.2, 'review'), 'REVIEW');
    assert.equal(reviewStateFrom(0.9, 'block'), 'REJECTED');
  });

  it('maps marketplace silo codes onto the central catalogue', () => {
    assert.equal(marketplaceSignalToEngine('duplicate_location'), 'duplicate_listing');
    assert.equal(marketplaceSignalToEngine('duplicate_images'), 'stolen_media');
    assert.equal(marketplaceSignalToEngine('shared_device'), 'shared_device_accounts');
    assert.equal(marketplaceSignalToEngine('duplicate_vin'), 'duplicate_vin');
  });

  it('never auto-bans from a marketplace fraud pipeline', () => {
    assert.equal(PROPERTY_FRAUD_AUTO_BAN, false);
    assert.equal(VEHICLE_FRAUD_AUTO_BAN, false);
  });

  it('fingerprints identical buffers the same way', () => {
    const a = contentFingerprint(Buffer.from('listing-photo-bytes'));
    const b = contentFingerprint(Buffer.from('listing-photo-bytes'));
    const c = contentFingerprint(Buffer.from('different-photo-bytes-here'));
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  it('never lets AI certify a document as authentic', async () => {
    const result = await validateDocumentBuffer(Buffer.from('%PDF-1.4 test'), 'application/pdf');
    assert.equal(result.aiCertifiedAuthentic, false);
  });

  it('holds only true payment blocks; restriction becomes review', () => {
    assert.equal(toPaymentLegacyDecision('block'), 'block');
    assert.equal(toPaymentLegacyDecision('temporary_restriction'), 'review');
    assert.equal(toPaymentLegacyDecision('review'), 'review');
    assert.equal(toLegacyDecision('temporary_restriction'), 'block');
  });
});

describe('decision assembly audit shape', () => {
  it('records rules, model and policy without making the LLM the authority', () => {
    const record = assembleDecision({
      input: {
        eventType: 'LOGIN_SUCCESS',
        subjectKind: 'user',
        subjectId: 1,
        userId: 1,
        policyCode: 'login',
      },
      signals: [{ code: 'ato_sequence', weight: 40 }],
      policy: { ...DEFAULT_THRESHOLDS, code: 'login' },
      uuid: '00000000-0000-4000-8000-000000000001',
    });
    assert.equal(record.modelId, 'rules-v1');
    assert.equal(record.policyCode, 'login');
    assert.deepEqual(record.rulesTriggered, ['ato_sequence']);
    assert.equal(record.decision, 'allow_with_monitoring');
  });
});
