import { execute, queryOne, type Row } from '../../db/query';
import { detectDuplicates } from '../ai/ai.capabilities';
import { evaluateRisk } from './risk.engine';
import { similarMediaListingIds } from './risk.image';
import { signalHit } from './risk.signals';
import { upsertRelationship } from './risk.graph';
import type { RiskDecisionRecord } from './risk.types';

export interface DuplicateResult {
  matchedListingIds: number[];
  similarityScore: number;
  signals: string[];
  confidence: number;
}

export function marketplaceSignalToEngine(code: string): string {
  if (code === 'duplicate_location' || code === 'duplicate_description') return 'duplicate_listing';
  if (code === 'duplicate_images') return 'stolen_media';
  if (code === 'shared_device') return 'shared_device_accounts';
  return code;
}

export async function detectDuplicateListing(listingId: number): Promise<DuplicateResult> {
  const [text, images] = await Promise.all([detectDuplicates(listingId), similarMediaListingIds(listingId)]);
  const matched = new Set<number>([
    ...text.matches.map((m) => m.listingId),
    ...images,
  ]);
  const similarity = Math.max(text.score, images.length > 0 ? 0.9 : 0);
  return {
    matchedListingIds: [...matched],
    similarityScore: similarity,
    signals: [
      ...text.matches.map((m) => m.reason),
      ...(images.length > 0 ? ['image_hash'] : []),
    ],
    confidence: text.confidence,
  };
}

export async function assessListingRisk(listingId: number, userId: number | null): Promise<RiskDecisionRecord> {
  const extra = [];
  const dup = await detectDuplicateListing(listingId);
  if (dup.similarityScore >= 0.82) {
    extra.push(await signalHit('duplicate_listing', 22, dup.matchedListingIds.slice(0, 5).join(','), 'content'));
    for (const otherId of dup.matchedListingIds.slice(0, 8)) {
      await upsertRelationship({
        fromKind: 'listing',
        fromKey: String(listingId),
        toKind: 'listing',
        toKey: String(otherId),
        relType: 'LISTING_DUPLICATE_OF',
        strength: dup.similarityScore,
        evidence: { signals: dup.signals },
      });
    }
  }
  if (dup.signals.includes('image_hash')) {
    extra.push(await signalHit('stolen_media', 24, undefined, 'content'));
  }

  const listing = await queryOne<Row>('SELECT user_id, marketplace_id FROM listings WHERE id = ?', [listingId]);
  const ownerId = userId ?? (listing ? Number(listing.user_id) : null);
  if (ownerId) {
    await upsertRelationship({
      fromKind: 'user',
      fromKey: String(ownerId),
      toKind: 'listing',
      toKey: String(listingId),
      relType: 'USER_CREATED_LISTING',
      strength: 0.5,
    });
  }

  return evaluateRisk(
    {
      eventType: 'LISTING_SUBMITTED',
      subjectKind: 'listing',
      subjectId: listingId,
      userId: ownerId,
      listingId,
      policyCode: 'listing',
      persist: true,
    },
    extra,
  );
}

export async function persistMarketplaceSignals(
  table: 'property_risk_events' | 'vehicle_risk_events',
  listingId: number,
  userId: number | null,
  signals: Array<{ code: string; severity: string; detail: string; delta?: number }>,
  extra: { propertyId?: number | null; vehicleId?: number | null },
): Promise<void> {
  for (const signal of signals) {
    if (table === 'property_risk_events') {
      await execute(
        `INSERT INTO property_risk_events (listing_id, property_id, user_id, signal_code, severity, score_delta, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [listingId, extra.propertyId ?? null, userId, signal.code, signal.severity, signal.delta ?? 0, signal.detail],
      ).catch(() => undefined);
    } else {
      await execute(
        `INSERT INTO vehicle_risk_events (listing_id, vehicle_id, user_id, signal_code, severity, score_delta, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [listingId, extra.vehicleId ?? null, userId, signal.code, signal.severity, signal.delta ?? 0, signal.detail],
      ).catch(() => undefined);
    }
  }
}
