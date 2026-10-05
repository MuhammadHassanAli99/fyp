import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { VEHICLE_MARKETPLACE_ID } from './vehicles.rules';

export async function createLead(params: {
  listingId: number;
  buyerId: number;
  message?: string | null;
}) {
  const listing = await queryOne<Row>(
    `SELECT l.id, l.user_id, l.business_id, vd.vehicle_id
       FROM listings l JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [params.listingId],
  );
  if (!listing) throw notFound('Listing');
  if (Number(listing.user_id) === params.buyerId) throw badRequest('You cannot create a lead on your own listing');
  const id = await insertAndGetId(
    `INSERT INTO vehicle_leads
       (uuid, listing_id, vehicle_id, business_id, buyer_id, seller_id, status, source, message)
     VALUES (?, ?, ?, ?, ?, ?, 'new', 'inquiry', ?)`,
    [
      uuid(),
      params.listingId,
      listing.vehicle_id ?? null,
      listing.business_id ?? null,
      params.buyerId,
      Number(listing.user_id),
      params.message ?? null,
    ],
  );
  await execute(`UPDATE listings SET lead_count = lead_count + 1 WHERE id = ?`, [params.listingId]);
  await recordAudit({
    action: 'vehicle.lead.created',
    entityType: 'vehicle_lead',
    entityId: id,
    after: { listingId: params.listingId },
  });
  return getLead(id, params.buyerId, false);
}

export async function getLead(id: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>('SELECT * FROM vehicle_leads WHERE id = ?', [id]);
  if (!row) throw notFound('Lead');
  if (!isStaff && Number(row.buyer_id) !== userId && Number(row.seller_id) !== userId && Number(row.assignee_id ?? 0) !== userId) {
    throw forbidden('This lead does not belong to you');
  }
  return mapLead(row);
}

export async function listLeads(userId: number, role: 'buyer' | 'seller') {
  const rows = await queryRows<Row>(
    `SELECT * FROM vehicle_leads WHERE ${role === 'seller' ? 'seller_id' : 'buyer_id'} = ? ORDER BY updated_at DESC LIMIT 200`,
    [userId],
  );
  return rows.map(mapLead);
}

export async function updateLead(params: {
  leadId: number;
  userId: number;
  isStaff: boolean;
  status?: 'new' | 'contacted' | 'qualified' | 'negotiating' | 'converted' | 'lost';
  assigneeId?: number | null;
  followUpAt?: string | null;
}) {
  const row = await queryOne<Row>('SELECT * FROM vehicle_leads WHERE id = ?', [params.leadId]);
  if (!row) throw notFound('Lead');
  if (!params.isStaff && Number(row.seller_id) !== params.userId) {
    throw forbidden('Only the seller or staff can update this lead');
  }
  await execute(
    `UPDATE vehicle_leads
        SET status = COALESCE(?, status), assignee_id = COALESCE(?, assignee_id), follow_up_at = COALESCE(?, follow_up_at)
      WHERE id = ?`,
    [params.status ?? null, params.assigneeId ?? null, params.followUpAt ?? null, params.leadId],
  );
  return getLead(params.leadId, params.userId, params.isStaff);
}

export async function listDealerInventory(businessId: number, userId: number, isStaff: boolean) {
  const business = await queryOne<Row>('SELECT owner_user_id FROM business_profiles WHERE id = ?', [businessId]);
  if (!business) throw notFound('Dealer');
  if (!isStaff && Number(business.owner_user_id) !== userId) throw forbidden('You cannot view this dealer inventory');
  const rows = await queryRows<Row>(
    `SELECT i.*, v.make_name, v.model_name, v.year, v.vehicle_type
       FROM vehicle_dealer_inventory i
       JOIN vehicles v ON v.id = i.vehicle_id
      WHERE i.business_id = ?
      ORDER BY i.updated_at DESC LIMIT 500`,
    [businessId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    vehicleId: Number(row.vehicle_id),
    listingId: row.listing_id === null ? null : Number(row.listing_id),
    status: String(row.status),
    askingPrice: row.asking_price,
    currency: row.currency,
    makeName: row.make_name,
    modelName: row.model_name,
    year: row.year === null ? null : Number(row.year),
    vehicleType: row.vehicle_type,
  }));
}

export async function upsertDealerInventory(params: {
  businessId: number;
  vehicleId: number;
  userId: number;
  isStaff: boolean;
  listingId?: number | null;
  status?: string;
  askingPrice?: number | null;
  currency?: string | null;
}) {
  const business = await queryOne<Row>('SELECT owner_user_id FROM business_profiles WHERE id = ?', [params.businessId]);
  if (!business) throw notFound('Dealer');
  if (!params.isStaff && Number(business.owner_user_id) !== params.userId) {
    throw forbidden('You cannot edit this dealer inventory');
  }
  await execute(
    `INSERT INTO vehicle_dealer_inventory (business_id, vehicle_id, listing_id, status, asking_price, currency)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE listing_id = VALUES(listing_id), status = VALUES(status),
       asking_price = VALUES(asking_price), currency = VALUES(currency)`,
    [
      params.businessId,
      params.vehicleId,
      params.listingId ?? null,
      params.status ?? 'available',
      params.askingPrice ?? null,
      params.currency ?? null,
    ],
  );
  return listDealerInventory(params.businessId, params.userId, params.isStaff);
}

export { VEHICLE_MARKETPLACE_ID };

function mapLead(row: Row) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    listingId: row.listing_id === null ? null : Number(row.listing_id),
    vehicleId: row.vehicle_id === null ? null : Number(row.vehicle_id),
    buyerId: Number(row.buyer_id),
    sellerId: Number(row.seller_id),
    status: String(row.status),
    message: row.message,
    followUpAt: row.follow_up_at ? (row.follow_up_at as Date).toISOString() : null,
  };
}
