import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, forbidden, notFound } from '../../core/errors';
import { toJson } from '../../db/sql';
import { recordAudit } from '../../middleware/audit';
import {
  assertBusinessPermission,
  createBusiness,
  getBusiness,
  getMembership,
  saveGoldShopExtension,
  updateBusiness,
} from '../../modules/business/business.service';
import type { CreateBusinessInput, GoldShopExtensionInput } from '../../modules/business/business.schema';

/** Public brand storefronts require 3–4 properly posted gold ads. */
export const GOLD_STORE_MIN_LISTINGS = 3;
export const GOLD_STORE_MAX_MIN_LISTINGS = 4;

export type GoldStorefrontStatus = 'draft' | 'pending_review' | 'building' | 'active' | 'suspended';

export interface ApplyGoldStoreInput {
  legalName: string;
  tradeName?: string;
  description?: string;
  website?: string;
  registrationNo?: string;
  licenseReference: string;
  taxId?: string;
  countryId?: number;
  regionId?: number;
  cityId?: number;
  address: string;
  contactPhone: string;
  contactEmail?: string;
  establishedYear?: number;
  certifications?: string[];
  offerings?: Array<{ category: string; purity?: string }>;
  notes?: string;
  minListingsRequired?: number;
}

/**
 * A gold ad counts as "properly posted" for store unlock when it is a published
 * gold listing under the shop with photos, weight, and karat filled in.
 */
export async function countProperGoldListings(businessId: number): Promise<number> {
  const row = await queryOne<Row>(
    `SELECT COUNT(*) AS cnt
       FROM listings l
       JOIN marketplaces m ON m.id = l.marketplace_id AND m.code = 'gold'
       JOIN gold_listing_details g ON g.listing_id = l.id
      WHERE l.business_id = ?
        AND l.deleted_at IS NULL
        AND (l.lifecycle_status = 'published' OR l.status = 'published')
        AND l.media_count >= 1
        AND CHAR_LENGTH(TRIM(l.title)) >= 3
        AND g.karat IS NOT NULL
        AND (g.gross_weight_g IS NOT NULL OR g.net_weight_g IS NOT NULL)`,
    [businessId],
  );
  return Number(row?.cnt ?? 0);
}

export async function ensureGoldShopProfile(
  businessId: number,
  options?: { minListingsRequired?: number; status?: GoldStorefrontStatus },
) {
  const min = clampMinListings(options?.minListingsRequired);
  const status = options?.status ?? 'draft';
  await execute(
    `INSERT INTO gold_shop_profiles
       (business_id, min_listings_required, storefront_status, proper_listing_count)
     VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE business_id = business_id`,
    [businessId, min, status],
  );
}

function clampMinListings(value?: number): number {
  if (value == null || !Number.isFinite(value)) return GOLD_STORE_MIN_LISTINGS;
  return Math.min(GOLD_STORE_MAX_MIN_LISTINGS, Math.max(GOLD_STORE_MIN_LISTINGS, Math.round(value)));
}

export async function getStorefrontRow(businessId: number) {
  return queryOne<Row>(`SELECT * FROM gold_shop_profiles WHERE business_id = ?`, [businessId]);
}

export async function evaluateGoldStorefront(businessId: number) {
  const business = await queryOne<Row>(
    `SELECT id, kind, status, legal_name, trade_name, slug, logo_url, verified_at,
            license_reference, address, contact_phone, contact_email, description
       FROM business_profiles WHERE id = ?`,
    [businessId],
  );
  if (!business || String(business.kind) !== 'gold_shop') {
    return null;
  }

  await ensureGoldShopProfile(businessId);
  const profile = await getStorefrontRow(businessId);
  if (!profile) return null;

  const properCount = await countProperGoldListings(businessId);
  const minRequired = clampMinListings(Number(profile.min_listings_required));
  const current = String(profile.storefront_status) as GoldStorefrontStatus;
  const businessStatus = String(business.status);

  let next: GoldStorefrontStatus = current;
  if (current === 'suspended') {
    next = 'suspended';
  } else if (businessStatus === 'active') {
    next = properCount >= minRequired ? 'active' : 'building';
  } else if (current === 'active') {
    // Business no longer active — demote public brand storefront.
    next = 'building';
  } else if (current === 'pending_review' || current === 'draft' || current === 'building') {
    next = current;
  }

  await execute(
    `UPDATE gold_shop_profiles
        SET proper_listing_count = ?,
            min_listings_required = ?,
            storefront_status = ?,
            storefront_unlocked_at = CASE
              WHEN ? = 'active' THEN COALESCE(storefront_unlocked_at, CURRENT_TIMESTAMP)
              ELSE storefront_unlocked_at
            END
      WHERE business_id = ?`,
    [properCount, minRequired, next, next, businessId],
  );

  const refreshed = await getStorefrontRow(businessId);
  return mapStoreProgress(business, refreshed ?? profile, properCount, minRequired, next);
}

function mapStoreProgress(
  business: Row,
  profile: Row,
  properCount: number,
  minRequired: number,
  status: GoldStorefrontStatus,
) {
  const remaining = Math.max(0, minRequired - properCount);
  return {
    businessId: Number(business.id),
    kind: 'gold_shop' as const,
    name: (business.trade_name as string | null) ?? String(business.legal_name),
    legalName: String(business.legal_name),
    tradeName: (business.trade_name as string | null) ?? null,
    slug: String(business.slug),
    logoUrl: (business.logo_url as string | null) ?? null,
    verified: business.verified_at != null,
    businessStatus: String(business.status),
    storefrontStatus: status,
    properListingCount: properCount,
    minListingsRequired: minRequired,
    listingsRemaining: remaining,
    isBrandReady: status === 'active' && properCount >= minRequired && String(business.status) === 'active',
    applicationSubmittedAt: profile.application_submitted_at
      ? (profile.application_submitted_at as Date).toISOString()
      : null,
    storefrontUnlockedAt: profile.storefront_unlocked_at
      ? (profile.storefront_unlocked_at as Date).toISOString()
      : null,
    requirements: {
      licenseReference: Boolean(business.license_reference),
      address: Boolean(business.address),
      contactPhone: Boolean(business.contact_phone),
      minProperListings: minRequired,
    },
  };
}

/**
 * Proper store creation process for Gold Marketplace.
 * Creates a pending gold_shop, saves shop extension data, and submits for review.
 * Personal sellers should post ads without calling this.
 */
export async function applyForGoldStore(userId: number, input: ApplyGoldStoreInput) {
  if (!input.licenseReference?.trim()) throw badRequest('A shop license or registration reference is required');
  if (!input.address?.trim()) throw badRequest('A shop address is required');
  if (!input.contactPhone?.trim()) throw badRequest('A shop contact phone is required');

  const minListings = clampMinListings(input.minListingsRequired);
  const createInput: CreateBusinessInput = {
    kind: 'gold_shop',
    legalName: input.legalName,
    tradeName: input.tradeName,
    description: input.description,
    website: input.website,
    registrationNo: input.registrationNo,
    licenseReference: input.licenseReference,
    taxId: input.taxId,
    countryId: input.countryId,
    regionId: input.regionId,
    cityId: input.cityId,
    address: input.address,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
    establishedYear: input.establishedYear,
    marketplaces: ['gold'],
  };

  const business = await createBusiness(userId, createInput);
  const businessId = Number(business.id);

  await ensureGoldShopProfile(businessId, { minListingsRequired: minListings, status: 'draft' });

  const extension: GoldShopExtensionInput = {
    certifications: input.certifications,
    notes: input.notes,
    offerings: input.offerings,
  };
  await saveGoldShopExtension(businessId, userId, false, extension);

  await execute(
    `UPDATE gold_shop_profiles
        SET storefront_status = 'pending_review',
            application_submitted_at = CURRENT_TIMESTAMP,
            min_listings_required = ?,
            application_notes = ?
      WHERE business_id = ?`,
    [minListings, input.notes ?? null, businessId],
  );

  void recordAudit({
    action: 'gold_store.applied',
    entityType: 'business',
    entityId: businessId,
    after: { minListingsRequired: minListings },
  });

  return getGoldStore(businessId, userId, false);
}

export async function submitGoldStoreApplication(businessId: number, userId: number, isStaff: boolean) {
  await assertBusinessPermission(businessId, userId, 'business.update', isStaff);
  const business = await queryOne<Row>(`SELECT * FROM business_profiles WHERE id = ?`, [businessId]);
  if (!business) throw notFound('Store');
  if (String(business.kind) !== 'gold_shop') throw badRequest('Only gold shops can apply as Gold Marketplace stores');

  const missing: string[] = [];
  if (!business.license_reference) missing.push('licenseReference');
  if (!business.address) missing.push('address');
  if (!business.contact_phone) missing.push('contactPhone');
  if (missing.length) {
    throw new AppError('Complete the store profile before submitting', {
      status: 400,
      code: ErrorCode.VALIDATION_FAILED,
      details: { missing },
    });
  }

  await ensureGoldShopProfile(businessId);
  await execute(
    `UPDATE gold_shop_profiles
        SET storefront_status = 'pending_review',
            application_submitted_at = COALESCE(application_submitted_at, CURRENT_TIMESTAMP)
      WHERE business_id = ?`,
    [businessId],
  );

  if (String(business.status) === 'draft' || String(business.status) === 'rejected') {
    await execute(`UPDATE business_profiles SET status = 'pending' WHERE id = ?`, [businessId]);
  }

  void recordAudit({ action: 'gold_store.submitted', entityType: 'business', entityId: businessId });
  return getGoldStore(businessId, userId, isStaff);
}

export async function listPublicGoldStores(params: {
  countryId?: number | null;
  cityId?: number | null;
  q?: string;
  page?: number;
  perPage?: number;
}) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(50, Math.max(1, params.perPage ?? 20));
  const clauses: string[] = [
    `bp.kind = 'gold_shop'`,
    `bp.status = 'active'`,
    `gsp.storefront_status = 'active'`,
    `gsp.proper_listing_count >= gsp.min_listings_required`,
  ];
  const values: unknown[] = [];

  if (params.countryId) {
    clauses.push('bp.country_id = ?');
    values.push(params.countryId);
  }
  if (params.cityId) {
    clauses.push('bp.city_id = ?');
    values.push(params.cityId);
  }
  if (params.q?.trim()) {
    const like = `%${params.q.trim().replace(/[\\%_]/g, '')}%`;
    clauses.push('(bp.legal_name LIKE ? OR bp.trade_name LIKE ? OR bp.slug LIKE ?)');
    values.push(like, like, like);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const countRow = await queryOne<Row>(
    `SELECT COUNT(*) AS cnt
       FROM business_profiles bp
       JOIN gold_shop_profiles gsp ON gsp.business_id = bp.id
       ${whereSql}`,
    values,
  );
  const total = Number(countRow?.cnt ?? 0);
  const rows = await queryRows<Row>(
    `SELECT bp.id, bp.legal_name, bp.trade_name, bp.slug, bp.logo_url, bp.description,
            bp.city_id, bp.country_id, bp.address, bp.verified_at, bp.status,
            gsp.storefront_status, gsp.proper_listing_count, gsp.min_listings_required,
            gsp.storefront_unlocked_at
       FROM business_profiles bp
       JOIN gold_shop_profiles gsp ON gsp.business_id = bp.id
       ${whereSql}
      ORDER BY bp.verified_at IS NULL, gsp.proper_listing_count DESC, bp.legal_name ASC
      LIMIT ? OFFSET ?`,
    [...values, perPage, (page - 1) * perPage],
  );

  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      name: (row.trade_name as string | null) ?? String(row.legal_name),
      legalName: String(row.legal_name),
      tradeName: (row.trade_name as string | null) ?? null,
      slug: String(row.slug),
      logoUrl: (row.logo_url as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      address: (row.address as string | null) ?? null,
      cityId: row.city_id === null ? null : Number(row.city_id),
      countryId: row.country_id === null ? null : Number(row.country_id),
      verified: row.verified_at != null,
      storefrontStatus: String(row.storefront_status),
      properListingCount: Number(row.proper_listing_count ?? 0),
      minListingsRequired: Number(row.min_listings_required ?? GOLD_STORE_MIN_LISTINGS),
      storefrontUnlockedAt: row.storefront_unlocked_at
        ? (row.storefront_unlocked_at as Date).toISOString()
        : null,
      isBrand: true,
    })),
    page,
    perPage,
    total,
  };
}

export async function getGoldStore(businessId: number, viewerId: number | null, isStaff: boolean) {
  const business = await getBusiness(businessId, viewerId, isStaff);
  if (business.kind !== 'gold_shop') throw notFound('Gold store');

  const progress = await evaluateGoldStorefront(businessId);
  const isMember = Boolean(viewerId && (await getMembership(businessId, viewerId)));
  const publicBrand = progress?.isBrandReady === true;

  if (!publicBrand && !isMember && !isStaff) {
    throw notFound('Gold store');
  }

  const listings = publicBrand || isMember || isStaff
    ? await listStoreListings(businessId, { publishedOnly: !isMember && !isStaff })
    : [];

  return {
    ...business,
    store: progress,
    listings,
    sellerMode: publicBrand ? 'brand' : 'person_or_building',
    note:
      publicBrand
        ? 'This Gold store is listed as a brand/shop.'
        : 'Personal ads are posted as a person. This shop becomes a public brand after approval and the minimum properly posted ads.',
  };
}

export async function getGoldStoreBySlug(slug: string, viewerId: number | null, isStaff: boolean) {
  const row = await queryOne<Row>(`SELECT id FROM business_profiles WHERE slug = ? AND kind = 'gold_shop'`, [slug]);
  if (!row) throw notFound('Gold store');
  return getGoldStore(Number(row.id), viewerId, isStaff);
}

async function listStoreListings(businessId: number, options: { publishedOnly: boolean }) {
  const clauses = [`l.business_id = ?`, `l.deleted_at IS NULL`, `m.code = 'gold'`];
  const values: unknown[] = [businessId];
  if (options.publishedOnly) {
    clauses.push(`(l.lifecycle_status = 'published' OR l.status = 'published')`);
  }
  const rows = await queryRows<Row>(
    `SELECT l.id, l.uuid, l.title, l.price, l.currency, l.status, l.lifecycle_status,
            l.media_count, l.published_at,
            g.karat, g.gross_weight_g, g.net_weight_g, g.form,
            (SELECT lm.thumb_url FROM listing_media lm
              WHERE lm.listing_id = l.id AND lm.kind = 'image'
              ORDER BY lm.is_primary DESC, lm.sort_order ASC LIMIT 1) AS thumb_url
       FROM listings l
       JOIN marketplaces m ON m.id = l.marketplace_id
       LEFT JOIN gold_listing_details g ON g.listing_id = l.id
      WHERE ${clauses.join(' AND ')}
      ORDER BY l.published_at DESC, l.id DESC
      LIMIT 100`,
    values,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    title: String(row.title),
    price: row.price === null ? null : Number(row.price),
    currency: (row.currency as string | null) ?? null,
    status: String(row.lifecycle_status ?? row.status),
    mediaCount: Number(row.media_count ?? 0),
    publishedAt: row.published_at ? (row.published_at as Date).toISOString() : null,
    thumbUrl: (row.thumb_url as string | null) ?? null,
    karat: row.karat === null || row.karat === undefined ? null : Number(row.karat),
    weightG:
      row.net_weight_g !== null && row.net_weight_g !== undefined
        ? Number(row.net_weight_g)
        : row.gross_weight_g === null || row.gross_weight_g === undefined
          ? null
          : Number(row.gross_weight_g),
    form: (row.form as string | null) ?? null,
  }));
}

/**
 * Personal ads: businessId omitted.
 * Brand/store ads: gold_shop that has completed application; members may post
 * while building inventory. Public brand badge requires storefront active.
 */
export async function assertCanPostAsGoldStore(businessId: number, userId: number, isStaff = false) {
  await assertBusinessPermission(businessId, userId, 'listing.post', isStaff);
  const business = await queryOne<Row>(
    `SELECT id, kind, status FROM business_profiles WHERE id = ?`,
    [businessId],
  );
  if (!business) throw notFound('Store');
  if (String(business.kind) !== 'gold_shop') {
    throw forbidden('Only Gold Marketplace stores can post brand ads in Gold');
  }

  const status = String(business.status);
  if (status === 'rejected' || status === 'suspended') {
    throw forbidden('This Gold store cannot post brand ads while suspended or rejected');
  }
  if (status !== 'active' && status !== 'pending') {
    throw forbidden('Complete the Gold store application before posting as a brand');
  }

  await ensureGoldShopProfile(businessId);
  const profile = await getStorefrontRow(businessId);
  const storefront = String(profile?.storefront_status ?? 'draft');
  if (storefront === 'draft') {
    throw new AppError('Submit the Gold store application before posting as a brand/shop', {
      status: 403,
      code: ErrorCode.APPROVAL_REQUIRED,
      details: {
        hint: 'Personal items can still be posted as a person without a store.',
        storefrontStatus: storefront,
      },
    });
  }
  if (storefront === 'suspended') {
    throw forbidden('This Gold storefront is suspended');
  }

  return {
    businessId,
    storefrontStatus: storefront as GoldStorefrontStatus,
    isPublicBrand: storefront === 'active' && status === 'active',
  };
}

export async function syncGoldStorefrontForListing(listingId: number) {
  const row = await queryOne<Row>(
    `SELECT l.business_id, bp.kind
       FROM listings l
       LEFT JOIN business_profiles bp ON bp.id = l.business_id
      WHERE l.id = ?`,
    [listingId],
  );
  if (!row?.business_id || String(row.kind) !== 'gold_shop') return null;
  return evaluateGoldStorefront(Number(row.business_id));
}

export async function listMyGoldStores(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT bp.id
       FROM business_members bm
       JOIN business_profiles bp ON bp.id = bm.business_id
      WHERE bm.user_id = ?
        AND bm.removed_at IS NULL
        AND bm.accepted_at IS NOT NULL
        AND bp.kind = 'gold_shop'
        AND bp.status <> 'rejected'
      ORDER BY bp.created_at DESC`,
    [userId],
  );
  const stores = [];
  for (const row of rows) {
    const progress = await evaluateGoldStorefront(Number(row.id));
    if (progress) stores.push(progress);
  }
  return stores;
}

export async function updateGoldStoreProfile(
  businessId: number,
  userId: number,
  isStaff: boolean,
  input: Partial<ApplyGoldStoreInput>,
) {
  await assertBusinessPermission(businessId, userId, 'business.update', isStaff);
  await updateBusiness(businessId, userId, isStaff, {
    legalName: input.legalName,
    tradeName: input.tradeName,
    description: input.description,
    website: input.website,
    registrationNo: input.registrationNo,
    licenseReference: input.licenseReference,
    taxId: input.taxId,
    countryId: input.countryId,
    regionId: input.regionId,
    cityId: input.cityId,
    address: input.address,
    contactPhone: input.contactPhone,
    contactEmail: input.contactEmail,
    establishedYear: input.establishedYear,
    marketplaces: ['gold'],
  });

  if (input.certifications || input.offerings || input.notes !== undefined) {
    await saveGoldShopExtension(businessId, userId, isStaff, {
      certifications: input.certifications,
      offerings: input.offerings,
      notes: input.notes,
    });
  }

  if (input.minListingsRequired != null) {
    await execute(`UPDATE gold_shop_profiles SET min_listings_required = ? WHERE business_id = ?`, [
      clampMinListings(input.minListingsRequired),
      businessId,
    ]);
  }

  return getGoldStore(businessId, userId, isStaff);
}

export function mapGoldShopExtension(profile: Row | null, offerings: Row[]) {
  return {
    certifications: toJson<string[]>(profile?.certifications, []),
    notes: (profile?.notes as string | null) ?? null,
    minListingsRequired: Number(profile?.min_listings_required ?? GOLD_STORE_MIN_LISTINGS),
    storefrontStatus: String(profile?.storefront_status ?? 'draft'),
    properListingCount: Number(profile?.proper_listing_count ?? 0),
    applicationSubmittedAt: profile?.application_submitted_at
      ? (profile.application_submitted_at as Date).toISOString()
      : null,
    storefrontUnlockedAt: profile?.storefront_unlocked_at
      ? (profile.storefront_unlocked_at as Date).toISOString()
      : null,
    offerings: offerings.map((row) => ({
      category: String(row.category),
      purity: (row.purity as string | null) ?? null,
    })),
    isBrandReady: String(profile?.storefront_status ?? '') === 'active',
  };
}
