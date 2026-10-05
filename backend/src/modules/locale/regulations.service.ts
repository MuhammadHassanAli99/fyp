import { queryOne, queryRows, type Row } from '../../db/query';
import { remember } from '../../config/cache';
import { toBoolean, toJson, toNumber } from '../../db/sql';
import { getComplianceRule } from '../../marketplaces/gold/gold.compliance';

/**
 * Configurable regulatory layer. Country KYC/AML flags, feature flags,
 * gold_compliance_rules and vehicle_trade_rules are composed here so
 * marketplace services do not hardcode country if-statements.
 */

export interface RegulatorySnapshot {
  countryId: number;
  iso2: string;
  version: string;
  effectiveDate: string;
  requiresKyc: boolean;
  requiresAml: boolean;
  marketplaceRestrictions: Array<{
    code: string;
    launched: boolean;
    isActive: boolean;
  }>;
  listing: {
    kycRequiredToSell: boolean;
    documentsRequired: boolean;
  };
  gold: {
    sellerVerificationRequired: boolean;
    importExportRestricted: boolean;
    minKycLevel: string | null;
    kycRequiredAbove: number | null;
    amlRequiredAbove: number | null;
    escrowRequiredAbove: number | null;
    taxCode: string | null;
  } | null;
  vehicles: {
    importRules: Array<{
      originCountryId: number;
      destinationCountryId: number;
      version: number;
      effectiveFrom: string;
      effectiveTo: string | null;
      inspectionRequired: boolean;
      registrationRequired: boolean;
      requiredDocuments: unknown;
      dutyRatePct: number | null;
    }>;
  };
  payments: {
    available: boolean;
  };
  flags: Array<{
    code: string;
    enabled: boolean;
    targetPlatforms: unknown;
  }>;
}

export async function getRegulations(countryId: number, marketplace?: string | null): Promise<RegulatorySnapshot> {
  const cacheKey = `ref:regulations:${countryId}:${marketplace ?? 'all'}`;
  return remember(cacheKey, 300, async () => {
    const country = await queryOne<Row>(
      `SELECT id, iso2, requires_kyc, requires_aml FROM countries WHERE id = ?`,
      [countryId],
    );
    if (!country) {
      return emptySnapshot(countryId);
    }

    const iso2 = String(country.iso2);
    const [marketplaces, flags, gold, vehicleRules] = await Promise.all([
      queryRows<Row>(
        `SELECT m.code, m.is_active, COALESCE(mc.is_active, 1) AS launched
           FROM marketplaces m
           LEFT JOIN marketplace_countries mc
             ON mc.marketplace_id = m.id AND mc.country_id = ?
          ORDER BY m.sort_order`,
        [countryId],
      ),
      queryRows<Row>(
        `SELECT code, is_enabled, target_countries, target_platforms
           FROM feature_flags`,
      ),
      getComplianceRule(countryId),
      queryRows<Row>(
        `SELECT origin_country_id, destination_country_id, version, effective_from, effective_to,
                inspection_required, registration_required, required_documents, duty_rate_pct
           FROM vehicle_trade_rules
          WHERE (origin_country_id = ? OR destination_country_id = ?)
            AND is_active = 1
            AND effective_from <= CURRENT_DATE
            AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
          ORDER BY version DESC`,
        [countryId, countryId],
      ),
    ]);

    const scopedFlags = flags
      .filter((flag) => {
        const countries = toJson<string[] | null>(flag.target_countries, null);
        if (!countries || countries.length === 0) return true;
        return countries.includes(iso2);
      })
      .map((flag) => ({
        code: String(flag.code),
        enabled: Number(flag.is_enabled) === 1,
        targetPlatforms: toJson(flag.target_platforms, null),
      }));

    const marketplaceRestrictions = marketplaces.map((row) => ({
      code: String(row.code),
      launched: Number(row.launched) === 1,
      isActive: Number(row.is_active) === 1,
    }));

    const scoped =
      marketplace && marketplaceRestrictions.length > 0
        ? marketplaceRestrictions.filter((entry) => entry.code === marketplace)
        : marketplaceRestrictions;

    const goldBlock = gold
      ? {
          sellerVerificationRequired: gold.sellerVerificationRequired,
          importExportRestricted: gold.importExportRestricted,
          minKycLevel: gold.minKycLevel,
          kycRequiredAbove: gold.kycRequiredAbove,
          amlRequiredAbove: gold.amlRequiredAbove,
          escrowRequiredAbove: gold.escrowRequiredAbove,
          taxCode: gold.taxCode,
        }
      : null;

    return {
      countryId,
      iso2,
      version: `reg-${iso2}-${new Date().toISOString().slice(0, 10)}`,
      effectiveDate: new Date().toISOString().slice(0, 10),
      requiresKyc: toBoolean(country.requires_kyc),
      requiresAml: toBoolean(country.requires_aml),
      marketplaceRestrictions: scoped,
      listing: {
        kycRequiredToSell: toBoolean(country.requires_kyc),
        documentsRequired: marketplace === 'property' || marketplace === 'gold',
      },
      gold: marketplace && marketplace !== 'gold' ? null : goldBlock,
      vehicles: {
        importRules: vehicleRules.map((row) => ({
          originCountryId: Number(row.origin_country_id),
          destinationCountryId: Number(row.destination_country_id),
          version: Number(row.version),
          effectiveFrom: toIsoDate(row.effective_from as Date),
          effectiveTo: row.effective_to ? toIsoDate(row.effective_to as Date) : null,
          inspectionRequired: toBoolean(row.inspection_required),
          registrationRequired: toBoolean(row.registration_required),
          requiredDocuments: toJson(row.required_documents, null),
          dutyRatePct: toNumber(row.duty_rate_pct),
        })),
      },
      payments: { available: true },
      flags: scopedFlags,
    };
  });
}

function emptySnapshot(countryId: number): RegulatorySnapshot {
  return {
    countryId,
    iso2: '',
    version: 'reg-unknown',
    effectiveDate: new Date().toISOString().slice(0, 10),
    requiresKyc: false,
    requiresAml: false,
    marketplaceRestrictions: [],
    listing: { kycRequiredToSell: false, documentsRequired: false },
    gold: null,
    vehicles: { importRules: [] },
    payments: { available: true },
    flags: [],
  };
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}
