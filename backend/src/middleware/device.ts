import type { RequestHandler } from 'express';
import { execute, queryOne, type Row } from '../db/query';
import { sha256, uuid } from '../core/security/crypto';
import { clip } from '../core/strings';
import { loggerFor } from '../config/logger';

const log = loggerFor('device');

interface DeviceRow extends Row {
  id: number;
  uuid: string;
  is_rooted: number;
  is_jailbroken: number;
  is_emulator: number;
  is_trusted: number;
}

/**
 * Device fingerprinting (§19).
 *
 * The client sends a stable `X-Device-Id` plus integrity signals. We derive the
 * stored hash server-side from the client value *and* the user agent, so a
 * spoofed header alone does not let an attacker impersonate a known-good device.
 *
 * Registration is best-effort: a fingerprinting failure must never block a
 * legitimate request, it only means we lose a risk signal for that call.
 */
export const identifyDevice: RequestHandler = (req, _res, next) => {
  void (async () => {
    const clientDeviceId = req.headers['x-device-id'] as string | undefined;
    if (!clientDeviceId) return next();

    const fingerprint = sha256(`${clientDeviceId}|${req.headers['user-agent'] ?? ''}`);
    req.device.fingerprintHash = fingerprint;
    req.context.deviceHash = fingerprint;

    const platformId = req.context.platformId;
    if (!platformId) return next();

    const existing = await queryOne<DeviceRow>(
      `SELECT id, uuid, is_rooted, is_jailbroken, is_emulator, is_trusted
         FROM user_devices
        WHERE fingerprint_hash = ? AND (user_id = ? OR (user_id IS NULL AND ? IS NULL))
        LIMIT 1`,
      [fingerprint, req.auth?.userId ?? null, req.auth?.userId ?? null],
    );

    if (existing) {
      req.device.id = existing.id;
      req.device.uuid = existing.uuid;
      req.device.isRooted = existing.is_rooted === 1 || req.device.isRooted;
      req.device.isJailbroken = existing.is_jailbroken === 1 || req.device.isJailbroken;
      req.device.isEmulator = existing.is_emulator === 1 || req.device.isEmulator;
      req.context.deviceId = existing.id;

      await execute(
        `UPDATE user_devices
            SET last_seen_at = CURRENT_TIMESTAMP,
                app_version = COALESCE(?, app_version),
                is_rooted = ?, is_jailbroken = ?, is_emulator = ?,
                is_debugging = ?, is_automation = ?,
                user_id = COALESCE(user_id, ?)
          WHERE id = ?`,
        [
          clip(req.context.appVersion, 24),
          req.device.isRooted ? 1 : 0,
          req.device.isJailbroken ? 1 : 0,
          req.device.isEmulator ? 1 : 0,
          req.device.isDebugging ? 1 : 0,
          req.device.isAutomation ? 1 : 0,
          req.auth?.userId ?? null,
          existing.id,
        ],
      );

      if (req.auth) {
        await execute(
          `INSERT INTO fingerprint_users (fingerprint_hash, user_id)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP, session_count = session_count + 1`,
          [fingerprint, req.auth.userId],
        ).catch(() => undefined);
      }
      return next();
    }

    const deviceUuid = uuid();
    const result = await execute(
      `INSERT INTO user_devices
         (uuid, user_id, platform_id, fingerprint_hash, device_name, device_model, manufacturer,
          os_version, app_version, locale, timezone, is_rooted, is_jailbroken, is_emulator,
          is_debugging, is_automation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP, id = LAST_INSERT_ID(id)`,
      [
        deviceUuid,
        req.auth?.userId ?? null,
        platformId,
        fingerprint,
        clip(req.headers['x-device-name'] as string | undefined, 128),
        clip(req.headers['x-device-model'] as string | undefined, 128),
        clip(req.headers['x-device-manufacturer'] as string | undefined, 96),
        clip(req.headers['x-os-version'] as string | undefined, 48),
        clip(req.context.appVersion, 24),
        clip(req.context.language, 24),
        clip(req.context.timezone, 64),
        req.device.isRooted ? 1 : 0,
        req.device.isJailbroken ? 1 : 0,
        req.device.isEmulator ? 1 : 0,
        req.device.isDebugging ? 1 : 0,
        req.device.isAutomation ? 1 : 0,
      ],
    );

    req.device.id = result.insertId;
    req.device.uuid = deviceUuid;
    req.context.deviceId = result.insertId;

    // Feed the multi-account signal: same fingerprint seen with many users.
    await execute(
      `INSERT INTO device_fingerprints (fingerprint_hash, platform_id, user_agent, is_rooted, is_jailbroken, is_emulator, is_debugging, is_automation)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP,
                               is_rooted = VALUES(is_rooted),
                               is_jailbroken = VALUES(is_jailbroken),
                               is_emulator = VALUES(is_emulator),
                               is_debugging = VALUES(is_debugging),
                               is_automation = VALUES(is_automation)`,
      [
        fingerprint,
        platformId,
        (req.headers['user-agent'] ?? '').toString().slice(0, 512),
        req.device.isRooted ? 1 : 0,
        req.device.isJailbroken ? 1 : 0,
        req.device.isEmulator ? 1 : 0,
        req.device.isDebugging ? 1 : 0,
        req.device.isAutomation ? 1 : 0,
      ],
    ).catch((error) => log.debug({ err: error }, 'fingerprint upsert skipped'));

    if (req.auth) {
      await execute(
        `INSERT INTO fingerprint_users (fingerprint_hash, user_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE last_seen_at = CURRENT_TIMESTAMP, session_count = session_count + 1`,
        [fingerprint, req.auth.userId],
      ).catch(() => undefined);
    }

    next();
  })().catch((error) => {
    log.warn({ err: error }, 'device identification failed; continuing');
    next();
  });
};
