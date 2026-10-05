import { execute, insertAndGetId, queryOne, queryRows, transaction, type Row } from '../../db/query';
import { AppError, ErrorCode, badRequest, forbidden, notFound } from '../../core/errors';
import { toBoolean, toJson } from '../../db/sql';
import { randomToken, sha256, uuid } from '../../core/security/crypto';
import { recordAudit } from '../../middleware/audit';
import { AuthEvent, recordAuthEvent } from '../auth/auth.security';
import { verifyPassword } from '../../core/security/password';
import {
  roleAllows,
  type CreateBusinessInput,
  type UpdateBusinessInput,
  type InviteMemberInput,
  type MemberRole,
  type DealerExtensionInput,
  type AgencyExtensionInput,
  type BuilderExtensionInput,
  type GoldShopExtensionInput,
  type LocationInput,
} from './business.schema';

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'business';
  return `${base}-${randomToken(4).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toLowerCase()}`;
}

export async function getMembership(businessId: number, userId: number) {
  return queryOne<Row>(
    `SELECT id, member_role, can_post, can_reply, can_billing, accepted_at, removed_at
       FROM business_members
      WHERE business_id = ? AND user_id = ? AND removed_at IS NULL`,
    [businessId, userId],
  );
}

export async function assertBusinessPermission(businessId: number, userId: number, permission: string, isStaff = false) {
  if (isStaff) return { role: 'owner' as MemberRole, membershipId: 0 };
  const membership = await getMembership(businessId, userId);
  if (!membership || !membership.accepted_at) throw forbidden('You are not a member of this business');
  const role = String(membership.member_role) as MemberRole;
  if (permission === 'listing.post' && !toBoolean(membership.can_post)) {
    throw forbidden('You cannot post listings for this business');
  }
  if (!roleAllows(role, permission)) throw forbidden(`Requires permission: ${permission}`);
  return { role, membershipId: Number(membership.id) };
}

export async function listMyBusinesses(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT bp.id, bp.kind, bp.legal_name, bp.trade_name, bp.slug, bp.logo_url, bp.status, bp.verified_at,
            bm.member_role, bm.accepted_at
       FROM business_members bm
       JOIN business_profiles bp ON bp.id = bm.business_id
      WHERE bm.user_id = ? AND bm.removed_at IS NULL AND bm.accepted_at IS NOT NULL
        AND bp.status <> 'rejected'
      ORDER BY bp.created_at DESC`,
    [userId],
  );
  return rows.map(mapBusinessSummary);
}

export async function createBusiness(userId: number, input: CreateBusinessInput) {
  const slug = slugify(input.tradeName || input.legalName);
  const id = await transaction(async (connection) => {
    const inserted = await execute(
      `INSERT INTO business_profiles
         (user_id, kind, legal_name, trade_name, slug, registration_no, license_reference, tax_id, description,
          website, established_year, country_id, region_id, city_id, address, contact_phone, contact_email,
          business_hours, social_links, marketplaces, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        userId,
        input.kind,
        input.legalName,
        input.tradeName ?? null,
        slug,
        input.registrationNo ?? null,
        input.licenseReference ?? null,
        input.taxId ?? null,
        input.description ?? null,
        input.website ?? null,
        input.establishedYear ?? null,
        input.countryId ?? null,
        input.regionId ?? null,
        input.cityId ?? null,
        input.address ?? null,
        input.contactPhone ?? null,
        input.contactEmail ?? null,
        input.businessHours ? JSON.stringify(input.businessHours) : null,
        input.socialLinks ? JSON.stringify(input.socialLinks) : null,
        input.marketplaces ? JSON.stringify(input.marketplaces) : null,
      ],
      connection,
    );
    const businessId = inserted.insertId;
    await execute(
      `INSERT INTO business_members (business_id, user_id, member_role, can_post, can_reply, can_billing, accepted_at)
       VALUES (?, ?, 'owner', 1, 1, 1, CURRENT_TIMESTAMP)`,
      [businessId, userId],
      connection,
    );
    return businessId;
  });

  void recordAudit({ action: 'business.created', entityType: 'business', entityId: id, after: { kind: input.kind } });
  return getBusiness(id, userId, false);
}

export async function getBusiness(businessId: number, viewerId: number | null, isStaff: boolean) {
  const row = await queryOne<Row>(`SELECT * FROM business_profiles WHERE id = ?`, [businessId]);
  if (!row) throw notFound('Business');
  const isMember = viewerId ? Boolean(await getMembership(businessId, viewerId)) : false;
  if (String(row.status) !== 'active' && !isMember && !isStaff) throw notFound('Business');
  const members = isMember || isStaff ? await listMembers(businessId) : [];
  const extensions = await loadExtensions(businessId, String(row.kind));
  const locations = await queryRows<Row>(
    `SELECT id, kind, name, country_id, city_id, address, phone, is_primary FROM business_locations WHERE business_id = ?`,
    [businessId],
  );
  return {
    ...mapBusiness(row),
    members,
    locations: locations.map((item) => ({
      id: Number(item.id),
      kind: String(item.kind),
      name: (item.name as string | null) ?? null,
      countryId: item.country_id === null ? null : Number(item.country_id),
      cityId: item.city_id === null ? null : Number(item.city_id),
      address: (item.address as string | null) ?? null,
      phone: (item.phone as string | null) ?? null,
      isPrimary: toBoolean(item.is_primary),
    })),
    extensions,
    isMember,
  };
}

export async function getBusinessBySlug(slug: string, viewerId: number | null, isStaff: boolean) {
  const row = await queryOne<Row>(`SELECT id FROM business_profiles WHERE slug = ?`, [slug]);
  if (!row) throw notFound('Business');
  return getBusiness(Number(row.id), viewerId, isStaff);
}

export async function updateBusiness(businessId: number, userId: number, isStaff: boolean, input: UpdateBusinessInput) {
  await assertBusinessPermission(businessId, userId, 'business.update', isStaff);
  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, unknown> = {
    legal_name: input.legalName,
    trade_name: input.tradeName,
    description: input.description,
    website: input.website,
    registration_no: input.registrationNo,
    license_reference: input.licenseReference,
    tax_id: input.taxId,
    country_id: input.countryId,
    region_id: input.regionId,
    city_id: input.cityId,
    address: input.address,
    contact_phone: input.contactPhone,
    contact_email: input.contactEmail,
    established_year: input.establishedYear,
    business_hours: input.businessHours ? JSON.stringify(input.businessHours) : undefined,
    social_links: input.socialLinks ? JSON.stringify(input.socialLinks) : undefined,
    marketplaces: input.marketplaces ? JSON.stringify(input.marketplaces) : undefined,
  };
  for (const [column, value] of Object.entries(map)) {
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(value);
  }
  if (fields.length > 0) {
    values.push(businessId);
    await execute(`UPDATE business_profiles SET ${fields.join(', ')} WHERE id = ?`, values);
  }
  void recordAudit({ action: 'business.updated', entityType: 'business', entityId: businessId, after: input });
  return getBusiness(businessId, userId, isStaff);
}

export async function listMembers(businessId: number) {
  const rows = await queryRows<Row>(
    `SELECT bm.id, bm.user_id, bm.member_role, bm.can_post, bm.can_reply, bm.can_billing,
            bm.invited_at, bm.accepted_at, up.display_name, u.username, u.uuid
       FROM business_members bm
       JOIN users u ON u.id = bm.user_id
       LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE bm.business_id = ? AND bm.removed_at IS NULL
      ORDER BY FIELD(bm.member_role,'owner','admin','manager','agent','salesperson','editor','accountant','support','staff'), bm.id`,
    [businessId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    uuid: String(row.uuid),
    username: (row.username as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    role: String(row.member_role),
    canPost: toBoolean(row.can_post),
    canReply: toBoolean(row.can_reply),
    canBilling: toBoolean(row.can_billing),
    acceptedAt: row.accepted_at ? (row.accepted_at as Date).toISOString() : null,
  }));
}

export async function inviteMember(businessId: number, invitedBy: number, isStaff: boolean, input: InviteMemberInput) {
  await assertBusinessPermission(businessId, invitedBy, 'business.invite', isStaff);
  const token = randomToken(24);
  const invitationUuid = uuid();
  await execute(
    `INSERT INTO business_invitations
       (uuid, business_id, invited_user_id, invited_email, invited_phone, member_role, token_hash, invited_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 14 DAY))`,
    [
      invitationUuid,
      businessId,
      input.userId ?? null,
      input.email?.toLowerCase() ?? null,
      input.phone ?? null,
      input.role,
      sha256(token),
      invitedBy,
    ],
  );
  void recordAudit({
    action: 'business.member_invited',
    entityType: 'business',
    entityId: businessId,
    after: { role: input.role, email: input.email ?? null },
  });
  return { invitationId: invitationUuid, token, expiresInDays: 14 };
}

export async function acceptInvitation(userId: number, token: string) {
  const row = await queryOne<Row>(
    `SELECT * FROM business_invitations
      WHERE token_hash = ? AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
        AND expires_at > CURRENT_TIMESTAMP`,
    [sha256(token)],
  );
  if (!row) throw badRequest('This invitation is invalid or has expired');

  const user = await queryOne<Row>(`SELECT id, email, phone_e164 FROM users WHERE id = ?`, [userId]);
  if (!user) throw notFound('User');
  const emailOk = !row.invited_email || String(user.email ?? '').toLowerCase() === String(row.invited_email).toLowerCase();
  const phoneOk = !row.invited_phone || String(user.phone_e164 ?? '') === String(row.invited_phone);
  const userOk = !row.invited_user_id || Number(row.invited_user_id) === userId;
  if (!emailOk || !phoneOk || !userOk) throw forbidden('This invitation was issued to a different account');

  const role = String(row.member_role) as MemberRole;
  const flags = flagsForRole(role);
  await transaction(async (connection) => {
    await execute(
      `INSERT INTO business_members (business_id, user_id, member_role, can_post, can_reply, can_billing, accepted_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE member_role = VALUES(member_role), can_post = VALUES(can_post),
         can_reply = VALUES(can_reply), can_billing = VALUES(can_billing),
         accepted_at = CURRENT_TIMESTAMP, removed_at = NULL`,
      [row.business_id, userId, role, flags.canPost, flags.canReply, flags.canBilling],
      connection,
    );
    await execute(`UPDATE business_invitations SET accepted_at = CURRENT_TIMESTAMP, invited_user_id = ? WHERE id = ?`, [
      userId,
      row.id,
    ], connection);
  });
  void recordAudit({
    action: 'business.member_accepted',
    entityType: 'business',
    entityId: Number(row.business_id),
    after: { userId, role },
  });
  return getBusiness(Number(row.business_id), userId, false);
}

export async function changeMemberRole(
  businessId: number,
  actorId: number,
  targetUserId: number,
  role: Exclude<MemberRole, 'owner'>,
  isStaff: boolean,
) {
  await assertBusinessPermission(businessId, actorId, 'business.change_role', isStaff);
  const target = await getMembership(businessId, targetUserId);
  if (!target) throw notFound('Member');
  if (String(target.member_role) === 'owner') throw forbidden('The owner role can only change through ownership transfer');
  const flags = flagsForRole(role);
  await execute(
    `UPDATE business_members SET member_role = ?, can_post = ?, can_reply = ?, can_billing = ? WHERE id = ?`,
    [role, flags.canPost, flags.canReply, flags.canBilling, target.id],
  );
  void recordAudit({
    action: 'business.role_changed',
    entityType: 'business',
    entityId: businessId,
    after: { targetUserId, role },
  });
  return listMembers(businessId);
}

export async function removeMember(businessId: number, actorId: number, targetUserId: number, isStaff: boolean) {
  await assertBusinessPermission(businessId, actorId, 'business.remove_member', isStaff);
  const target = await getMembership(businessId, targetUserId);
  if (!target) throw notFound('Member');
  if (String(target.member_role) === 'owner') throw forbidden('Transfer ownership before removing the owner');
  await execute(`UPDATE business_members SET removed_at = CURRENT_TIMESTAMP WHERE id = ?`, [target.id]);
  void recordAudit({
    action: 'business.member_removed',
    entityType: 'business',
    entityId: businessId,
    after: { targetUserId },
  });
  return { removed: true };
}

export async function transferOwnership(businessId: number, actorId: number, toUserId: number, password: string) {
  const actor = await assertBusinessPermission(businessId, actorId, '*');
  if (actor.role !== 'owner') throw forbidden('Only the owner can transfer ownership');
  const user = await queryOne<Row>(`SELECT password_hash FROM users WHERE id = ?`, [actorId]);
  if (!user?.password_hash || !(await verifyPassword(password, String(user.password_hash)))) {
    throw new AppError('Password confirmation failed', { status: 401, code: ErrorCode.INVALID_CREDENTIALS });
  }
  const target = await getMembership(businessId, toUserId);
  if (!target || !target.accepted_at) throw badRequest('The new owner must already be an accepted member');

  await transaction(async (connection) => {
    await execute(`UPDATE business_members SET member_role = 'admin' WHERE business_id = ? AND user_id = ?`, [
      businessId,
      actorId,
    ], connection);
    await execute(
      `UPDATE business_members SET member_role = 'owner', can_post = 1, can_reply = 1, can_billing = 1
        WHERE business_id = ? AND user_id = ?`,
      [businessId, toUserId],
      connection,
    );
    await execute(`UPDATE business_profiles SET user_id = ? WHERE id = ?`, [toUserId, businessId], connection);
  });

  void recordAudit({
    action: 'business.ownership_transferred',
    entityType: 'business',
    entityId: businessId,
    after: { from: actorId, to: toUserId },
  });
  void recordAuthEvent({
    type: AuthEvent.BUSINESS_OWNERSHIP_CHANGED,
    userId: actorId,
    metadata: { businessId, toUserId },
  });
  return getBusiness(businessId, actorId, false);
}

export async function addLocation(businessId: number, userId: number, isStaff: boolean, input: LocationInput) {
  await assertBusinessPermission(businessId, userId, 'business.update', isStaff);
  const id = await insertAndGetId(
    `INSERT INTO business_locations (business_id, kind, name, country_id, region_id, city_id, address, phone, is_primary)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      businessId,
      input.kind,
      input.name ?? null,
      input.countryId ?? null,
      input.regionId ?? null,
      input.cityId ?? null,
      input.address ?? null,
      input.phone ?? null,
      input.isPrimary ? 1 : 0,
    ],
  );
  return { id };
}

export async function saveDealerExtension(businessId: number, userId: number, isStaff: boolean, input: DealerExtensionInput) {
  await assertBusinessPermission(businessId, userId, 'business.update', isStaff);
  await execute(
    `INSERT INTO dealer_profiles (business_id, dealer_license, has_service_center, notes)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE dealer_license = VALUES(dealer_license),
       has_service_center = VALUES(has_service_center), notes = VALUES(notes)`,
    [businessId, input.dealerLicense ?? null, input.hasServiceCenter ? 1 : 0, input.notes ?? null],
  );
  if (input.brands) {
    await execute(`DELETE FROM dealer_brands WHERE business_id = ?`, [businessId]);
    for (const brand of input.brands) {
      await execute(`INSERT INTO dealer_brands (business_id, brand_name) VALUES (?, ?)`, [businessId, brand]);
    }
  }
  return loadExtensions(businessId, 'dealer');
}

export async function saveAgencyExtension(businessId: number, userId: number, isStaff: boolean, input: AgencyExtensionInput) {
  await assertBusinessPermission(businessId, userId, 'business.update', isStaff);
  await execute(
    `INSERT INTO agency_profiles (business_id, agency_license, property_categories, notes)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE agency_license = VALUES(agency_license),
       property_categories = VALUES(property_categories), notes = VALUES(notes)`,
    [businessId, input.agencyLicense ?? null, input.propertyCategories ? JSON.stringify(input.propertyCategories) : null, input.notes ?? null],
  );
  if (input.areaIds || input.cityIds) {
    await execute(`DELETE FROM agency_areas WHERE business_id = ?`, [businessId]);
    for (const cityId of input.cityIds ?? []) {
      await execute(`INSERT INTO agency_areas (business_id, city_id) VALUES (?, ?)`, [businessId, cityId]);
    }
    for (const areaId of input.areaIds ?? []) {
      await execute(`INSERT INTO agency_areas (business_id, area_id) VALUES (?, ?)`, [businessId, areaId]);
    }
  }
  return loadExtensions(businessId, 'agency');
}

export async function saveBuilderExtension(businessId: number, userId: number, isStaff: boolean, input: BuilderExtensionInput) {
  await assertBusinessPermission(businessId, userId, 'business.update', isStaff);
  await execute(
    `INSERT INTO builder_profiles (business_id, builder_registration, construction_history, notes)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE builder_registration = VALUES(builder_registration),
       construction_history = VALUES(construction_history), notes = VALUES(notes)`,
    [businessId, input.builderRegistration ?? null, input.constructionHistory ?? null, input.notes ?? null],
  );
  if (input.projects) {
    await execute(`DELETE FROM builder_projects WHERE business_id = ?`, [businessId]);
    for (const project of input.projects) {
      await execute(
        `INSERT INTO builder_projects (business_id, name, city_id, status, completed_year) VALUES (?, ?, ?, ?, ?)`,
        [businessId, project.name, project.cityId ?? null, project.status ?? 'planned', project.completedYear ?? null],
      );
    }
  }
  return loadExtensions(businessId, 'builder');
}

export async function saveGoldShopExtension(businessId: number, userId: number, isStaff: boolean, input: GoldShopExtensionInput) {
  await assertBusinessPermission(businessId, userId, 'business.update', isStaff);
  await execute(
    `INSERT INTO gold_shop_profiles (business_id, certifications, notes)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE certifications = VALUES(certifications), notes = VALUES(notes)`,
    [businessId, input.certifications ? JSON.stringify(input.certifications) : null, input.notes ?? null],
  );
  if (input.offerings) {
    await execute(`DELETE FROM gold_shop_offerings WHERE business_id = ?`, [businessId]);
    for (const offering of input.offerings) {
      await execute(`INSERT INTO gold_shop_offerings (business_id, category, purity) VALUES (?, ?, ?)`, [
        businessId,
        offering.category,
        offering.purity ?? null,
      ]);
    }
  }
  return loadExtensions(businessId, 'gold_shop');
}

function flagsForRole(role: MemberRole) {
  return {
    canPost: roleAllows(role, 'listing.post') ? 1 : 0,
    canReply: roleAllows(role, 'listing.reply') ? 1 : 0,
    canBilling: roleAllows(role, 'billing') ? 1 : 0,
  };
}

async function loadExtensions(businessId: number, kind: string) {
  if (kind === 'dealer') {
    const profile = await queryOne<Row>(`SELECT * FROM dealer_profiles WHERE business_id = ?`, [businessId]);
    const brands = await queryRows<Row>(`SELECT brand_name FROM dealer_brands WHERE business_id = ?`, [businessId]);
    return {
      dealer: profile
        ? {
            dealerLicense: (profile.dealer_license as string | null) ?? null,
            hasServiceCenter: toBoolean(profile.has_service_center),
            notes: (profile.notes as string | null) ?? null,
            brands: brands.map((row) => String(row.brand_name)),
          }
        : { brands: brands.map((row) => String(row.brand_name)) },
    };
  }
  if (kind === 'agency') {
    const profile = await queryOne<Row>(`SELECT * FROM agency_profiles WHERE business_id = ?`, [businessId]);
    const areas = await queryRows<Row>(`SELECT city_id, area_id FROM agency_areas WHERE business_id = ?`, [businessId]);
    return {
      agency: {
        agencyLicense: (profile?.agency_license as string | null) ?? null,
        propertyCategories: toJson<string[]>(profile?.property_categories, []),
        notes: (profile?.notes as string | null) ?? null,
        cityIds: areas.map((row) => row.city_id).filter(Boolean).map(Number),
        areaIds: areas.map((row) => row.area_id).filter(Boolean).map(Number),
      },
    };
  }
  if (kind === 'builder') {
    const profile = await queryOne<Row>(`SELECT * FROM builder_profiles WHERE business_id = ?`, [businessId]);
    const projects = await queryRows<Row>(`SELECT name, city_id, status, completed_year FROM builder_projects WHERE business_id = ?`, [
      businessId,
    ]);
    return {
      builder: {
        builderRegistration: (profile?.builder_registration as string | null) ?? null,
        constructionHistory: (profile?.construction_history as string | null) ?? null,
        notes: (profile?.notes as string | null) ?? null,
        projects: projects.map((row) => ({
          name: String(row.name),
          cityId: row.city_id === null ? null : Number(row.city_id),
          status: String(row.status),
          completedYear: row.completed_year === null ? null : Number(row.completed_year),
        })),
      },
    };
  }
  if (kind === 'gold_shop') {
    const profile = await queryOne<Row>(`SELECT * FROM gold_shop_profiles WHERE business_id = ?`, [businessId]);
    const offerings = await queryRows<Row>(`SELECT category, purity FROM gold_shop_offerings WHERE business_id = ?`, [businessId]);
    return {
      goldShop: {
        certifications: toJson<string[]>(profile?.certifications, []),
        notes: (profile?.notes as string | null) ?? null,
        offerings: offerings.map((row) => ({
          category: String(row.category),
          purity: (row.purity as string | null) ?? null,
        })),
      },
    };
  }
  return {};
}

const mapBusinessSummary = (row: Row) => ({
  id: Number(row.id),
  kind: String(row.kind),
  legalName: String(row.legal_name),
  tradeName: (row.trade_name as string | null) ?? null,
  name: (row.trade_name as string | null) ?? String(row.legal_name),
  slug: String(row.slug),
  logoUrl: (row.logo_url as string | null) ?? null,
  status: String(row.status),
  verified: row.verified_at != null,
  role: row.member_role ? String(row.member_role) : undefined,
});

const mapBusiness = (row: Row) => ({
  id: Number(row.id),
  kind: String(row.kind),
  legalName: String(row.legal_name),
  tradeName: (row.trade_name as string | null) ?? null,
  name: (row.trade_name as string | null) ?? String(row.legal_name),
  slug: String(row.slug),
  description: (row.description as string | null) ?? null,
  logoUrl: (row.logo_url as string | null) ?? null,
  bannerUrl: (row.banner_url as string | null) ?? null,
  website: (row.website as string | null) ?? null,
  registrationNo: (row.registration_no as string | null) ?? null,
  licenseReference: (row.license_reference as string | null) ?? null,
  taxId: (row.tax_id as string | null) ?? null,
  countryId: row.country_id === null ? null : Number(row.country_id),
  cityId: row.city_id === null ? null : Number(row.city_id),
  address: (row.address as string | null) ?? null,
  contactPhone: (row.contact_phone as string | null) ?? null,
  contactEmail: (row.contact_email as string | null) ?? null,
  businessHours: toJson(row.business_hours, null),
  socialLinks: toJson(row.social_links, null),
  marketplaces: toJson<string[]>(row.marketplaces, []),
  verifiedAt: row.verified_at ? (row.verified_at as Date).toISOString() : null,
  status: String(row.status),
  createdAt: (row.created_at as Date).toISOString(),
});
