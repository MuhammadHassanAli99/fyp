import { loggerFor } from '../../config/logger';
import { timeoutRingingCalls } from '../calls/calls.service';
import { expireMaskedSessions } from '../calls/calls.masked';

const log = loggerFor('jobs.communication');

export async function runCallTimeouts(): Promise<void> {
  try {
    const count = await timeoutRingingCalls();
    if (count > 0) log.info({ count }, 'ringing calls timed out');
  } catch (error) {
    log.warn({ err: error }, 'call timeout job failed');
  }
}

export async function runMaskedExpiry(): Promise<void> {
  try {
    const count = await expireMaskedSessions();
    if (count > 0) log.info({ count }, 'masked sessions expired');
  } catch (error) {
    log.warn({ err: error }, 'masked expiry job failed');
  }
}
