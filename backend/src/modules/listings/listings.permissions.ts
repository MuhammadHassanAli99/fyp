import { queryOne, queryRows, type Row } from '../../db/query';
import { forbidden } from '../../core/errors';
import { roleAllows, type MemberRole } from '../business/business.schema';
import { toBoolean } from '../../db/sql';

export type ListingAction =
  | 'view'
  | 'edit'
  | 'submit'
  | 'archive'
  | 'restore'
  | 'renew'
  | 'promote'
  | 'delete'
  | 'change_ownership'
  | 'approve'
  | 'reject'
  | 'override_fraud'
  | 'view_documents'
  | 'change_transaction'
  | 'view_analytics';

export interface ListingActor {
  userId: number;
  isStaff: boolean;
  roles: string[];
  permissions: string[];
}

const STAFF_ACTIONS: ListingAction[] = [
  'approve',
  'reject',
  'override_fraud',
  'change_ownership',
  'view_documents',
];

function hasPermission(actor: ListingActor, code: string): boolean {
  return (
    actor.permissions.includes('*') ||
    actor.permissions.includes(code) ||
    actor.permissions.includes(`${code.split('.')[0]}.*`)
  );
}

export function assignedListingAllows(action: ListingAction): boolean {
  return action === 'view' || action === 'view_analytics' || action === 'edit' || action === 'submit';
}

export async function assertListingPermission(
  listing: Row,
  actor: ListingActor,
  action: ListingAction,
): Promise<{ role: 'OWNER' | 'BUSINESS_ADMIN' | 'BUSINESS_MANAGER' | 'AGENT' | 'EDITOR' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN' | 'GRANTEE' }> {
  const ownerId = Number(listing.user_id);
  const sellerId = listing.seller_id === null || listing.seller_id === undefined ? ownerId : Number(listing.seller_id);
  const createdBy = listing.created_by === null || listing.created_by === undefined ? ownerId : Number(listing.created_by);
  const isOwner = actor.userId === ownerId || actor.userId === sellerId || actor.userId === createdBy;

  if (actor.roles.includes('super_admin') || hasPermission(actor, '*')) {
    return { role: 'SUPER_ADMIN' };
  }
  if (actor.roles.includes('admin') && actor.isStaff) {
    if (action === 'override_fraud' && !hasPermission(actor, 'listing.override_fraud') && !hasPermission(actor, 'listing.moderate')) {
      throw forbidden('Only fraud analysts or admins may override fraud decisions');
    }
    return { role: 'ADMIN' };
  }
  if (actor.isStaff && (hasPermission(actor, 'listing.moderate') || hasPermission(actor, 'listing.approve') || actor.roles.includes('moderator'))) {
    if (STAFF_ACTIONS.includes(action) || action === 'view' || action === 'view_analytics' || action === 'archive' || action === 'restore') {
      if (action === 'approve' && !hasPermission(actor, 'listing.approve') && !hasPermission(actor, 'listing.moderate')) {
        throw forbidden('Missing permission: listing.approve');
      }
      if (action === 'reject' && !hasPermission(actor, 'listing.reject') && !hasPermission(actor, 'listing.moderate')) {
        throw forbidden('Missing permission: listing.reject');
      }
      if (action === 'override_fraud' && !hasPermission(actor, 'listing.override_fraud') && !hasPermission(actor, 'listing.moderate')) {
        throw forbidden('Missing permission: listing.override_fraud');
      }
      return { role: 'MODERATOR' };
    }
  }

  if (isOwner) {
    const terminal = ['sold', 'rented'].includes(String(listing.transaction_status ?? listing.status ?? '').toLowerCase());
    if (terminal && (action === 'edit' || action === 'submit' || action === 'promote' || action === 'renew')) {
      throw forbidden('Sold or rented listings cannot be modified');
    }
    if (action === 'approve' || action === 'reject' || action === 'override_fraud') {
      throw forbidden('Only a moderator can perform this action');
    }
    if (action === 'change_ownership') {
      throw forbidden('Only an admin can transfer listing ownership');
    }
    return { role: 'OWNER' };
  }

  const businessId = listing.business_id === null ? null : Number(listing.business_id);
  if (businessId) {
    const membership = await queryOne<Row>(
      `SELECT member_role, can_post, accepted_at, removed_at
         FROM business_members
        WHERE business_id = ? AND user_id = ? AND removed_at IS NULL AND accepted_at IS NOT NULL
        LIMIT 1`,
      [businessId, actor.userId],
    );
    if (membership) {
      const role = String(membership.member_role) as MemberRole;
      const mapped =
        role === 'owner' || role === 'admin'
          ? 'BUSINESS_ADMIN'
          : role === 'manager'
            ? 'BUSINESS_MANAGER'
            : role === 'editor'
              ? 'EDITOR'
              : 'AGENT';

      if (action === 'approve' || action === 'reject' || action === 'override_fraud' || action === 'change_ownership') {
        throw forbidden('This action is restricted to platform staff');
      }
      if ((action === 'edit' || action === 'submit' || action === 'promote' || action === 'renew') && !toBoolean(membership.can_post) && !roleAllows(role, 'listing.post')) {
        throw forbidden('You cannot manage listings for this business');
      }
      if (action === 'delete' && role !== 'owner' && role !== 'admin') {
        throw forbidden('Only a business admin may delete a listing');
      }
      if (action === 'archive' && !['owner', 'admin', 'manager'].includes(role)) {
        throw forbidden('Only a business manager or admin may archive a listing');
      }
      return { role: mapped };
    }
  }

  const grant = await queryOne<Row>(
    `SELECT role FROM listing_grants
      WHERE listing_id = ? AND user_id = ? AND revoked_at IS NULL
      LIMIT 1`,
    [Number(listing.id), actor.userId],
  );
  if (grant) {
    const grantRole = String(grant.role);
    if (action === 'view' || action === 'view_analytics') return { role: 'GRANTEE' };
    if ((action === 'edit' || action === 'submit') && ['editor', 'agent', 'manager'].includes(grantRole)) {
      return { role: 'GRANTEE' };
    }
    throw forbidden('Your listing grant does not allow this action');
  }

  const assignment = await queryOne<Row>(
    `SELECT id FROM listing_assignments
      WHERE listing_id = ? AND user_id = ? AND revoked_at IS NULL
      LIMIT 1`,
    [Number(listing.id), actor.userId],
  );
  if (assignment) {
    const terminal = ['sold', 'rented'].includes(String(listing.transaction_status ?? listing.status ?? '').toLowerCase());
    if (terminal && (action === 'edit' || action === 'submit')) {
      throw forbidden('Sold or rented listings cannot be modified');
    }
    if (assignedListingAllows(action)) return { role: 'AGENT' };
    throw forbidden('Your listing assignment does not allow this action');
  }

  throw forbidden('You can only manage your own listings');
}

export async function listListingGrants(listingId: number) {
  const rows = await queryRows<Row>(
    `SELECT g.id, g.user_id, g.role, g.granted_by, g.created_at, p.display_name
       FROM listing_grants g
       LEFT JOIN user_profiles p ON p.user_id = g.user_id
      WHERE g.listing_id = ? AND g.revoked_at IS NULL
      ORDER BY g.created_at`,
    [listingId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    userId: Number(row.user_id),
    role: String(row.role),
    grantedBy: Number(row.granted_by),
    displayName: (row.display_name as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}
