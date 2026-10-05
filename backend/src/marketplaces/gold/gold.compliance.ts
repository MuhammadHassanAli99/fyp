import { queryOne, type Row } from '../../db/query';
import { toNumber } from '../../db/sql';
import { AppError, ErrorCode, forbidden } from '../../core/errors';
import { convertAmount } from '../../modules/locale/fx.service';

export interface GoldComplianceRule {
  countryId: number;
  kycRequiredAbove: number | null;
  amlRequiredAbove: number | null;
  physicalVerifyAbove: number | null;
  escrowRequiredAbove: number | null;
  currency: string;
  minKycLevel: 'none' | 'basic' | 'standard' | 'enhanced';
  sellerVerificationRequired: boolean;
  importExportRestricted: boolean;
  taxCode: string | null;
  recordRetentionDays: number;
}

const KYC_RANK: Record<string, number> = { none: 0, basic: 1, standard: 2, enhanced: 3 };

export async function getComplianceRule(countryId: number | null): Promise<GoldComplianceRule | null> {
  if (!countryId) return null;
  const row = await queryOne<Row>(
    `SELECT country_id, kyc_required_above, aml_required_above, physical_verify_above,
            escrow_required_above, currency, min_kyc_level, seller_verification_required,
            import_export_restricted, tax_code, record_retention_days
       FROM gold_compliance_rules WHERE country_id = ? AND is_active = 1`,
    [countryId],
  );
  if (!row) return null;
  return {
    countryId: Number(row.country_id),
    kycRequiredAbove: toNumber(row.kyc_required_above),
    amlRequiredAbove: toNumber(row.aml_required_above),
    physicalVerifyAbove: toNumber(row.physical_verify_above),
    escrowRequiredAbove: toNumber(row.escrow_required_above),
    currency: String(row.currency),
    minKycLevel: row.min_kyc_level as GoldComplianceRule['minKycLevel'],
    sellerVerificationRequired: Number(row.seller_verification_required) === 1,
    importExportRestricted: Number(row.import_export_restricted) === 1,
    taxCode: (row.tax_code as string | null) ?? null,
    recordRetentionDays: Number(row.record_retention_days ?? 2555),
  };
}

export async function assertGoldTradeAllowed(params: {
  userId: number;
  countryId: number | null;
  amount: number;
  currency: string;
  isSeller?: boolean;
}): Promise<{
  rule: GoldComplianceRule | null;
  requiresKyc: boolean;
  requiresAml: boolean;
  requiresPhysicalVerification: boolean;
  requiresEscrow: boolean;
}> {
  const rule = await getComplianceRule(params.countryId);
  if (!rule) {
    return {
      rule: null,
      requiresKyc: false,
      requiresAml: false,
      requiresPhysicalVerification: false,
      requiresEscrow: false,
    };
  }

  const converted = await convertAmount(params.amount, params.currency, rule.currency);
  const amountInRuleCurrency = converted?.amount ?? params.amount;

  const over = (threshold: number | null) => threshold !== null && amountInRuleCurrency >= threshold;

  const requiresKyc = over(rule.kycRequiredAbove) || rule.minKycLevel !== 'none';
  const requiresAml = over(rule.amlRequiredAbove);
  const requiresPhysicalVerification = over(rule.physicalVerifyAbove);
  const requiresEscrow = over(rule.escrowRequiredAbove);

  if (requiresKyc) {
    const kyc = await queryOne<Row>(
      `SELECT level, status FROM kyc_records WHERE user_id = ?`,
      [params.userId],
    );
    const level = (kyc?.level as string | undefined) ?? 'none';
    const status = (kyc?.status as string | undefined) ?? 'not_started';
    if (status !== 'verified' || (KYC_RANK[level] ?? 0) < (KYC_RANK[rule.minKycLevel] ?? 0)) {
      throw new AppError('Additional identity verification is required for this gold transaction', {
        status: 403,
        code: ErrorCode.KYC_REQUIRED,
        details: { minKycLevel: rule.minKycLevel, amount: amountInRuleCurrency, currency: rule.currency },
      });
    }
  }

  if (requiresAml) {
    const hit = await queryOne<Row>(
      `SELECT result FROM aml_screenings
        WHERE user_id = ? AND result IN ('match')
        ORDER BY created_at DESC LIMIT 1`,
      [params.userId],
    );
    if (hit) {
      throw forbidden('This account cannot complete a high-value gold transaction until a compliance review finishes');
    }
  }

  return { rule, requiresKyc, requiresAml, requiresPhysicalVerification, requiresEscrow };
}
