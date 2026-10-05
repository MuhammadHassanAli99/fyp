import type { PoolConnection } from '../../db/pool';
import { execute, queryOne, queryRows, queryCount, transaction, type Row } from '../../db/query';
import { buildInsert, buildUpdate, toBoolean, toJson, toNumber } from '../../db/sql';
import { AppError, ErrorCode, badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { referenceCode, uuid } from '../../core/security/crypto';
import { env } from '../../config/env';
import { contextOrDefaults } from '../../core/context';
import { eventBus } from '../../core/events/event-bus';
import { loggerFor } from '../../config/logger';
import { marketplaceRegistry } from '../../marketplaces/module';
import { getAttributeIndex, getOptionIndex, getMarketplace } from '../catalog/catalog.service';
import { consumeQuota, getQuota, releaseQuota, loadEntitlements } from '../../middleware/entitlements';
import { convertAmount } from '../locale/fx.service';
import { ALLOWED_TRANSITIONS, type CreateListingInput, type ListingStatus, type UpdateListingInput } from './listings.schema';
import { findSimilar, mapCard, type ListingCard } from './listings.repository';
import { scoreCompleteness as scorePayload } from './listings.validation';
import { recordListingEvent } from './listings.events';
import { readDimensions, isPubliclyViewable } from './listings.lifecycle';
import {
  appealRejection,
  archiveListing,
  captureVersionOnUpdate,
  listListingEvents,
  listRejections,
  publishListing,
  rejectListing,
  renewListingEngine,
  requireListingActor,
  restoreListing,
  setTransactionStatus,
  submitListing,
} from './listings.engine';
import { type ListingActor } from './listings.permissions';
import { enqueueListingAnalytics, getListingAnalytics, recordShare } from './listings.analytics';
import { createShareToken } from '../share/share.tokens';
import { listListingPromotions, listPromotionPackages, requestPromotion } from './listings.promotions';
import { addAvailabilityBlock, listAvailability } from './listings.availability';
import { listListingVersions } from './listings.versions';

const log = loggerFor('listings');

export interface ListingDetail extends ListingCard {
  description: string | null;
  address: string | null;
  postalCode: string | null;
  regionId: number | null;
  regionName: string | null;
  countryName: string | null;
  hideExactLocation: boolean;
  expiresAt: string | null;
  soldAt: string | null;
  renewalCount: number;
  leadCount: number;
  shareCount: number;
  completenessScore: number;
  moderationState: string;
  contactPhone: string | null;
  contactWhatsapp: string | null;
  allowChat: boolean;
  allowCalls: boolean;
  allowOffers: boolean;
  rejectionReason: string | null;
  media: Array<{
    id: number;
    kind: string;
    url: string;
    thumbUrl: string | null;
    caption: string | null;
    isPrimary: boolean;
    width: number | null;
    height: number | null;
    durationSecs: number | null;
    isAiEnhanced: boolean;
  }>;
  documents: Array<{ id: number; docType: string; title: string | null; fileUrl: string | null; isPublic: boolean; isVerified: boolean }>;
  attributes: Array<{ code: string; label: string; value: unknown; unit: string | null; showInCard: boolean; group: string | null }>;
  details: Record<string, unknown>;
  priceBreakdown: Array<{ code: string; label: string; amount: number; kind: string }>;
  unitPrice: { value: number; unit: string } | null;
  convertedPrice: { amount: number; currency: string; rate: number } | null;
  auction: Record<string, unknown> | null;
  canEdit: boolean;
  canContact: boolean;
  lifecycleStatus: string;
  transactionStatus: string;
  moderationStatus: string;
  expirationStatus: string;
  currentVersion: number;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                      */
/* -------------------------------------------------------------------------- */

const DETAIL_SELECT = `
  l.*, m.code AS marketplace_code, c.name AS category_name,
  ct.name AS category_name_localized,
  city.name AS city_name, ar.name AS area_name, reg.name AS region_name, co.name AS country_name,
  p.display_name AS seller_name, p.avatar_url AS seller_avatar,
  p.show_phone AS seller_show_phone, p.show_whatsapp AS seller_show_whatsapp,
  bp.trade_name AS business_name, bp.kind AS business_kind, bp.verified_at AS business_verified_at,
  u.account_type AS seller_account_type, u.phone_e164 AS seller_phone,
  ts.band AS seller_trust_band,
  rs.average_rating AS seller_rating, rs.review_count AS seller_review_count,
  (SELECT COUNT(*) FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = l.user_id AND b.code = 'verified') AS seller_verified,
  (SELECT COUNT(*) FROM listing_media lmv WHERE lmv.listing_id = l.id AND lmv.kind = 'video') AS video_count,
  (SELECT lm.thumb_url FROM listing_media lm WHERE lm.listing_id = l.id AND lm.kind = 'image'
    ORDER BY lm.is_primary DESC, lm.sort_order LIMIT 1) AS primary_image
`;

const DETAIL_JOINS = `
  FROM listings l
  JOIN marketplaces m ON m.id = l.marketplace_id
  JOIN categories c ON c.id = l.category_id
  LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
  LEFT JOIN cities city ON city.id = l.city_id
  LEFT JOIN areas ar ON ar.id = l.area_id
  LEFT JOIN regions reg ON reg.id = l.region_id
  LEFT JOIN countries co ON co.id = l.country_id
  JOIN users u ON u.id = l.user_id
  LEFT JOIN user_profiles p ON p.user_id = l.user_id
  LEFT JOIN business_profiles bp ON bp.id = l.business_id
  LEFT JOIN trust_scores ts ON ts.user_id = l.user_id
  LEFT JOIN rating_summaries rs ON rs.subject_kind = 'user' AND rs.subject_id = l.user_id AND rs.marketplace_id = 0
`;

export async function getListing(params: {
  idOrUuid: string | number;
  language: string;
  currency: string;
  viewerId: number | null;
  isStaff: boolean;
}): Promise<ListingDetail> {
  const numericId = Number(params.idOrUuid);
  const row = await queryOne<Row>(
    `SELECT ${DETAIL_SELECT} ${DETAIL_JOINS}
      WHERE (l.id = ? OR l.uuid = ? OR l.reference_code = ? OR l.slug = ?) AND l.deleted_at IS NULL`,
    [params.language, Number.isFinite(numericId) ? numericId : 0, String(params.idOrUuid), String(params.idOrUuid), String(params.idOrUuid)],
  );
  if (!row) throw notFound('Listing');

  const listingId = Number(row.id);
  const ownerId = Number(row.user_id);
  const isOwner = params.viewerId !== null && params.viewerId === ownerId;
  const dimensions = readDimensions(row);

  if (!isPubliclyViewable(dimensions) && !isOwner && !params.isStaff) {
    throw notFound('Listing');
  }

  const module = marketplaceRegistry.getById(Number(row.marketplace_id));

  const [media, documents, attributeValues, details, auction] = await Promise.all([
    queryRows<Row>(
      `SELECT id, kind, url, thumb_url, card_url, caption, is_primary, sort_order, width, height,
              duration_secs, is_ai_enhanced
         FROM listing_media WHERE listing_id = ? AND status = 'ready'
        ORDER BY is_primary DESC, sort_order, id`,
      [listingId],
    ),
    queryRows<Row>(
      `SELECT id, doc_type, title, file_url, is_public, verified_at
         FROM listing_documents WHERE listing_id = ? ORDER BY doc_type`,
      [listingId],
    ),
    queryRows<Row>(
      `SELECT lav.value_text, lav.value_number, lav.value_bool, lav.value_date, lav.value_json,
              lav.unit_code, a.code, a.data_type, a.unit_code AS attr_unit, a.show_in_card,
              COALESCE(at.label, a.label) AS label,
              ao.label AS option_label
         FROM listing_attribute_values lav
         JOIN attributes a ON a.id = lav.attribute_id
         LEFT JOIN attribute_translations at ON at.attribute_id = a.id AND at.language = ?
         LEFT JOIN attribute_options ao ON ao.id = lav.option_id
        WHERE lav.listing_id = ?
        ORDER BY a.sort_order, a.id`,
      [params.language, listingId],
    ),
    module ? module.loadDetails(listingId) : Promise.resolve(null),
    row.operation === 'auction'
      ? queryOne<Row>('SELECT * FROM auctions WHERE listing_id = ?', [listingId])
      : Promise.resolve(null),
  ]);

  const card = mapCard(row);
  const price = toNumber(row.price);
  const currency = (row.currency as string | null) ?? null;

  // §1 "Show original price / Show converted price": we always return the
  // original and, when the viewer's currency differs, the conversion alongside it.
  let convertedPrice: ListingDetail['convertedPrice'] = null;
  if (price !== null && currency && currency !== params.currency) {
    const converted = await convertAmount(price, currency, params.currency);
    if (converted) convertedPrice = converted;
  }

  const pricing = module?.pricingModel();
  const detailPayload = details ?? {};
  const priceBreakdown = pricing ? pricing.breakdown(detailPayload, currency ?? params.currency) : [];
  const unitPrice = pricing?.unitPrice && price !== null ? pricing.unitPrice(detailPayload, price) : null;

  const sellerShowsPhone = toBoolean(row.seller_show_phone);

  return {
    ...card,
    description: (row.description as string | null) ?? null,
    address: toBoolean(row.hide_exact_location) ? null : ((row.address as string | null) ?? null),
    postalCode: (row.postal_code as string | null) ?? null,
    regionId: row.region_id === null ? null : Number(row.region_id),
    regionName: (row.region_name as string | null) ?? null,
    countryName: (row.country_name as string | null) ?? null,
    hideExactLocation: toBoolean(row.hide_exact_location),
    expiresAt: row.expires_at ? (row.expires_at as Date).toISOString() : null,
    soldAt: row.sold_at ? (row.sold_at as Date).toISOString() : null,
    renewalCount: Number(row.renewal_count ?? 0),
    leadCount: Number(row.lead_count ?? 0),
    shareCount: Number(row.share_count ?? 0),
    completenessScore: Number(row.completeness_score ?? 0),
    moderationState: String(row.moderation_state),
    // Contact details are only exposed when the seller allows it.
    contactPhone: sellerShowsPhone ? ((row.contact_phone as string | null) ?? (row.seller_phone as string | null)) : null,
    contactWhatsapp: toBoolean(row.seller_show_whatsapp) ? ((row.contact_whatsapp as string | null) ?? null) : null,
    allowChat: toBoolean(row.allow_chat),
    allowCalls: toBoolean(row.allow_calls),
    allowOffers: toBoolean(row.allow_offers),
    rejectionReason: isOwner || params.isStaff ? ((row.rejection_reason as string | null) ?? null) : null,
    media: media.map((item) => ({
      id: Number(item.id),
      kind: String(item.kind),
      url: String(item.url),
      thumbUrl: (item.thumb_url as string | null) ?? null,
      caption: (item.caption as string | null) ?? null,
      isPrimary: toBoolean(item.is_primary),
      width: item.width === null ? null : Number(item.width),
      height: item.height === null ? null : Number(item.height),
      durationSecs: item.duration_secs === null ? null : Number(item.duration_secs),
      isAiEnhanced: toBoolean(item.is_ai_enhanced),
    })),
    documents: documents.map((doc) => ({
      id: Number(doc.id),
      docType: String(doc.doc_type),
      title: (doc.title as string | null) ?? null,
      // Private documents are listed (so buyers know they exist) without the URL.
      fileUrl: toBoolean(doc.is_public) || isOwner || params.isStaff ? String(doc.file_url) : null,
      isPublic: toBoolean(doc.is_public),
      isVerified: doc.verified_at !== null,
    })),
    attributes: attributeValues.map((value) => ({
      code: String(value.code),
      label: String(value.label),
      value: readAttributeValue(value),
      unit: (value.unit_code as string | null) ?? (value.attr_unit as string | null) ?? null,
      showInCard: toBoolean(value.show_in_card),
      group: null,
    })),
    details: detailPayload,
    priceBreakdown,
    unitPrice,
    convertedPrice,
    auction: auction ? mapAuction(auction) : null,
    canEdit: isOwner || params.isStaff,
    canContact:
      params.viewerId !== null &&
      !isOwner &&
      dimensions.lifecycleStatus === 'published' &&
      (toBoolean(row.allow_chat) || toBoolean(row.allow_calls)),
    lifecycleStatus: dimensions.lifecycleStatus,
    transactionStatus: dimensions.transactionStatus,
    moderationStatus: dimensions.moderationStatus,
    expirationStatus: dimensions.expirationStatus,
    currentVersion: Number(row.current_version ?? 1),
  };
}

const readAttributeValue = (row: Row): unknown => {
  if (row.option_label !== null && row.option_label !== undefined) return row.option_label;
  if (row.value_json !== null && row.value_json !== undefined) return row.value_json;
  if (row.value_bool !== null && row.value_bool !== undefined) return toBoolean(row.value_bool);
  if (row.value_number !== null && row.value_number !== undefined) return toNumber(row.value_number);
  if (row.value_date !== null && row.value_date !== undefined) return (row.value_date as Date).toISOString().slice(0, 10);
  return row.value_text ?? null;
};

const mapAuction = (row: Row): Record<string, unknown> => {
  const status = String(row.status);
  const live = status === 'live' || status === 'scheduled' || status === 'paused';
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    startPrice: toNumber(row.start_price),
    reservePrice: toNumber(row.reserve_price),
    buyNowPrice: toNumber(row.buy_now_price),
    bidIncrement: toNumber(row.bid_increment),
    currency: String(row.currency),
    currentBid: toNumber(row.current_bid),
    bidCount: Number(row.bid_count ?? 0),
    startsAt: (row.starts_at as Date).toISOString(),
    endsAt: (row.ends_at as Date).toISOString(),
    status,
    requiresDeposit: toBoolean(row.requires_deposit),
    depositAmount: toNumber(row.deposit_amount),
    settlementStatus: (row.settlement_status as string | undefined) ?? 'none',
    winnerId: live ? null : row.winner_id === null ? null : Number(row.winner_id),
    serverNow: new Date().toISOString(),
  };
};

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

export async function createListing(userId: number, input: CreateListingInput): Promise<{ listing: ListingDetail; warnings: string[] }> {
  const context = contextOrDefaults();

  const marketplace = await getMarketplace(input.marketplace ?? input.marketplaceId ?? context.marketplaceId ?? 0);
  const module = marketplaceRegistry.require(marketplace.code);

  if (!marketplace.operations.includes(input.operation)) {
    throw new AppError(`${marketplace.name} does not support "${input.operation}"`, {
      status: 400,
      code: ErrorCode.UNSUPPORTED_OPERATION,
      details: { supported: marketplace.operations },
    });
  }

  const category = await queryOne<Row>(
    'SELECT id, code, marketplace_id, is_leaf FROM categories WHERE id = ? AND is_active = 1',
    [input.categoryId],
  );
  if (!category) throw badRequest('The selected category does not exist');
  if (Number(category.marketplace_id) !== marketplace.id) {
    throw badRequest('That category belongs to a different marketplace');
  }
  if (!toBoolean(category.is_leaf)) {
    throw badRequest('Pick a specific subcategory rather than a top-level one');
  }

  // §16 quota. Reserve before doing the work so we do not create a listing the
  // plan does not allow, and release it if publishing fails.
  const publishing = input.publish;
  const quota = await getQuota(userId, 'active_listings');
  if (!quota.unlimited && quota.remaining !== null && quota.remaining <= 0) {
    throw new AppError('You have reached the listing limit for your plan', {
      status: 403,
      code: ErrorCode.QUOTA_EXCEEDED,
      details: { feature: 'active_listings', limit: quota.limit, upgradeAvailable: true },
    });
  }

  const entitlements = await loadEntitlements(userId);
  const mediaLimit = entitlements.features.images_per_listing?.limit ?? env.LISTING_MAX_MEDIA;
  if (input.media && mediaLimit !== null && input.media.length > mediaLimit) {
    throw new AppError(`Your plan allows ${mediaLimit} images per listing`, {
      status: 403,
      code: ErrorCode.QUOTA_EXCEEDED,
      details: { feature: 'images_per_listing', limit: mediaLimit },
    });
  }
  if (input.operation === 'auction' && marketplace.code === 'gold' && entitlements.features.gold_auctions && !entitlements.features.gold_auctions.enabled) {
    throw new AppError('Gold auctions are not included in your current plan', {
      status: 403,
      code: ErrorCode.FEATURE_NOT_IN_PLAN,
      details: { feature: 'gold_auctions', currentPlan: entitlements.planCode },
    });
  }

  if (input.businessId) {
    const { assertBusinessPermission } = await import('../business/business.service');
    await assertBusinessPermission(input.businessId, userId, 'listing.post');
  }

  const validation = await module.validateDetails(input.details, {
    operation: input.operation,
    categoryCode: String(category.code),
    countryId: input.location?.countryId ?? context.countryId,
  });

  const currency = input.currency ?? context.currency;
  const priceBase =
    input.price !== undefined && currency
      ? ((await convertAmount(input.price, currency, env.BASE_CURRENCY))?.amount ?? input.price)
      : null;

  const derived = module.deriveComputedColumns
    ? module.deriveComputedColumns(validation.details, { price: input.price ?? null, currency })
    : validation.details;

  const result = await transaction(async (connection) => {
    await queryOne('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId], connection);
    const activeCount = await queryCount(
      `SELECT COUNT(*) FROM listings
        WHERE user_id = ? AND deleted_at IS NULL
          AND (lifecycle_status IN ('pending_review','published') OR status IN ('pending_review','published','validating','reserved'))`,
      [userId],
      connection,
    );
    if (!quota.unlimited && quota.limit !== null && activeCount >= quota.limit) {
      throw new AppError('You have reached the listing limit for your plan', {
        status: 403,
        code: ErrorCode.QUOTA_EXCEEDED,
        details: { feature: 'active_listings', limit: quota.limit, upgradeAvailable: true },
      });
    }

    const listingUuid = uuid();
    const reference = referenceCode(marketplace.code.slice(0, 3));
    const publishing = input.publish;
    const status: ListingStatus = publishing ? 'pending_review' : 'draft';
    const fxRate = priceBase !== null && input.price ? priceBase / input.price : null;

    const insert = buildInsert('listings', {
      uuid: listingUuid,
      reference_code: reference,
      marketplace_id: marketplace.id,
      category_id: input.categoryId,
      user_id: userId,
      seller_id: userId,
      created_by: userId,
      business_id: input.businessId ?? null,
      operation: input.operation,
      title: input.title,
      slug: await uniqueSlug(input.title, marketplace.id, connection),
      description: input.description ?? null,
      language: context.language,
      condition_code: input.conditionCode ?? null,
      price: input.price ?? null,
      currency: input.price !== undefined ? currency : null,
      price_type: input.priceType,
      price_period: input.pricePeriod,
      price_base: priceBase,
      price_fx_rate: fxRate,
      price_fx_at: fxRate !== null ? new Date() : null,
      price_negotiable: input.priceNegotiable ? 1 : 0,
      installments_available: input.installmentsAvailable ? 1 : 0,
      country_id: input.location?.countryId ?? context.countryId ?? 1,
      region_id: input.location?.regionId ?? null,
      city_id: input.location?.cityId ?? null,
      area_id: input.location?.areaId ?? null,
      address: input.location?.address ?? null,
      postal_code: input.location?.postalCode ?? null,
      latitude: input.location?.latitude ?? null,
      longitude: input.location?.longitude ?? null,
      hide_exact_location: input.location?.hideExactLocation ? 1 : 0,
      status,
      lifecycle_status: publishing ? 'pending_review' : 'draft',
      transaction_status: 'available',
      moderation_status: publishing ? 'in_review' : 'not_reviewed',
      expiration_status: 'active',
      current_version: 1,
      contact_phone: input.contactPhone ?? null,
      contact_whatsapp: input.contactWhatsapp ?? null,
      allow_chat: input.allowChat ? 1 : 0,
      allow_calls: input.allowCalls ? 1 : 0,
      allow_offers: input.allowOffers ? 1 : 0,
      media_count: input.media?.length ?? 0,
      completeness_score: scorePayload({
        title: input.title,
        description: input.description,
        price: input.price,
        mediaCount: input.media?.length ?? 0,
        cityId: input.location?.cityId,
        latitude: input.location?.latitude,
        attributeCount: input.attributes ? Object.keys(input.attributes).length : 0,
        documentCount: input.documents?.length ?? 0,
        detailsPresent: input.details !== undefined,
      }),
      source: context.platform === 'web' ? 'web' : 'app',
    });

    const inserted = await execute(insert.sql, insert.params, connection);
    const listingId = inserted.insertId;

    await module.saveDetails(listingId, derived, connection);
    if (input.attributes) await saveAttributeValues(listingId, marketplace.id, input.attributes, connection);
    if (input.media && input.media.length > 0) await saveMedia(listingId, input.media, connection);
    if (input.documents && input.documents.length > 0) await saveDocuments(listingId, input.documents, connection);

    if (input.operation === 'auction' && input.auction) {
      await createAuction(listingId, input.auction, currency, connection);
    }

    await recordStatusChange(listingId, null, status, userId, 'owner', null, connection);
    await recordListingEvent(listingId, 'CREATED', { id: userId, type: 'owner' }, { status, marketplaceId: marketplace.id }, connection);

    const event = await eventBus.enqueue(connection, 'listing.created', 'listing', listingId, {
      listingId,
      userId,
      marketplaceId: marketplace.id,
      categoryId: input.categoryId,
      status,
    });

    return { listingId, event };
  });

  void eventBus.publishAfterCommit(result.event);

  if (publishing) {
    await consumeQuota(userId, 'active_listings').catch(async (error) => {
      log.warn({ err: error, listingId: result.listingId }, 'quota consume failed after create');
      throw error;
    });
    // The publish gate (duplicate/spam/fraud checks) runs asynchronously; the
    // listing sits in pending_review until it clears.
    void submitForReview(result.listingId, userId).catch((error) =>
      log.error({ err: error, listingId: result.listingId }, 'auto submit failed'),
    );
  }

  const listing = await getListing({
    idOrUuid: result.listingId,
    language: context.language,
    currency: context.currency,
    viewerId: userId,
    isStaff: false,
  });

  return { listing, warnings: validation.warnings };
}

async function uniqueSlug(title: string, marketplaceId: number, connection?: PoolConnection): Promise<string> {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff\u0900-\u097f]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180) || 'listing';

  const taken = await queryCount(
    'SELECT COUNT(*) FROM listings WHERE marketplace_id = ? AND slug LIKE ?',
    [marketplaceId, `${base}%`],
    connection,
  );
  return taken === 0 ? base : `${base}-${taken + 1}-${Date.now().toString(36).slice(-4)}`;
}

/* -------------------------------------------------------------------------- */
/* EAV values                                                                 */
/* -------------------------------------------------------------------------- */

export async function saveAttributeValues(
  listingId: number,
  marketplaceId: number,
  values: Record<string, unknown>,
  connection: PoolConnection,
): Promise<void> {
  const { byCode } = await getAttributeIndex(marketplaceId);

  for (const [code, raw] of Object.entries(values)) {
    const attribute = byCode.get(code);
    // Silently skipping unknown codes keeps an older client from failing when
    // the admin renames an attribute.
    if (!attribute || raw === null || raw === undefined || raw === '') continue;

    let valueText: string | null = null;
    let valueNumber: number | null = null;
    let valueBool: number | null = null;
    let valueDate: string | null = null;
    let valueJson: string | null = null;
    let optionId: number | null = null;

    switch (attribute.dataType) {
      case 'integer':
      case 'decimal': {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) continue;
        valueNumber = parsed;
        break;
      }
      case 'boolean':
        valueBool = raw === true || raw === 'true' || raw === 1 || raw === '1' ? 1 : 0;
        break;
      case 'date': {
        const date = new Date(String(raw));
        if (Number.isNaN(date.getTime())) continue;
        valueDate = date.toISOString().slice(0, 10);
        break;
      }
      case 'enum': {
        valueText = String(raw).slice(0, 500);
        const options = await getOptionIndex(attribute.id);
        optionId = options.get(valueText) ?? null;
        break;
      }
      case 'multi_enum':
        valueJson = JSON.stringify(Array.isArray(raw) ? raw.slice(0, 50) : [raw]);
        break;
      case 'json':
        valueJson = JSON.stringify(raw);
        break;
      default:
        valueText = String(raw).slice(0, 500);
        // Numeric-looking text is also stored numerically so range filters work.
        if (/^-?\d+(\.\d+)?$/.test(valueText)) valueNumber = Number(valueText);
    }

    await execute(
      `INSERT INTO listing_attribute_values
         (listing_id, attribute_id, value_text, value_number, value_bool, value_date, value_json, option_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         value_text = VALUES(value_text), value_number = VALUES(value_number),
         value_bool = VALUES(value_bool), value_date = VALUES(value_date),
         value_json = VALUES(value_json), option_id = VALUES(option_id)`,
      [listingId, attribute.id, valueText, valueNumber, valueBool, valueDate, valueJson, optionId],
      connection,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Media & documents                                                          */
/* -------------------------------------------------------------------------- */

async function saveMedia(
  listingId: number,
  media: NonNullable<CreateListingInput['media']>,
  connection: PoolConnection,
): Promise<void> {
  const hasExplicitPrimary = media.some((item) => item.isPrimary);
  for (const [index, item] of media.entries()) {
    await execute(
      `INSERT INTO listing_media
         (listing_id, kind, url, thumb_url, caption, is_primary, sort_order, width, height, duration_secs, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        listingId,
        item.kind,
        item.url,
        item.thumbUrl ?? item.url,
        item.caption ?? null,
        // Without an explicit choice the first image becomes the cover.
        (hasExplicitPrimary ? item.isPrimary : index === 0) ? 1 : 0,
        index,
        item.width ?? null,
        item.height ?? null,
        item.durationSecs ?? null,
        item.kind === 'video' ? 'processing' : 'ready',
      ],
      connection,
    );
  }
  await execute('UPDATE listings SET media_count = (SELECT COUNT(*) FROM listing_media WHERE listing_id = ?) WHERE id = ?', [
    listingId,
    listingId,
  ], connection);
}

async function saveDocuments(
  listingId: number,
  documents: NonNullable<CreateListingInput['documents']>,
  connection: PoolConnection,
): Promise<void> {
  for (const doc of documents) {
    await execute(
      `INSERT INTO listing_documents (listing_id, doc_type, title, file_url, is_public)
       VALUES (?, ?, ?, ?, ?)`,
      [listingId, doc.docType, doc.title ?? null, doc.fileUrl, doc.isPublic ? 1 : 0],
      connection,
    );
  }
}

export async function addMedia(
  listingId: number,
  userId: number,
  isStaff: boolean,
  item: { url: string; thumbUrl?: string; kind: string; caption?: string; isPrimary: boolean; sortOrder?: number; width?: number; height?: number; sizeBytes?: number; mimeType?: string },
): Promise<{ id: number; mediaCount: number }> {
  const listing = await requireOwnedListing(listingId, userId, isStaff);

  const entitlements = await loadEntitlements(userId);
  const limit = entitlements.features.images_per_listing?.limit ?? env.LISTING_MAX_MEDIA;
  const current = Number(listing.media_count ?? 0);
  if (limit !== null && !entitlements.features.images_per_listing?.unlimited && current >= limit) {
    throw new AppError(`Your plan allows ${limit} media items per listing`, {
      status: 403,
      code: ErrorCode.QUOTA_EXCEEDED,
      details: { feature: 'images_per_listing', limit },
    });
  }
  if (item.kind === 'video' && !entitlements.features.video_upload?.enabled) {
    throw new AppError('Video upload is not included in your plan', {
      status: 403,
      code: ErrorCode.FEATURE_NOT_IN_PLAN,
      details: { feature: 'video_upload' },
    });
  }

  return transaction(async (connection) => {
    if (item.isPrimary) {
      await execute('UPDATE listing_media SET is_primary = 0 WHERE listing_id = ?', [listingId], connection);
    }
    const inserted = await execute(
      `INSERT INTO listing_media
         (listing_id, kind, url, thumb_url, caption, is_primary, sort_order, width, height, size_bytes, mime_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        listingId,
        item.kind,
        item.url,
        item.thumbUrl ?? item.url,
        item.caption ?? null,
        item.isPrimary || current === 0 ? 1 : 0,
        item.sortOrder ?? current,
        item.width ?? null,
        item.height ?? null,
        item.sizeBytes ?? null,
        item.mimeType ?? null,
        item.kind === 'video' ? 'processing' : 'ready',
      ],
      connection,
    );

    await execute(
      'UPDATE listings SET media_count = (SELECT COUNT(*) FROM listing_media WHERE listing_id = ?) WHERE id = ?',
      [listingId, listingId],
      connection,
    );

    const event = await eventBus.enqueue(connection, 'listing.media_added', 'listing', listingId, {
      listingId,
      mediaId: inserted.insertId,
      kind: item.kind,
    });
    void eventBus.publishAfterCommit(event);

    return { id: inserted.insertId, mediaCount: current + 1 };
  });
}

export async function deleteMedia(listingId: number, mediaId: number, userId: number, isStaff: boolean): Promise<void> {
  await requireOwnedListing(listingId, userId, isStaff);
  const result = await execute('DELETE FROM listing_media WHERE id = ? AND listing_id = ?', [mediaId, listingId]);
  if (result.affectedRows === 0) throw notFound('Media');

  await execute(
    'UPDATE listings SET media_count = (SELECT COUNT(*) FROM listing_media WHERE listing_id = ?) WHERE id = ?',
    [listingId, listingId],
  );
  // Removing the cover must promote another image, or the card renders blank.
  await execute(
    `UPDATE listing_media SET is_primary = 1
      WHERE listing_id = ? AND id = (SELECT MIN(id) FROM (SELECT id FROM listing_media WHERE listing_id = ?) t)
        AND NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM listing_media WHERE listing_id = ? AND is_primary = 1) x)`,
    [listingId, listingId, listingId],
  );
}

export async function reorderMedia(listingId: number, userId: number, isStaff: boolean, orderedIds: number[]): Promise<void> {
  await requireOwnedListing(listingId, userId, isStaff);
  await transaction(async (connection) => {
    for (const [index, mediaId] of orderedIds.entries()) {
      await execute('UPDATE listing_media SET sort_order = ?, is_primary = ? WHERE id = ? AND listing_id = ?', [
        index,
        index === 0 ? 1 : 0,
        mediaId,
        listingId,
      ], connection);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Update                                                                     */
/* -------------------------------------------------------------------------- */

export async function updateListing(
  listingId: number,
  userId: number,
  isStaff: boolean,
  input: UpdateListingInput,
): Promise<{ listing: ListingDetail; warnings: string[] }> {
  const context = contextOrDefaults();
  const existing = await requireOwnedListing(listingId, userId, isStaff);

  if (['sold', 'rented', 'removed'].includes(String(existing.status)) || readDimensions(existing).transactionStatus === 'sold') {
    if (!isStaff) {
      throw conflict(`A ${existing.status} listing can no longer be edited`);
    }
  }

  const marketplaceId = Number(existing.marketplace_id);
  const module = marketplaceRegistry.requireById(marketplaceId);
  const warnings: string[] = [];

  if (input.details !== undefined) {
    const validation = await module.validateDetails(input.details, {
      operation: input.operation ?? String(existing.operation),
      categoryCode: null,
      countryId: input.location?.countryId ?? Number(existing.country_id),
    });
    warnings.push(...validation.warnings);
  }

  const currency = input.currency ?? (existing.currency as string | null) ?? context.currency;
  const oldPrice = toNumber(existing.price);
  const priceChanged = input.price !== undefined && input.price !== oldPrice;
  const priceBase =
    input.price !== undefined ? ((await convertAmount(input.price, currency, env.BASE_CURRENCY))?.amount ?? input.price) : undefined;

  const changedFields: string[] = [];

  await transaction(async (connection) => {
    const update = buildUpdate('listings', {
      title: input.title,
      description: input.description,
      condition_code: input.conditionCode,
      category_id: input.categoryId,
      operation: input.operation,
      price: input.price,
      currency: input.price !== undefined ? currency : undefined,
      price_base: priceBase,
      price_type: input.priceType,
      price_period: input.pricePeriod,
      price_negotiable: input.priceNegotiable === undefined ? undefined : input.priceNegotiable ? 1 : 0,
      installments_available: input.installmentsAvailable === undefined ? undefined : input.installmentsAvailable ? 1 : 0,
      country_id: input.location?.countryId,
      region_id: input.location?.regionId,
      city_id: input.location?.cityId,
      area_id: input.location?.areaId,
      address: input.location?.address,
      postal_code: input.location?.postalCode,
      latitude: input.location?.latitude,
      longitude: input.location?.longitude,
      hide_exact_location: input.location?.hideExactLocation === undefined ? undefined : input.location.hideExactLocation ? 1 : 0,
      contact_phone: input.contactPhone,
      contact_whatsapp: input.contactWhatsapp,
      allow_chat: input.allowChat === undefined ? undefined : input.allowChat ? 1 : 0,
      allow_calls: input.allowCalls === undefined ? undefined : input.allowCalls ? 1 : 0,
      allow_offers: input.allowOffers === undefined ? undefined : input.allowOffers ? 1 : 0,
      business_id: input.businessId,
    });

    if (update) {
      changedFields.push(...Array.from(update.sql.matchAll(/(\w+) = \?/g)).map((match) => match[1] ?? ''));
      await execute(`${update.sql} WHERE id = ?`, [...update.params, listingId], connection);
    }

    if (input.details !== undefined) {
      const validation = await module.validateDetails(input.details, {
        operation: input.operation ?? String(existing.operation),
        categoryCode: null,
        countryId: input.location?.countryId ?? Number(existing.country_id),
      });
      const derived = module.deriveComputedColumns
        ? module.deriveComputedColumns(validation.details, { price: input.price ?? oldPrice, currency })
        : validation.details;
      await module.saveDetails(listingId, derived, connection);
      changedFields.push('details');
    }

    if (input.attributes) {
      await saveAttributeValues(listingId, marketplaceId, input.attributes, connection);
      changedFields.push('attributes');
    }

    if (priceChanged) {
      await execute(
        'INSERT INTO listing_price_history (listing_id, old_price, new_price, currency, changed_by) VALUES (?, ?, ?, ?, ?)',
        [listingId, oldPrice, input.price!, currency, userId],
        connection,
      );
      if (priceBase !== undefined) {
        await execute(
          'UPDATE listings SET price_fx_rate = ?, price_fx_at = CURRENT_TIMESTAMP WHERE id = ?',
          [input.price ? priceBase / input.price : null, listingId],
          connection,
        );
      }
    }

    /**
     * A published listing whose substance changed goes back through review.
     * Editing the price or contact details does not, otherwise sellers could
     * never respond to the market.
     */
    const substantive = changedFields.some((field) => ['title', 'description', 'category_id', 'details'].includes(field));
    if (substantive && readDimensions(existing).lifecycleStatus === 'published' && !isStaff) {
      await execute(
        `UPDATE listings
            SET status = 'pending_review', lifecycle_status = 'pending_review',
                moderation_status = 'in_review', moderation_state = 'under_review'
          WHERE id = ?`,
        [listingId],
        connection,
      );
      await recordStatusChange(listingId, 'published', 'pending_review', userId, 'system', 'edited after publication', connection);
      await recordListingEvent(listingId, 'SUBMITTED', { id: userId, type: 'owner' }, { reason: 'edited after publication' }, connection);
    }

    if (changedFields.length > 0) {
      await captureVersionOnUpdate({
        listingId,
        row: existing,
        changedFields: [...new Set(changedFields)],
        userId,
        connection,
      });
      await recordListingEvent(listingId, 'UPDATED', { id: userId, type: 'owner' }, { changedFields }, connection);
    }

    const event = await eventBus.enqueue(connection, 'listing.updated', 'listing', listingId, {
      listingId,
      userId,
      changedFields: [...new Set(changedFields)],
    });
    void eventBus.publishAfterCommit(event);

    if (priceChanged) {
      const priceEvent = await eventBus.enqueue(connection, 'listing.price_changed', 'listing', listingId, {
        listingId,
        oldPrice: oldPrice === null ? null : String(oldPrice),
        newPrice: String(input.price),
        currency,
      });
      void eventBus.publishAfterCommit(priceEvent);
    }
  });

  const listing = await getListing({
    idOrUuid: listingId,
    language: context.language,
    currency: context.currency,
    viewerId: userId,
    isStaff,
  });

  return { listing, warnings };
}

/* -------------------------------------------------------------------------- */
/* Lifecycle (§8)                                                             */
/* -------------------------------------------------------------------------- */

export async function requireOwnedListing(listingId: number, userId: number, isStaff: boolean): Promise<Row> {
  const listing = await queryOne<Row>('SELECT * FROM listings WHERE id = ? AND deleted_at IS NULL', [listingId]);
  if (!listing) throw notFound('Listing');
  if (Number(listing.user_id) !== userId && !isStaff) {
    throw forbidden('You can only manage your own listings');
  }
  return listing;
}

function assertTransition(from: ListingStatus, to: ListingStatus, isStaff: boolean): void {
  if (from === to) return;
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new AppError(`A ${from} listing cannot become ${to}`, {
      status: 409,
      code: ErrorCode.INVALID_STATE_TRANSITION,
      details: { from, to, allowed: ALLOWED_TRANSITIONS[from] },
    });
  }
  // Only staff may reject or hard-remove.
  if ((to === 'rejected' || to === 'removed') && !isStaff) {
    throw forbidden('Only a moderator can perform this action');
  }
}

function actorFrom(userId: number, isStaff: boolean, roles: string[] = [], permissions: string[] = []): ListingActor {
  return { userId, isStaff, roles: isStaff && roles.length === 0 ? ['moderator'] : roles, permissions };
}

export async function submitForReview(listingId: number, userId: number): Promise<{ status: ListingStatus; flags: Record<string, number> }> {
  const result = await submitListing(listingId, actorFrom(userId, false));
  return { status: result.status as ListingStatus, flags: result.flags };
}

export async function changeStatus(params: {
  listingId: number;
  userId: number;
  isStaff: boolean;
  to: ListingStatus;
  reason?: string;
  buyerId?: number;
  roles?: string[];
  permissions?: string[];
}): Promise<{ status: ListingStatus }> {
  const actor = actorFrom(params.userId, params.isStaff, params.roles, params.permissions);

  if (params.to === 'published') {
    if (!params.isStaff) throw forbidden('Only a moderator can publish a listing');
    const result = await publishListing(params.listingId, actor);
    return { status: result.status as ListingStatus };
  }
  if (params.to === 'rejected') {
    if (!params.isStaff) throw forbidden('Only a moderator can perform this action');
    await rejectListing({
      listingId: params.listingId,
      actor,
      reasonCode: 'MISLEADING_INFORMATION',
      reason: params.reason ?? 'Does not meet our listing policy',
    });
    return { status: 'rejected' };
  }
  if (params.to === 'archived') {
    await archiveListing(params.listingId, actor, params.reason);
    return { status: 'archived' };
  }
  if (params.to === 'sold' || params.to === 'rented' || params.to === 'reserved') {
    await setTransactionStatus({
      listingId: params.listingId,
      actor,
      to: params.to,
      buyerId: params.buyerId,
    });
    return { status: params.to };
  }
  if (params.to === 'expired') {
    if (!params.isStaff) throw forbidden('Expiration is handled by the server');
  }

  const listing = await requireOwnedListing(params.listingId, params.userId, params.isStaff);
  const from = String(listing.status) as ListingStatus;
  assertTransition(from, params.to, params.isStaff);

  await transaction(async (connection) => {
    const update = buildUpdate('listings', { status: params.to });
    if (update) await execute(`${update.sql} WHERE id = ?`, [...update.params, params.listingId], connection);
    await recordStatusChange(params.listingId, from, params.to, params.userId, params.isStaff ? 'moderator' : 'owner', params.reason ?? null, connection);
  });
  return { status: params.to };
}

/** §8 Renewed — history row, listing returns to PUBLISHED. */
export async function renewListing(listingId: number, userId: number, isStaff: boolean): Promise<{ expiresAt: string }> {
  const result = await renewListingEngine(listingId, actorFrom(userId, isStaff));
  return { expiresAt: result.expiresAt };
}

/** §8 Featured / Boosted via packages or legacy kind. */
export async function promoteListing(params: {
  listingId: number;
  userId: number;
  isStaff: boolean;
  kind?: 'feature' | 'boost' | 'urgent' | 'bump' | 'top_of_search' | 'homepage' | 'story';
  packageCode?: string;
  days: number;
  useQuota: boolean;
  gatewayCode?: string;
  countryId?: number;
  currency?: string;
}): Promise<{ kind: string; endsAt?: string; activated: boolean; order?: unknown }> {
  await requireListingActor(params.listingId, actorFrom(params.userId, params.isStaff), 'promote');
  const context = contextOrDefaults();
  const packageCode =
    params.packageCode ??
    (params.kind === 'feature'
      ? 'featured_7'
      : params.kind === 'boost' || params.kind === 'top_of_search'
        ? 'boost_7'
        : params.kind === 'homepage'
          ? 'homepage_7'
          : params.kind === 'urgent'
            ? 'urgent_3'
            : params.kind === 'bump'
              ? 'bump_1'
              : 'boost_7');

  const result = await requestPromotion({
    listingId: params.listingId,
    userId: params.userId,
    packageCode,
    useQuota: params.useQuota,
    gatewayCode: params.gatewayCode,
    countryId: params.countryId ?? context.countryId ?? 1,
    currency: params.currency ?? context.currency,
  });
  if (result.activated) return { kind: result.kind, endsAt: result.endsAt, activated: true };
  return { kind: packageCode, activated: false, order: result };
}

async function recordStatusChange(
  listingId: number,
  from: string | null,
  to: string,
  actorId: number | null,
  actorType: 'owner' | 'moderator' | 'system' | 'job' | 'ai',
  reason: string | null,
  connection: PoolConnection,
): Promise<void> {
  await execute(
    `INSERT INTO listing_status_history (listing_id, from_status, to_status, actor_id, actor_type, reason)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [listingId, from, to, actorId, actorType, reason],
    connection,
  );
}

export async function softDeleteListing(listingId: number, userId: number, isStaff: boolean): Promise<void> {
  const listing = await requireOwnedListing(listingId, userId, isStaff);
  await execute(`UPDATE listings SET deleted_at = CURRENT_TIMESTAMP, status = 'removed', lifecycle_status = 'archived' WHERE id = ?`, [listingId]);
  await releaseQuota(Number(listing.user_id), 'active_listings').catch(() => undefined);

  await transaction(async (connection) => {
    await recordStatusChange(listingId, String(listing.status), 'removed', userId, isStaff ? 'moderator' : 'owner', 'deleted', connection);
    const event = await eventBus.enqueue(connection, 'listing.removed', 'listing', listingId, {
      listingId,
      userId: Number(listing.user_id),
      byModerator: isStaff,
    });
    void eventBus.publishAfterCommit(event);
  });
}

/* -------------------------------------------------------------------------- */
/* Engagement                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Records a view. Deduplicated per IP per hour so a refresh does not inflate the
 * seller's stats — view counts are a purchase signal, so they have to be honest.
 */
export async function recordView(params: {
  listingId: number;
  viewerId: number | null;
  guestUuid: string | null;
  source: string;
  durationMs?: number;
}): Promise<void> {
  const context = contextOrDefaults();
  const { hashIp } = await import('../../core/security/crypto');
  const ipHash = hashIp(context.ip);

  const recent = await queryCount(
    `SELECT COUNT(*) FROM listing_views
      WHERE listing_id = ? AND ip_hash = ? AND created_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 1 HOUR)`,
    [params.listingId, ipHash],
  );

  await execute(
    `INSERT INTO listing_views
       (listing_id, user_id, guest_uuid, device_id, source, country_id, city_id, platform_id, duration_ms, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.listingId,
      params.viewerId,
      params.guestUuid,
      context.deviceId,
      params.source,
      context.countryId,
      null,
      context.platformId,
      params.durationMs ?? null,
      ipHash,
    ],
  );

  await enqueueListingAnalytics({
    listingId: params.listingId,
    eventType: 'view',
    actorUserId: params.viewerId,
    guestUuid: params.guestUuid,
    source: params.source,
  });
  if (recent === 0) {
    await enqueueListingAnalytics({
      listingId: params.listingId,
      eventType: 'unique_view',
      actorUserId: params.viewerId,
      guestUuid: params.guestUuid,
      source: params.source,
    });
  }

  await transaction(async (connection) => {
    const event = await eventBus.enqueue(connection, 'listing.viewed', 'listing', params.listingId, {
      listingId: params.listingId,
      viewerId: params.viewerId,
      source: params.source,
    });
    void eventBus.publishAfterCommit(event);
  });
}

export async function getSimilarListings(listingId: number, language: string, limit = 12): Promise<ListingCard[]> {
  const listing = await queryOne<Row>(
    'SELECT marketplace_id, category_id, price, city_id, country_id FROM listings WHERE id = ?',
    [listingId],
  );
  if (!listing) throw notFound('Listing');

  return findSimilar({
    listingId,
    marketplaceId: Number(listing.marketplace_id),
    categoryId: Number(listing.category_id),
    price: toNumber(listing.price),
    cityId: listing.city_id === null ? null : Number(listing.city_id),
    countryId: Number(listing.country_id),
    language,
    limit,
  });
}

async function createAuction(
  listingId: number,
  auction: NonNullable<CreateListingInput['auction']>,
  currency: string,
  connection: PoolConnection,
): Promise<void> {
  if (auction.endsAt <= auction.startsAt) {
    throw badRequest('The auction must end after it starts');
  }
  await execute(
    `INSERT INTO auctions
       (uuid, listing_id, start_price, reserve_price, buy_now_price, bid_increment, currency,
        starts_at, ends_at, anti_snipe_secs, status, requires_deposit, deposit_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      listingId,
      auction.startPrice,
      auction.reservePrice ?? null,
      auction.buyNowPrice ?? null,
      auction.bidIncrement,
      currency,
      auction.startsAt,
      auction.endsAt,
      auction.antiSnipeSecs,
      auction.startsAt.getTime() <= Date.now() ? 'live' : 'scheduled',
      auction.requiresDeposit ? 1 : 0,
      auction.depositAmount ?? null,
    ],
    connection,
  );
}

/** §8 draft management, synced from the client outbox. */
export async function saveDraft(userId: number, payload: { uuid?: string; marketplaceId: number; categoryId?: number; step?: number; data: Record<string, unknown> }) {
  const draftUuid = payload.uuid ?? uuid();
  const data = payload.data;
  const completeness = scorePayload({
    title: typeof data.title === 'string' ? data.title : null,
    description: typeof data.description === 'string' ? data.description : null,
    price: typeof data.price === 'number' ? data.price : Number(data.price) || null,
    mediaCount: Array.isArray(data.media) ? data.media.length : 0,
    cityId: typeof data.cityId === 'number' ? data.cityId : null,
    detailsPresent: data.details !== undefined,
  });
  const missing: string[] = [];
  if (!data.title || String(data.title).trim().length < 6) missing.push('title');
  if (data.price === undefined || data.price === null || data.price === '') missing.push('price');
  if (!payload.categoryId) missing.push('category');

  await execute(
    `INSERT INTO listing_drafts (uuid, user_id, marketplace_id, category_id, payload, step, completeness_score, missing_fields, client_updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE payload = VALUES(payload), step = VALUES(step),
                             category_id = VALUES(category_id), completeness_score = VALUES(completeness_score),
                             missing_fields = VALUES(missing_fields), client_updated_at = CURRENT_TIMESTAMP`,
    [
      draftUuid,
      userId,
      payload.marketplaceId,
      payload.categoryId ?? null,
      JSON.stringify(payload.data),
      payload.step ?? 0,
      completeness,
      JSON.stringify(missing),
    ],
  );
  return { uuid: draftUuid, completenessScore: completeness, missingFields: missing };
}

export async function listDrafts(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT d.uuid, d.marketplace_id, d.category_id, d.payload, d.step, d.completeness_score, d.missing_fields, d.updated_at, m.code AS marketplace_code
       FROM listing_drafts d JOIN marketplaces m ON m.id = d.marketplace_id
      WHERE d.user_id = ? ORDER BY d.updated_at DESC LIMIT 50`,
    [userId],
  );
  return rows.map((row) => ({
    uuid: String(row.uuid),
    marketplaceId: Number(row.marketplace_id),
    marketplaceCode: String(row.marketplace_code),
    categoryId: row.category_id === null ? null : Number(row.category_id),
    step: Number(row.step),
    completenessScore: Number(row.completeness_score ?? 0),
    missingFields: toJson<string[]>(row.missing_fields, []),
    data: toJson<Record<string, unknown>>(row.payload, {}),
    updatedAt: (row.updated_at as Date).toISOString(),
  }));
}

export async function deleteDraft(userId: number, draftUuid: string): Promise<void> {
  await execute('DELETE FROM listing_drafts WHERE uuid = ? AND user_id = ?', [draftUuid, userId]);
}

export async function archiveOwnedListing(listingId: number, userId: number, isStaff: boolean, reason?: string) {
  return archiveListing(listingId, actorFrom(userId, isStaff), reason);
}

export async function restoreOwnedListing(listingId: number, userId: number, isStaff: boolean) {
  return restoreListing(listingId, actorFrom(userId, isStaff));
}

export async function publishOwnedListing(listingId: number, userId: number, isStaff: boolean, roles: string[], permissions: string[]) {
  return publishListing(listingId, actorFrom(userId, isStaff, roles, permissions));
}

export async function rejectOwnedListing(
  listingId: number,
  userId: number,
  isStaff: boolean,
  roles: string[],
  permissions: string[],
  input: { reasonCode: string; reason: string; details?: string },
) {
  return rejectListing({
    listingId,
    actor: actorFrom(userId, isStaff, roles, permissions),
    reasonCode: input.reasonCode,
    reason: input.reason,
    details: input.details,
  });
}

export async function appealOwnedListing(listingId: number, userId: number, note: string) {
  return appealRejection(listingId, actorFrom(userId, false), note);
}

export async function setOwnedTransaction(
  listingId: number,
  userId: number,
  isStaff: boolean,
  input: { status: 'available' | 'reserved' | 'sold' | 'rented'; buyerId?: number; startsAt?: Date; endsAt?: Date },
) {
  return setTransactionStatus({
    listingId,
    actor: actorFrom(userId, isStaff),
    to: input.status,
    buyerId: input.buyerId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
  });
}

export async function addOwnedAvailabilityBlock(
  listingId: number,
  userId: number,
  isStaff: boolean,
  input: { kind: 'booking' | 'reserved' | 'rented' | 'blocked' | 'maintenance'; startsAt: Date; endsAt: Date; note?: string },
) {
  await requireListingActor(listingId, actorFrom(userId, isStaff), 'change_transaction');
  return transaction(async (connection) =>
    addAvailabilityBlock({
      listingId,
      kind: input.kind,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      note: input.note,
      createdBy: userId,
      connection,
    }),
  );
}

export async function getOwnedEvents(listingId: number, userId: number, isStaff: boolean) {
  await requireListingActor(listingId, actorFrom(userId, isStaff), 'view');
  return listListingEvents(listingId);
}

export async function getOwnedRejections(listingId: number, userId: number, isStaff: boolean) {
  await requireListingActor(listingId, actorFrom(userId, isStaff), 'view');
  return listRejections(listingId);
}

export async function getOwnedVersions(listingId: number, userId: number, isStaff: boolean) {
  await requireListingActor(listingId, actorFrom(userId, isStaff), 'view');
  return listListingVersions(listingId);
}

export async function getOwnedAnalytics(listingId: number, userId: number, isStaff: boolean, days = 30) {
  await requireListingActor(listingId, actorFrom(userId, isStaff), 'view_analytics');
  const entitlements = await loadEntitlements(userId);
  if (!isStaff && !entitlements.features.listing_analytics?.enabled) {
    throw new AppError('Listing analytics is not included in your plan', {
      status: 403,
      code: ErrorCode.FEATURE_NOT_IN_PLAN,
      details: { feature: 'listing_analytics', currentPlan: entitlements.planCode, upgradeAvailable: true },
    });
  }
  const data = await getListingAnalytics(listingId, days);
  const advanced = isStaff || Boolean(entitlements.features.advanced_analytics?.enabled);
  const business = isStaff || Boolean(entitlements.features.business_analytics?.enabled);
  if (!advanced) {
    return {
      periodDays: data.periodDays,
      views: data.views,
      favorites: data.favorites,
      messages: data.messages,
      calls: data.calls,
      uniqueViewers: null,
      searchImpressions: null,
      shares: null,
      offers: null,
      bookings: null,
      conversions: null,
      series: [],
      ctr: null,
      advancedLocked: true,
      businessAnalytics: false,
    };
  }
  return { ...data, advancedLocked: false, businessAnalytics: business };
}

export async function getOwnedPromotions(listingId: number, userId: number, isStaff: boolean) {
  await requireListingActor(listingId, actorFrom(userId, isStaff), 'view');
  return listListingPromotions(listingId);
}

export async function shareListingPublic(listingId: number, userId: number | null, channel: 'link' | 'whatsapp' | 'sms' | 'email' | 'other') {
  await recordShare(listingId, userId, channel);
  let url: string | null = null;
  let token: string | null = null;
  if (userId) {
    const created = await createShareToken({
      ownerUserId: userId,
      targetType: 'listing',
      targetId: listingId,
    });
    token = created.token;
    url = created.url;
  } else {
    url = `${env.WEB_URL.replace(/\/$/, '')}/listing/${listingId}`;
  }
  return { shared: true, channel, token, url };
}

export async function getListingAvailabilityWindow(listingId: number, from: Date, to: Date) {
  return listAvailability(listingId, from, to);
}

export { listPromotionPackages };

