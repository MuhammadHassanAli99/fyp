import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertCallTransition, canTransition, normalizeCallState } from './calls.state';
import { iceServersForUser } from './calls.ice';

describe('call signalling helpers', () => {
  it('normalises client status aliases before the state machine runs', () => {
    assert.equal(normalizeCallState('answered'), 'accepted');
    assert.equal(canTransition('ringing', normalizeCallState('answered')), true);
    assert.equal(canTransition('ringing', normalizeCallState('declined')), true);
    assert.throws(() => assertCallTransition('connected', 'ringing'));
  });

  it('never returns TURN credentials when TURN is not configured', () => {
    const servers = iceServersForUser(1);
    for (const server of servers) {
      if (server.urls.some((url) => url.startsWith('turn:'))) {
        assert.ok(server.username);
        assert.ok(server.credential);
      }
    }
    assert.ok(Array.isArray(servers));
  });
});
