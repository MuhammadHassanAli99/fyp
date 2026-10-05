export const GDPR_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
  'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
  'SE', 'IS', 'LI', 'NO', 'GB',
]);

export type PrivacyKind = 'export' | 'erasure' | 'rectification' | 'restriction' | 'portability';
export type PrivacyRegulation = 'gdpr' | 'ccpa' | 'other';

export const PRIVACY_KIND_LABEL: Record<PrivacyKind, string> = {
  export: 'access / copy',
  erasure: 'deletion',
  rectification: 'correction',
  restriction: 'opt-out / restrict processing',
  portability: 'portable export',
};

export interface SecurityResource {
  ownerId?: number | null;
  assignedTo?: number | null;
  assignedUserIds?: number[];
  businessId?: number | null;
  organizationId?: number | null;
  companyId?: number | null;
  departmentId?: number | null;
  teamId?: number | null;
  marketplaceId?: number | null;
  countryId?: number | null;
  regionId?: number | null;
  cityId?: number | null;
  categoryId?: number | null;
  status?: string | null;
  transactionStatus?: string | null;
  lifecycleStatus?: string | null;
  [key: string]: unknown;
}
