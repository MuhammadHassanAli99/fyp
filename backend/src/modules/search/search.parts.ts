import { queryRows, type Row } from '../../db/query';
import { escapeLike, toNumber } from '../../db/sql';
import type { SearchQuery } from './search.dsl';

export interface PartHit {
  kind: 'part';
  id: number;
  uuid: string;
  name: string;
  brand: string | null;
  categoryCode: string;
  price: number | null;
  currency: string | null;
  conditionCode: string | null;
  marketplaceCode: 'vehicles';
  placement: 'organic';
}

export async function searchParts(
  dsl: SearchQuery,
  _ctx: { language: string; currency: string; countryId: number | null; viewerId: number | null },
): Promise<PartHit[]> {
  const term = (dsl.keywords || dsl.originalQuery).trim();
  const params: Array<string | number> = [];
  const where = [`p.deleted_at IS NULL`, `p.status = 'active'`];
  if (term) {
    where.push(`(p.name LIKE ? OR p.brand LIKE ? OR p.sku LIKE ? OR p.oem_part_number LIKE ?)`);
    const like = `%${escapeLike(term.slice(0, 80))}%`;
    params.push(like, like, like, like);
  }
  if (typeof dsl.filters.partCategory === 'string') {
    where.push('p.category_code = ?');
    params.push(dsl.filters.partCategory);
  }
  if (typeof dsl.filters.partBrand === 'string') {
    where.push('p.brand = ?');
    params.push(dsl.filters.partBrand);
  }
  if (dsl.filters.oem === 'oem' || dsl.filters.oem === true) {
    where.push('p.oem_part_number IS NOT NULL AND p.oem_part_number <> \'\'');
  }
  if (dsl.filters.oem === 'aftermarket') {
    where.push('(p.oem_part_number IS NULL OR p.oem_part_number = \'\')');
  }
  const makeId = dsl.filters.makeId ? Number(dsl.filters.makeId) : undefined;
  const modelId = dsl.filters.modelId ? Number(dsl.filters.modelId) : undefined;
  if (makeId || modelId || dsl.filters.yearMin) {
    where.push(`EXISTS (
      SELECT 1 FROM vehicle_part_compatibility vpc
       WHERE vpc.part_id = p.id
         ${makeId ? 'AND vpc.make_id = ?' : ''}
         ${modelId ? 'AND vpc.model_id = ?' : ''}
         ${dsl.filters.yearMin ? 'AND (vpc.year_from IS NULL OR vpc.year_from <= ?)' : ''}
         ${dsl.filters.yearMax ? 'AND (vpc.year_to IS NULL OR vpc.year_to >= ?)' : ''}
    )`);
    if (makeId) params.push(makeId);
    if (modelId) params.push(modelId);
    if (dsl.filters.yearMin) params.push(Number(dsl.filters.yearMin));
    if (dsl.filters.yearMax) params.push(Number(dsl.filters.yearMax));
  }
  if (dsl.price?.max !== undefined) {
    where.push('p.price <= ?');
    params.push(dsl.price.max);
  }
  const limit = Math.min(dsl.pagination.perPage, 50);
  const offset = (dsl.pagination.page - 1) * limit;
  const rows = await queryRows<Row>(
    `SELECT p.id, p.uuid, p.name, p.brand, p.category_code, p.price, p.currency, p.condition_code
       FROM vehicle_parts p
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  ).catch(() => [] as Row[]);
  void _ctx;
  return rows.map((row) => ({
    kind: 'part' as const,
    id: Number(row.id),
    uuid: String(row.uuid),
    name: String(row.name),
    brand: (row.brand as string | null) ?? null,
    categoryCode: String(row.category_code),
    price: toNumber(row.price),
    currency: (row.currency as string | null) ?? null,
    conditionCode: (row.condition_code as string | null) ?? null,
    marketplaceCode: 'vehicles' as const,
    placement: 'organic' as const,
  }));
}
