import { badRequest } from '../../core/errors';

/**
 * Explicit call state machine. Clients must not invent transitions; the server
 * is the only writer of `calls.status`.
 *
 * Legacy rows from 010 used `answered` / `declined`. Those are accepted as
 * aliases of `accepted` / `rejected` so history stays readable.
 */
export const CALL_STATES = [
  'idle',
  'ringing',
  'accepted',
  'rejected',
  'busy',
  'cancelled',
  'connecting',
  'connected',
  'failed',
  'ended',
  'missed',
  'timeout',
] as const;

export type CallState = (typeof CALL_STATES)[number];

export const TERMINAL_CALL_STATES: ReadonlySet<CallState> = new Set([
  'rejected',
  'busy',
  'cancelled',
  'failed',
  'ended',
  'missed',
  'timeout',
]);

const TRANSITIONS: Record<CallState, readonly CallState[]> = {
  idle: ['ringing', 'failed'],
  ringing: ['accepted', 'rejected', 'busy', 'cancelled', 'timeout', 'missed', 'failed'],
  accepted: ['connecting', 'connected', 'cancelled', 'failed', 'ended'],
  connecting: ['connected', 'failed', 'cancelled', 'ended'],
  connected: ['ended', 'failed'],
  rejected: [],
  busy: [],
  cancelled: [],
  failed: [],
  ended: [],
  missed: [],
  timeout: [],
};

const LEGACY: Record<string, CallState> = {
  answered: 'accepted',
  declined: 'rejected',
};

export function normalizeCallState(value: string | null | undefined): CallState {
  if (!value) return 'idle';
  const mapped = LEGACY[value] ?? value;
  if ((CALL_STATES as readonly string[]).includes(mapped)) return mapped as CallState;
  return 'failed';
}

export function isTerminalCallState(state: CallState): boolean {
  return TERMINAL_CALL_STATES.has(state);
}

export function canTransition(from: CallState, to: CallState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}

export function assertCallTransition(from: CallState, to: CallState): void {
  if (!canTransition(from, to)) {
    throw badRequest(`Call cannot move from ${from} to ${to}`);
  }
}

export function historyStatus(state: CallState): 'COMPLETED' | 'MISSED' | 'REJECTED' | 'CANCELLED' | 'FAILED' | 'BUSY' {
  switch (state) {
    case 'ended':
    case 'connected':
      return 'COMPLETED';
    case 'missed':
    case 'timeout':
      return 'MISSED';
    case 'rejected':
      return 'REJECTED';
    case 'cancelled':
      return 'CANCELLED';
    case 'busy':
      return 'BUSY';
    default:
      return 'FAILED';
  }
}
