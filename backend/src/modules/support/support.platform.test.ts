import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AI_CONFIDENCE_THRESHOLD,
  canTransition,
  detectSensitiveIntent,
  slaMinutesFor,
  ticketNumberFromSubject,
  toDbPriority,
  toDbStatus,
  toPublicPriority,
  toPublicStatus,
} from './support.types';
import { scoreKnowledgeOverlap } from './support.kb';

describe('support status mapping', () => {
  it('maps spec states onto the existing 018 ENUM without a migration', () => {
    assert.equal(toPublicStatus({ status: 'new' }), 'NEW');
    assert.equal(toPublicStatus({ status: 'open' }), 'OPEN');
    assert.equal(toPublicStatus({ status: 'open', assignedTo: 9 }), 'ASSIGNED');
    assert.equal(toPublicStatus({ status: 'open', assignedTo: 9, firstResponseAt: new Date() }), 'IN_PROGRESS');
    assert.equal(toPublicStatus({ status: 'pending_customer' }), 'WAITING_FOR_CUSTOMER');
    assert.equal(toPublicStatus({ status: 'pending_internal' }), 'WAITING_INTERNAL');
    assert.equal(toPublicStatus({ status: 'on_hold' }), 'WAITING_INTERNAL');
    assert.equal(toDbStatus('ASSIGNED'), 'open');
    assert.equal(toDbStatus('WAITING_FOR_CUSTOMER'), 'pending_customer');
    assert.equal(toDbStatus('CRITICAL' as string) || 'open', 'open');
  });

  it('refuses illegal transitions', () => {
    assert.equal(canTransition('new', 'open'), true);
    assert.equal(canTransition('closed', 'open'), false);
    assert.equal(canTransition('closed', 'reopened'), true);
    assert.equal(canTransition('resolved', 'reopened'), true);
    assert.equal(canTransition('resolved', 'new'), false);
  });
});

describe('support priority mapping', () => {
  it('stores CRITICAL as urgent plus a tag, not a new ENUM value', () => {
    assert.deepEqual(toDbPriority('CRITICAL'), { priority: 'urgent', critical: true });
    assert.equal(toPublicPriority('urgent', { severity: 'critical' }), 'CRITICAL');
    assert.equal(toPublicPriority('high'), 'HIGH');
  });
});

describe('support safety', () => {
  it('escalates payment, fraud, KYC and takeover language', () => {
    assert.equal(detectSensitiveIntent('I need a refund for a double charge'), 'refund_dispute');
    assert.equal(detectSensitiveIntent('My account was hacked last night'), 'account_takeover');
    assert.equal(detectSensitiveIntent('This seller is running a gold scam'), 'fraud');
    assert.equal(detectSensitiveIntent('KYC documents were rejected'), 'kyc');
    assert.equal(detectSensitiveIntent('How do I change the listing title?'), null);
  });
});

describe('SLA configuration', () => {
  it('never hardcodes a single SLA; priority and plan scale the category target', () => {
    const base = slaMinutesFor({ baseMinutes: 240, priority: 'normal' });
    const urgent = slaMinutesFor({ baseMinutes: 240, priority: 'urgent' });
    const dedicated = slaMinutesFor({ baseMinutes: 240, priority: 'normal', hasDedicatedSupport: true });
    assert.equal(base, 240);
    assert.ok((urgent ?? 0) < (base ?? 0));
    assert.ok((dedicated ?? 0) < (base ?? 0));
    assert.equal(slaMinutesFor({ baseMinutes: null, priority: 'high' }), null);
  });
});

describe('omnichannel thread identity', () => {
  it('extracts the ticket number from an email subject so replies join the same case', () => {
    assert.equal(ticketNumberFromSubject('Re: SUP-2026-A1B2C3 your gold listing'), 'SUP-2026-A1B2C3');
    assert.equal(ticketNumberFromSubject('Hello from WhatsApp'), null);
  });
});

describe('knowledge grounding', () => {
  it('scores overlap so the AI can refuse to answer below the confidence floor', () => {
    const high = scoreKnowledgeOverlap('how do gold certificates work', 'Gold certificates', 'Hallmark and certificate checks');
    const low = scoreKnowledgeOverlap('unrelated quantum foam', 'Gold certificates', 'Hallmark and certificate checks');
    assert.ok(high > AI_CONFIDENCE_THRESHOLD);
    assert.ok(low < AI_CONFIDENCE_THRESHOLD);
  });
});
