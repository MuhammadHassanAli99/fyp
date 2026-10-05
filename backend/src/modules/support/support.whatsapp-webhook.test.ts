import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normaliseWhatsAppWebhook } from './support.whatsapp-webhook';

/** A realistic Meta WhatsApp Cloud API inbound-message envelope. */
const metaEnvelope = (messages: unknown[], statuses: unknown[] = []) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '15550001111', phone_number_id: '106540352242922' },
            contacts: [{ profile: { name: 'Sara Khan' }, wa_id: '923000000001' }],
            messages,
            statuses,
          },
        },
      ],
    },
  ],
});

describe('WhatsApp webhook normalisation', () => {
  it('extracts a text message from Meta\'s nested envelope', () => {
    const batch = normaliseWhatsAppWebhook(
      metaEnvelope([
        {
          from: '923000000001',
          id: 'wamid.ABC123',
          timestamp: '1700000000',
          type: 'text',
          text: { body: 'My gold listing was rejected, why?' },
        },
      ]),
    );

    // The regression this guards: the endpoint used to validate against a flat
    // {from, text} schema and rejected Meta's real payload with a 400.
    assert.equal(batch.messages.length, 1);
    assert.equal(batch.messages[0]?.from, '923000000001');
    assert.equal(batch.messages[0]?.text, 'My gold listing was rejected, why?');
    assert.equal(batch.messages[0]?.messageId, 'wamid.ABC123');
    assert.equal(batch.messages[0]?.profileName, 'Sara Khan');
  });

  it('handles several messages in one webhook', () => {
    const batch = normaliseWhatsAppWebhook(
      metaEnvelope([
        { from: '923000000001', id: 'wamid.1', type: 'text', text: { body: 'first' } },
        { from: '923000000002', id: 'wamid.2', type: 'text', text: { body: 'second' } },
      ]),
    );

    assert.equal(batch.messages.length, 2);
    assert.deepEqual(
      batch.messages.map((m) => m.text),
      ['first', 'second'],
    );
  });

  it('captures media as an id reference, not a fetchable url', () => {
    const batch = normaliseWhatsAppWebhook(
      metaEnvelope([
        {
          from: '923000000001',
          id: 'wamid.IMG',
          type: 'image',
          image: { id: 'media-77', mime_type: 'image/jpeg', caption: 'receipt' },
        },
      ]),
    );

    assert.equal(batch.messages[0]?.mediaUrl, 'whatsapp-media:media-77');
    assert.equal(batch.messages[0]?.text, 'receipt');
  });

  it('separates delivery receipts from inbound messages', () => {
    const batch = normaliseWhatsAppWebhook(
      metaEnvelope([], [{ id: 'wamid.OUT', status: 'delivered', recipient_id: '923000000001' }]),
    );

    assert.equal(batch.messages.length, 0);
    assert.equal(batch.statuses.length, 1);
    assert.equal(batch.statuses[0]?.status, 'delivered');
  });

  it('still accepts the flat relay shape', () => {
    const batch = normaliseWhatsAppWebhook({ from: '923000000001', text: 'hello', messageId: 'rel-1' });

    assert.equal(batch.messages.length, 1);
    assert.equal(batch.messages[0]?.text, 'hello');
  });

  it('returns an empty batch for junk rather than throwing', () => {
    // Meta retries any non-2xx forever, so a malformed payload must be
    // acknowledged, not rejected.
    for (const junk of [null, undefined, {}, { entry: 'nope' }, { entry: [] }, []]) {
      assert.deepEqual(normaliseWhatsAppWebhook(junk), { messages: [], statuses: [] });
    }
  });
});
