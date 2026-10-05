import { execute, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { toBoolean, toJson, toNumber } from '../../db/sql';
import { AppError, ErrorCode, badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { contextOrDefaults } from '../../core/context';
import { eventBus } from '../../core/events/event-bus';
import { loggerFor } from '../../config/logger';
import { marketplaceRegistry, type CompareField } from '../../marketplaces/module';
import { findCardsByIds, type ListingCard } from '../listings/listings.repository';
import { getAttributes } from '../catalog/catalog.service';
import { convertAmount } from '../locale/fx.service';
import { getSetting } from '../locale/settings.service';
import { emitToUser } from '../../realtime/socket';
import { createShareToken, publicShareUrl } from '../share/share.tokens';
import { throughGateway } from '../ai/ai.gateway';
import { orchestrate } from '../ai/ai.orchestrator';
import type { AiDriver } from '../../providers/ai/types';

const log = loggerFor('comparison');

/**
 * Comparison (§15 Compare, and spec lines 1–3).
 *
 * Two behaviours the spec asks for explicitly:
 *   1. Manual, PakWheels-style side-by-side comparison for vehicles and property.
 *   2. When the set reaches 3–4 items, AI compares them *automatically* — the
 *      user does not have to press anything.
 *
 * The table itself is built from the marketplace module's `comparableFields()`,
 * so gold compares karat and making charges while vehicles compare mileage and
 * engine size, with no branching in this file.
 */

export interface ComparisonRowValue {
  listingId: number;
  raw: unknown;
  display: string;
  /** True when this listing wins the row (best value for a `better` field). */
  isBest: boolean;
}

export interface ComparisonRow {
  code: string;
  label: string;
  group: string;
  kind: string;
  unit: string | null;
  better: 'higher' | 'lower' | 'none';
  /** False when every listing has the same value — the UI can collapse these. */
  differs: boolean;
  values: ComparisonRowValue[];
}

export interface ComparisonSet {
  id: number;
  uuid: string;
  name: string | null;
  marketplaceId: number;
  marketplaceCode: string;
  itemCount: number;
  maxItems: number;
  shareToken: string | null;
  items: ListingCard[];
  rows: ComparisonRow[];
  groups: string[];
  /** Populated when an AI comparison exists or was just generated. */
  aiVerdict: AiComparison | null;
  aiEligible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AiComparison {
  uuid: string;
  summary: string;
  recommendation: string;
  bestOverallListingId: number | null;
  bestValueListingId: number | null;
  bestConditionListingId: number | null;
  criteriaScores: Record<string, Record<string, number>>;
  prosCons: Record<string, { pros: string[]; cons: string[] }>;
  differences: string[];
  model: string;
  language: string;
  generatedAt: string;
}

const DEFAULT_MAX_ITEMS = 6;

async function limits(): Promise<{ maxItems: number; aiMin: number; aiMax: number }> {
  const [maxItems, aiMin, aiMax] = await Promise.all([
    getSetting<number>('compare.max_items', DEFAULT_MAX_ITEMS),
    getSetting<number>('compare.ai_min_items', 3),
    getSetting<number>('compare.ai_max_items', 4),
  ]);
  return { maxItems, aiMin, aiMax };
}

/* -------------------------------------------------------------------------- */
/* Set management                                                             */
/* -------------------------------------------------------------------------- */

interface Owner {
  userId: number | null;
  guestUuid: string | null;
}

function assertOwnership(row: Row, owner: Owner): void {
  const rowUser = row.user_id === null || row.user_id === undefined ? null : Number(row.user_id);
  const rowGuest = (row.guest_uuid as string | null) ?? null;

  const isUserOwner = owner.userId !== null && rowUser !== null && rowUser === owner.userId;
  // Guest sets are keyed by guest_uuid with no user_id — do not match on guest_uuid alone when user_id is set.
  const isGuestOwner =
    owner.userId === null &&
    owner.guestUuid !== null &&
    rowGuest !== null &&
    rowGuest === owner.guestUuid &&
    rowUser === null;

  if (!isUserOwner && !isGuestOwner) throw forbidden('This comparison belongs to someone else');
}

export async function createSet(params: {
  owner: Owner;
  marketplaceId: number;
  name?: string;
  listingIds?: number[];
}): Promise<ComparisonSet> {
  // Guests may compare before signing in (§1), so either identity is acceptable.
  if (params.owner.userId === null && params.owner.guestUuid === null) {
    throw badRequest('A comparison needs either a signed-in user or a guest session');
  }

  const setUuid = uuid();
  const inserted = await execute(
    `INSERT INTO comparison_sets (uuid, user_id, guest_uuid, marketplace_id, name, item_count)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [setUuid, params.owner.userId, params.owner.guestUuid, params.marketplaceId, params.name ?? null],
  );

  const setId = inserted.insertId;
  for (const listingId of params.listingIds ?? []) {
    await addItem({ setId, owner: params.owner, listingId, skipAi: true });
  }

  return getSet({ idOrUuid: setId, owner: params.owner });
}

export async function addItem(params: {
  setId: number | string;
  owner: Owner;
  listingId: number;
  skipAi?: boolean;
}): Promise<ComparisonSet> {
  const set = await loadSetRow(params.setId);
  assertOwnership(set, params.owner);

  const { maxItems, aiMin, aiMax } = await limits();
  const setId = Number(set.id);

  if (Number(set.item_count) >= maxItems) {
    throw conflict(`You can compare up to ${maxItems} items at once`);
  }

  const listing = await queryOne<Row>(
    `SELECT id, marketplace_id, category_id, status FROM listings WHERE id = ? AND deleted_at IS NULL`,
    [params.listingId],
  );
  if (!listing) throw notFound('Listing');

  // Comparing across marketplaces is meaningless — the field sets do not overlap.
  if (Number(listing.marketplace_id) !== Number(set.marketplace_id)) {
    throw new AppError('You can only compare items from the same marketplace', {
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
  }

  const already = await queryOne<Row>('SELECT id FROM comparison_items WHERE comparison_set_id = ? AND listing_id = ?', [
    setId,
    params.listingId,
  ]);
  if (already) {
    return getSet({ idOrUuid: setId, owner: params.owner });
  }

  const itemCount = Number(set.item_count) + 1;

  await transaction(async (connection) => {
    await execute(
      'INSERT INTO comparison_items (comparison_set_id, listing_id, position) VALUES (?, ?, ?)',
      [setId, params.listingId, itemCount],
      connection,
    );
    await execute('UPDATE comparison_sets SET item_count = ? WHERE id = ?', [itemCount, setId], connection);

    const event = await eventBus.enqueue(connection, 'comparison.item_added', 'comparison_set', setId, {
      setId,
      listingId: params.listingId,
      itemCount,
      marketplaceId: Number(set.marketplace_id),
    });
    void eventBus.publishAfterCommit(event);
  });

  const result = await getSet({ idOrUuid: setId, owner: params.owner });
  if (params.owner.userId) {
    emitToUser(params.owner.userId, 'compare:updated', { setId, itemCount: result.itemCount });
  }

  /**
   * Spec line 1: "when user enter 3 or 4 cars name for compare then should AI
   * automatically compare the car". The trigger is the item count crossing into
   * the AI window — no user action required.
   */
  if (!params.skipAi && itemCount >= aiMin && itemCount <= aiMax) {
    void generateAiComparison(setId, params.owner).catch((error) =>
      log.warn({ err: error, setId }, 'automatic AI comparison failed'),
    );
  }

  return result;
}

export async function removeItem(params: { setId: number | string; owner: Owner; listingId: number }): Promise<ComparisonSet> {
  const set = await loadSetRow(params.setId);
  assertOwnership(set, params.owner);
  const setId = Number(set.id);

  const result = await execute('DELETE FROM comparison_items WHERE comparison_set_id = ? AND listing_id = ?', [
    setId,
    params.listingId,
  ]);
  if (result.affectedRows === 0) throw notFound('Comparison item');

  await execute(
    `UPDATE comparison_sets
        SET item_count = (SELECT COUNT(*) FROM comparison_items WHERE comparison_set_id = ?)
      WHERE id = ?`,
    [setId, setId],
  );

  // The stored verdict described a different set of items, so it is now wrong.
  await execute('DELETE FROM comparison_ai_results WHERE comparison_set_id = ?', [setId]);

  const updated = await getSet({ idOrUuid: setId, owner: params.owner });
  if (params.owner.userId) {
    emitToUser(params.owner.userId, 'compare:updated', { setId, itemCount: updated.itemCount });
  }
  return updated;
}

export async function deleteSet(setIdOrUuid: number | string, owner: Owner): Promise<void> {
  const set = await loadSetRow(setIdOrUuid);
  assertOwnership(set, owner);
  await execute('DELETE FROM comparison_sets WHERE id = ?', [set.id]);
}

export async function listSets(owner: Owner): Promise<Array<{ id: number; uuid: string; name: string | null; marketplaceId: number; marketplaceCode: string; itemCount: number; thumbnails: string[]; updatedAt: string }>> {
  const rows = await queryRows<Row>(
    `SELECT cs.id, cs.uuid, cs.name, cs.marketplace_id, cs.item_count, cs.updated_at, m.code AS marketplace_code
       FROM comparison_sets cs
       JOIN marketplaces m ON m.id = cs.marketplace_id
      WHERE (cs.user_id = ? AND ? IS NOT NULL) OR (cs.guest_uuid = ? AND ? IS NOT NULL)
      ORDER BY cs.updated_at DESC LIMIT 50`,
    [owner.userId, owner.userId, owner.guestUuid, owner.guestUuid],
  );

  if (rows.length === 0) return [];

  const thumbnails = await queryRows<Row>(
    `SELECT ci.comparison_set_id, lm.thumb_url
       FROM comparison_items ci
       JOIN listing_media lm ON lm.listing_id = ci.listing_id AND lm.is_primary = 1
      WHERE ci.comparison_set_id IN (${rows.map(() => '?').join(', ')})
      ORDER BY ci.position`,
    rows.map((row) => row.id),
  );

  const bySet = new Map<number, string[]>();
  for (const thumb of thumbnails) {
    const key = Number(thumb.comparison_set_id);
    const list = bySet.get(key) ?? [];
    if (thumb.thumb_url) list.push(String(thumb.thumb_url));
    bySet.set(key, list);
  }

  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    name: (row.name as string | null) ?? null,
    marketplaceId: Number(row.marketplace_id),
    marketplaceCode: String(row.marketplace_code),
    itemCount: Number(row.item_count),
    thumbnails: bySet.get(Number(row.id))?.slice(0, 4) ?? [],
    updatedAt: (row.updated_at as Date).toISOString(),
  }));
}

async function loadSetRow(idOrUuid: number | string): Promise<Row> {
  const numeric = Number(idOrUuid);
  const row = await queryOne<Row>(
    `SELECT cs.*, m.code AS marketplace_code FROM comparison_sets cs
       JOIN marketplaces m ON m.id = cs.marketplace_id
      WHERE cs.id = ? OR cs.uuid = ? OR cs.share_token = ?`,
    [Number.isFinite(numeric) ? numeric : 0, String(idOrUuid), String(idOrUuid)],
  );
  if (!row) throw notFound('Comparison');
  return row;
}

/* -------------------------------------------------------------------------- */
/* Table construction                                                         */
/* -------------------------------------------------------------------------- */

export async function getSet(params: { idOrUuid: number | string; owner: Owner; viaShareToken?: boolean }): Promise<ComparisonSet> {
  const set = await loadSetRow(params.idOrUuid);
  if (!params.viaShareToken) assertOwnership(set, params.owner);

  const context = contextOrDefaults();
  const setId = Number(set.id);
  const marketplaceId = Number(set.marketplace_id);
  const { maxItems, aiMin, aiMax } = await limits();

  const itemRows = await queryRows<Row>(
    'SELECT listing_id FROM comparison_items WHERE comparison_set_id = ? ORDER BY position, id',
    [setId],
  );
  const listingIds = itemRows.map((row) => Number(row.listing_id));
  const items = await findCardsByIds(listingIds, context.language);

  const rows = listingIds.length >= 2 ? await buildRows(marketplaceId, items, context.currency, context.language) : [];
  const aiVerdict = await loadAiComparison(setId);

  return {
    id: setId,
    uuid: String(set.uuid),
    name: (set.name as string | null) ?? null,
    marketplaceId,
    marketplaceCode: String(set.marketplace_code),
    itemCount: items.length,
    maxItems,
    shareToken: (set.share_token as string | null) ?? null,
    items,
    rows,
    groups: [...new Set(rows.map((row) => row.group))],
    aiVerdict,
    aiEligible: items.length >= aiMin && items.length <= aiMax,
    createdAt: (set.created_at as Date).toISOString(),
    updatedAt: (set.updated_at as Date).toISOString(),
  };
}

/**
 * Builds the comparison table.
 *
 * Values come from three places, in this order of preference: the module's
 * typed detail columns, the listing core columns, and the EAV attributes. Money
 * is normalised to the viewer's currency before comparing, otherwise a cheaper
 * listing priced in another currency would look more expensive.
 */
async function buildRows(
  marketplaceId: number,
  items: ListingCard[],
  currency: string,
  language: string,
): Promise<ComparisonRow[]> {
  const module = marketplaceRegistry.getById(marketplaceId);
  if (!module) return [];

  const moduleFields = module.comparableFields();
  const detailMap = await module.loadDetailsBatch(items.map((item) => item.id));

  // Admin-defined comparable attributes extend the module's built-in list, so a
  // new comparable field can be added without a deploy.
  let attributeFields: Awaited<ReturnType<typeof getAttributes>> = [];
  try {
    attributeFields = await getAttributes({
      marketplaceId,
      language,
      onlyComparable: true,
    });
  } catch (error) {
    log.warn({ err: error, marketplaceId }, 'Comparable attributes unavailable; using module fields only');
  }

  const attributeValues = await loadAttributeValues(items.map((item) => item.id));

  const fields: CompareField[] = [
    ...moduleFields,
    ...attributeFields
      .filter((attribute) => !moduleFields.some((field) => field.code === attribute.code))
      .map<CompareField>((attribute) => ({
        code: attribute.code,
        label: attribute.label,
        source: 'attribute',
        attributeCode: attribute.code,
        kind:
          attribute.dataType === 'boolean'
            ? 'boolean'
            : attribute.dataType === 'integer' || attribute.dataType === 'decimal'
              ? 'number'
              : attribute.dataType === 'date'
                ? 'date'
                : attribute.dataType === 'enum'
                  ? 'enum'
                  : 'text',
        unit: attribute.unitCode ?? undefined,
        better: 'none',
        group: 'Specifications',
      })),
  ];

  const rows: ComparisonRow[] = [];

  for (const field of fields) {
    const values: ComparisonRowValue[] = [];

    for (const item of items) {
      const raw = await resolveFieldValue(field, item, detailMap.get(item.id) ?? {}, attributeValues.get(item.id) ?? {}, currency);
      values.push({ listingId: item.id, raw, display: formatValue(raw, field), isBest: false });
    }

    const present = values.filter((value) => value.raw !== null && value.raw !== undefined && value.raw !== '');
    if (present.length === 0 && !field.alwaysShow) continue;

    // A row where everything matches is noise; mark it so the UI can hide it
    // behind a "show identical fields" toggle rather than dropping information.
    const distinct = new Set(present.map((value) => JSON.stringify(value.raw)));
    const differs = distinct.size > 1;
    if (!differs && !field.alwaysShow && present.length < items.length) continue;

    markWinners(values, field);

    rows.push({
      code: field.code,
      label: field.label,
      group: field.group,
      kind: field.kind,
      unit: field.unit ?? null,
      better: field.better ?? 'none',
      differs,
      values,
    });
  }

  return rows;
}

async function resolveFieldValue(
  field: CompareField,
  item: ListingCard,
  details: Record<string, unknown>,
  attributes: Record<string, unknown>,
  currency: string,
): Promise<unknown> {
  switch (field.source) {
    case 'listing': {
      const value = (item as unknown as Record<string, unknown>)[field.column ?? field.code];
      if (field.kind === 'money' && typeof value === 'number' && item.currency && item.currency !== currency) {
        const converted = await convertAmount(value, item.currency, currency);
        return converted?.amount ?? value;
      }
      return value ?? null;
    }
    case 'detail': {
      const key = field.column ?? field.code;
      // Detail maps are camelCase from the module's mapper; fall back to the raw
      // snake_case column name so a field can name either.
      return details[toCamel(key)] ?? details[key] ?? null;
    }
    case 'attribute':
      return attributes[field.attributeCode ?? field.code] ?? null;
    case 'computed':
      return computeDerived(field.code, item, details);
    default:
      return null;
  }
}

/** Derived rows that need both the listing and its details. */
function computeDerived(code: string, item: ListingCard, details: Record<string, unknown>): unknown {
  switch (code) {
    case 'pricePerGram': {
      const weight = toNumber(details.netWeightG);
      return item.price !== null && weight && weight > 0 ? Number((item.price / weight).toFixed(2)) : null;
    }
    case 'pricePerSqm': {
      const area = toNumber(details.areaSqm);
      return item.price !== null && area && area > 0 ? Number((item.price / area).toFixed(2)) : null;
    }
    case 'ageYears': {
      const year = toNumber(details.year) ?? toNumber(details.yearBuilt);
      return year ? new Date().getFullYear() - year : null;
    }
    default:
      return null;
  }
}

const toCamel = (value: string): string => value.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

async function loadAttributeValues(listingIds: number[]): Promise<Map<number, Record<string, unknown>>> {
  if (listingIds.length === 0) return new Map();
  const rows = await queryRows<Row>(
    `SELECT lav.listing_id, a.code, a.data_type, lav.value_text, lav.value_number, lav.value_bool,
            lav.value_date, lav.value_json, ao.label AS option_label
       FROM listing_attribute_values lav
       JOIN attributes a ON a.id = lav.attribute_id
       LEFT JOIN attribute_options ao ON ao.id = lav.option_id
      WHERE lav.listing_id IN (${listingIds.map(() => '?').join(', ')})`,
    listingIds,
  );

  const result = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const key = Number(row.listing_id);
    const bucket = result.get(key) ?? {};
    bucket[String(row.code)] =
      row.option_label ??
      row.value_json ??
      (row.value_bool !== null && row.value_bool !== undefined ? toBoolean(row.value_bool) : null) ??
      toNumber(row.value_number) ??
      (row.value_date ? (row.value_date as Date).toISOString().slice(0, 10) : null) ??
      row.value_text ??
      null;
    result.set(key, bucket);
  }
  return result;
}

/** Marks the winning cell(s) so the UI can highlight the better spec per row. */
function markWinners(values: ComparisonRowValue[], field: CompareField): void {
  const better = field.better ?? 'none';
  if (better === 'none') return;

  if (field.kind === 'boolean') {
    for (const value of values) {
      value.isBest = value.raw === true;
    }
    return;
  }

  const numeric = values
    .map((value) => ({ value, number: toNumber(value.raw) }))
    .filter((entry): entry is { value: ComparisonRowValue; number: number } => entry.number !== null);
  if (numeric.length < 2) return;

  const target = better === 'higher' ? Math.max(...numeric.map((n) => n.number)) : Math.min(...numeric.map((n) => n.number));
  for (const entry of numeric) {
    if (entry.number === target) entry.value.isBest = true;
  }
}

function formatValue(raw: unknown, field: CompareField): string {
  if (raw === null || raw === undefined || raw === '') return '—';
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (field.kind === 'money' && typeof raw === 'number') {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(raw);
  }
  if (typeof raw === 'number') {
    const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(raw);
    return field.unit ? `${formatted} ${field.unit}` : formatted;
  }
  if (Array.isArray(raw)) return raw.join(', ');
  if (typeof raw === 'object') return JSON.stringify(raw);
  // Turn enum values like `very_good` into `Very good`.
  const text = String(raw);
  return /^[a-z0-9_]+$/.test(text) ? text.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : text;
}

/* -------------------------------------------------------------------------- */
/* AI comparison (spec line 1)                                                */
/* -------------------------------------------------------------------------- */

export async function generateAiComparison(setIdOrUuid: number | string, owner: Owner, force = false): Promise<AiComparison | null> {
  const set = await loadSetRow(setIdOrUuid);
  assertOwnership(set, owner);
  const setId = Number(set.id);
  const context = contextOrDefaults();
  const { aiMin, aiMax } = await limits();

  if (!force) {
    const existing = await loadAiComparison(setId);
    if (existing) return existing;
  }

  const itemCount = Number(set.item_count);
  // Manual / post-compare AI may run from 2 cars when force=true (PakWheels-style).
  const minRequired = force ? Math.min(aiMin, 2) : aiMin;
  if (itemCount < minRequired) {
    throw badRequest(`Add at least ${minRequired} items to get an AI comparison`);
  }
  if (itemCount > aiMax) {
    throw badRequest(`AI comparison works with up to ${aiMax} items; remove some to continue`);
  }

  const comparison = await getSet({ idOrUuid: setId, owner });
  if (comparison.items.length < minRequired) return null;

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'comparison.ai_requested', 'comparison_set', setId, {
      setId,
      listingIds: comparison.items.map((item) => item.id),
      marketplaceId: comparison.marketplaceId,
    });
    void eventBus.publishAfterCommit(event);
  });

  const run = (driver: AiDriver) =>
    driver.compareListings({
      marketplaceCode: comparison.marketplaceCode,
      language: context.language,
      currency: context.currency,
      items: comparison.items.map((item) => ({
        id: item.id,
        title: item.title,
        price: item.price,
        currency: item.currency,
        condition: item.conditionCode,
        city: item.cityName,
        sellerRating: item.seller.rating,
        isVerifiedSeller: item.seller.isVerified,
      })),
      rows: comparison.rows.map((row) => ({
        code: row.code,
        label: row.label,
        group: row.group,
        better: row.better,
        unit: row.unit,
        differs: row.differs,
        values: row.values.map((value) => ({ listingId: value.listingId, display: value.display, raw: value.raw })),
      })),
    });
  let verdict;
  try {
    const gated = owner.userId
      ? await throughGateway({ userId: owner.userId }, { task: 'compare', input: { setId }, run })
      : await orchestrate({ task: 'compare', skipEntitlement: true, skipQuota: true, input: { setId } }, run);
    if ('accepted' in gated) return null;
    verdict = gated.result;
  } catch (error) {
    log.debug({ err: error, setId }, 'AI comparison skipped');
    return null;
  }

  const resultUuid = uuid();
  const expiresAt = new Date(Date.now() + 24 * 3_600_000);

  await execute(
    `INSERT INTO comparison_ai_results
       (uuid, comparison_set_id, listing_ids, item_count, verdict_summary, best_overall_listing_id,
        best_value_listing_id, best_condition_listing_id, criteria_scores, pros_cons, recommendation,
        differences, model, tokens_used, latency_ms, language, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      resultUuid,
      setId,
      JSON.stringify(comparison.items.map((item) => item.id)),
      comparison.items.length,
      verdict.summary,
      verdict.bestOverallListingId,
      verdict.bestValueListingId,
      verdict.bestConditionListingId,
      JSON.stringify(verdict.criteriaScores),
      JSON.stringify(verdict.prosCons),
      verdict.recommendation,
      JSON.stringify(verdict.differences),
      verdict.model,
      verdict.tokensUsed ?? null,
      verdict.latencyMs ?? null,
      context.language,
      expiresAt,
    ],
  );

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'comparison.ai_ready', 'comparison_set', setId, {
      setId,
      resultId: 0,
    });
    void eventBus.publishAfterCommit(event);
  });

  return loadAiComparison(setId);
}

async function loadAiComparison(setId: number): Promise<AiComparison | null> {
  const row = await queryOne<Row>(
    `SELECT * FROM comparison_ai_results
      WHERE comparison_set_id = ? AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY generated_at DESC LIMIT 1`,
    [setId],
  );
  if (!row) return null;

  // A verdict written for a different item set must not be shown as current.
  const storedIds = toJson<number[]>(row.listing_ids, []);
  const currentIds = (
    await queryRows<Row>('SELECT listing_id FROM comparison_items WHERE comparison_set_id = ? ORDER BY position', [setId])
  ).map((item) => Number(item.listing_id));

  if (storedIds.length !== currentIds.length || storedIds.some((id) => !currentIds.includes(id))) {
    return null;
  }

  return {
    uuid: String(row.uuid),
    summary: String(row.verdict_summary ?? ''),
    recommendation: String(row.recommendation ?? ''),
    bestOverallListingId: row.best_overall_listing_id === null ? null : Number(row.best_overall_listing_id),
    bestValueListingId: row.best_value_listing_id === null ? null : Number(row.best_value_listing_id),
    bestConditionListingId: row.best_condition_listing_id === null ? null : Number(row.best_condition_listing_id),
    criteriaScores: toJson<Record<string, Record<string, number>>>(row.criteria_scores, {}),
    prosCons: toJson<Record<string, { pros: string[]; cons: string[] }>>(row.pros_cons, {}),
    differences: toJson<string[]>(row.differences, []),
    model: String(row.model),
    language: String(row.language ?? 'en'),
    generatedAt: (row.generated_at as Date).toISOString(),
  };
}

/**
 * Spec line 1 verbatim: the user types 3–4 *names* rather than picking listings.
 * We resolve each name to the best-matching published listing, then compare.
 */
export async function compareByNames(params: {
  owner: Owner;
  marketplaceId: number;
  names: string[];
  countryId: number | null;
}): Promise<{ set: ComparisonSet; resolved: Array<{ query: string; listingId: number | null; title: string | null }> }> {
  const { aiMax } = await limits();
  if (params.names.length < 2) throw badRequest('Give at least two names to compare');
  if (params.names.length > aiMax) throw badRequest(`Compare up to ${aiMax} items at a time`);

  const resolved: Array<{ query: string; listingId: number | null; title: string | null }> = [];

  for (const name of params.names) {
    let match = await queryOne<Row>(
      `SELECT l.id, l.title,
              MATCH(l.title, l.description) AGAINST (? IN NATURAL LANGUAGE MODE) AS relevance
         FROM listings l
        WHERE l.marketplace_id = ? AND l.status = 'published' AND l.deleted_at IS NULL
          AND (? IS NULL OR l.country_id = ?)
          AND MATCH(l.title, l.description) AGAINST (? IN NATURAL LANGUAGE MODE)
        ORDER BY relevance DESC, l.is_featured DESC, l.view_count DESC
        LIMIT 1`,
      [name, params.marketplaceId, params.countryId, params.countryId, name],
    );

    // FULLTEXT can miss short / brand-model queries — fall back to LIKE.
    if (!match) {
      const like = `%${name.replace(/[%_]/g, '').trim()}%`;
      match = await queryOne<Row>(
        `SELECT l.id, l.title
           FROM listings l
          WHERE l.marketplace_id = ? AND l.status = 'published' AND l.deleted_at IS NULL
            AND (? IS NULL OR l.country_id = ?)
            AND (l.title LIKE ? OR l.description LIKE ?)
          ORDER BY l.is_featured DESC, l.view_count DESC, l.id DESC
          LIMIT 1`,
        [params.marketplaceId, params.countryId, params.countryId, like, like],
      );
    }

    resolved.push({
      query: name,
      listingId: match ? Number(match.id) : null,
      title: match ? String(match.title) : null,
    });
  }

  const listingIds = resolved.map((entry) => entry.listingId).filter((id): id is number => id !== null);
  if (listingIds.length < 2) {
    throw badRequest('Could not find enough matching listings for those names');
  }

  const set = await createSet({
    owner: params.owner,
    marketplaceId: params.marketplaceId,
    name: params.names.join(' vs '),
    listingIds,
  });

  // Automatic AI once we have at least 2 resolved listings (force allows 2).
  if (listingIds.length >= 2 && listingIds.length <= aiMax) {
    await generateAiComparison(set.id, params.owner, true).catch((error) =>
      log.warn({ err: error, setId: set.id }, 'AI comparison after name lookup failed'),
    );
  }

  return { set: await getSet({ idOrUuid: set.id, owner: params.owner }), resolved };
}

/** §15 Share — issues a read-only token for the set. */
export async function shareSet(setIdOrUuid: number | string, owner: Owner): Promise<{ shareToken: string; url: string }> {
  const set = await loadSetRow(setIdOrUuid);
  assertOwnership(set, owner);

  let token = set.share_token as string | null;
  if (!token) {
    token = uuid();
    await execute('UPDATE comparison_sets SET share_token = ? WHERE id = ?', [token, set.id]);
  }
  if (owner.userId) {
    await createShareToken({
      ownerUserId: owner.userId,
      targetType: 'comparison',
      targetId: Number(set.id),
      token,
    });
  }
  return { shareToken: token, url: publicShareUrl(token) };
}
