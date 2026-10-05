import { execute, queryOne, queryRows, type Row } from '../../db/query';
import { notFound, unauthenticated } from '../../core/errors';
import { toBoolean, toJson, toNumber } from '../../db/sql';
import { cache, cacheKeys } from '../../config/cache';
import { recordAudit } from '../../middleware/audit';
import { AuthEvent, recordAuthEvent } from '../auth/auth.security';
import type {
  UpdateLocationInput,
  UpdatePreferencesInput,
  UpdateProfileInput,
  MergePreferencesInput,
  UpdatePrivacyInput,
} from './users.schema';
import { mergePreferences, emptyPreferences, type PreferenceSnapshot } from '../locale/preference-merge';
import { sanitizeBio } from './bio';

export async function getProfile(userId: number) {
  const row = await queryOne<Row>(
    `SELECT u.id, u.uuid, u.email, u.phone_e164, u.username, u.account_type, u.status,
            u.country_id, u.region_id, u.city_id, u.area_id, u.language, u.currency, u.timezone, u.theme,
            u.measurement_system, u.last_marketplace_id, u.email_verified_at, u.phone_verified_at, u.created_at,
            u.approx_latitude, u.approx_longitude, u.location_source, u.location_updated_at,
            up.display_name, up.first_name, up.last_name, up.bio, up.avatar_url, up.cover_url,
            up.date_of_birth, up.gender, up.address_line1, up.address_line2, up.postal_code,
            up.website, up.whatsapp, up.show_phone, up.show_email, up.show_whatsapp,
            up.profile_completeness, up.visibility, up.show_location, up.show_listings,
            up.show_businesses, up.show_reviews, up.show_last_active,
            pi.thumb_url AS avatar_thumb_url, pi.profile_url AS avatar_profile_url
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN profile_images pi ON pi.id = up.avatar_image_id AND pi.status = 'ready'
      WHERE u.id = ? AND u.deleted_at IS NULL`,
    [userId],
  );
  if (!row) throw notFound('User');

  return mapProfile(row);
}

export async function updateProfile(userId: number, input: UpdateProfileInput) {
  const bio = input.bio !== undefined ? sanitizeBio(input.bio).text : undefined;
  await execute('INSERT INTO user_profiles (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id', [userId]);

  const fields: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    values.push(value);
  };

  if (input.displayName !== undefined) set('display_name', input.displayName);
  if (input.firstName !== undefined) set('first_name', input.firstName);
  if (input.lastName !== undefined) set('last_name', input.lastName);
  if (bio !== undefined) set('bio', bio);
  if (input.dateOfBirth !== undefined) set('date_of_birth', input.dateOfBirth);
  if (input.gender !== undefined) set('gender', input.gender);
  if (input.addressLine1 !== undefined) set('address_line1', input.addressLine1);
  if (input.addressLine2 !== undefined) set('address_line2', input.addressLine2);
  if (input.postalCode !== undefined) set('postal_code', input.postalCode);
  if (input.website !== undefined) set('website', input.website);
  if (input.whatsapp !== undefined) set('whatsapp', input.whatsapp);
  if (input.showPhone !== undefined) set('show_phone', input.showPhone ? 1 : 0);
  if (input.showEmail !== undefined) set('show_email', input.showEmail ? 1 : 0);
  if (input.showWhatsapp !== undefined) set('show_whatsapp', input.showWhatsapp ? 1 : 0);

  if (fields.length > 0) {
    values.push(userId);
    await execute(`UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = ?`, values);
  }

  await refreshProfileCompleteness(userId);
  void recordAudit({
    action: 'profile.changed',
    entityType: 'user',
    entityId: userId,
    after: { fields: Object.keys(input) },
  });
  void recordAuthEvent({ type: AuthEvent.PROFILE_CHANGED, userId, metadata: { fields: Object.keys(input) } });

  return getProfile(userId);
}

export async function getBusinessProfile(userId: number) {
  const row = await queryOne<Row>(
    `SELECT id, user_id, kind, legal_name, trade_name, slug, description, logo_url, banner_url,
            website, established_year, country_id, city_id, address, contact_phone, contact_email,
            marketplaces, verified_at, status, created_at
       FROM business_profiles
      WHERE user_id = ? AND status <> 'rejected'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (!row) return null;

  return {
    id: Number(row.id),
    kind: String(row.kind),
    legalName: String(row.legal_name),
    tradeName: (row.trade_name as string | null) ?? null,
    slug: String(row.slug),
    description: (row.description as string | null) ?? null,
    logoUrl: (row.logo_url as string | null) ?? null,
    bannerUrl: (row.banner_url as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    establishedYear: row.established_year === null ? null : Number(row.established_year),
    countryId: row.country_id === null ? null : Number(row.country_id),
    cityId: row.city_id === null ? null : Number(row.city_id),
    address: (row.address as string | null) ?? null,
    contactPhone: (row.contact_phone as string | null) ?? null,
    contactEmail: (row.contact_email as string | null) ?? null,
    marketplaces: toJson<string[]>(row.marketplaces, []),
    verifiedAt: row.verified_at ? (row.verified_at as Date).toISOString() : null,
    status: String(row.status),
    createdAt: (row.created_at as Date).toISOString(),
  };
}

export async function getVerificationStatus(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT id, uuid, doc_type, status, reviewed_at, rejection_reason, created_at
       FROM verification_requests
      WHERE user_id = ?
      ORDER BY created_at DESC LIMIT 20`,
    [userId],
  );

  const latest = rows[0];
  return {
    overallStatus: latest ? String(latest.status) : 'none',
    requests: rows.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      docType: String(row.doc_type),
      status: String(row.status),
      reviewedAt: row.reviewed_at ? (row.reviewed_at as Date).toISOString() : null,
      rejectionReason: (row.rejection_reason as string | null) ?? null,
      createdAt: (row.created_at as Date).toISOString(),
    })),
  };
}

export async function getTrustScore(userId: number) {
  const row = await queryOne<Row>(
    `SELECT score, band, identity_points, activity_points, review_points, response_points,
            penalty_points, breakdown, computed_at
       FROM trust_scores WHERE user_id = ?`,
    [userId],
  );

  if (!row) {
    return { score: 0, band: 'new' as const, breakdown: null, computedAt: null };
  }

  return {
    score: toNumber(row.score) ?? 0,
    band: String(row.band) as 'new' | 'bronze' | 'silver' | 'gold' | 'platinum',
    identityPoints: toNumber(row.identity_points) ?? 0,
    activityPoints: toNumber(row.activity_points) ?? 0,
    reviewPoints: toNumber(row.review_points) ?? 0,
    responsePoints: toNumber(row.response_points) ?? 0,
    penaltyPoints: toNumber(row.penalty_points) ?? 0,
    breakdown: row.breakdown ? toJson<Record<string, unknown>>(row.breakdown, {}) : null,
    computedAt: (row.computed_at as Date).toISOString(),
  };
}

export async function updatePreferences(userId: number, input: UpdatePreferencesInput) {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.countryId !== undefined) {
    fields.push('country_id = ?');
    values.push(input.countryId);
  }
  if (input.language !== undefined) {
    fields.push('language = ?');
    values.push(input.language);
  }
  if (input.currency !== undefined) {
    fields.push('currency = ?');
    values.push(input.currency);
  }
  if (input.timezone !== undefined) {
    fields.push('timezone = ?');
    values.push(input.timezone);
  }
  if (input.theme !== undefined) {
    fields.push('theme = ?');
    values.push(input.theme);
  }
  if (input.measurementSystem !== undefined) {
    fields.push('measurement_system = ?');
    values.push(input.measurementSystem);
  }

  if (fields.length > 0) {
    values.push(userId);
    await execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    await cache.del(cacheKeys.permissions(userId));
  }

  return getProfile(userId);
}

export async function setLastMarketplace(userId: number, marketplaceId: number) {
  await execute('UPDATE users SET last_marketplace_id = ? WHERE id = ?', [marketplaceId, userId]);
  return { marketplaceId };
}

export async function getPreferences(userId: number) {
  const profile = await getProfile(userId);
  return { preferences: profile.preferences, location: profile.location };
}

export async function getSavedLocation(userId: number) {
  const profile = await getProfile(userId);
  return profile.location;
}

export async function updateSavedLocation(userId: number, input: UpdateLocationInput) {
  if (input.cityId) {
    const city = await queryOne<Row>('SELECT id, country_id, region_id FROM cities WHERE id = ? AND is_active = 1', [
      input.cityId,
    ]);
    if (!city) throw notFound('City');
    if (input.countryId && Number(city.country_id) !== input.countryId) {
      throw notFound('City');
    }
    if (input.regionId && city.region_id !== null && Number(city.region_id) !== input.regionId) {
      throw notFound('City');
    }
  }
  if (input.regionId) {
    const region = await queryOne<Row>('SELECT id, country_id FROM regions WHERE id = ? AND is_active = 1', [
      input.regionId,
    ]);
    if (!region) throw notFound('Region');
    if (input.countryId && Number(region.country_id) !== input.countryId) {
      throw notFound('Region');
    }
  }
  if (input.areaId) {
    const area = await queryOne<Row>('SELECT id, city_id FROM areas WHERE id = ? AND is_active = 1', [input.areaId]);
    if (!area) throw notFound('Area');
    if (input.cityId && Number(area.city_id) !== input.cityId) {
      throw notFound('Area');
    }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.countryId !== undefined) {
    fields.push('country_id = ?');
    values.push(input.countryId);
  }
  if (input.regionId !== undefined) {
    fields.push('region_id = ?');
    values.push(input.regionId);
  }
  if (input.cityId !== undefined) {
    fields.push('city_id = ?');
    values.push(input.cityId);
  }
  if (input.areaId !== undefined) {
    fields.push('area_id = ?');
    values.push(input.areaId);
  }
  if (input.latitude !== undefined) {
    fields.push('approx_latitude = ?');
    values.push(input.latitude);
  }
  if (input.longitude !== undefined) {
    fields.push('approx_longitude = ?');
    values.push(input.longitude);
  }
  if (input.source !== undefined) {
    fields.push('location_source = ?');
    values.push(input.source);
  }
  if (fields.length > 0) {
    fields.push('location_updated_at = CURRENT_TIMESTAMP');
    values.push(userId);
    await execute(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
  }

  if (input.postalCode !== undefined) {
    await execute(
      `INSERT INTO user_profiles (user_id, postal_code)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE postal_code = VALUES(postal_code)`,
      [userId, input.postalCode],
    );
  }

  return getSavedLocation(userId);
}

export async function mergeRemotePreferences(userId: number, local: MergePreferencesInput) {
  const profile = await getProfile(userId);
  const authenticated: PreferenceSnapshot = {
    countryId: profile.preferences.countryId,
    language: profile.preferences.language,
    currency: profile.preferences.currency,
    timezone: profile.preferences.timezone,
    theme: profile.preferences.theme,
    measurementSystem: profile.preferences.measurementSystem,
    regionId: profile.location.regionId,
    cityId: profile.location.cityId,
    areaId: profile.location.areaId,
    postalCode: profile.location.postalCode,
    locationSource: (profile.location.source as PreferenceSnapshot['locationSource']) ?? null,
  };

  // theme stored as 'system' by historical default is treated as unset only when
  // the user has never written any other preference? Keep it explicit if present
  // on the row — mergePreferences already treats non-null as explicit.
  const localSnap: PreferenceSnapshot = {
    ...emptyPreferences(),
    countryId: local.countryId ?? null,
    language: local.language ?? null,
    currency: local.currency ?? null,
    timezone: local.timezone ?? null,
    theme: local.theme ?? null,
    measurementSystem: local.measurementSystem ?? null,
    regionId: local.regionId ?? null,
    cityId: local.cityId ?? null,
    areaId: local.areaId ?? null,
    postalCode: local.postalCode ?? null,
    locationSource: local.locationSource ?? null,
  };

  let countryDefault: Partial<PreferenceSnapshot> = {};
  const countryId = authenticated.countryId ?? localSnap.countryId;
  if (countryId) {
    const country = await queryOne<Row>(
      'SELECT id, default_language, default_currency, default_timezone, measurement_system FROM countries WHERE id = ?',
      [countryId],
    );
    if (country) {
      countryDefault = {
        countryId: Number(country.id),
        language: String(country.default_language),
        currency: String(country.default_currency),
        timezone: String(country.default_timezone),
        measurementSystem: country.measurement_system as PreferenceSnapshot['measurementSystem'],
      };
    }
  }

  const merged = mergePreferences({ authenticated, local: localSnap, countryDefault });
  await execute(
    `UPDATE users
        SET country_id = ?, language = ?, currency = ?, timezone = ?, theme = ?,
            measurement_system = ?, region_id = ?, city_id = ?, area_id = ?,
            location_source = COALESCE(location_source, ?)
      WHERE id = ?`,
    [
      merged.countryId,
      merged.language,
      merged.currency,
      merged.timezone,
      merged.theme,
      merged.measurementSystem,
      merged.regionId,
      merged.cityId,
      merged.areaId,
      merged.locationSource,
      userId,
    ],
  );

  if (merged.postalCode) {
    await execute(
      `INSERT INTO user_profiles (user_id, postal_code)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE postal_code = COALESCE(postal_code, VALUES(postal_code))`,
      [userId, merged.postalCode],
    );
  }

  return getPreferences(userId);
}

const mapProfile = (row: Row) => ({
  id: Number(row.id),
  uuid: String(row.uuid),
  email: (row.email as string | null) ?? null,
  phone: (row.phone_e164 as string | null) ?? null,
  username: (row.username as string | null) ?? null,
  accountType: String(row.account_type),
  status: String(row.status),
  emailVerified: row.email_verified_at !== null,
  phoneVerified: row.phone_verified_at !== null,
  preferences: {
    countryId: row.country_id === null ? null : Number(row.country_id),
    language: (row.language as string | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    theme: (row.theme as 'light' | 'dark' | 'system' | null) ?? null,
    measurementSystem: (row.measurement_system as 'metric' | 'imperial' | null) ?? null,
    lastMarketplaceId: row.last_marketplace_id === null ? null : Number(row.last_marketplace_id),
  },
  location: {
    countryId: row.country_id === null ? null : Number(row.country_id),
    regionId: row.region_id === null || row.region_id === undefined ? null : Number(row.region_id),
    cityId: row.city_id === null || row.city_id === undefined ? null : Number(row.city_id),
    areaId: row.area_id === null || row.area_id === undefined ? null : Number(row.area_id),
    postalCode: (row.postal_code as string | null) ?? null,
    latitude: toNumber(row.approx_latitude),
    longitude: toNumber(row.approx_longitude),
    source: (row.location_source as string | null) ?? null,
    updatedAt: row.location_updated_at ? (row.location_updated_at as Date).toISOString() : null,
  },
  profile: {
    displayName: (row.display_name as string | null) ?? null,
    firstName: (row.first_name as string | null) ?? null,
    lastName: (row.last_name as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    coverUrl: (row.cover_url as string | null) ?? null,
    dateOfBirth: row.date_of_birth ? String(row.date_of_birth).slice(0, 10) : null,
    gender: (row.gender as string | null) ?? null,
    addressLine1: (row.address_line1 as string | null) ?? null,
    addressLine2: (row.address_line2 as string | null) ?? null,
    postalCode: (row.postal_code as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    whatsapp: (row.whatsapp as string | null) ?? null,
    showPhone: toBoolean(row.show_phone),
    showEmail: toBoolean(row.show_email),
    showWhatsapp: toBoolean(row.show_whatsapp),
    completeness: Number(row.profile_completeness ?? 0),
    visibility: (row.visibility as string | null) ?? 'public',
    avatarThumbUrl: (row.avatar_thumb_url as string | null) ?? (row.avatar_url as string | null) ?? null,
  },
  privacy: {
    visibility: (row.visibility as string | null) ?? 'public',
    showPhone: toBoolean(row.show_phone),
    showEmail: toBoolean(row.show_email),
    showWhatsapp: toBoolean(row.show_whatsapp),
    showLocation: row.show_location === undefined ? true : toBoolean(row.show_location),
    showListings: row.show_listings === undefined ? true : toBoolean(row.show_listings),
    showBusinesses: row.show_businesses === undefined ? true : toBoolean(row.show_businesses),
    showReviews: row.show_reviews === undefined ? true : toBoolean(row.show_reviews),
    showLastActive: toBoolean(row.show_last_active),
  },
  createdAt: (row.created_at as Date).toISOString(),
});

export async function refreshProfileCompleteness(userId: number): Promise<number> {
  const row = await queryOne<Row>(
    `SELECT u.username, u.email_verified_at, u.phone_verified_at, u.country_id,
            up.display_name, up.bio, up.avatar_url
       FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE u.id = ?`,
    [userId],
  );
  if (!row) return 0;
  let score = 10;
  if (row.display_name) score += 15;
  if (row.username) score += 15;
  if (row.avatar_url) score += 15;
  if (row.bio) score += 10;
  if (row.email_verified_at) score += 15;
  if (row.phone_verified_at) score += 10;
  if (row.country_id) score += 10;
  score = Math.min(100, score);
  await execute('UPDATE user_profiles SET profile_completeness = ? WHERE user_id = ?', [score, userId]);
  return score;
}

export async function getPrivacy(userId: number) {
  const profile = await getProfile(userId);
  return profile.privacy;
}

export async function updatePrivacy(userId: number, input: UpdatePrivacyInput) {
  await execute('INSERT INTO user_profiles (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id', [userId]);
  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, unknown> = {
    visibility: input.visibility,
    show_phone: input.showPhone,
    show_email: input.showEmail,
    show_whatsapp: input.showWhatsapp,
    show_location: input.showLocation,
    show_listings: input.showListings,
    show_businesses: input.showBusinesses,
    show_reviews: input.showReviews,
    show_last_active: input.showLastActive,
  };
  for (const [column, value] of Object.entries(map)) {
    if (value === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
  }
  if (fields.length > 0) {
    values.push(userId);
    await execute(`UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id = ?`, values);
  }
  void recordAudit({ action: 'profile.privacy_changed', entityType: 'user', entityId: userId, after: input });
  return getPrivacy(userId);
}

export async function getPublicProfile(username: string, viewerId: number | null) {
  const row = await queryOne<Row>(
    `SELECT u.id, u.uuid, u.username, u.email, u.phone_e164, u.status, u.created_at,
            u.email_verified_at, u.phone_verified_at, u.country_id, u.city_id,
            up.display_name, up.bio, up.avatar_url, up.website, up.whatsapp,
            up.show_phone, up.show_email, up.show_whatsapp, up.visibility,
            up.show_location, up.show_listings, up.show_businesses, up.show_reviews, up.show_last_active,
            pi.thumb_url AS avatar_thumb_url, pi.profile_url AS avatar_profile_url,
            c.name AS country_name, ci.name AS city_name
       FROM users u
       LEFT JOIN user_profiles up ON up.user_id = u.id
       LEFT JOIN profile_images pi ON pi.id = up.avatar_image_id AND pi.status = 'ready'
       LEFT JOIN countries c ON c.id = u.country_id
       LEFT JOIN cities ci ON ci.id = u.city_id
      WHERE u.username_normalized = ? AND u.deleted_at IS NULL AND u.status IN ('active','pending')`,
    [username.trim().toLowerCase()],
  );
  if (!row) throw notFound('Profile');

  const ownerId = Number(row.id);
  const visibility = String(row.visibility ?? 'public');
  const isOwner = viewerId === ownerId;

  if (visibility === 'private' && !isOwner) throw notFound('Profile');
  if (visibility === 'registered' && !viewerId && !isOwner) throw unauthenticated('Sign in to view this profile');

  const verification = await loadVerificationBadges(ownerId);
  const rating = await loadRatingCard(ownerId);
  const businesses = toBoolean(row.show_businesses) || isOwner ? await loadPublicBusinesses(ownerId) : [];

  return {
    id: ownerId,
    uuid: String(row.uuid),
    username: String(row.username),
    displayName: (row.display_name as string | null) ?? String(row.username),
    bio: (row.bio as string | null) ?? null,
    avatarUrl: (row.avatar_profile_url as string | null) ?? (row.avatar_url as string | null) ?? null,
    avatarThumbUrl: (row.avatar_thumb_url as string | null) ?? (row.avatar_url as string | null) ?? null,
    website: (row.website as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    visibility,
    isOwner,
    verification,
    rating,
    location:
      (toBoolean(row.show_location) || isOwner) && (row.city_name || row.country_name)
        ? { city: (row.city_name as string | null) ?? null, country: (row.country_name as string | null) ?? null }
        : null,
    contact: {
      email: (toBoolean(row.show_email) || isOwner) && row.email ? String(row.email) : null,
      phone: (toBoolean(row.show_phone) || isOwner) && row.phone_e164 ? String(row.phone_e164) : null,
      whatsapp: (toBoolean(row.show_whatsapp) || isOwner) ? ((row.whatsapp as string | null) ?? null) : null,
    },
    businesses,
    flags: {
      showListings: toBoolean(row.show_listings) || isOwner,
      showReviews: toBoolean(row.show_reviews) || isOwner,
      showBusinesses: toBoolean(row.show_businesses) || isOwner,
    },
  };
}

async function loadVerificationBadges(userId: number) {
  const identity = await queryOne<Row>(
    `SELECT status FROM verification_requests
      WHERE user_id = ? AND business_id IS NULL
        AND doc_type IN ('government_id','passport','driving_license')
        AND status = 'approved'
      ORDER BY reviewed_at DESC LIMIT 1`,
    [userId],
  );
  const business = await queryOne<Row>(
    `SELECT status FROM verification_requests
      WHERE user_id = ? AND doc_type = 'business_license' AND status = 'approved'
      LIMIT 1`,
    [userId],
  );
  const user = await queryOne<Row>(
    'SELECT email_verified_at, phone_verified_at FROM users WHERE id = ?',
    [userId],
  );
  const identityVerified = Boolean(identity);
  const businessVerified = Boolean(business);
  return {
    identityVerified,
    businessVerified,
    emailVerified: Boolean(user?.email_verified_at),
    phoneVerified: Boolean(user?.phone_verified_at),
    badge: identityVerified && businessVerified ? 'verified' : identityVerified ? 'identity' : businessVerified ? 'business' : null,
  };
}

async function loadRatingCard(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT rs.marketplace_id, rs.average_rating, rs.review_count, m.code AS marketplace_code
       FROM rating_summaries rs
       LEFT JOIN marketplaces m ON m.id = rs.marketplace_id
      WHERE rs.subject_kind = 'user' AND rs.subject_id = ?`,
    [userId],
  );
  const overall = rows.find((row) => Number(row.marketplace_id) === 0);
  return {
    average: overall ? toNumber(rowAverage(overall)) ?? 0 : 0,
    count: overall ? Number(overall.review_count) : 0,
    marketplaces: rows
      .filter((row) => Number(row.marketplace_id) > 0)
      .map((row) => ({
        marketplace: String(row.marketplace_code ?? row.marketplace_id),
        average: toNumber(row.average_rating) ?? 0,
        count: Number(row.review_count),
      })),
  };
}

const rowAverage = (row: Row) => row.average_rating;

async function loadPublicBusinesses(userId: number) {
  const rows = await queryRows<Row>(
    `SELECT id, kind, legal_name, trade_name, slug, logo_url, verified_at, status
       FROM business_profiles
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC LIMIT 8`,
    [userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: String(row.kind),
    name: (row.trade_name as string | null) ?? String(row.legal_name),
    slug: String(row.slug),
    logoUrl: (row.logo_url as string | null) ?? null,
    verified: row.verified_at != null,
  }));
}
