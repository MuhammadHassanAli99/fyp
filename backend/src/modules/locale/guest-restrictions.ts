/**
 * Single source of truth for guest capabilities (§1 Guest Mode).
 * Bootstrap, configuration, and POST /auth/guest all read this object so the
 * three payloads cannot drift.
 */
export const GUEST_RESTRICTIONS = {
  canBrowse: true,
  canSearch: true,
  canFilter: true,
  canViewListing: true,
  canViewPublicSeller: true,
  canViewMaps: true,
  canChangeCountry: true,
  canChangeLanguage: true,
  canChangeCurrency: true,
  canChangeLocation: true,
  canChangeTheme: true,
  canSharePublicListing: true,
  canCompare: true,
  canPostListing: false,
  canContactSeller: false,
  canSendMessage: false,
  canFavorite: false,
  canSaveSearch: false,
  canReview: false,
  canSubscribe: false,
  canPurchase: false,
  canRent: false,
  canMakeOffer: false,
  canAccessAccount: false,
} as const;

export type GuestRestrictions = typeof GUEST_RESTRICTIONS;
