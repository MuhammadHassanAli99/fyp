import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OtpRouter, type OtpProvider, type OtpDispatch } from './otp.provider';
import type { DeliveryResult } from './types';

const dispatch = (over: Partial<OtpDispatch> = {}): OtpDispatch => ({
  channel: 'email',
  destination: 'user@example.com',
  code: '123456',
  purpose: 'login',
  language: 'en',
  ttlMinutes: 10,
  ...over,
});

class FakeProvider implements OtpProvider {
  readonly calls: OtpDispatch[] = [];
  constructor(
    readonly channel: OtpProvider['channel'],
    private readonly configured: boolean,
    private readonly result: Partial<DeliveryResult> = {},
  ) {}
  readonly providerName = 'fake';
  isConfigured(): boolean {
    return this.configured;
  }
  async send(input: OtpDispatch): Promise<DeliveryResult> {
    this.calls.push(input);
    return { provider: 'fake', messageId: 'm1', accepted: 1, rejected: 0, ...this.result };
  }
}

describe('OTP routing', () => {
  it('sends on the requested channel when it is configured', async () => {
    const email = new FakeProvider('email', true);
    const router = new OtpRouter([email]);

    const outcome = await router.send(dispatch());

    assert.equal(outcome.channel, 'email');
    assert.equal(outcome.accepted, 1);
    assert.equal(outcome.substitutedFrom, undefined);
    assert.equal(email.calls.length, 1);
  });

  it('reports whatsapp as the channel when whatsapp is configured', async () => {
    const whatsapp = new FakeProvider('whatsapp', true);
    const sms = new FakeProvider('sms', true);
    const router = new OtpRouter([whatsapp, sms]);

    const outcome = await router.send(dispatch({ channel: 'whatsapp', destination: '+923000000001' }));

    assert.equal(outcome.channel, 'whatsapp');
    assert.equal(whatsapp.calls.length, 1);
    assert.equal(sms.calls.length, 0, 'must not double-send');
  });

  it('falls back to SMS when whatsapp is unconfigured, and says so', async () => {
    const whatsapp = new FakeProvider('whatsapp', false);
    const sms = new FakeProvider('sms', true);
    const router = new OtpRouter([whatsapp, sms]);

    const outcome = await router.send(dispatch({ channel: 'whatsapp', destination: '+923000000001' }));

    // The regression this guards: the old implementation routed whatsapp
    // through the SMS driver but still reported the channel as whatsapp.
    assert.equal(outcome.channel, 'sms');
    assert.equal(outcome.substitutedFrom, 'whatsapp');
    assert.equal(sms.calls.length, 1);
    assert.equal(sms.calls[0]?.channel, 'sms');
  });

  it('never substitutes email for a phone channel', async () => {
    const email = new FakeProvider('email', true);
    const router = new OtpRouter([email]);

    const outcome = await router.send(dispatch({ channel: 'sms', destination: '+923000000001' }));

    // A phone-verification code must not be delivered to a mailbox.
    assert.equal(outcome.accepted, 0);
    assert.equal(outcome.rejected, 1);
    assert.equal(outcome.permanent, true);
    assert.equal(email.calls.length, 0);
  });

  it('surfaces a rejected delivery instead of reporting success', async () => {
    const email = new FakeProvider('email', true, { accepted: 0, rejected: 1, permanent: true, errorCode: 'REJECTED' });
    const router = new OtpRouter([email]);

    const outcome = await router.send(dispatch());

    assert.equal(outcome.accepted, 0);
    assert.equal(outcome.rejected, 1);
  });

  it('lists only configured channels', () => {
    const router = new OtpRouter([
      new FakeProvider('email', true),
      new FakeProvider('sms', false),
      new FakeProvider('whatsapp', false),
    ]);

    assert.deepEqual(router.configuredChannels(), ['email']);
  });
});
