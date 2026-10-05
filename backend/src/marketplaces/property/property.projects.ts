import { execute, insertAndGetId, queryOne, queryRows, type Row } from '../../db/query';
import { uuid } from '../../core/security/crypto';
import { forbidden, notFound } from '../../core/errors';
import { recordAudit } from '../../middleware/audit';
import { assertBusinessPermission } from '../../modules/business/business.service';

export async function createProject(params: {
  userId: number;
  businessId: number;
  name: string;
  description?: string | null;
  countryId: number;
  cityId?: number | null;
  areaId?: number | null;
}) {
  await assertBusinessPermission(params.businessId, params.userId, 'listing.post');
  const slug = params.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 180) || 'project';
  const id = await insertAndGetId(
    `INSERT INTO property_projects
       (uuid, business_id, owner_user_id, name, slug, description, country_id, city_id, area_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
    [
      uuid(),
      params.businessId,
      params.userId,
      params.name,
      `${slug}-${Date.now().toString(36)}`,
      params.description ?? null,
      params.countryId,
      params.cityId ?? null,
      params.areaId ?? null,
    ],
  );
  await recordAudit({ action: 'property.project.created', entityType: 'property_project', entityId: id });
  return getProject(id, params.userId, false);
}

export async function getProject(id: number, userId: number, isStaff: boolean) {
  const row = await queryOne<Row>('SELECT * FROM property_projects WHERE id = ?', [id]);
  if (!row) throw notFound('Project');
  if (!isStaff && Number(row.owner_user_id) !== userId) {
    try {
      await assertBusinessPermission(Number(row.business_id), userId, 'listing.post');
    } catch {
      throw forbidden('You cannot view this project');
    }
  }
  const buildings = await queryRows<Row>(
    `SELECT b.id, b.name, b.total_floors,
            (SELECT COUNT(*) FROM property_floors f WHERE f.building_id = b.id) AS floor_count
       FROM property_buildings b WHERE b.project_id = ? ORDER BY b.sort_order, b.id`,
    [id],
  );
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    name: String(row.name),
    status: String(row.status),
    businessId: Number(row.business_id),
    countryId: Number(row.country_id),
    cityId: row.city_id === null ? null : Number(row.city_id),
    buildings: buildings.map((building) => ({
      id: Number(building.id),
      name: String(building.name),
      totalFloors: building.total_floors === null ? null : Number(building.total_floors),
      floorCount: Number(building.floor_count ?? 0),
    })),
  };
}

export async function addBuilding(params: {
  projectId: number;
  userId: number;
  name: string;
  totalFloors?: number | null;
}) {
  const project = await queryOne<Row>('SELECT * FROM property_projects WHERE id = ?', [params.projectId]);
  if (!project) throw notFound('Project');
  await assertBusinessPermission(Number(project.business_id), params.userId, 'listing.post');
  const id = await insertAndGetId(
    `INSERT INTO property_buildings (project_id, name, total_floors) VALUES (?, ?, ?)`,
    [params.projectId, params.name, params.totalFloors ?? null],
  );
  if (params.totalFloors && params.totalFloors > 0) {
    for (let floor = 1; floor <= Math.min(params.totalFloors, 80); floor += 1) {
      await execute(`INSERT INTO property_floors (building_id, floor_number, name) VALUES (?, ?, ?)`, [
        id,
        floor,
        `Floor ${floor}`,
      ]);
    }
  }
  return { id, projectId: params.projectId, name: params.name };
}

export async function addUnit(params: {
  floorId: number;
  userId: number;
  unitNumber: string;
  unitType?: string | null;
  propertyId?: number | null;
}) {
  const floor = await queryOne<Row>(
    `SELECT f.id, p.business_id
       FROM property_floors f
       JOIN property_buildings b ON b.id = f.building_id
       JOIN property_projects p ON p.id = b.project_id
      WHERE f.id = ?`,
    [params.floorId],
  );
  if (!floor) throw notFound('Floor');
  await assertBusinessPermission(Number(floor.business_id), params.userId, 'listing.post');
  const id = await insertAndGetId(
    `INSERT INTO property_units (floor_id, property_id, unit_number, unit_type, status)
     VALUES (?, ?, ?, ?, 'available')`,
    [params.floorId, params.propertyId ?? null, params.unitNumber, params.unitType ?? null],
  );
  return { id, floorId: params.floorId, unitNumber: params.unitNumber };
}

export async function listBuilderProjects(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT * FROM property_projects WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT 100`,
    [userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    name: String(row.name),
    status: String(row.status),
    businessId: Number(row.business_id),
  }));
}
