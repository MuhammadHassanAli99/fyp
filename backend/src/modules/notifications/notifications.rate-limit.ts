import { cache } from '../../config/cache';
import type { NotificationChannel, PolicyGroup } from './notifications.types';

const WINDOWS: Record<string, { limit: number; windowSeconds: number }> = {
  push: { limit: 60, windowSeconds: 3600 },
  email: { limit: 40, windowSeconds: 3600 },
  sms: { limit: 8, windowSeconds: 3600 },
  otp_sms: { limit: 5, windowSeconds: 3600 },
  in_app: { limit: 200, windowSeconds: 3600 },
  silent: { limit: 120, windowSeconds: 3600 },
  marketing: { limit: 12, windowSeconds: 86400 },
  announcement: { limit: 4, windowSeconds: 86400 },
};

export async function consumeNotificationRateLimit(params: {
  userId: number;
  channel: NotificationChannel;
  policyGroup: PolicyGroup;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  let bucket = params.channel as string;
  if (params.policyGroup === 'MARKETING') bucket = 'marketing';
  if (params.policyGroup === 'SYSTEM' && params.channel !== 'in_app') bucket = 'announcement';
  if (params.channel === 'sms' && params.policyGroup === 'SECURITY') bucket = 'otp_sms';

  const rule = WINDOWS[bucket] ?? WINDOWS.push!;
  const key = `notify:rl:${params.userId}:${bucket}`;
  const count = (await cache.get<number>(key)) ?? 0;
  if (count >= rule.limit) {
    return { allowed: false, retryAfterSeconds: rule.windowSeconds };
  }
  await cache.set(key, count + 1, rule.windowSeconds);
  return { allowed: true, retryAfterSeconds: 0 };
}

export const notificationRateWindows = WINDOWS;
