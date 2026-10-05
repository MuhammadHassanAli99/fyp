import { runDevelopmentBackup } from './security.backup';
import { runSecurityMonitor } from './security.monitor';
import { processDuePrivacyRequests } from './security.privacy';
import { loggerFor } from '../../config/logger';
import { env } from '../../config/env';

const log = loggerFor('security.jobs');

export async function runSecurityJobs(): Promise<void> {
  try {
    const processed = await processDuePrivacyRequests(10);
    if (processed > 0) log.info({ processed }, 'privacy requests processed');
  } catch (error) {
    log.warn({ err: error }, 'privacy processor failed');
  }

  try {
    await runSecurityMonitor();
  } catch (error) {
    log.warn({ err: error }, 'security monitor failed');
  }
}

export async function runScheduledBackup(): Promise<void> {
  if (env.isProduction) return;
  try {
    await runDevelopmentBackup();
  } catch (error) {
    log.warn({ err: error }, 'development backup failed');
  }
}
