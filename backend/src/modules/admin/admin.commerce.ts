import type { Request } from 'express';
import type { AuthPrincipal } from '../../types/express';
import { execute, insertAndGetId, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { notFound } from '../../core/errors';
import { cache, cacheKeys } from '../../config/cache';
import { buildUpdate, where } from '../../db/sql';
import { env } from '../../config/env';
import { invalidateTaxonomy } from '../catalog/catalog.service';
import { upsertRates } from '../locale/fx.service';
import { changeStatus, promoteListing } from '../listings/listings.service';
import { requestRefund } from '../payments/payments.refunds';
import { applyEntitlementOverride } from '../subscriptions/subscriptions.service';
import { restoreListing } from '../listings/listings.engine';
import { assertResourceInScope, effectivePermission, scopeSql, writeAdminAudit } from './admin.authz';
import type { AdminListQuery } from './admin.schema';

export async function listAdminListings(auth: AuthPrincipal, q: AdminListQuery) {
  const permission = effectivePermission(auth, ['listing.view_any', 'listing.view']);
  const scoped = scopeSql(auth, permission, {
    ownerId: 'l.user_id',
    countryId: 'l.country_id',
    marketplaceId: 'l.marketplace_id',
    categoryId: 'l.category_id',
    businessId: 'l.business_id',
    assignmentTable: 'l.id',
  });
  const filter = where()
    .raw('l.deleted_at IS NULL')
    .raw(scoped.sql, ...scoped.params)
    .eq('l.status', q.status)
    .eq('l.country_id', q.countryId)
    .eq('l.marketplace_id', q.marketplaceId)
    .eq('l.category_id', q.categoryId)
    .eq('l.business_id', q.companyId);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, '')}%`;
    filter.raw('(l.title LIKE ? OR l.reference_code LIKE ?)', like, like);
  }
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM listings l ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT l.id, l.uuid, l.reference_code, l.title, l.status, l.lifecycle_status, l.marketplace_id, l.category_id,
            l.user_id, l.business_id, l.country_id, l.price, l.currency, l.is_featured, l.is_boosted, l.created_at, l.published_at
       FROM listings l
       ${built.sql}
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      referenceCode: String(row.reference_code),
      title: String(row.title),
      status: String(row.status),
      lifecycleStatus: (row.lifecycle_status as string | null) ?? String(row.status),
      marketplaceId: Number(row.marketplace_id),
      categoryId: Number(row.category_id),
      userId: Number(row.user_id),
      businessId: row.business_id === null ? null : Number(row.business_id),
      countryId: row.country_id === null ? null : Number(row.country_id),
      price: row.price === null ? null : Number(row.price),
      currency: (row.currency as string | null) ?? null,
      featured: row.is_featured === 1,
      boosted: row.is_boosted === 1,
      createdAt: (row.created_at as Date).toISOString(),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

async function loadListingForAdmin(auth: AuthPrincipal, id: number, permission: string) {
  const row = await queryOne<Row>(`SELECT * FROM listings WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!row) throw notFound('Listing');
  const assigned = await queryRows<Row>(
    `SELECT user_id FROM listing_assignments WHERE listing_id = ? AND revoked_at IS NULL`,
    [id],
  );
  assertResourceInScope(auth, permission, {
    ownerId: Number(row.user_id),
    countryId: row.country_id === null ? null : Number(row.country_id),
    marketplaceId: Number(row.marketplace_id),
    categoryId: Number(row.category_id),
    businessId: row.business_id === null ? null : Number(row.business_id),
    assignedUserIds: assigned.map((item) => Number(item.user_id)),
  });
  return row;
}

export async function actOnListing(
  req: Request,
  id: number,
  action: 'approve' | 'reject' | 'suspend' | 'feature' | 'boost' | 'expire' | 'restore' | 'archive' | 'delete',
  reason?: string,
  days?: number,
) {
  const auth = req.auth!;
  const permission =
    action === 'approve'
      ? 'listing.approve'
      : action === 'reject'
        ? 'listing.reject'
        : action === 'suspend'
          ? 'listing.suspend'
          : action === 'feature'
            ? 'listing.feature'
            : action === 'boost'
              ? 'listing.boost'
              : action === 'restore'
                ? effectivePermission(auth, ['listing.restore', 'listing.update'])
                : action === 'delete'
                  ? 'listing.delete'
                  : 'listing.moderate';
  await loadListingForAdmin(auth, id, permission);

  if (action === 'feature' || action === 'boost') {
    const result = await promoteListing({
      listingId: id,
      userId: auth.userId,
      isStaff: true,
      kind: action === 'feature' ? 'feature' : 'boost',
      days: days ?? 7,
      useQuota: false,
    });
    await writeAdminAudit({ req, action: `listing.${action}`, entityType: 'listing', entityId: id, permission, reason: reason ?? null });
    return result;
  }

  if (action === 'restore') {
    const result = await restoreListing(id, {
      userId: auth.userId,
      isStaff: true,
      roles: auth.roles,
      permissions: auth.permissions,
    });
    await writeAdminAudit({ req, action: 'listing.restore', entityType: 'listing', entityId: id, permission, reason: reason ?? null });
    return result;
  }

  if (action === 'delete') {
    await execute(`UPDATE listings SET deleted_at = CURRENT_TIMESTAMP, status = 'removed' WHERE id = ?`, [id]);
    await writeAdminAudit({ req, action: 'listing.delete', entityType: 'listing', entityId: id, permission, reason: reason ?? null });
    return { status: 'removed' };
  }

  const to =
    action === 'approve'
      ? 'published'
      : action === 'reject'
        ? 'rejected'
        : action === 'suspend'
          ? 'suspended'
          : action === 'expire'
            ? 'expired'
            : 'archived';

  const result = await changeStatus({
    listingId: id,
    userId: auth.userId,
    isStaff: true,
    to,
    reason,
    roles: auth.roles,
    permissions: auth.permissions,
  });
  await writeAdminAudit({ req, action: `listing.${action}`, entityType: 'listing', entityId: id, permission, reason: reason ?? null, after: result });
  return result;
}

export async function listAdminCategories(marketplaceId?: number) {
  const rows = await queryRows<Row>(
    `SELECT id, marketplace_id, parent_id, code, name, slug, depth, is_leaf, is_active, listing_count, sort_order, operations
       FROM categories
      WHERE (? IS NULL OR marketplace_id = ?)
      ORDER BY marketplace_id, path`,
    [marketplaceId ?? null, marketplaceId ?? null],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    marketplaceId: Number(row.marketplace_id),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    code: String(row.code),
    name: String(row.name),
    slug: String(row.slug),
    depth: Number(row.depth),
    isLeaf: row.is_leaf === 1,
    isActive: row.is_active === 1,
    listingCount: Number(row.listing_count ?? 0),
    sortOrder: Number(row.sort_order ?? 0),
  }));
}

export async function upsertCategory(
  req: Request,
  input: {
    id?: number;
    marketplaceId: number;
    parentId?: number | null;
    code: string;
    name: string;
    slug?: string;
    description?: string;
    icon?: string;
    operations?: string[];
    groupCode?: string;
    isActive?: boolean;
    sortOrder?: number;
  },
) {
  const slug = (input.slug ?? input.code).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  let parentPath = '/';
  let depth = 0;
  if (input.parentId) {
    const parent = await queryOne<Row>(`SELECT path, depth FROM categories WHERE id = ?`, [input.parentId]);
    if (!parent) throw notFound('Parent category');
    parentPath = String(parent.path);
    depth = Number(parent.depth) + 1;
  }
  if (input.id) {
    await execute(
      `UPDATE categories
          SET name = ?, slug = ?, description = COALESCE(?, description), icon = COALESCE(?, icon),
              operations = COALESCE(?, operations), group_code = COALESCE(?, group_code),
              is_active = COALESCE(?, is_active), sort_order = COALESCE(?, sort_order)
        WHERE id = ?`,
      [
        input.name,
        slug,
        input.description ?? null,
        input.icon ?? null,
        input.operations ? JSON.stringify(input.operations) : null,
        input.groupCode ?? null,
        input.isActive === undefined ? null : input.isActive ? 1 : 0,
        input.sortOrder ?? null,
        input.id,
      ],
    );
    await invalidateTaxonomy(input.marketplaceId);
    await writeAdminAudit({ req, action: 'category.update', entityType: 'category', entityId: input.id, permission: 'category.update', after: input });
    return { id: input.id };
  }
  const id = await insertAndGetId(
    `INSERT INTO categories (marketplace_id, parent_id, code, name, slug, path, depth, description, icon, operations, group_code, is_leaf, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
    [
      input.marketplaceId,
      input.parentId ?? null,
      input.code,
      input.name,
      slug,
      parentPath,
      depth,
      input.description ?? null,
      input.icon ?? null,
      input.operations ? JSON.stringify(input.operations) : null,
      input.groupCode ?? null,
      input.sortOrder ?? 0,
    ],
  );
  await execute(`UPDATE categories SET path = CONCAT(?, ?, '/') WHERE id = ?`, [parentPath, id, id]);
  if (input.parentId) await execute(`UPDATE categories SET is_leaf = 0 WHERE id = ?`, [input.parentId]);
  await invalidateTaxonomy(input.marketplaceId);
  await writeAdminAudit({ req, action: 'category.create', entityType: 'category', entityId: id, permission: 'category.create', after: input });
  return { id };
}

export async function listAdminCountries() {
  const rows = await queryRows<Row>(
    `SELECT id, iso2, iso3, name, dial_code, default_currency, default_language, default_timezone,
            date_format, time_format, number_format, vat_rate, requires_kyc, requires_aml, is_active
       FROM countries ORDER BY sort_order, name`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    iso2: String(row.iso2),
    iso3: String(row.iso3),
    name: String(row.name),
    dialCode: String(row.dial_code),
    defaultCurrency: String(row.default_currency),
    defaultLanguage: String(row.default_language),
    defaultTimezone: String(row.default_timezone),
    dateFormat: String(row.date_format),
    timeFormat: String(row.time_format),
    numberFormat: row.number_format ?? null,
    vatRate: Number(row.vat_rate ?? 0),
    requiresKyc: row.requires_kyc === 1,
    requiresAml: row.requires_aml === 1,
    isActive: row.is_active === 1,
  }));
}

export async function updateCountry(
  req: Request,
  id: number,
  input: {
    name?: string;
    dialCode?: string;
    defaultCurrency?: string;
    defaultLanguage?: string;
    defaultTimezone?: string;
    dateFormat?: string;
    timeFormat?: string;
    numberFormat?: unknown;
    vatRate?: number;
    requiresKyc?: boolean;
    requiresAml?: boolean;
    isActive?: boolean;
  },
) {
  const existing = await queryOne<Row>(`SELECT * FROM countries WHERE id = ?`, [id]);
  if (!existing) throw notFound('Country');
  const patch = buildUpdate('countries', {
    name: input.name,
    dial_code: input.dialCode,
    default_currency: input.defaultCurrency,
    default_language: input.defaultLanguage,
    default_timezone: input.defaultTimezone,
    date_format: input.dateFormat,
    time_format: input.timeFormat,
    number_format: input.numberFormat ? JSON.stringify(input.numberFormat) : undefined,
    vat_rate: input.vatRate,
    requires_kyc: input.requiresKyc === undefined ? undefined : input.requiresKyc ? 1 : 0,
    requires_aml: input.requiresAml === undefined ? undefined : input.requiresAml ? 1 : 0,
    is_active: input.isActive === undefined ? undefined : input.isActive ? 1 : 0,
  });
  if (patch) await execute(`${patch.sql} WHERE id = ?`, [...patch.params, id]);
  await cache.del(cacheKeys.countries());
  await writeAdminAudit({ req, action: 'country.update', entityType: 'country', entityId: id, permission: 'country.update', after: input });
  return { id };
}

export async function listAdminLanguages() {
  const rows = await queryRows<Row>(`SELECT code, name, native_name, direction, is_active, is_default FROM languages ORDER BY sort_order, name`);
  return rows.map((row) => ({
    code: String(row.code),
    name: String(row.name),
    nativeName: String(row.native_name),
    direction: String(row.direction),
    isActive: row.is_active === 1,
    isDefault: row.is_default === 1,
    rtl: String(row.direction) === 'rtl',
  }));
}

export async function updateLanguage(req: Request, code: string, input: { name?: string; nativeName?: string; direction?: string; isActive?: boolean }) {
  const patch = buildUpdate('languages', {
    name: input.name,
    native_name: input.nativeName,
    direction: input.direction,
    is_active: input.isActive === undefined ? undefined : input.isActive ? 1 : 0,
  });
  if (patch) await execute(`${patch.sql} WHERE code = ?`, [...patch.params, code]);
  await cache.del(cacheKeys.languages());
  await writeAdminAudit({ req, action: 'language.update', entityType: 'language', entityId: code, permission: 'language.update', after: input });
  return { code };
}

export async function listAdminTranslations(language?: string, namespace?: string) {
  const filter = where().eq('language', language).eq('namespace', namespace);
  const built = filter.build();
  const rows = await queryRows<Row>(
    `SELECT id, language, namespace, trans_key, value, is_machine, updated_at FROM translations ${built.sql} ORDER BY namespace, trans_key LIMIT 500`,
    built.params,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    language: String(row.language),
    namespace: String(row.namespace),
    key: String(row.trans_key),
    value: String(row.value),
    machine: row.is_machine === 1,
    updatedAt: (row.updated_at as Date).toISOString(),
  }));
}

export async function upsertTranslation(req: Request, input: { language: string; namespace: string; key: string; value: string }) {
  const existing = await queryOne<Row>(
    `SELECT id, value FROM translations WHERE language = ? AND namespace = ? AND trans_key = ?`,
    [input.language, input.namespace, input.key],
  );
  if (existing) {
    await execute(
      `INSERT INTO translation_versions (language, namespace, trans_key, value, version, editor_id)
       SELECT ?, ?, ?, ?, COALESCE(MAX(version), 0) + 1, ? FROM translation_versions
        WHERE language = ? AND namespace = ? AND trans_key = ?`,
      [input.language, input.namespace, input.key, String(existing.value), req.auth!.userId, input.language, input.namespace, input.key],
    );
    await execute(`UPDATE translations SET value = ?, is_machine = 0 WHERE id = ?`, [input.value, existing.id]);
  } else {
    await insertAndGetId(
      `INSERT INTO translations (language, namespace, trans_key, value, is_machine) VALUES (?, ?, ?, ?, 0)`,
      [input.language, input.namespace, input.key, input.value],
    );
  }
  await writeAdminAudit({ req, action: 'translation.update', entityType: 'translation', entityId: input.key, permission: 'translation.update', after: input });
  return { ok: true };
}

export async function listAdminCurrencies() {
  const rows = await queryRows<Row>(
    `SELECT c.code, c.name, c.symbol, c.decimal_digits, c.is_active, r.rate, r.provider, r.fetched_at
       FROM currencies c
       LEFT JOIN exchange_rates r ON r.base_currency = ? AND r.quote_currency = c.code
      ORDER BY c.code`,
    [env.BASE_CURRENCY],
  );
  return rows.map((row) => ({
    code: String(row.code),
    name: String(row.name),
    symbol: String(row.symbol),
    decimalDigits: Number(row.decimal_digits),
    isActive: row.is_active === 1,
    rate: row.rate === null || row.rate === undefined ? null : Number(row.rate),
    provider: (row.provider as string | null) ?? null,
    rateAt: row.fetched_at ? (row.fetched_at as Date).toISOString() : null,
    baseCurrency: env.BASE_CURRENCY,
  }));
}

export async function updateCurrency(
  req: Request,
  code: string,
  input: { name?: string; symbol?: string; decimals?: number; isActive?: boolean; rate?: number; rateProvider?: string },
) {
  const patch = buildUpdate('currencies', {
    name: input.name,
    symbol: input.symbol,
    decimal_digits: input.decimals,
    is_active: input.isActive === undefined ? undefined : input.isActive ? 1 : 0,
  });
  if (patch) await execute(`${patch.sql} WHERE code = ?`, [...patch.params, code.toUpperCase()]);
  if (input.rate && input.rate > 0) {
    await upsertRates([{ base: env.BASE_CURRENCY, quote: code.toUpperCase(), rate: input.rate }], input.rateProvider ?? 'manual');
  }
  await writeAdminAudit({ req, action: 'currency.update', entityType: 'currency', entityId: code, permission: 'currency.update', after: input });
  return { code: code.toUpperCase() };
}

export async function listAdminSubscriptions(auth: AuthPrincipal, q: AdminListQuery) {
  const permission = effectivePermission(auth, ['subscription.view_any', 'subscription.view']);
  const scoped = scopeSql(auth, permission, { ownerId: 's.user_id', countryId: 'u.country_id' });
  const filter = where().raw(scoped.sql, ...scoped.params).eq('s.status', q.status);
  const built = filter.build();
  const total = await queryCount(
    `SELECT COUNT(*) FROM user_subscriptions s JOIN users u ON u.id = s.user_id ${built.sql}`,
    built.params,
  );
  const rows = await queryRows<Row>(
    `SELECT s.id, s.uuid, s.user_id, s.status, s.created_at, s.current_period_end, p.code AS plan_code, p.name AS plan_name, u.email
       FROM user_subscriptions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN subscription_plans p ON p.id = s.plan_id
       ${built.sql}
      ORDER BY s.id DESC
      LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      uuid: row.uuid ? String(row.uuid) : String(row.id),
      userId: Number(row.user_id),
      email: (row.email as string | null) ?? null,
      status: String(row.status),
      planCode: (row.plan_code as string | null) ?? null,
      planName: (row.plan_name as string | null) ?? null,
      periodEnd: row.current_period_end ? (row.current_period_end as Date).toISOString() : null,
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

export async function overrideSubscription(req: Request, id: number, input: { reason: string; featureCode?: string; enabled?: boolean }) {
  await applyEntitlementOverride(req.auth!.userId, id, input.featureCode ?? 'active_listings', {
    enabled: input.enabled,
    reason: input.reason,
  });
  await writeAdminAudit({ req, action: 'subscription.override', entityType: 'subscription', entityId: id, permission: 'subscription.manage', reason: input.reason });
  return { id, overridden: true };
}

export async function listAdminPayments(auth: AuthPrincipal, q: AdminListQuery) {
  const permission = effectivePermission(auth, ['payment.view_any', 'payment.view']);
  const scoped = scopeSql(auth, permission, { ownerId: 'p.user_id' });
  const filter = where().raw(scoped.sql, ...scoped.params).eq('p.status', q.status).eq('p.currency', q.currency);
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM payments p ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT p.id, p.uuid, p.user_id, p.order_id, p.amount, p.currency, p.status, p.gateway_code, p.created_at
       FROM payments p ${built.sql}
      ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      userId: Number(row.user_id),
      orderId: row.order_id === null ? null : Number(row.order_id),
      amount: Number(row.amount),
      currency: String(row.currency),
      status: String(row.status),
      gateway: (row.gateway_code as string | null) ?? null,
      createdAt: (row.created_at as Date).toISOString(),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

export async function listAdminRefunds(auth: AuthPrincipal, q: AdminListQuery) {
  const permission = effectivePermission(auth, ['refund.view_any', 'refund.view']);
  const scoped = scopeSql(auth, permission, { ownerId: 'r.user_id' });
  const filter = where().raw(scoped.sql, ...scoped.params).eq('r.status', q.status);
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM refunds r ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT r.id, r.uuid, r.user_id, r.amount, r.currency, r.status, r.reason, r.created_at
       FROM refunds r ${built.sql}
      ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      userId: Number(row.user_id),
      amount: Number(row.amount),
      currency: String(row.currency),
      status: String(row.status),
      reason: (row.reason as string | null) ?? null,
      createdAt: (row.created_at as Date).toISOString(),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

export async function listAdminInvoices(auth: AuthPrincipal, q: AdminListQuery) {
  const permission = effectivePermission(auth, ['invoice.view_any', 'invoice.view']);
  const scoped = scopeSql(auth, permission, { ownerId: 'i.user_id' });
  const filter = where().raw(scoped.sql, ...scoped.params);
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM invoices i ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT i.id, i.uuid, i.user_id, i.total_amount, i.currency, i.status, i.created_at
       FROM invoices i ${built.sql}
      ORDER BY i.id DESC LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      uuid: row.uuid ? String(row.uuid) : String(row.id),
      userId: Number(row.user_id),
      total: Number(row.total_amount),
      currency: String(row.currency),
      status: String(row.status),
      createdAt: (row.created_at as Date).toISOString(),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

export async function adminRefund(req: Request, paymentUuid: string, amount: number | undefined, reason: string) {
  const result = await requestRefund({
    userId: req.auth!.userId,
    isStaff: true,
    paymentUuid,
    amount: amount ?? null,
    reason,
  });
  await writeAdminAudit({
    req,
    action: 'refund.create',
    entityType: 'payment',
    entityId: paymentUuid,
    permission: 'refund.create',
    reason,
    after: result,
  });
  return result;
}
