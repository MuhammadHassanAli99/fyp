import { execute, insertAndGetId, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { uuid } from '../../core/security/crypto';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors';
import { roundDecimal } from '../../core/decimal';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { createOrder } from '../../modules/payments/payments.service';

export async function createPart(params: {
  sellerId: number;
  businessId?: number | null;
  categoryCode: string;
  name: string;
  sku?: string | null;
  oemPartNumber?: string | null;
  manufacturerPartNumber?: string | null;
  barcode?: string | null;
  brand?: string | null;
  conditionCode?: string;
  warranty?: string | null;
  price: number;
  currency: string;
  quantity?: number;
  warehouse?: string | null;
  compatibility?: Array<{
    makeId?: number;
    modelId?: number;
    variantId?: number;
    yearFrom?: number;
    yearTo?: number;
    engineCc?: number;
    transmission?: string;
  }>;
}) {
  if (params.price < 0) throw badRequest('Price must be zero or positive');
  const id = await insertAndGetId(
    `INSERT INTO vehicle_parts
       (uuid, seller_user_id, business_id, category_code, name, sku, oem_part_number,
        manufacturer_part_number, barcode, brand, condition_code, warranty, price, currency, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    [
      uuid(),
      params.sellerId,
      params.businessId ?? null,
      params.categoryCode,
      params.name,
      params.sku ?? null,
      params.oemPartNumber ?? null,
      params.manufacturerPartNumber ?? null,
      params.barcode ?? null,
      params.brand ?? null,
      params.conditionCode ?? 'new',
      params.warranty ?? null,
      roundDecimal(params.price, 2),
      params.currency,
    ],
  );
  await execute(
    `INSERT INTO vehicle_part_inventory (part_id, warehouse, quantity, reserved_quantity)
     VALUES (?, ?, ?, 0)`,
    [id, params.warehouse ?? 'default', params.quantity ?? 0],
  );
  for (const row of params.compatibility ?? []) {
    await execute(
      `INSERT INTO vehicle_part_compatibility
         (part_id, make_id, model_id, variant_id, year_from, year_to, engine_cc, transmission)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        row.makeId ?? null,
        row.modelId ?? null,
        row.variantId ?? null,
        row.yearFrom ?? null,
        row.yearTo ?? null,
        row.engineCc ?? null,
        row.transmission ?? null,
      ],
    );
  }
  await recordAudit({
    action: 'vehicle.part.created',
    entityType: 'vehicle_part',
    entityId: id,
    after: { name: params.name, sku: params.sku },
  });
  return getPart(id);
}

export async function getPart(id: number) {
  const row = await queryOne<Row>('SELECT * FROM vehicle_parts WHERE id = ? AND deleted_at IS NULL', [id]);
  if (!row) throw notFound('Part');
  const [compat, inventory] = await Promise.all([
    queryRows<Row>('SELECT * FROM vehicle_part_compatibility WHERE part_id = ?', [id]),
    queryRows<Row>('SELECT * FROM vehicle_part_inventory WHERE part_id = ?', [id]),
  ]);
  return mapPart(row, compat, inventory);
}

export async function searchParts(params: {
  q?: string;
  oem?: string;
  sku?: string;
  brand?: string;
  categoryCode?: string;
  makeId?: number;
  modelId?: number;
  year?: number;
  conditionCode?: string;
  page: number;
  perPage: number;
}) {
  const where: string[] = ['p.deleted_at IS NULL', `p.status = 'active'`];
  const values: unknown[] = [];
  if (params.q) {
    where.push('(p.name LIKE ? OR p.oem_part_number LIKE ? OR p.sku LIKE ?)');
    const like = `%${params.q}%`;
    values.push(like, like, like);
  }
  if (params.oem) {
    where.push('p.oem_part_number = ?');
    values.push(params.oem);
  }
  if (params.sku) {
    where.push('p.sku = ?');
    values.push(params.sku);
  }
  if (params.brand) {
    where.push('p.brand = ?');
    values.push(params.brand);
  }
  if (params.categoryCode) {
    where.push('p.category_code = ?');
    values.push(params.categoryCode);
  }
  if (params.conditionCode) {
    where.push('p.condition_code = ?');
    values.push(params.conditionCode);
  }
  if (params.makeId || params.modelId || params.year) {
    where.push(`EXISTS (
      SELECT 1 FROM vehicle_part_compatibility c
       WHERE c.part_id = p.id
         AND (? IS NULL OR c.make_id = ?)
         AND (? IS NULL OR c.model_id = ?)
         AND (? IS NULL OR ((c.year_from IS NULL OR c.year_from <= ?) AND (c.year_to IS NULL OR c.year_to >= ?)))
    )`);
    values.push(
      params.makeId ?? null,
      params.makeId ?? null,
      params.modelId ?? null,
      params.modelId ?? null,
      params.year ?? null,
      params.year ?? null,
      params.year ?? null,
    );
  }
  const offset = (params.page - 1) * params.perPage;
  const rows = await queryRows<Row>(
    `SELECT p.* FROM vehicle_parts p
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT ? OFFSET ?`,
    [...values, params.perPage, offset],
  );
  return rows.map((row) => mapPart(row, [], []));
}

export async function buyPart(params: {
  partId: number;
  buyerId: number;
  countryId: number;
  quantity: number;
  gatewayCode: string;
}) {
  if (params.quantity < 1) throw badRequest('Quantity must be at least 1');
  return transaction(async (connection) => {
    const part = await queryOne<Row>(
      `SELECT * FROM vehicle_parts WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
      [params.partId],
      connection,
    );
    if (!part) throw notFound('Part');
    if (Number(part.seller_user_id) === params.buyerId) throw forbidden('You cannot buy your own part');
    const inventory = await queryOne<Row>(
      `SELECT * FROM vehicle_part_inventory WHERE part_id = ? ORDER BY id LIMIT 1 FOR UPDATE`,
      [params.partId],
      connection,
    );
    const available = inventory ? Number(inventory.quantity) - Number(inventory.reserved_quantity) : 0;
    if (available < params.quantity) throw conflict('Not enough stock');

    const unit = toNumber(part.price) ?? 0;
    const amount = Number(roundDecimal(unit * params.quantity, 2));
    const currency = String(part.currency);
    const checkout = await createOrder(params.buyerId, {
      kind: 'parts_purchase',
      amount,
      currency,
      countryId: params.countryId,
      gatewayCode: params.gatewayCode,
      description: `Vehicle part ${String(part.name)}`,
      referenceType: 'vehicle_part',
      referenceId: params.partId,
    });

    await execute(
      `UPDATE vehicle_part_inventory
          SET reserved_quantity = reserved_quantity + ?
        WHERE id = ? AND quantity - reserved_quantity >= ?`,
      [params.quantity, inventory!.id, params.quantity],
      connection,
    );

    await recordAudit({
      action: 'vehicle.part.reserved',
      entityType: 'vehicle_part',
      entityId: params.partId,
      after: { quantity: params.quantity, orderId: checkout.order.id },
    });
    await notifyUser({
      userId: Number(part.seller_user_id),
      categoryCode: 'vehicle.parts',
      title: 'Part reserved',
      body: `${params.quantity} × ${String(part.name)} was reserved.`,
      actionType: 'payment',
      actionTarget: checkout.order.uuid,
      data: { summary: 'Part reserved' },
    });
    return { ...checkout, partId: params.partId, quantity: params.quantity, amount, currency };
  });
}

function mapPart(row: Row, compat: Row[], inventory: Row[]) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    sellerUserId: Number(row.seller_user_id),
    categoryCode: String(row.category_code),
    name: String(row.name),
    sku: (row.sku as string | null) ?? null,
    oemPartNumber: (row.oem_part_number as string | null) ?? null,
    manufacturerPartNumber: (row.manufacturer_part_number as string | null) ?? null,
    barcode: (row.barcode as string | null) ?? null,
    brand: (row.brand as string | null) ?? null,
    conditionCode: String(row.condition_code),
    warranty: (row.warranty as string | null) ?? null,
    price: toNumber(row.price),
    currency: String(row.currency),
    status: String(row.status),
    compatibility: compat.map((item) => ({
      makeId: item.make_id === null ? null : Number(item.make_id),
      modelId: item.model_id === null ? null : Number(item.model_id),
      yearFrom: item.year_from === null ? null : Number(item.year_from),
      yearTo: item.year_to === null ? null : Number(item.year_to),
      engineCc: item.engine_cc === null ? null : Number(item.engine_cc),
      transmission: (item.transmission as string | null) ?? null,
    })),
    inventory: inventory.map((item) => ({
      warehouse: (item.warehouse as string | null) ?? 'default',
      sku: item.sku,
      quantity: Number(item.quantity),
      reservedQuantity: Number(item.reserved_quantity),
      availableQuantity: Number(item.quantity) - Number(item.reserved_quantity),
      reorderThreshold: item.reorder_threshold === null ? null : Number(item.reorder_threshold),
    })),
  };
}

export function canReservePart(quantity: number, reserved: number, buyQty: number): boolean {
  return quantity - reserved >= buyQty && buyQty > 0;
}
