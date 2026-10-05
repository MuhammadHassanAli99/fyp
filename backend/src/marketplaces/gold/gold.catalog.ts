import { queryOne, queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { toBoolean, toNumber } from '../../db/sql';
import { listBrands } from '../../modules/catalog/catalog.service';

export async function getGoldCatalog(params: { countryId: number | null; language: string }) {
  const [purities, countryPurities, brands, hallmarks, categories] = await Promise.all([
    listGlobalPurities(),
    getCountryPurityStandards(params.countryId),
    listBrands(1),
    listHallmarkAuthorities(params.countryId),
    listGoldCategories(params.language),
  ]);

  return {
    groups: categories.groups,
    categories: categories.leaves,
    purities,
    countryPurities,
    brands,
    hallmarkAuthorities: hallmarks,
    makingChargeTypes: [
      { code: 'flat', api: 'FIXED', label: 'Fixed amount' },
      { code: 'per_gram', api: 'PER_GRAM', label: 'Per gram' },
      { code: 'percent', api: 'PERCENTAGE', label: 'Percentage of metal value' },
    ],
    weightUnits: ['gram', 'tola', 'ounce'],
    disclaimer:
      'Gold market rates are a reference only. Seller listing prices are independent and may include making charges, premiums, taxes and other costs.',
  };
}

async function listGlobalPurities() {
  return remember('gold:purity-standards', 3600, async () => {
    const rows = await queryRows<Row>('SELECT * FROM gold_purity_standards ORDER BY karat DESC');
    return rows.map((row) => ({
      karat: toNumber(row.karat) ?? 0,
      fineness: Number(row.fineness),
      purityPercent: toNumber(row.purity_percent) ?? 0,
      label: String(row.label),
      commonRegions: row.common_regions ?? null,
    }));
  });
}

export async function getCountryPurityStandards(countryId: number | null) {
  if (!countryId) return [];
  return remember(`gold:purity-country:${countryId}`, 3600, async () => {
    const rows = await queryRows<Row>(
      `SELECT karat, fineness, purity_percent, standard_code, verification_method, label, is_default
         FROM gold_purity_country_standards
        WHERE country_id = ? AND is_active = 1
        ORDER BY sort_order, karat DESC`,
      [countryId],
    );
    return rows.map((row) => ({
      karat: toNumber(row.karat) ?? 0,
      fineness: Number(row.fineness),
      purityPercent: toNumber(row.purity_percent) ?? 0,
      standardCode: String(row.standard_code),
      verificationMethod: (row.verification_method as string | null) ?? null,
      label: String(row.label),
      isDefault: toBoolean(row.is_default),
    }));
  });
}

export async function listHallmarkAuthorities(countryId: number | null) {
  const rows = await queryRows<Row>(
    `SELECT id, code, name, country_id, verification_source
       FROM gold_hallmark_authorities
      WHERE is_active = 1 AND (country_id = ? OR country_id IS NULL OR ? IS NULL)
      ORDER BY (country_id IS NULL), sort_order, name`,
    [countryId, countryId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    countryId: row.country_id === null ? null : Number(row.country_id),
    verificationSource: (row.verification_source as string | null) ?? null,
  }));
}

async function listGoldCategories(language: string) {
  const rows = await queryRows<Row>(
    `SELECT c.id, c.parent_id, c.code, c.name, c.slug, c.is_leaf, c.group_code, c.sort_order,
            COALESCE(ct.name, c.name) AS localized_name,
            p.code AS parent_code, COALESCE(pt.name, p.name) AS parent_name
       FROM categories c
       LEFT JOIN category_translations ct ON ct.category_id = c.id AND ct.language = ?
       LEFT JOIN categories p ON p.id = c.parent_id
       LEFT JOIN category_translations pt ON pt.category_id = p.id AND pt.language = ?
      WHERE c.marketplace_id = 1 AND c.is_active = 1
      ORDER BY COALESCE(p.sort_order, c.sort_order), c.sort_order, c.id`,
    [language, language],
  );

  const groupsMap = new Map<string, { code: string; name: string; categories: Array<{ id: number; code: string; name: string; isLeaf: boolean }> }>();
  const leaves: Array<{ id: number; code: string; name: string; parentCode: string | null; parentName: string | null; isLeaf: boolean }> = [];

  for (const row of rows) {
    const item = {
      id: Number(row.id),
      code: String(row.code),
      name: String(row.localized_name),
      isLeaf: toBoolean(row.is_leaf),
    };
    const groupCode = (row.group_code as string | null) || (row.parent_code as string | null) || (row.parent_id ? 'other' : String(row.code));
    const groupName = (row.parent_name as string | null) || (row.group_code as string | null) || item.name;
    if (!groupsMap.has(groupCode)) {
      groupsMap.set(groupCode, { code: groupCode, name: String(groupName), categories: [] });
    }
    if (item.isLeaf) {
      groupsMap.get(groupCode)!.categories.push(item);
      leaves.push({
        ...item,
        parentCode: (row.parent_code as string | null) ?? null,
        parentName: (row.parent_name as string | null) ?? null,
      });
    }
  }

  return { groups: [...groupsMap.values()], leaves };
}

export async function resolveFinenessForCountry(params: {
  countryId: number | null;
  karat: number;
}): Promise<{ fineness: number; purityPercent: number; standardCode: string | null }> {
  if (params.countryId) {
    const row = await queryOne<Row>(
      `SELECT fineness, purity_percent, standard_code
         FROM gold_purity_country_standards
        WHERE country_id = ? AND karat = ? AND is_active = 1
        ORDER BY is_default DESC LIMIT 1`,
      [params.countryId, params.karat],
    );
    if (row) {
      return {
        fineness: Number(row.fineness),
        purityPercent: toNumber(row.purity_percent) ?? 0,
        standardCode: String(row.standard_code),
      };
    }
  }
  const global = await queryOne<Row>(
    'SELECT fineness, purity_percent FROM gold_purity_standards WHERE karat = ?',
    [params.karat],
  );
  if (global) {
    return {
      fineness: Number(global.fineness),
      purityPercent: toNumber(global.purity_percent) ?? 0,
      standardCode: null,
    };
  }
  const fineness = Math.round((params.karat / 24) * 1000);
  return { fineness, purityPercent: Number(((fineness / 1000) * 100).toFixed(3)), standardCode: null };
}
