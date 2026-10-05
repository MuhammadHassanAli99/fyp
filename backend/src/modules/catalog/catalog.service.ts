import { queryOne, queryRows, execute, type Row } from '../../db/query';
import { remember, cache, cacheKeys } from '../../config/cache';
import { notFound } from '../../core/errors';
import { toBoolean, toJson, toNumber } from '../../db/sql';

/**
 * Taxonomy service (§4, §22 Category Management, §30 Future Expansion).
 *
 * Categories and attributes are data, not code. The client fetches the whole
 * tree once per marketplace+language, caches it in Drift, and revalidates using
 * `taxonomyVersion` — so adding a category is instantly live without an app
 * release.
 */

export interface MarketplaceSummary {
  id: number;
  code: string;
  name: string;
  tagline: string | null;
  icon: string | null;
  color: string | null;
  operations: string[];
  config: Record<string, unknown>;
  isActive: boolean;
  isComingSoon: boolean;
  sortOrder: number;
  taxonomyVersion: number;
}

export interface CategoryNode {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  slug: string;
  icon: string | null;
  imageUrl: string | null;
  description: string | null;
  groupCode: string | null;
  operations: string[] | null;
  depth: number;
  isLeaf: boolean;
  listingCount: number;
  children: CategoryNode[];
}

export interface AttributeOption {
  id: number;
  value: string;
  label: string;
  icon: string | null;
}

export interface AttributeDefinition {
  id: number;
  code: string;
  label: string;
  helpText: string | null;
  dataType: string;
  inputType: string;
  unitCode: string | null;
  unitGroup: string;
  isRequired: boolean;
  isFilterable: boolean;
  isSortable: boolean;
  isComparable: boolean;
  isSearchable: boolean;
  showInCard: boolean;
  filterWidget: string;
  validation: Record<string, unknown> | null;
  defaultValue: string | null;
  sortOrder: number;
  options: AttributeOption[];
}

export async function listMarketplaces(countryId: number | null, language: string): Promise<MarketplaceSummary[]> {
  return remember(`${cacheKeys.marketplaces()}:${countryId ?? 'all'}:${language}`, 600, async () => {
    const rows = await queryRows<Row>(
      `SELECT m.id, m.code, m.name, m.tagline, m.icon, m.color, m.operations, m.config,
              m.is_active, m.is_coming_soon, m.sort_order,
              COALESCE(mt.name, m.name)       AS localized_name,
              COALESCE(mt.tagline, m.tagline) AS localized_tagline,
              COALESCE(tv.version, 1)         AS taxonomy_version
         FROM marketplaces m
         LEFT JOIN marketplace_translations mt ON mt.marketplace_id = m.id AND mt.language = ?
         LEFT JOIN taxonomy_versions tv ON tv.marketplace_id = m.id
        WHERE m.is_active = 1
          AND (? IS NULL OR EXISTS (
                SELECT 1 FROM marketplace_countries mc
                 WHERE mc.marketplace_id = m.id AND mc.country_id = ? AND mc.is_active = 1))
        ORDER BY m.sort_order, m.id`,
      [language, countryId, countryId],
    );

    return rows.map((row) => ({
      id: Number(row.id),
      code: String(row.code),
      name: String(row.localized_name),
      tagline: (row.localized_tagline as string | null) ?? null,
      icon: (row.icon as string | null) ?? null,
      color: (row.color as string | null) ?? null,
      operations: toJson<string[]>(row.operations, []),
      config: toJson<Record<string, unknown>>(row.config, {}),
      isActive: toBoolean(row.is_active),
      isComingSoon: toBoolean(row.is_coming_soon),
      sortOrder: Number(row.sort_order),
      taxonomyVersion: Number(row.taxonomy_version),
    }));
  });
}

export async function getMarketplace(codeOrId: string | number): Promise<MarketplaceSummary> {
  const row = await queryOne<Row>(
    `SELECT m.*, COALESCE(tv.version, 1) AS taxonomy_version
       FROM marketplaces m
       LEFT JOIN taxonomy_versions tv ON tv.marketplace_id = m.id
      WHERE m.code = ? OR m.id = ?`,
    [String(codeOrId), Number(codeOrId) || 0],
  );
  if (!row) throw notFound('Marketplace');
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    tagline: (row.tagline as string | null) ?? null,
    icon: (row.icon as string | null) ?? null,
    color: (row.color as string | null) ?? null,
    operations: toJson<string[]>(row.operations, []),
    config: toJson<Record<string, unknown>>(row.config, {}),
    isActive: toBoolean(row.is_active),
    isComingSoon: toBoolean(row.is_coming_soon),
    sortOrder: Number(row.sort_order),
    taxonomyVersion: Number(row.taxonomy_version),
  };
}

/** Full category tree for a marketplace, localized and nested. */
export async function getCategoryTree(marketplaceId: number, language: string): Promise<CategoryNode[]> {
  return remember(cacheKeys.taxonomy(marketplaceId, language), 900, async () => {
    const rows = await queryRows<Row>(
      `SELECT c.id, c.parent_id, c.code, c.slug, c.icon, c.image_url, c.group_code,
              c.operations, c.depth, c.is_leaf, c.listing_count, c.sort_order,
              COALESCE(ct.name, c.name)               AS name,
              COALESCE(ct.description, c.description) AS description
         FROM categories c
         LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
        WHERE c.marketplace_id = ? AND c.is_active = 1
        ORDER BY c.depth, c.sort_order, c.id`,
      [language, marketplaceId],
    );

    const nodes = new Map<number, CategoryNode>();
    const roots: CategoryNode[] = [];

    for (const row of rows) {
      nodes.set(Number(row.id), {
        id: Number(row.id),
        parentId: row.parent_id === null ? null : Number(row.parent_id),
        code: String(row.code),
        name: String(row.name),
        slug: String(row.slug),
        icon: (row.icon as string | null) ?? null,
        imageUrl: (row.image_url as string | null) ?? null,
        description: (row.description as string | null) ?? null,
        groupCode: (row.group_code as string | null) ?? null,
        operations: row.operations ? toJson<string[]>(row.operations, []) : null,
        depth: Number(row.depth),
        isLeaf: toBoolean(row.is_leaf),
        listingCount: Number(row.listing_count),
        children: [],
      });
    }

    // Rows are depth-ordered, so a parent always exists before its children.
    for (const node of nodes.values()) {
      if (node.parentId === null) roots.push(node);
      else nodes.get(node.parentId)?.children.push(node);
    }

    return roots;
  });
}

export async function getCategory(marketplaceId: number, idOrSlug: string | number, language: string): Promise<CategoryNode & { path: string; ancestors: Array<{ id: number; name: string; slug: string }> }> {
  const row = await queryOne<Row>(
    `SELECT c.*, COALESCE(ct.name, c.name) AS localized_name,
            COALESCE(ct.description, c.description) AS localized_description
       FROM categories c
       LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
      WHERE c.marketplace_id = ? AND (c.id = ? OR c.slug = ? OR c.code = ?) AND c.is_active = 1`,
    [language, marketplaceId, Number(idOrSlug) || 0, String(idOrSlug), String(idOrSlug)],
  );
  if (!row) throw notFound('Category');

  const ancestorIds = String(row.path)
    .split('/')
    .filter(Boolean)
    .map(Number)
    .filter((id) => id !== Number(row.id));

  const ancestors =
    ancestorIds.length > 0
      ? await queryRows<Row>(
          `SELECT c.id, c.slug, COALESCE(ct.name, c.name) AS name
             FROM categories c
             LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
            WHERE c.id IN (${ancestorIds.map(() => '?').join(', ')})
            ORDER BY c.depth`,
          [language, ...ancestorIds],
        )
      : [];

  return {
    id: Number(row.id),
    parentId: row.parent_id === null ? null : Number(row.parent_id),
    code: String(row.code),
    name: String(row.localized_name),
    slug: String(row.slug),
    icon: (row.icon as string | null) ?? null,
    imageUrl: (row.image_url as string | null) ?? null,
    description: (row.localized_description as string | null) ?? null,
    groupCode: (row.group_code as string | null) ?? null,
    operations: row.operations ? toJson<string[]>(row.operations, []) : null,
    depth: Number(row.depth),
    isLeaf: toBoolean(row.is_leaf),
    listingCount: Number(row.listing_count),
    children: [],
    path: String(row.path),
    ancestors: ancestors.map((ancestor) => ({
      id: Number(ancestor.id),
      name: String(ancestor.name),
      slug: String(ancestor.slug),
    })),
  };
}

/**
 * The attribute set that drives the create-listing form and the filter panel.
 * When `categoryId` is given, per-category overrides are applied on top of the
 * attribute defaults.
 */
export async function getAttributes(params: {
  marketplaceId: number;
  categoryId?: number | null;
  language: string;
  onlyFilterable?: boolean;
  onlyComparable?: boolean;
}): Promise<AttributeDefinition[]> {
  const cacheKey = `${cacheKeys.attributes(params.marketplaceId, params.categoryId ?? null)}:${params.language}:${params.onlyFilterable ? 'f' : ''}${params.onlyComparable ? 'c' : ''}`;

  return remember(cacheKey, 900, async () => {
    const conditions: string[] = ['a.is_active = 1', '(a.marketplace_id = ? OR a.marketplace_id IS NULL)'];
    const values: unknown[] = [params.language, params.marketplaceId];

    if (params.categoryId) {
      conditions.push('ca.category_id = ?');
      values.push(params.categoryId);
    }

    const rows = await queryRows<Row>(
      `SELECT a.id, a.code, a.data_type, a.input_type, a.unit_code, a.unit_group,
              a.validation, a.default_value, a.filter_widget, a.show_in_card,
              a.is_searchable, a.is_sortable,
              MAX(COALESCE(ca.is_required,   a.is_required))   AS is_required,
              MAX(COALESCE(ca.is_filterable, a.is_filterable)) AS is_filterable,
              MAX(COALESCE(ca.is_comparable, a.is_comparable)) AS is_comparable,
              MAX(COALESCE(ca.sort_order,    a.sort_order))    AS sort_order,
              MAX(COALESCE(at.label, a.label))         AS label,
              MAX(COALESCE(at.help_text, a.help_text)) AS help_text
         FROM attributes a
         ${params.categoryId ? 'JOIN' : 'LEFT JOIN'} category_attributes ca ON ca.attribute_id = a.id
         LEFT JOIN attribute_translations at ON at.attribute_id = a.id AND at.language = ?
        WHERE ${conditions.join(' AND ')}
        GROUP BY a.id
        ORDER BY sort_order, a.id`,
      values,
    );

    const filtered = rows.filter((row) => {
      if (params.onlyFilterable && !toBoolean(row.is_filterable)) return false;
      if (params.onlyComparable && !toBoolean(row.is_comparable)) return false;
      return true;
    });

    if (filtered.length === 0) return [];

    // One extra query for all options rather than one per attribute.
    const attributeIds = filtered.map((row) => Number(row.id));
    const optionRows = await queryRows<Row>(
      `SELECT o.id, o.attribute_id, o.value, o.icon, o.sort_order,
              COALESCE(ot.label, o.label) AS label
         FROM attribute_options o
         LEFT JOIN attribute_option_translations ot ON ot.option_id = o.id AND ot.language = ?
        WHERE o.attribute_id IN (${attributeIds.map(() => '?').join(', ')}) AND o.is_active = 1
        ORDER BY o.attribute_id, o.sort_order, o.id`,
      [params.language, ...attributeIds],
    );

    const optionsByAttribute = new Map<number, AttributeOption[]>();
    for (const option of optionRows) {
      const key = Number(option.attribute_id);
      const list = optionsByAttribute.get(key) ?? [];
      list.push({
        id: Number(option.id),
        value: String(option.value),
        label: String(option.label),
        icon: (option.icon as string | null) ?? null,
      });
      optionsByAttribute.set(key, list);
    }

    return filtered.map((row) => ({
      id: Number(row.id),
      code: String(row.code),
      label: String(row.label),
      helpText: (row.help_text as string | null) ?? null,
      dataType: String(row.data_type),
      inputType: String(row.input_type),
      unitCode: (row.unit_code as string | null) ?? null,
      unitGroup: String(row.unit_group),
      isRequired: toBoolean(row.is_required),
      isFilterable: toBoolean(row.is_filterable),
      isSortable: toBoolean(row.is_sortable),
      isComparable: toBoolean(row.is_comparable),
      isSearchable: toBoolean(row.is_searchable),
      showInCard: toBoolean(row.show_in_card),
      filterWidget: String(row.filter_widget),
      validation: row.validation ? toJson<Record<string, unknown>>(row.validation, {}) : null,
      defaultValue: (row.default_value as string | null) ?? null,
      sortOrder: Number(row.sort_order),
      options: optionsByAttribute.get(Number(row.id)) ?? [],
    }));
  });
}

/** §10 Filters — the panel definition the client renders. */
export async function getFilterDefinition(marketplaceId: number, categoryId: number | null, language: string) {
  const [attributes, sortOptions, brands] = await Promise.all([
    getAttributes({ marketplaceId, categoryId, language, onlyFilterable: true }),
    getSortOptions(marketplaceId),
    listBrands(marketplaceId),
  ]);

  return {
    // Filters every marketplace shares (§10).
    core: [
      { code: 'location', label: 'Location', widget: 'location' },
      { code: 'price', label: 'Price', widget: 'min_max' },
      { code: 'distance', label: 'Distance', widget: 'range_slider', requiresLocation: true },
      { code: 'category', label: 'Category', widget: 'category_tree' },
      { code: 'operation', label: 'Looking to', widget: 'checkbox_list' },
      { code: 'condition', label: 'Condition', widget: 'checkbox_list' },
      { code: 'rating', label: 'Seller rating', widget: 'range_slider' },
      { code: 'verifiedSeller', label: 'Verified sellers only', widget: 'toggle' },
      { code: 'premiumSeller', label: 'Premium sellers only', widget: 'toggle' },
      { code: 'withPhotos', label: 'With photos', widget: 'toggle' },
      { code: 'withVideo', label: 'With video', widget: 'toggle' },
      { code: 'postedWithin', label: 'Posted within', widget: 'select' },
      { code: 'availability', label: 'Availability', widget: 'select' },
    ],
    attributes,
    sortOptions,
    brands,
  };
}

export const getSortOptions = (marketplaceId: number | null) =>
  remember(cacheKeys.sortOptions(marketplaceId), 900, async () => {
    const rows = await queryRows<Row>(
      `SELECT code, label, sort_field, direction, applies_to, requires_location, is_default, sort_order
         FROM sort_options
        WHERE is_active = 1 AND (marketplace_id = ? OR marketplace_id IS NULL)
        ORDER BY sort_order, code`,
      [marketplaceId],
    );
    return rows.map((row) => ({
      code: String(row.code),
      label: String(row.label),
      appliesTo: String(row.applies_to),
      requiresLocation: toBoolean(row.requires_location),
      isDefault: toBoolean(row.is_default),
    }));
  });

export const listBrands = (marketplaceId: number) =>
  remember(`ref:brands:${marketplaceId}`, 1800, async () => {
    const rows = await queryRows<Row>(
      `SELECT id, name, slug, logo_url, is_popular, country_id, verification_status
         FROM brands
        WHERE (marketplace_id = ? OR marketplace_id IS NULL) AND is_active = 1
        ORDER BY is_popular DESC, sort_order, name`,
      [marketplaceId],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      slug: String(row.slug),
      logoUrl: (row.logo_url as string | null) ?? null,
      isPopular: toBoolean(row.is_popular),
      countryId: row.country_id === null || row.country_id === undefined ? null : Number(row.country_id),
      verificationStatus: (row.verification_status as string | undefined) ?? 'unverified',
    }));
  });

/**
 * Bumps the taxonomy version and clears the caches. Every admin write to
 * categories/attributes must call this, or clients keep serving a stale tree.
 */
export async function invalidateTaxonomy(marketplaceId: number): Promise<number> {
  await execute(
    `INSERT INTO taxonomy_versions (marketplace_id, version) VALUES (?, 2)
     ON DUPLICATE KEY UPDATE version = version + 1`,
    [marketplaceId],
  );
  await cache.delPrefix(`taxonomy:${marketplaceId}:`);
  await cache.delPrefix(`attrs:${marketplaceId}:`);
  await cache.delPrefix(cacheKeys.marketplaces());
  await cache.del(cacheKeys.sortOptions(marketplaceId));

  const row = await queryOne<Row>('SELECT version FROM taxonomy_versions WHERE marketplace_id = ?', [marketplaceId]);
  return Number(row?.version ?? 1);
}

/** Attribute id ⇄ code map, used when persisting EAV values. */
export const getAttributeIndex = (marketplaceId: number) =>
  remember(`attrs:index:${marketplaceId}`, 900, async () => {
    const rows = await queryRows<Row>(
      `SELECT a.id, a.code, a.data_type, a.unit_group, a.validation
         FROM attributes a
        WHERE (a.marketplace_id = ? OR a.marketplace_id IS NULL) AND a.is_active = 1`,
      [marketplaceId],
    );
    const byCode = new Map<string, { id: number; dataType: string; unitGroup: string; validation: Record<string, unknown> | null }>();
    const byId = new Map<number, string>();
    for (const row of rows) {
      byCode.set(String(row.code), {
        id: Number(row.id),
        dataType: String(row.data_type),
        unitGroup: String(row.unit_group),
        validation: row.validation ? toJson<Record<string, unknown>>(row.validation, {}) : null,
      });
      byId.set(Number(row.id), String(row.code));
    }
    return { byCode, byId };
  });

/** Option value ⇄ id map for enum attributes. */
export const getOptionIndex = (attributeId: number) =>
  remember(`attrs:options:${attributeId}`, 900, async () => {
    const rows = await queryRows<Row>('SELECT id, value FROM attribute_options WHERE attribute_id = ? AND is_active = 1', [
      attributeId,
    ]);
    return new Map(rows.map((row) => [String(row.value), Number(row.id)]));
  });

export const getListingCountsByCategory = (marketplaceId: number, countryId: number | null) =>
  remember(`counts:categories:${marketplaceId}:${countryId ?? 'all'}`, 300, async () => {
    const rows = await queryRows<Row>(
      `SELECT c.id, COUNT(l.id) AS total
         FROM categories c
         LEFT JOIN listings l
           ON l.category_id = c.id AND l.status = 'published' AND l.deleted_at IS NULL
              AND (? IS NULL OR l.country_id = ?)
        WHERE c.marketplace_id = ? AND c.is_active = 1
        GROUP BY c.id`,
      [countryId, countryId, marketplaceId],
    );
    return Object.fromEntries(rows.map((row) => [String(row.id), toNumber(row.total) ?? 0]));
  });
