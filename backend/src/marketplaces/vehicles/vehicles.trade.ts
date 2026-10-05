import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { uuid } from '../../core/security/crypto';
import { badRequest, forbidden, notFound } from '../../core/errors';
import { roundDecimal } from '../../core/decimal';
import { recordAudit } from '../../middleware/audit';
import { notifyUser } from '../../modules/notifications/notify';
import { VEHICLE_MARKETPLACE_ID } from './vehicles.rules';

const CASE_FLOW = [
  'draft',
  'seller_confirmed',
  'verification',
  'inspection',
  'origin_eligibility',
  'destination_eligibility',
  'documents',
  'agreement',
  'payment',
  'export_docs',
  'shipping_booked',
  'origin_customs',
  'in_transit',
  'destination_customs',
  'cleared',
  'released',
  'local_transport',
  'registration',
  'delivered',
  'completed',
] as const;

export async function getTradeRule(originCountryId: number, destinationCountryId: number, onDate = new Date()) {
  const day = onDate.toISOString().slice(0, 10);
  const row = await queryOne<Row>(
    `SELECT * FROM vehicle_trade_rules
      WHERE origin_country_id = ? AND destination_country_id = ? AND is_active = 1
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to >= ?)
      ORDER BY version DESC, effective_from DESC
      LIMIT 1`,
    [originCountryId, destinationCountryId, day, day],
  );
  if (!row) {
    return {
      found: false,
      originCountryId,
      destinationCountryId,
      requiredDocuments: [] as string[],
      disclaimer: 'No active trade rule for this corridor. Rules are versioned and never assumed permanent.',
    };
  }
  return {
    found: true,
    id: Number(row.id),
    version: Number(row.version),
    effectiveFrom: String(row.effective_from).slice(0, 10),
    effectiveTo: row.effective_to ? String(row.effective_to).slice(0, 10) : null,
    maxVehicleAgeYears: row.max_vehicle_age_years === null ? null : Number(row.max_vehicle_age_years),
    emissionRequirement: row.emission_requirement,
    safetyRequirement: row.safety_requirement,
    handDrive: row.hand_drive,
    inspectionRequired: Number(row.inspection_required) === 1,
    registrationRequired: Number(row.registration_required) === 1,
    dutyRatePct: toNumber(row.duty_rate_pct),
    importTaxPct: toNumber(row.import_tax_pct),
    requiredDocuments: Array.isArray(row.required_documents) ? row.required_documents : [],
    restrictions: row.restrictions,
    notes: row.notes,
    disclaimer: 'Trade rules are versioned with effective dates. Confirm current legal requirements before shipping.',
  };
}

export async function estimateLandedCost(params: {
  listingId?: number | null;
  originCountryId: number;
  destinationCountryId: number;
  vehiclePrice: number;
  currency: string;
  shipping?: number;
  insurance?: number;
  portFees?: number;
  inspectionFees?: number;
  registrationFees?: number;
  brokerFees?: number;
  localDelivery?: number;
}) {
  const rule = await getTradeRule(params.originCountryId, params.destinationCountryId);
  const dutyRate = rule.found ? (rule.dutyRatePct ?? 0) / 100 : 0;
  const taxRate = rule.found ? (rule.importTaxPct ?? 0) / 100 : 0;
  const vehiclePrice = Number(roundDecimal(params.vehiclePrice, 2));
  const shipping = Number(roundDecimal(params.shipping ?? 0, 2));
  const insurance = Number(roundDecimal(params.insurance ?? 0, 2));
  const customsDuty = Number(roundDecimal(vehiclePrice * dutyRate, 2));
  const importTax = Number(roundDecimal((vehiclePrice + customsDuty) * taxRate, 2));
  const portFees = Number(roundDecimal(params.portFees ?? 0, 2));
  const inspectionFees = Number(roundDecimal(params.inspectionFees ?? 0, 2));
  const registrationFees = Number(roundDecimal(params.registrationFees ?? 0, 2));
  const brokerFees = Number(roundDecimal(params.brokerFees ?? 0, 2));
  const localDelivery = Number(roundDecimal(params.localDelivery ?? 0, 2));
  const total = Number(
    roundDecimal(
      vehiclePrice +
        shipping +
        insurance +
        customsDuty +
        importTax +
        portFees +
        inspectionFees +
        registrationFees +
        brokerFees +
        localDelivery,
      2,
    ),
  );
  const disclaimer =
    'Estimated landed cost from versioned corridor rules. Not an authoritative customs calculation. Confirmed amounts replace estimates.';
  const id = await insertAndGetId(
    `INSERT INTO vehicle_landed_cost_quotes
       (uuid, listing_id, origin_country_id, destination_country_id, currency, status,
        vehicle_price, shipping, insurance, customs_duty, import_tax, port_fees, inspection_fees,
        registration_fees, broker_fees, local_delivery, total, disclaimer)
     VALUES (?, ?, ?, ?, ?, 'estimated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      params.listingId ?? null,
      params.originCountryId,
      params.destinationCountryId,
      params.currency,
      vehiclePrice,
      shipping,
      insurance,
      customsDuty,
      importTax,
      portFees,
      inspectionFees,
      registrationFees,
      brokerFees,
      localDelivery,
      total,
      disclaimer,
    ],
  );
  return {
    id,
    status: 'estimated' as const,
    currency: params.currency,
    components: {
      vehiclePrice,
      shipping,
      insurance,
      customsDuty,
      importTax,
      portFees,
      inspectionFees,
      registrationFees,
      brokerFees,
      localDelivery,
    },
    total,
    rule,
    disclaimer,
  };
}

export async function startTradeCase(params: {
  listingId: number;
  buyerId: number;
  originCountryId: number;
  destinationCountryId: number;
}) {
  const listing = await queryOne<Row>(
    `SELECT l.*, vd.vehicle_id FROM listings l
       JOIN vehicle_listing_details vd ON vd.listing_id = l.id
      WHERE l.id = ? AND l.deleted_at IS NULL`,
    [params.listingId],
  );
  if (!listing) throw notFound('Vehicle listing');
  if (Number(listing.marketplace_id) !== VEHICLE_MARKETPLACE_ID) throw badRequest('Not a vehicle listing');
  if (Number(listing.user_id) === params.buyerId) throw forbidden('You cannot import your own listing');
  if (!listing.vehicle_id) throw badRequest('This listing is not attached to a vehicle asset');
  const rule = await getTradeRule(params.originCountryId, params.destinationCountryId);
  const id = await insertAndGetId(
    `INSERT INTO vehicle_trade_cases
       (uuid, listing_id, vehicle_id, buyer_id, seller_id, origin_country_id, destination_country_id, rule_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      uuid(),
      params.listingId,
      Number(listing.vehicle_id),
      params.buyerId,
      Number(listing.user_id),
      params.originCountryId,
      params.destinationCountryId,
      rule.found ? rule.id : null,
    ],
  );
  const docs = rule.found ? (rule.requiredDocuments as string[]) : [];
  for (const docType of docs) {
    await execute(
      `INSERT INTO vehicle_trade_documents (case_id, doc_type, required, status) VALUES (?, ?, 1, 'missing')`,
      [id, docType],
    );
  }
  await recordAudit({
    action: 'vehicle.trade.started',
    entityType: 'vehicle_trade_case',
    entityId: id,
    after: { listingId: params.listingId, originCountryId: params.originCountryId, destinationCountryId: params.destinationCountryId },
  });
  return getTradeCase(id, params.buyerId, false);
}

export async function getTradeCase(id: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>('SELECT * FROM vehicle_trade_cases WHERE id = ?', [id]);
  if (!row) throw notFound('Trade case');
  if (!isStaff && Number(row.buyer_id) !== userId && Number(row.seller_id) !== userId) {
    throw forbidden('This trade case does not belong to you');
  }
  const documents = await queryRows<Row>('SELECT * FROM vehicle_trade_documents WHERE case_id = ?', [id]);
  const shipments = await queryRows<Row>('SELECT * FROM vehicle_shipments WHERE case_id = ? ORDER BY id DESC', [id]);
  const customs = await queryRows<Row>('SELECT * FROM vehicle_customs_declarations WHERE case_id = ?', [id]);
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    listingId: Number(row.listing_id),
    vehicleId: Number(row.vehicle_id),
    status: String(row.status),
    originCountryId: Number(row.origin_country_id),
    destinationCountryId: Number(row.destination_country_id),
    documents: documents.map((doc) => ({
      docType: String(doc.doc_type),
      required: Number(doc.required) === 1,
      status: String(doc.status),
    })),
    shipments: shipments.map(mapShipment),
    customs: customs.map((item) => ({
      id: Number(item.id),
      direction: String(item.direction),
      status: String(item.status),
      dutyAmount: toNumber(item.duty_amount),
      taxAmount: toNumber(item.tax_amount),
      calculationSource: String(item.calculation_source),
    })),
  };
}

export async function advanceTradeCase(params: {
  caseId: number;
  userId: number;
  isStaff: boolean;
  toStatus: (typeof CASE_FLOW)[number] | 'held' | 'cancelled';
}) {
  const row = await queryOne<Row>('SELECT * FROM vehicle_trade_cases WHERE id = ?', [params.caseId]);
  if (!row) throw notFound('Trade case');
  if (!params.isStaff && Number(row.buyer_id) !== params.userId && Number(row.seller_id) !== params.userId) {
    throw forbidden('This trade case does not belong to you');
  }
  await execute(`UPDATE vehicle_trade_cases SET status = ? WHERE id = ?`, [params.toStatus, params.caseId]);
  await recordAudit({
    action: 'vehicle.trade.advanced',
    entityType: 'vehicle_trade_case',
    entityId: params.caseId,
    after: { from: row.status, to: params.toStatus },
  });
  await notifyUser({
    userId: Number(row.buyer_id) === params.userId ? Number(row.seller_id) : Number(row.buyer_id),
    categoryCode: 'vehicle.trade',
    title: 'Trade case update',
    body: `Import/export status is now ${params.toStatus}.`,
    actionType: 'listing',
    actionTarget: String(row.listing_id),
    data: { summary: `Status ${params.toStatus}` },
  });
  return getTradeCase(params.caseId, params.userId, params.isStaff);
}

export async function bookShipment(params: {
  caseId: number;
  userId: number;
  isStaff: boolean;
  mode: string;
  providerCode?: string;
  originPort?: string;
  destinationPort?: string;
}) {
  const current = await getTradeCase(params.caseId, params.userId, params.isStaff);
  const id = await insertAndGetId(
    `INSERT INTO vehicle_shipments
       (uuid, case_id, mode, provider_code, origin_port, destination_port, status, booked_at)
     VALUES (?, ?, ?, ?, ?, ?, 'booked', CURRENT_TIMESTAMP)`,
    [
      uuid(),
      params.caseId,
      params.mode,
      params.providerCode ?? 'stub',
      params.originPort ?? null,
      params.destinationPort ?? null,
    ],
  );
  await execute(
    `INSERT INTO vehicle_shipment_events (shipment_id, status, notes) VALUES (?, 'booked', 'Booked via provider adapter')`,
    [id],
  );
  await execute(`UPDATE vehicle_trade_cases SET status = 'shipping_booked' WHERE id = ?`, [params.caseId]);
  await recordAudit({
    action: 'vehicle.shipment.booked',
    entityType: 'vehicle_shipment',
    entityId: id,
    after: { caseId: params.caseId, mode: params.mode, provider: params.providerCode ?? 'stub' },
  });
  return { shipmentId: id, case: current };
}

export async function trackShipment(shipmentId: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>(
    `SELECT s.*, c.buyer_id, c.seller_id
       FROM vehicle_shipments s
       JOIN vehicle_trade_cases c ON c.id = s.case_id
      WHERE s.id = ?`,
    [shipmentId],
  );
  if (!row) throw notFound('Shipment');
  if (!isStaff && Number(row.buyer_id) !== userId && Number(row.seller_id) !== userId) {
    throw forbidden('This shipment does not belong to you');
  }
  const events = await queryRows<Row>(
    `SELECT status, location_label, notes, occurred_at FROM vehicle_shipment_events WHERE shipment_id = ? ORDER BY occurred_at`,
    [shipmentId],
  );
  return {
    ...mapShipment(row),
    events: events.map((event) => ({
      status: String(event.status),
      locationLabel: event.location_label,
      notes: event.notes,
      occurredAt: (event.occurred_at as Date).toISOString(),
    })),
  };
}

export async function submitCustoms(params: {
  caseId: number;
  userId: number;
  isStaff: boolean;
  direction: 'export' | 'import';
  dutyAmount?: number | null;
  taxAmount?: number | null;
  currency?: string | null;
}) {
  await getTradeCase(params.caseId, params.userId, params.isStaff);
  const id = await insertAndGetId(
    `INSERT INTO vehicle_customs_declarations
       (case_id, direction, status, duty_amount, tax_amount, currency, calculation_source, notes)
     VALUES (?, ?, 'submitted', ?, ?, ?, 'rule_table', 'Duty/tax stored from corridor rules. AI is not the authority.')`,
    [
      params.caseId,
      params.direction,
      params.dutyAmount ?? null,
      params.taxAmount ?? null,
      params.currency ?? null,
    ],
  );
  await recordAudit({
    action: 'vehicle.customs.submitted',
    entityType: 'vehicle_customs',
    entityId: id,
    after: { caseId: params.caseId, direction: params.direction },
  });
  return { customsId: id };
}

export async function pollShipments(): Promise<number> {
  const rows = await queryRows<Row>(
    `SELECT id, status FROM vehicle_shipments WHERE status NOT IN ('delivered','cancelled') LIMIT 50`,
  );
  return rows.length;
}

function mapShipment(row: Row) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    mode: String(row.mode),
    providerCode: String(row.provider_code),
    trackingNumber: (row.tracking_number as string | null) ?? null,
    status: String(row.status),
    originPort: (row.origin_port as string | null) ?? null,
    destinationPort: (row.destination_port as string | null) ?? null,
  };
}
