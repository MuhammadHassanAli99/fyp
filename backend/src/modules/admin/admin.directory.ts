import type { AuthPrincipal } from '../../types/express';
import { execute, insertAndGetId, queryCount, queryOne, queryRows, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, forbidden, notFound } from '../../core/errors';
import { uuid } from '../../core/security/crypto';
import { cache, cacheKeys } from '../../config/cache';
import { where } from '../../db/sql';
import { listDevices } from '../auth/auth.devices';
import { listSessions } from '../auth/auth.service';
import { assertResourceInScope, effectivePermission, isUnrestricted, scopeSql, writeAdminAudit } from './admin.authz';
import type { AdminListQuery } from './admin.schema';
import type { Request } from 'express';

export async function listUsers(auth: AuthPrincipal, q: AdminListQuery) {
  const scoped = scopeSql(auth, 'user.view_any', { countryId: 'u.country_id', ownerId: 'u.id' });
  const filter = where()
    .raw('u.deleted_at IS NULL')
    .raw(scoped.sql, ...scoped.params)
    .eq('u.status', q.status)
    .eq('u.country_id', q.countryId);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, '')}%`;
    filter.raw('(u.email LIKE ? OR u.username LIKE ? OR u.phone_e164 LIKE ? OR p.display_name LIKE ?)', like, like, like, like);
  }
  const built = filter.build();
  const total = await queryCount(
    `SELECT COUNT(*) FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id ${built.sql}`,
    built.params,
  );
  const offset = (q.page - 1) * q.perPage;
  const rows = await queryRows<Row>(
    `SELECT u.id, u.uuid, u.email, u.phone_e164, u.username, u.account_type, u.status, u.country_id,
            u.email_verified_at, u.phone_verified_at, u.mfa_enabled, u.created_at, u.last_active_at,
            p.display_name, ts.score AS risk_score, ts.band AS risk_band
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN trust_scores ts ON ts.user_id = u.id
       ${built.sql}
      ORDER BY u.created_at DESC
      LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, offset],
  );
  return {
    items: rows.map(mapUserRow),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

function mapUserRow(row: Row) {
  return {
    id: Number(row.id),
    uuid: String(row.uuid),
    email: (row.email as string | null) ?? null,
    phone: (row.phone_e164 as string | null) ?? null,
    username: (row.username as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    accountType: String(row.account_type),
    status: String(row.status),
    countryId: row.country_id === null ? null : Number(row.country_id),
    emailVerified: row.email_verified_at !== null,
    phoneVerified: row.phone_verified_at !== null,
    mfaEnabled: row.mfa_enabled === 1,
    riskScore: row.risk_score === null || row.risk_score === undefined ? null : Number(row.risk_score),
    riskBand: (row.risk_band as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    lastActiveAt: row.last_active_at ? (row.last_active_at as Date).toISOString() : null,
  };
}

export async function getUser(auth: AuthPrincipal, id: number) {
  const row = await queryOne<Row>(
    `SELECT u.*, p.display_name, p.bio, ts.score AS risk_score, ts.band AS risk_band
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN trust_scores ts ON ts.user_id = u.id
      WHERE u.id = ? AND u.deleted_at IS NULL`,
    [id],
  );
  if (!row) throw notFound('User');
  assertResourceInScope(auth, 'user.view_any', {
    ownerId: Number(row.id),
    countryId: row.country_id === null ? null : Number(row.country_id),
  });

  const [roles, memberships, listings, tickets] = await Promise.all([
    queryRows<Row>(
      `SELECT r.code, r.name, ur.marketplace_id, ur.expires_at
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`,
      [id],
    ),
    queryRows<Row>(
      `SELECT b.id, b.legal_name, b.kind, m.member_role, m.member_status
         FROM business_members m JOIN business_profiles b ON b.id = m.business_id
        WHERE m.user_id = ? AND m.removed_at IS NULL`,
      [id],
    ),
    queryCount(`SELECT COUNT(*) FROM listings WHERE user_id = ? AND deleted_at IS NULL`, [id]),
    queryCount(`SELECT COUNT(*) FROM support_tickets WHERE user_id = ?`, [id]),
  ]);

  const assignments = await queryRows<Row>(
    `SELECT ura.uuid, r.code AS role, ura.scope_type, ura.country_id, ura.marketplace_id, ura.business_id, ura.expires_at
       FROM user_role_assignments ura JOIN roles r ON r.id = ura.role_id
      WHERE ura.user_id = ? AND ura.revoked_at IS NULL`,
    [id],
  );

  return {
    ...mapUserRow(row),
    bio: (row.bio as string | null) ?? null,
    roles: roles.map((item) => ({
      code: String(item.code),
      name: String(item.name),
      marketplaceId: item.marketplace_id === null ? null : Number(item.marketplace_id),
    })),
    assignments: assignments.map((item) => ({
      uuid: String(item.uuid),
      role: String(item.role),
      scopeType: String(item.scope_type),
      countryId: item.country_id === null ? null : Number(item.country_id),
      marketplaceId: item.marketplace_id === null ? null : Number(item.marketplace_id),
      businessId: item.business_id === null ? null : Number(item.business_id),
    })),
    memberships: memberships.map((item) => ({
      businessId: Number(item.id),
      name: String(item.legal_name),
      kind: String(item.kind),
      role: String(item.member_role),
      status: String(item.member_status ?? 'active'),
    })),
    listings,
    tickets,
  };
}

export async function setUserStatus(req: Request, id: number, status: 'active' | 'suspended' | 'banned', reason: string) {
  const auth = req.auth!;
  const permission = status === 'banned' ? 'user.ban' : status === 'suspended' ? 'user.suspend' : 'user.update';
  const row = await queryOne<Row>(`SELECT id, status, country_id FROM users WHERE id = ? AND deleted_at IS NULL`, [id]);
  if (!row) throw notFound('User');
  assertResourceInScope(auth, permission, { ownerId: id, countryId: row.country_id === null ? null : Number(row.country_id) });
  if (id === auth.userId) throw forbidden('You cannot change your own account status');

  await execute(`UPDATE users SET status = ?, status_reason = ? WHERE id = ?`, [status, reason.slice(0, 255), id]);
  if (status === 'banned' || status === 'suspended') {
    await execute(
      `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ? WHERE user_id = ? AND revoked_at IS NULL`,
      [status, id],
    );
  }
  await cache.del(cacheKeys.permissions(id));
  await writeAdminAudit({
    req,
    action: `user.${status}`,
    entityType: 'user',
    entityId: id,
    permission,
    reason,
    before: { status: String(row.status) },
    after: { status },
  });
  return { id, status };
}

export async function listUserSessions(auth: AuthPrincipal, id: number) {
  await getUser(auth, id);
  return listSessions(id, 0);
}

export async function listUserDevices(auth: AuthPrincipal, id: number) {
  await getUser(auth, id);
  return listDevices(id, null);
}

export async function listCompanies(auth: AuthPrincipal, q: AdminListQuery) {
  const permission = effectivePermission(auth, ['business.view_any', 'business.view']);
  const scoped = scopeSql(auth, permission, { countryId: 'b.country_id', businessId: 'b.id' });
  const filter = where()
    .raw(scoped.sql, ...scoped.params)
    .eq('b.status', q.status)
    .eq('b.country_id', q.countryId)
    .eq('b.id', q.companyId);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, '')}%`;
    filter.raw('(b.legal_name LIKE ? OR b.trade_name LIKE ? OR b.slug LIKE ?)', like, like, like);
  }
  const built = filter.build();
  const total = await queryCount(`SELECT COUNT(*) FROM business_profiles b ${built.sql}`, built.params);
  const rows = await queryRows<Row>(
    `SELECT b.id, b.kind, b.legal_name, b.trade_name, b.slug, b.status, b.country_id, b.verified_at, b.created_at,
            (SELECT COUNT(*) FROM business_members m WHERE m.business_id = b.id AND m.removed_at IS NULL) AS member_count
       FROM business_profiles b
       ${built.sql}
      ORDER BY b.created_at DESC
      LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      kind: String(row.kind),
      legalName: String(row.legal_name),
      tradeName: (row.trade_name as string | null) ?? null,
      slug: String(row.slug),
      status: String(row.status),
      countryId: row.country_id === null ? null : Number(row.country_id),
      verified: row.verified_at !== null,
      memberCount: Number(row.member_count ?? 0),
      createdAt: (row.created_at as Date).toISOString(),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

export async function getCompany(auth: AuthPrincipal, id: number) {
  const row = await queryOne<Row>(`SELECT * FROM business_profiles WHERE id = ?`, [id]);
  if (!row) throw notFound('Company');
  assertResourceInScope(auth, effectivePermission(auth, ['business.view_any', 'business.view']), {
    businessId: id,
    countryId: row.country_id === null ? null : Number(row.country_id),
  });
  const [members, departments, teams] = await Promise.all([
    queryRows<Row>(
      `SELECT m.id, m.user_id, m.member_role, m.member_status, m.department_id, m.team_id, m.can_post, m.can_billing,
              p.display_name, u.email
         FROM business_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN user_profiles p ON p.user_id = m.user_id
        WHERE m.business_id = ? AND m.removed_at IS NULL`,
      [id],
    ),
    queryRows<Row>(`SELECT id, uuid, code, name, kind, manager_user_id, is_active FROM business_departments WHERE business_id = ?`, [id]),
    queryRows<Row>(`SELECT id, uuid, department_id, name, manager_user_id, is_active FROM business_teams WHERE business_id = ?`, [id]),
  ]);
  return {
    id,
    kind: String(row.kind),
    legalName: String(row.legal_name),
    tradeName: (row.trade_name as string | null) ?? null,
    slug: String(row.slug),
    status: String(row.status),
    countryId: row.country_id === null ? null : Number(row.country_id),
    verifiedAt: row.verified_at ? (row.verified_at as Date).toISOString() : null,
    members: members.map((item) => ({
      id: Number(item.id),
      userId: Number(item.user_id),
      email: (item.email as string | null) ?? null,
      displayName: (item.display_name as string | null) ?? null,
      role: String(item.member_role),
      status: String(item.member_status ?? 'active'),
      departmentId: item.department_id === null ? null : Number(item.department_id),
      teamId: item.team_id === null ? null : Number(item.team_id),
    })),
    departments: departments.map((item) => ({
      id: Number(item.id),
      code: String(item.code),
      name: String(item.name),
      kind: String(item.kind),
      managerUserId: item.manager_user_id === null ? null : Number(item.manager_user_id),
    })),
    teams: teams.map((item) => ({
      id: Number(item.id),
      departmentId: Number(item.department_id),
      name: String(item.name),
      managerUserId: item.manager_user_id === null ? null : Number(item.manager_user_id),
    })),
  };
}

export async function setCompanyStatus(req: Request, id: number, status: string, reason: string) {
  const company = await getCompany(req.auth!, id);
  await execute(`UPDATE business_profiles SET status = ? WHERE id = ?`, [status, id]);
  await writeAdminAudit({
    req,
    action: `business.${status}`,
    entityType: 'business',
    entityId: id,
    permission: 'business.update',
    reason,
    organizationId: id,
    before: { status: company.status },
    after: { status },
  });
  return { id, status };
}

export async function listEmployees(auth: AuthPrincipal, q: AdminListQuery) {
  const scoped = scopeSql(auth, 'employee.view_any', { businessId: 'm.business_id', countryId: 'b.country_id' });
  const filter = where().raw('m.removed_at IS NULL').raw(scoped.sql, ...scoped.params).eq('m.business_id', q.companyId);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, '')}%`;
    filter.raw('(u.email LIKE ? OR p.display_name LIKE ?)', like, like);
  }
  const built = filter.build();
  const total = await queryCount(
    `SELECT COUNT(*) FROM business_members m
       JOIN business_profiles b ON b.id = m.business_id
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       ${built.sql}`,
    built.params,
  );
  const rows = await queryRows<Row>(
    `SELECT m.id, m.business_id, m.user_id, m.member_role, m.member_status, m.department_id, m.team_id,
            b.legal_name, u.email, p.display_name
       FROM business_members m
       JOIN business_profiles b ON b.id = m.business_id
       JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       ${built.sql}
      ORDER BY m.id DESC
      LIMIT ? OFFSET ?`,
    [...built.params, q.perPage, (q.page - 1) * q.perPage],
  );
  return {
    items: rows.map((row) => ({
      id: Number(row.id),
      businessId: Number(row.business_id),
      companyName: String(row.legal_name),
      userId: Number(row.user_id),
      email: (row.email as string | null) ?? null,
      displayName: (row.display_name as string | null) ?? null,
      role: String(row.member_role),
      status: String(row.member_status ?? 'active'),
      departmentId: row.department_id === null ? null : Number(row.department_id),
      teamId: row.team_id === null ? null : Number(row.team_id),
    })),
    total,
    page: q.page,
    perPage: q.perPage,
  };
}

export async function upsertEmployee(
  req: Request,
  businessId: number,
  input: {
    userId?: number;
    email?: string;
    role: string;
    departmentId?: number;
    teamId?: number;
    reportsTo?: number;
    canPost?: boolean;
    canReply?: boolean;
    canBilling?: boolean;
  },
) {
  await getCompany(req.auth!, businessId);
  let userId = input.userId;
  if (!userId && input.email) {
    const user = await queryOne<Row>(`SELECT id FROM users WHERE email = ? AND deleted_at IS NULL`, [input.email.toLowerCase()]);
    if (!user) throw notFound('User');
    userId = Number(user.id);
  }
  if (!userId) throw badRequest('Provide userId or email');

  const existing = await queryOne<Row>(
    `SELECT id FROM business_members WHERE business_id = ? AND user_id = ?`,
    [businessId, userId],
  );
  if (existing) {
    await execute(
      `UPDATE business_members
          SET member_role = ?, department_id = ?, team_id = ?, reports_to = ?,
              can_post = ?, can_reply = ?, can_billing = ?, member_status = 'active', removed_at = NULL, accepted_at = COALESCE(accepted_at, CURRENT_TIMESTAMP)
        WHERE id = ?`,
      [
        input.role,
        input.departmentId ?? null,
        input.teamId ?? null,
        input.reportsTo ?? null,
        input.canPost === false ? 0 : 1,
        input.canReply === false ? 0 : 1,
        input.canBilling ? 1 : 0,
        existing.id,
      ],
    );
  } else {
    await insertAndGetId(
      `INSERT INTO business_members
         (business_id, user_id, member_role, department_id, team_id, reports_to, can_post, can_reply, can_billing, accepted_at, member_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'active')`,
      [
        businessId,
        userId,
        input.role,
        input.departmentId ?? null,
        input.teamId ?? null,
        input.reportsTo ?? null,
        input.canPost === false ? 0 : 1,
        input.canReply === false ? 0 : 1,
        input.canBilling ? 1 : 0,
      ],
    );
  }
  await writeAdminAudit({
    req,
    action: 'employee.upsert',
    entityType: 'business_member',
    entityId: userId,
    permission: 'employee.update',
    organizationId: businessId,
    after: input,
  });
  return { businessId, userId, role: input.role };
}

export async function disableEmployee(req: Request, businessId: number, userId: number) {
  await getCompany(req.auth!, businessId);
  await execute(
    `UPDATE business_members SET member_status = 'disabled', removed_at = CURRENT_TIMESTAMP, can_post = 0
      WHERE business_id = ? AND user_id = ?`,
    [businessId, userId],
  );
  await execute(
    `UPDATE user_role_assignments SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND business_id = ? AND revoked_at IS NULL`,
    [userId, businessId],
  );
  await cache.del(cacheKeys.permissions(userId));
  await writeAdminAudit({
    req,
    action: 'employee.disable',
    entityType: 'business_member',
    entityId: userId,
    permission: 'employee.disable',
    organizationId: businessId,
  });
  return { disabled: true };
}

export async function createDepartment(req: Request, businessId: number, input: { code: string; name: string; kind: string; managerUserId?: number }) {
  await getCompany(req.auth!, businessId);
  const id = await insertAndGetId(
    `INSERT INTO business_departments (uuid, business_id, code, name, kind, manager_user_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), businessId, input.code, input.name, input.kind, input.managerUserId ?? null],
  );
  return { id, ...input };
}

export async function listRoles() {
  const rows = await queryRows<Row>(
    `SELECT r.id, r.code, r.name, r.description, r.is_staff, r.is_system,
            (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count
       FROM roles r ORDER BY r.id`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    isStaff: row.is_staff === 1,
    isSystem: row.is_system === 1,
    permissionCount: Number(row.permission_count ?? 0),
  }));
}

export async function listPermissions() {
  const rows = await queryRows<Row>(`SELECT id, code, resource, action, description FROM permissions ORDER BY resource, action`);
  return rows.map((row) => ({
    id: Number(row.id),
    code: String(row.code),
    resource: String(row.resource),
    action: String(row.action),
    description: (row.description as string | null) ?? null,
  }));
}

export async function getRole(code: string) {
  const row = await queryOne<Row>(`SELECT * FROM roles WHERE code = ?`, [code]);
  if (!row) throw notFound('Role');
  const permissions = await queryRows<Row>(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ? ORDER BY p.code`,
    [row.id],
  );
  return {
    id: Number(row.id),
    code: String(row.code),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    isStaff: row.is_staff === 1,
    isSystem: row.is_system === 1,
    permissions: permissions.map((item) => String(item.code)),
  };
}

export async function createRole(req: Request, input: { code: string; name: string; description?: string; isStaff: boolean; permissionCodes: string[] }) {
  const exists = await queryOne<Row>(`SELECT id FROM roles WHERE code = ?`, [input.code]);
  if (exists) throw new AppError('Role already exists', { status: 409, code: ErrorCode.ALREADY_EXISTS });
  const id = await insertAndGetId(
    `INSERT INTO roles (code, name, description, is_staff, is_system) VALUES (?, ?, ?, ?, 0)`,
    [input.code, input.name, input.description ?? null, input.isStaff ? 1 : 0],
  );
  if (input.permissionCodes.length > 0) {
    await execute(
      `INSERT IGNORE INTO role_permissions (role_id, permission_id)
       SELECT ?, id FROM permissions WHERE code IN (${input.permissionCodes.map(() => '?').join(',')})`,
      [id, ...input.permissionCodes],
    );
  }
  await writeAdminAudit({ req, action: 'role.create', entityType: 'role', entityId: input.code, permission: 'role.create', after: input });
  return getRole(input.code);
}

export async function updateRole(req: Request, code: string, input: { name?: string; description?: string; permissionCodes?: string[] }) {
  const role = await getRole(code);
  if (input.name || input.description) {
    await execute(`UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?`, [
      input.name ?? null,
      input.description ?? null,
      role.id,
    ]);
  }
  if (input.permissionCodes) {
    if (role.isSystem && code === 'super_admin') throw forbidden('Cannot rewrite super_admin grants');
    await execute(`DELETE FROM role_permissions WHERE role_id = ?`, [role.id]);
    if (input.permissionCodes.length > 0) {
      await execute(
        `INSERT IGNORE INTO role_permissions (role_id, permission_id)
         SELECT ?, id FROM permissions WHERE code IN (${input.permissionCodes.map(() => '?').join(',')})`,
        [role.id, ...input.permissionCodes],
      );
    }
  }
  await cache.delPrefix('perms:');
  await writeAdminAudit({ req, action: 'role.update', entityType: 'role', entityId: code, permission: 'role.update', after: input });
  return getRole(code);
}

export async function assignRole(
  req: Request,
  userId: number,
  input: {
    roleCode: string;
    scopeType: string;
    countryId?: number;
    regionId?: number;
    cityId?: number;
    marketplaceId?: number;
    categoryId?: number;
    businessId?: number;
    departmentId?: number;
    teamId?: number;
    expiresAt?: string;
    reason?: string;
  },
) {
  if (!isUnrestricted(req.auth!, 'role.assign') && input.scopeType === 'GLOBAL' && req.auth!.userId !== 0) {
    const target = await queryOne<Row>(`SELECT is_staff FROM roles WHERE code = ?`, [input.roleCode]);
    if (target && Number(target.is_staff) === 1 && !req.auth!.permissions.includes('*')) {
      throw forbidden('Only an unrestricted administrator can grant a global staff role');
    }
  }
  const role = await queryOne<Row>(`SELECT id, is_staff FROM roles WHERE code = ?`, [input.roleCode]);
  if (!role) throw notFound('Role');

  if (input.scopeType === 'GLOBAL' && !input.marketplaceId && !input.businessId && !input.countryId) {
    await execute(
      `INSERT INTO user_roles (user_id, role_id, marketplace_id, granted_by, expires_at)
       VALUES (?, ?, NULL, ?, ?)
       ON DUPLICATE KEY UPDATE granted_by = VALUES(granted_by), expires_at = VALUES(expires_at)`,
      [userId, role.id, req.auth!.userId, input.expiresAt ? new Date(input.expiresAt) : null],
    );
  }

  const assignmentId = await insertAndGetId(
    `INSERT INTO user_role_assignments
       (uuid, user_id, role_id, scope_type, country_id, region_id, city_id, marketplace_id, category_id,
        business_id, department_id, team_id, granted_by, expires_at, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuid(),
      userId,
      role.id,
      input.scopeType,
      input.countryId ?? null,
      input.regionId ?? null,
      input.cityId ?? null,
      input.marketplaceId ?? null,
      input.categoryId ?? null,
      input.businessId ?? null,
      input.departmentId ?? null,
      input.teamId ?? null,
      req.auth!.userId,
      input.expiresAt ? new Date(input.expiresAt) : null,
      input.reason ?? null,
    ],
  );
  await cache.del(cacheKeys.permissions(userId));
  await writeAdminAudit({
    req,
    action: 'role.assign',
    entityType: 'user',
    entityId: userId,
    permission: 'role.assign',
    reason: input.reason,
    after: input,
    organizationId: input.businessId ?? null,
  });
  return { assignmentId, userId, role: input.roleCode, scopeType: input.scopeType };
}

export async function revokeAssignment(req: Request, assignmentUuid: string) {
  const row = await queryOne<Row>(`SELECT id, user_id FROM user_role_assignments WHERE uuid = ? AND revoked_at IS NULL`, [assignmentUuid]);
  if (!row) throw notFound('Assignment');
  await execute(`UPDATE user_role_assignments SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?`, [row.id]);
  await cache.del(cacheKeys.permissions(Number(row.user_id)));
  await writeAdminAudit({
    req,
    action: 'role.revoke',
    entityType: 'user_role_assignment',
    entityId: assignmentUuid,
    permission: 'role.assign',
  });
  return { revoked: true };
}
