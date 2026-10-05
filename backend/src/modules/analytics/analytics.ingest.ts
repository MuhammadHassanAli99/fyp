import { execute, queryOne, type Row } from '../../db/query';
import { sha256, uuid } from '../../core/security/crypto';
import { clip } from '../../core/strings';
import { contextOrDefaults } from '../../core/context';
import { loggerFor } from '../../config/logger';
import { GUEST_EVENTS, normalizeEventName, type AnalyticsEventName } from './analytics.catalog';
import { parseBrowser, parseDeviceKind, parseOs, sanitizeProperties } from './analytics.privacy';

const log = loggerFor('analytics.ingest');

export interface IngestInput {
  eventName: string;
  properties?: Record<string, unknown>;
  entityType?: string | null;
  entityId?: number | null;
  eventUuid?: string | null;
  sessionId?: string | null;
}

export interface IngestResult {
  recorded: boolean;
  uuid?: string;
  reason?: string;
}

function clientSessionId(input: IngestInput, contextSession: number | null, guestUuid: string | null, userId: number | null): string | null {
  const fromBody = typeof input.sessionId === 'string' ? clip(input.sessionId, 64) : null;
  const fromProps =
    input.properties && typeof input.properties.sessionId === 'string'
      ? clip(String(input.properties.sessionId), 64)
      : null;
  if (fromBody && fromBody.length >= 8) return fromBody;
  if (fromProps && fromProps.length >= 8) return fromProps;
  if (contextSession) return `auth:${contextSession}`;
  if (userId) return `user:${userId}`;
  if (guestUuid) return `guest:${guestUuid}`;
  return null;
}

function utm(properties: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!properties) return null;
  const value = properties[key] ?? properties[key.replace('utm_', '')];
  return typeof value === 'string' ? clip(value, 96) : null;
}

async function resolveListingEntity(
  entityType: string | null | undefined,
  entityId: number | null | undefined,
  properties: Record<string, unknown> | null,
): Promise<{ entityType: string | null; entityId: number | null; marketplaceId: number | null; cityId: number | null; categoryId: number | null }> {
  const type = clip(entityType, 48);
  const fromProps = properties && typeof properties.listingId === 'number' ? Number(properties.listingId) : null;
  const id = entityId && Number.isFinite(entityId) ? entityId : fromProps;
  if (type === 'listing' && id && id > 0) {
    const listing = await queryOne<Row>(
      `SELECT id, marketplace_id, city_id, category_id FROM listings WHERE id = ? AND deleted_at IS NULL`,
      [id],
    );
    if (!listing) return { entityType: null, entityId: null, marketplaceId: null, cityId: null, categoryId: null };
    return {
      entityType: 'listing',
      entityId: Number(listing.id),
      marketplaceId: listing.marketplace_id == null ? null : Number(listing.marketplace_id),
      cityId: listing.city_id == null ? null : Number(listing.city_id),
      categoryId: listing.category_id == null ? null : Number(listing.category_id),
    };
  }
  if (type && id && id > 0 && type !== 'listing') {
    return { entityType: type, entityId: id, marketplaceId: null, cityId: null, categoryId: null };
  }
  return { entityType: null, entityId: null, marketplaceId: null, cityId: null, categoryId: null };
}

async function touchSession(params: {
  sessionId: string;
  eventName: AnalyticsEventName;
  userId: number | null;
  guestUuid: string | null;
  deviceId: number | null;
  platformId: number | null;
  countryId: number | null;
  cityId: number | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
}): Promise<void> {
  const isPage = params.eventName === 'page.viewed' || params.eventName === 'listing.viewed';
  const converted =
    params.eventName === 'listing.sold' ||
    params.eventName === 'listing.rented' ||
    params.eventName === 'user.registered' ||
    params.eventName === 'lead.created' ||
    params.eventName === 'payment.succeeded'
      ? 1
      : 0;
  const conversionKind =
    params.eventName === 'listing.sold' || params.eventName === 'payment.succeeded'
      ? 'purchase'
      : params.eventName === 'listing.rented'
        ? 'rental'
        : params.eventName === 'lead.created'
          ? 'lead'
          : params.eventName === 'user.registered'
            ? 'signup'
            : null;
  await execute(
    `INSERT INTO analytics_sessions
       (session_id, user_id, guest_uuid, device_id, platform_id, country_id, city_id, referrer,
        utm_source, utm_medium, utm_campaign, event_count, page_view_count, converted, conversion_kind, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       event_count = event_count + 1,
       page_view_count = page_view_count + VALUES(page_view_count),
       user_id = COALESCE(user_id, VALUES(user_id)),
       converted = IF(VALUES(converted) = 1, 1, converted),
       conversion_kind = COALESCE(conversion_kind, VALUES(conversion_kind)),
       ended_at = CURRENT_TIMESTAMP`,
    [
      params.sessionId,
      params.userId,
      params.guestUuid,
      params.deviceId,
      params.platformId,
      params.countryId,
      params.cityId,
      params.referrer,
      params.utmSource,
      params.utmMedium,
      params.utmCampaign,
      isPage ? 1 : 0,
      converted,
      conversionKind,
    ],
  ).catch((error) => log.debug({ err: error }, 'session upsert skipped'));
}

export async function ingestEvent(input: IngestInput): Promise<IngestResult> {
  const eventName = normalizeEventName(input.eventName);
  if (!eventName) return { recorded: false, reason: 'unknown_event' };

  const context = contextOrDefaults();
  const userId = context.userId;
  const guestUuid = context.guestUuid;

  if (!userId && !GUEST_EVENTS.has(eventName)) {
    return { recorded: false, reason: 'auth_required' };
  }
  if (!userId && !guestUuid && !context.installationId) {
    return { recorded: false, reason: 'anonymous_blocked' };
  }

  const properties = sanitizeProperties(input.properties);
  const entity = await resolveListingEntity(input.entityType, input.entityId ?? null, properties);
  const os = parseOs(context.userAgent, context.platform);
  const deviceKind = parseDeviceKind(context.userAgent, context.platform);
  const browser = parseBrowser(context.userAgent, context.platform);
  const sessionId = clientSessionId(input, context.sessionId, guestUuid, userId);
  const eventUuid = input.eventUuid && /^[0-9a-f-]{36}$/i.test(input.eventUuid) ? input.eventUuid : uuid();
  const ipHash = context.ip ? sha256(context.ip) : null;
  const referrer = properties && typeof properties.referrer === 'string' ? clip(String(properties.referrer), 255) : null;
  const utmSource = utm(properties, 'utm_source');
  const utmMedium = utm(properties, 'utm_medium');
  const utmCampaign = utm(properties, 'utm_campaign');

  try {
    await execute(
      `INSERT INTO analytics_events
         (uuid, event_name, user_id, guest_uuid, session_id, device_id, platform_id, marketplace_id,
          entity_type, entity_id, properties, country_id, city_id, os_name, os_version, app_version,
          browser, device_kind, referrer, utm_source, utm_medium, utm_campaign, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE uuid = uuid`,
      [
        eventUuid,
        eventName,
        userId,
        guestUuid,
        sessionId,
        context.deviceId,
        context.platformId,
        entity.marketplaceId ?? context.marketplaceId,
        entity.entityType,
        entity.entityId,
        properties ? JSON.stringify(properties) : null,
        context.countryId,
        entity.cityId,
        os.osName,
        os.osVersion,
        clip(context.appVersion, 24),
        browser,
        deviceKind,
        referrer,
        utmSource,
        utmMedium,
        utmCampaign,
        ipHash,
      ],
    );
    if (sessionId) {
      await touchSession({
        sessionId,
        eventName,
        userId,
        guestUuid,
        deviceId: context.deviceId,
        platformId: context.platformId,
        countryId: context.countryId,
        cityId: entity.cityId,
        referrer,
        utmSource,
        utmMedium,
        utmCampaign,
      });
    }
    return { recorded: true, uuid: eventUuid };
  } catch (error) {
    log.debug({ err: error, eventName }, 'analytics ingest skipped');
    return { recorded: false, reason: 'write_failed' };
  }
}

export async function ingestBatch(events: IngestInput[]): Promise<{ count: number; events: IngestResult[] }> {
  const results: IngestResult[] = [];
  for (const event of events.slice(0, 50)) {
    results.push(await ingestEvent(event));
  }
  return { count: results.filter((item) => item.recorded).length, events: results };
}

export async function recordDomainEvent(eventName: string, payload: Record<string, unknown>): Promise<void> {
  const listingId = typeof payload.listingId === 'number' ? payload.listingId : null;
  await ingestEvent({
    eventName,
    properties: payload,
    entityType: listingId ? 'listing' : null,
    entityId: listingId,
  });
}
