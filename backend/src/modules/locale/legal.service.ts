import { queryOne, execute, type Row } from '../../db/query';
import { notFound, badRequest } from '../../core/errors';
import { getContext } from '../../core/context';
import { packIp } from '../../core/security/crypto';
import { recordAudit } from '../../middleware/audit';

export const LEGAL_KINDS = [
  'terms',
  'privacy',
  'cookies',
  'refund',
  'listing_policy',
  'aml',
  'dsa',
  'eula',
] as const;

export type LegalKind = (typeof LEGAL_KINDS)[number];

const DISPLAY_NAMES: Record<LegalKind, string> = {
  terms: 'Terms & Conditions',
  privacy: 'Privacy Policy',
  cookies: 'Cookie Policy',
  refund: 'Refund Policy',
  listing_policy: 'Marketplace Rules',
  aml: 'Gold Terms',
  dsa: 'Property Terms',
  eula: 'Seller Agreement',
};

const CONSENT_MAP: Record<LegalKind, 'terms' | 'privacy' | 'cookies_analytics' | 'data_processing'> = {
  terms: 'terms',
  privacy: 'privacy',
  cookies: 'cookies_analytics',
  refund: 'data_processing',
  listing_policy: 'data_processing',
  aml: 'data_processing',
  dsa: 'data_processing',
  eula: 'data_processing',
};

export interface LegalDocument {
  id: number;
  kind: LegalKind;
  displayName: string;
  countryId: number | null;
  language: string;
  version: string;
  title: string;
  body: string | null;
  publishedAt: string | null;
  effectiveDate: string | null;
}

/**
 * Resolution: country+language → country+any → global+language → global.
 */
export async function resolveLegalDocument(params: {
  kind: LegalKind;
  countryId: number | null;
  language: string;
  includeBody?: boolean;
}): Promise<LegalDocument | null> {
  const row = await queryOne<Row>(
    `SELECT id, kind, country_id, language, version, title, body, published_at
       FROM legal_documents
      WHERE kind = ? AND is_current = 1
        AND (country_id = ? OR country_id IS NULL)
      ORDER BY (country_id = ?) DESC, (language = ?) DESC, published_at DESC
      LIMIT 1`,
    [params.kind, params.countryId, params.countryId, params.language],
  );
  if (!row) return null;
  return mapDoc(row, params.includeBody !== false);
}

export async function listLegalDocuments(countryId: number | null, language: string) {
  const docs: LegalDocument[] = [];
  for (const kind of LEGAL_KINDS) {
    const doc = await resolveLegalDocument({ kind, countryId, language, includeBody: false });
    if (doc) docs.push({ ...doc, body: null });
  }
  return docs;
}

export async function acceptLegalDocument(params: {
  userId: number;
  kind: LegalKind;
  countryId: number | null;
  language: string;
  guestUuid?: string | null;
}): Promise<{ accepted: true; kind: LegalKind; version: string; consentType: string }> {
  const doc = await resolveLegalDocument({
    kind: params.kind,
    countryId: params.countryId,
    language: params.language,
    includeBody: false,
  });
  if (!doc) throw notFound(`Legal document "${params.kind}"`);

  const consentType = CONSENT_MAP[params.kind];
  const context = getContext();
  const versionTag = `${params.kind}:${doc.version}`;

  await execute(
    `INSERT INTO user_consents (user_id, guest_uuid, consent_type, granted, document_version, ip_address, user_agent)
     VALUES (?, ?, ?, 1, ?, ?, ?)`,
    [
      params.userId,
      params.guestUuid ?? null,
      consentType,
      versionTag.slice(0, 24),
      packIp(context?.ip),
      context?.userAgent?.slice(0, 512) ?? null,
    ],
  );

  void recordAudit({
    action: 'legal.document_accepted',
    entityType: 'legal_document',
    entityId: doc.id,
    after: { kind: params.kind, version: doc.version, consentType },
  });

  return { accepted: true, kind: params.kind, version: doc.version, consentType };
}

export function parseLegalKind(raw: string): LegalKind {
  if ((LEGAL_KINDS as readonly string[]).includes(raw)) return raw as LegalKind;
  throw badRequest(`Unknown legal document kind "${raw}"`);
}

function mapDoc(row: Row, includeBody: boolean): LegalDocument {
  const kind = String(row.kind) as LegalKind;
  const published = row.published_at ? (row.published_at as Date).toISOString() : null;
  return {
    id: Number(row.id),
    kind,
    displayName: DISPLAY_NAMES[kind] ?? kind,
    countryId: row.country_id === null ? null : Number(row.country_id),
    language: String(row.language),
    version: String(row.version),
    title: String(row.title),
    body: includeBody ? String(row.body) : null,
    publishedAt: published,
    effectiveDate: published ? published.slice(0, 10) : null,
  };
}

export { DISPLAY_NAMES as LEGAL_DISPLAY_NAMES };
