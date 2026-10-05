import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertCallTransition,
  canTransition,
  historyStatus,
  isTerminalCallState,
  normalizeCallState,
} from '../calls/calls.state';
import { conversationTypeFromListing, previewFor } from './chat.types';
import { sniffMediaMime } from '../../providers/media-scan';
import { mediaScan } from '../../providers/media-scan';

describe('call state machine', () => {
  it('allows ringing to accepted / rejected / busy / timeout', () => {
    assert.equal(canTransition('ringing', 'accepted'), true);
    assert.equal(canTransition('ringing', 'rejected'), true);
    assert.equal(canTransition('ringing', 'busy'), true);
    assert.equal(canTransition('ringing', 'timeout'), true);
    assert.equal(canTransition('ringing', 'missed'), true);
    assert.equal(canTransition('ringing', 'connected'), false);
  });

  it('requires connecting before connected', () => {
    assert.equal(canTransition('accepted', 'connecting'), true);
    assert.equal(canTransition('connecting', 'connected'), true);
    assert.equal(canTransition('ringing', 'ended'), false);
    assert.equal(canTransition('connected', 'ended'), true);
  });

  it('treats terminal states as frozen', () => {
    for (const state of ['rejected', 'busy', 'cancelled', 'failed', 'ended', 'missed', 'timeout'] as const) {
      assert.equal(isTerminalCallState(state), true);
      assert.equal(canTransition(state, 'connected'), false);
    }
  });

  it('maps legacy answered/declined statuses', () => {
    assert.equal(normalizeCallState('answered'), 'accepted');
    assert.equal(normalizeCallState('declined'), 'rejected');
    assert.equal(historyStatus('busy'), 'BUSY');
    assert.equal(historyStatus('rejected'), 'REJECTED');
  });

  it('throws on illegal transitions', () => {
    assert.throws(() => assertCallTransition('ended', 'ringing'));
  });
});

describe('conversation type mapping', () => {
  it('derives type from listing operation and business kind', () => {
    assert.equal(conversationTypeFromListing({ operation: 'auction', businessKind: null }), 'auction');
    assert.equal(conversationTypeFromListing({ operation: 'rent', businessKind: 'dealer' }), 'rental');
    assert.equal(conversationTypeFromListing({ operation: 'sell', businessKind: 'dealer' }), 'buyer_dealer');
    assert.equal(conversationTypeFromListing({ operation: 'sell', businessKind: 'agency' }), 'buyer_agent');
    assert.equal(conversationTypeFromListing({ operation: 'sell', businessKind: null }), 'buyer_seller');
  });
});

describe('message previews', () => {
  it('never uses raw media bytes as the inbox preview', () => {
    assert.equal(previewFor('image', null), 'Photo');
    assert.equal(previewFor('voice', null), 'Voice message');
    assert.equal(previewFor('document', null), 'Document');
    assert.equal(previewFor('location', null), 'Location');
    assert.equal(previewFor('video', null), 'Video');
    assert.equal(previewFor('text', 'Hello there'), 'Hello there');
  });
});

describe('media magic-byte scanner', () => {
  it('detects jpeg and pdf', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const pdf = Buffer.from('%PDF-1.4 extra', 'ascii');
    assert.equal(sniffMediaMime(jpeg), 'image/jpeg');
    assert.equal(sniffMediaMime(pdf), 'application/pdf');
  });

  it('blocks PE executables even if claimed as jpeg', async () => {
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(64, 1)]);
    const result = await mediaScan.scan({ buffer: exe, claimedMime: 'image/jpeg', purpose: 'chat_attachment' });
    assert.equal(result.verdict, 'blocked');
  });

  it('blocks html claimed as a document', async () => {
    const html = Buffer.from('<!DOCTYPE html><html><body>hi</body></html>');
    const result = await mediaScan.scan({
      buffer: html,
      claimedMime: 'application/pdf',
      purpose: 'chat_attachment',
    });
    assert.equal(result.verdict, 'blocked');
  });
});

describe('masked calling public DTO', () => {
  it('does not serialise phone numbers', () => {
    const dto = {
      uuid: '11111111-1111-1111-1111-111111111111',
      listingId: 9,
      status: 'allocated',
      expiresAt: new Date().toISOString(),
      dialHint: null,
    };
    const serialized = JSON.stringify(dto);
    assert.equal(serialized.includes('real_number'), false);
    assert.equal(serialized.includes('proxy_number'), false);
    assert.equal(serialized.includes('+'), false);
    assert.equal(dto.dialHint, null);
    assert.equal('real_number' in dto, false);
    assert.equal('proxy_number' in dto, false);
  });
});
