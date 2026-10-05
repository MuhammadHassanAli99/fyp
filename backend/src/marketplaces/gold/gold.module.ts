import { z } from 'zod';
import type { PoolConnection } from '../../db/pool';
import { queryOne, queryRows, execute, type Row } from '../../db/query';
import { buildUpsert, toNumber, type WhereBuilder } from '../../db/sql';
import { validationFailed } from '../../core/errors';
import type {
  CompareField,
  FilterContext,
  MarketplaceModule,
  PricingBreakdownLine,
  PricingModel,
  SortOption,
  ValidationResult,
} from '../module';
import { goldRouter } from './gold.routes';
import { computeFineGoldWeight, mapMakingChargeType, netGoldWeight } from './gold.weights';
import { resolveFinenessForCountry } from './gold.catalog';
import { refreshListingMarketDelta } from './gold.ai';

const KARAT_TO_FINENESS: Record<string, number> = {
  '24': 999,
  '23': 958,
  '22': 916,
  '21': 875,
  '18': 750,
  '14': 585,
  '10': 416,
  '9': 375,
};

/** Grams per tola / troy ounce — the two units gold is actually quoted in. */
export const GRAMS_PER_TOLA = 11.6638;
export const GRAMS_PER_TROY_OUNCE = 31.1035;

const goldDetailsSchema = z
  .object({
    karat: z.coerce.number().min(1).max(24).optional(),
    fineness: z.coerce.number().int().min(1).max(1000).optional(),
    metalType: z
      .enum(['gold', 'white_gold', 'rose_gold', 'silver', 'platinum', 'palladium', 'mixed'])
      .default('gold'),

    grossWeightG: z.coerce.number().positive().max(1_000_000).optional(),
    netWeightG: z.coerce.number().positive().max(1_000_000).optional(),
    stoneWeightG: z.coerce.number().min(0).max(1_000_000).optional(),
    weightUnit: z.enum(['gram', 'tola', 'ounce', 'kg']).default('gram'),
    weightDisplay: z.coerce.number().positive().optional(),
    quantity: z.coerce.number().int().min(1).max(10_000).default(1),
    pieceCount: z.coerce.number().int().min(1).optional(),

    brandId: z.coerce.number().int().positive().optional(),
    brandName: z.string().trim().max(128).optional(),
    isHallmarked: z.coerce.boolean().default(false),
    hallmarkAuthority: z.string().trim().max(128).optional(),
    hallmarkCode: z.string().trim().max(64).optional(),
    hasCertificate: z.coerce.boolean().default(false),
    certificateNumber: z.string().trim().max(96).optional(),
    certificateAuthority: z
      .enum(['bis', 'pgji', 'sgl', 'igi', 'gia', 'hallmark_uk', 'assay_office', 'lbma', 'local_shop', 'other'])
      .optional(),
    certificateUrl: z.string().url().max(512).optional(),
    assayReportUrl: z.string().url().max(512).optional(),

    ratePerGram: z.coerce.number().positive().optional(),
    rateCurrency: z.string().length(3).optional(),
    makingCharges: z.coerce.number().min(0).optional(),
    makingChargeType: z.string().max(24).optional(),
    wastagePercent: z.coerce.number().min(0).max(100).optional(),
    stoneCharges: z.coerce.number().min(0).optional(),
    otherCharges: z.coerce.number().min(0).optional(),
    taxAmount: z.coerce.number().min(0).optional(),
    buybackPercent: z.coerce.number().min(0).max(100).optional(),

    form: z
      .enum(['bar', 'coin', 'biscuit', 'jewellery', 'ornament', 'scrap', 'nugget', 'dust', 'other'])
      .default('jewellery'),
    jewelleryType: z
      .enum(['ring', 'bangle', 'bracelet', 'necklace', 'earring', 'pendant', 'chain', 'anklet', 'nosepin', 'tikka', 'set', 'watch', 'other'])
      .optional(),
    genderTarget: z.enum(['women', 'men', 'unisex', 'kids']).optional(),
    sizeLabel: z.string().trim().max(48).optional(),
    designStyle: z.string().trim().max(96).optional(),
    gemstones: z
      .array(
        z.object({
          type: z.string().max(48),
          carat: z.coerce.number().min(0).optional(),
          count: z.coerce.number().int().min(0).optional(),
          colour: z.string().max(32).optional(),
        }),
      )
      .max(20)
      .optional(),

    isInvestmentGrade: z.coerce.boolean().default(false),
    isAntique: z.coerce.boolean().default(false),
    antiquePeriod: z.string().trim().max(96).optional(),
    isScrap: z.coerce.boolean().default(false),
    yearOfManufacture: z.coerce.number().int().min(1000).max(2100).optional(),
    originCountryId: z.coerce.number().int().positive().optional(),
    serialNumber: z.string().trim().max(96).optional(),
    packaging: z.string().trim().max(64).optional(),

    exchangeAccepted: z.coerce.boolean().default(false),
    buybackAvailable: z.coerce.boolean().default(false),
    deliveryAvailable: z.coerce.boolean().default(false),
    insuredShipping: z.coerce.boolean().default(false),
    inspectionAllowed: z.coerce.boolean().default(true),
    escrowAvailable: z.coerce.boolean().default(false),
  })
  .strip();

export type GoldDetailsInput = z.infer<typeof goldDetailsSchema>;

/** Converts a seller-supplied weight into grams, the canonical storage unit. */
export function toGrams(value: number, unit: string): number {
  switch (unit) {
    case 'tola':
      return value * GRAMS_PER_TOLA;
    case 'ounce':
      return value * GRAMS_PER_TROY_OUNCE;
    case 'kg':
      return value * 1000;
    default:
      return value;
  }
}

export function fromGrams(grams: number, unit: string): number {
  switch (unit) {
    case 'tola':
      return grams / GRAMS_PER_TOLA;
    case 'ounce':
      return grams / GRAMS_PER_TROY_OUNCE;
    case 'kg':
      return grams / 1000;
    default:
      return grams;
  }
}

const round = (value: number, decimals = 2): number => Number(value.toFixed(decimals));

class GoldMarketplaceModule implements MarketplaceModule {
  readonly code = 'gold';
  readonly name = 'Gold Marketplace';
  readonly detailTable = 'gold_listing_details';
  readonly supportedOperations = ['buy', 'sell', 'auction', 'exchange'] as const;

  async validateDetails(input: unknown, context: { operation: string; categoryCode: string | null; countryId: number | null }): Promise<ValidationResult> {
    const parsed = goldDetailsSchema.safeParse(input ?? {});
    if (!parsed.success) {
      throw validationFailed(
        parsed.error.issues.map((issue) => ({
          field: `details.${issue.path.map(String).join('.')}`,
          message: issue.message,
          code: issue.code,
        })),
      );
    }

    const details = parsed.data;
    const warnings: string[] = [];

    // Weight: accept either grams or a display unit, and always end up with grams.
    if (details.weightDisplay !== undefined && details.grossWeightG === undefined) {
      details.grossWeightG = round(toGrams(details.weightDisplay, details.weightUnit), 3);
    }
    if (details.grossWeightG === undefined && details.netWeightG === undefined) {
      throw validationFailed([{ field: 'details.grossWeightG', message: 'Weight is required for a gold listing' }]);
    }
    details.grossWeightG ??= details.netWeightG;
    details.weightDisplay ??= round(fromGrams(details.grossWeightG!, details.weightUnit), 3);

    // Purity: karat and fineness are two views of the same number; derive the
    // missing one and warn when the seller's pair disagrees with the standard.
    if (details.karat !== undefined && details.fineness === undefined) {
      const resolved = await resolveFinenessForCountry({ countryId: context.countryId, karat: details.karat });
      details.fineness = resolved.fineness;
    } else if (details.fineness !== undefined && details.karat === undefined) {
      details.karat = round((details.fineness / 1000) * 24, 2);
    } else if (details.karat !== undefined && details.fineness !== undefined) {
      const expected = KARAT_TO_FINENESS[String(details.karat)];
      if (expected && Math.abs(expected - details.fineness) > 15) {
        warnings.push(`${details.karat}K normally means ${expected} fineness, not ${details.fineness}`);
      }
    }
    if (details.karat === undefined && !details.isScrap) {
      throw validationFailed([{ field: 'details.karat', message: 'Purity (karat) is required' }]);
    }

    // Net metal weight = gross − stones, unless the seller stated it directly.
    if (details.netWeightG === undefined && details.grossWeightG !== undefined) {
      details.netWeightG = Number(netGoldWeight(details.grossWeightG, details.stoneWeightG ?? 0));
    }
    if (details.netWeightG! > details.grossWeightG!) {
      throw validationFailed([
        { field: 'details.netWeightG', message: 'Net weight cannot exceed gross weight' },
      ]);
    }

    const making = mapMakingChargeType(details.makingChargeType as string | undefined);
    if (making) details.makingChargeType = making;
    else if (details.makingChargeType) {
      throw validationFailed([{ field: 'details.makingChargeType', message: 'Use FIXED, PER_GRAM or PERCENTAGE' }]);
    }

    const fine = computeFineGoldWeight(details.netWeightG ?? 0, details.fineness ?? null, details.karat ?? null);
    (details as Record<string, unknown>).fineGoldWeightG = fine === null ? null : Number(fine);

    if (details.gemstones && details.gemstones.length > 0 && !details.stoneWeightG) {
      warnings.push('You listed gemstones but no stone weight — buyers usually ask for it');
    }
    if (details.form === 'jewellery' && !details.jewelleryType) {
      warnings.push('Choosing a jewellery type helps buyers find this listing');
    }
    if (context.operation === 'auction' && !details.hasCertificate && !details.isHallmarked) {
      warnings.push('Auction listings without a hallmark or certificate attract far fewer bids');
    }
    if (details.isScrap) {
      details.form = 'scrap';
    }

    return { details: details as unknown as Record<string, unknown>, warnings };
  }

  /** Recomputes the derived money columns so filters and sorting stay correct. */
  deriveComputedColumns(
    raw: Record<string, unknown>,
    listing: { price: number | null; currency: string | null },
  ): Record<string, unknown> {
    const details = raw as GoldDetailsInput;
    const net = details.netWeightG ?? 0;
    const rate = details.ratePerGram ?? 0;
    const metalValue = net > 0 && rate > 0 ? round(net * rate) : null;
    const fine = computeFineGoldWeight(net, details.fineness ?? null, details.karat ?? null);
    return {
      ...details,
      metalValue,
      fineGoldWeightG: fine === null ? null : Number(fine),
      rateCurrency: details.rateCurrency ?? listing.currency ?? undefined,
    };
  }

  async saveDetails(listingId: number, raw: Record<string, unknown>, connection: PoolConnection): Promise<void> {
    const d = raw as GoldDetailsInput & { metalValue?: number | null };
    const columns = {
      listing_id: listingId,
      karat: d.karat ?? null,
      fineness: d.fineness ?? null,
      purity_percent: d.fineness !== undefined ? round((d.fineness / 1000) * 100, 3) : null,
      metal_type: d.metalType,
      gross_weight_g: d.grossWeightG ?? null,
      net_weight_g: d.netWeightG ?? null,
      stone_weight_g: d.stoneWeightG ?? null,
      weight_unit: d.weightUnit,
      weight_display: d.weightDisplay ?? null,
      quantity: d.quantity,
      piece_count: d.pieceCount ?? null,
      brand_id: d.brandId ?? null,
      brand_name: d.brandName ?? null,
      is_hallmarked: d.isHallmarked ? 1 : 0,
      hallmark_authority: d.hallmarkAuthority ?? null,
      hallmark_code: d.hallmarkCode ?? null,
      has_certificate: d.hasCertificate ? 1 : 0,
      certificate_number: d.certificateNumber ?? null,
      certificate_authority: d.certificateAuthority ?? null,
      certificate_url: null,
      assay_report_url: null,
      rate_per_gram: d.ratePerGram ?? null,
      rate_currency: d.rateCurrency ?? null,
      metal_value: d.metalValue ?? null,
      making_charges: d.makingCharges ?? null,
      making_charge_type: d.makingChargeType ?? null,
      wastage_percent: d.wastagePercent ?? null,
      stone_charges: d.stoneCharges ?? null,
      other_charges: d.otherCharges ?? null,
      tax_amount: d.taxAmount ?? null,
      buyback_percent: d.buybackPercent ?? null,
      form: d.form,
      jewellery_type: d.jewelleryType ?? null,
      gender_target: d.genderTarget ?? null,
      size_label: d.sizeLabel ?? null,
      design_style: d.designStyle ?? null,
      gemstones: d.gemstones ? JSON.stringify(d.gemstones) : null,
      has_gemstones: d.gemstones && d.gemstones.length > 0 ? 1 : 0,
      is_investment_grade: d.isInvestmentGrade ? 1 : 0,
      is_antique: d.isAntique ? 1 : 0,
      antique_period: d.antiquePeriod ?? null,
      is_scrap: d.isScrap ? 1 : 0,
      year_of_manufacture: d.yearOfManufacture ?? null,
      origin_country_id: d.originCountryId ?? null,
      serial_number: (d as { serialNumber?: string }).serialNumber ?? null,
      packaging: (d as { packaging?: string }).packaging ?? null,
      fine_gold_weight_g: (d as { fineGoldWeightG?: number | null }).fineGoldWeightG ?? null,
      exchange_accepted: d.exchangeAccepted ? 1 : 0,
      buyback_available: d.buybackAvailable ? 1 : 0,
      delivery_available: d.deliveryAvailable ? 1 : 0,
      insured_shipping: d.insuredShipping ? 1 : 0,
      inspection_allowed: d.inspectionAllowed ? 1 : 0,
      escrow_available: d.escrowAvailable ? 1 : 0,
    };

    const updatable = Object.keys(columns).filter((column) => column !== 'listing_id');
    const { sql, params } = buildUpsert(this.detailTable, columns, updatable);
    await execute(sql, params, connection);
  }

  async loadDetails(listingId: number): Promise<Record<string, unknown> | null> {
    const row = await queryOne<Row>(`SELECT * FROM ${this.detailTable} WHERE listing_id = ?`, [listingId]);
    return row ? mapGoldRow(row) : null;
  }

  async loadDetailsBatch(listingIds: number[]): Promise<Map<number, Record<string, unknown>>> {
    if (listingIds.length === 0) return new Map();
    const placeholders = listingIds.map(() => '?').join(', ');
    const rows = await queryRows<Row>(
      `SELECT * FROM ${this.detailTable} WHERE listing_id IN (${placeholders})`,
      listingIds,
    );
    return new Map(rows.map((row) => [Number(row.listing_id), mapGoldRow(row)]));
  }

  joinClause(): string {
    return `LEFT JOIN ${this.detailTable} gd ON gd.listing_id = l.id`;
  }

  /** §10 filters, gold flavour. */
  applyFilters(builder: WhereBuilder, context: FilterContext): void {
    const q = context.query as Record<string, string | string[] | undefined>;
    const num = (key: string): number | undefined => {
      const raw = Array.isArray(q[key]) ? q[key]?.[0] : q[key];
      const parsed = raw === undefined ? NaN : Number(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const list = (key: string): string[] | undefined => {
      const raw = q[key];
      if (raw === undefined) return undefined;
      const values = Array.isArray(raw) ? raw : String(raw).split(',');
      const cleaned = values.map((value) => value.trim()).filter(Boolean);
      return cleaned.length > 0 ? cleaned : undefined;
    };
    const flag = (key: string): boolean | undefined => {
      const raw: unknown = Array.isArray(q[key]) ? q[key]?.[0] : q[key];
      if (raw === undefined || raw === null || raw === '') return undefined;
      if (raw === true || raw === 'true' || raw === '1' || raw === 1) return true;
      if (raw === false || raw === 'false' || raw === '0' || raw === 0) return false;
      return undefined;
    };

    builder.in('gd.karat', list('karat')?.map((value) => Number(value.replace(/k$/i, ''))).filter(Number.isFinite));
    builder.between('gd.net_weight_g', num('weightMin'), num('weightMax'));
    builder.in('gd.form', list('form'));
    builder.in('gd.jewellery_type', list('jewelleryType'));
    builder.in('gd.metal_type', list('metalType'));
    builder.in('gd.gender_target', list('genderTarget'));
    builder.in('gd.brand_id', list('brandId')?.map(Number).filter(Number.isFinite));
    builder.in('gd.certificate_authority', list('certificateAuthority'));
    builder.between('gd.fineness', num('finenessMin'), num('finenessMax'));
    builder.eq('gd.serial_number', Array.isArray(q.serialNumber) ? q.serialNumber?.[0] : q.serialNumber);
    if (flag('antique')) builder.bool('gd.is_antique', true);
    const sellerType = Array.isArray(q.sellerType) ? q.sellerType?.[0] : q.sellerType;
    if (sellerType === 'business') builder.raw('l.business_id IS NOT NULL');
    if (sellerType === 'individual') builder.raw('l.business_id IS NULL');
    builder.bool('gd.is_hallmarked', flag('hallmarked'));
    builder.bool('gd.has_certificate', flag('certified'));
    builder.bool('gd.is_investment_grade', flag('investmentGrade'));
    builder.bool('gd.is_antique', flag('antique'));
    builder.bool('gd.is_scrap', flag('scrap'));
    builder.lte('gd.making_charges', num('makingChargeMax'));
    builder.gte('gd.making_charges', num('makingChargeMin'));
    builder.bool('gd.has_gemstones', flag('gemstones'));
    builder.bool('gd.buyback_available', flag('buyback'));
    builder.bool('gd.exchange_accepted', flag('exchange'));
    builder.bool('gd.delivery_available', flag('delivery'));
    builder.bool('gd.escrow_available', flag('escrow'));

    if (flag('authenticityChecked')) {
      builder.in('gd.authenticity_risk', ['low']);
    }
    builder.gte('gd.authenticity_score', num('minAuthenticityScore'));
    // Below-market deals (§5 price prediction feeding a filter).
    builder.lte('gd.price_vs_market_pct', num('maxPriceVsMarketPct'));
  }

  sortOptions(): SortOption[] {
    return [
      { code: 'weight_desc', label: 'Weight: heaviest first', expression: 'gd.net_weight_g', direction: 'DESC' },
      { code: 'weight_asc', label: 'Weight: lightest first', expression: 'gd.net_weight_g', direction: 'ASC' },
      { code: 'karat_desc', label: 'Purity: highest karat', expression: 'gd.karat', direction: 'DESC' },
      { code: 'karat_asc', label: 'Purity: lowest karat', expression: 'gd.karat', direction: 'ASC' },
      {
        code: 'price_per_gram_asc',
        label: 'Price per gram: low to high',
        expression: 'CASE WHEN gd.net_weight_g > 0 THEN l.price_base / gd.net_weight_g ELSE NULL END',
        direction: 'ASC',
      },
      {
        code: 'ending_soon',
        label: 'Auction ending soon',
        expression: '(SELECT a.ends_at FROM auctions a WHERE a.listing_id = l.id AND a.status = \'live\')',
        direction: 'ASC',
      },
      { code: 'trust', label: 'Highest trust', expression: 'ts.score', direction: 'DESC' },
      { code: 'best_deal', label: 'Best value vs market', expression: 'gd.price_vs_market_pct', direction: 'ASC' },
    ];
  }

  /** §15 Compare — the rows of the gold comparison table. */
  comparableFields(): CompareField[] {
    return [
      { code: 'price', label: 'Price', source: 'listing', column: 'price', kind: 'money', better: 'lower', group: 'Price', alwaysShow: true },
      { code: 'pricePerGram', label: 'Price per gram', source: 'computed', kind: 'money', better: 'lower', group: 'Price', alwaysShow: true },
      { code: 'karat', label: 'Purity', source: 'detail', column: 'karat', kind: 'number', unit: 'K', better: 'higher', group: 'Purity', alwaysShow: true },
      { code: 'fineness', label: 'Fineness', source: 'detail', column: 'fineness', kind: 'number', better: 'higher', group: 'Purity' },
      { code: 'metalType', label: 'Metal', source: 'detail', column: 'metal_type', kind: 'enum', better: 'none', group: 'Purity' },
      { code: 'netWeightG', label: 'Net weight', source: 'detail', column: 'net_weight_g', kind: 'number', unit: 'g', better: 'higher', group: 'Weight', alwaysShow: true },
      { code: 'fineGoldWeightG', label: 'Fine gold weight', source: 'detail', column: 'fine_gold_weight_g', kind: 'number', unit: 'g', better: 'higher', group: 'Weight' },
      { code: 'grossWeightG', label: 'Gross weight', source: 'detail', column: 'gross_weight_g', kind: 'number', unit: 'g', better: 'higher', group: 'Weight' },
      { code: 'stoneWeightG', label: 'Stone weight', source: 'detail', column: 'stone_weight_g', kind: 'number', unit: 'g', better: 'none', group: 'Weight' },
      { code: 'form', label: 'Form', source: 'detail', column: 'form', kind: 'enum', better: 'none', group: 'Item' },
      { code: 'jewelleryType', label: 'Type', source: 'detail', column: 'jewellery_type', kind: 'enum', better: 'none', group: 'Item' },
      { code: 'brandName', label: 'Brand', source: 'detail', column: 'brand_name', kind: 'text', better: 'none', group: 'Item' },
      { code: 'isHallmarked', label: 'Hallmarked', source: 'detail', column: 'is_hallmarked', kind: 'boolean', better: 'higher', group: 'Trust', alwaysShow: true },
      { code: 'hasCertificate', label: 'Certificate', source: 'detail', column: 'has_certificate', kind: 'boolean', better: 'higher', group: 'Trust', alwaysShow: true },
      { code: 'certificateAuthority', label: 'Certified by', source: 'detail', column: 'certificate_authority', kind: 'enum', better: 'none', group: 'Trust' },
      { code: 'authenticityRisk', label: 'AI authenticity risk', source: 'detail', column: 'authenticity_risk', kind: 'enum', better: 'none', group: 'Trust' },
      { code: 'makingCharges', label: 'Making charges', source: 'detail', column: 'making_charges', kind: 'money', better: 'lower', group: 'Charges' },
      { code: 'wastagePercent', label: 'Wastage', source: 'detail', column: 'wastage_percent', kind: 'number', unit: '%', better: 'lower', group: 'Charges' },
      { code: 'buybackPercent', label: 'Buyback', source: 'detail', column: 'buyback_percent', kind: 'number', unit: '%', better: 'higher', group: 'Terms' },
      { code: 'exchangeAccepted', label: 'Exchange accepted', source: 'detail', column: 'exchange_accepted', kind: 'boolean', better: 'higher', group: 'Terms' },
      { code: 'deliveryAvailable', label: 'Delivery', source: 'detail', column: 'delivery_available', kind: 'boolean', better: 'higher', group: 'Terms' },
      { code: 'isInvestmentGrade', label: 'Investment grade', source: 'detail', column: 'is_investment_grade', kind: 'boolean', better: 'higher', group: 'Item' },
      { code: 'isAntique', label: 'Antique', source: 'detail', column: 'is_antique', kind: 'boolean', better: 'none', group: 'Item' },
    ];
  }

  /**
   * Gold pricing is transparent by convention: metal value + making + wastage +
   * stones + tax. Showing the breakdown is a meaningful trust feature, so the
   * module exposes it rather than only a total.
   */
  pricingModel(): PricingModel {
    return {
      breakdown: (raw: Record<string, unknown>): PricingBreakdownLine[] => {
        const net = toNumber(raw.netWeightG ?? raw.net_weight_g) ?? 0;
        const rate = toNumber(raw.ratePerGram ?? raw.rate_per_gram) ?? 0;
        const lines: PricingBreakdownLine[] = [];

        const metalValue = toNumber(raw.metalValue ?? raw.metal_value) ?? (net > 0 && rate > 0 ? net * rate : 0);
        if (metalValue > 0) {
          lines.push({ code: 'metal', label: 'Metal value', amount: round(metalValue), kind: 'base' });
        }

        const makingType = (raw.makingChargeType ?? raw.making_charge_type) as string | null;
        const making = toNumber(raw.makingCharges ?? raw.making_charges) ?? 0;
        if (making > 0) {
          const amount =
            makingType === 'per_gram' ? making * net : makingType === 'percent' ? (metalValue * making) / 100 : making;
          lines.push({ code: 'making', label: 'Making charges', amount: round(amount), kind: 'charge' });
        }

        const wastage = toNumber(raw.wastagePercent ?? raw.wastage_percent) ?? 0;
        if (wastage > 0 && metalValue > 0) {
          lines.push({ code: 'wastage', label: `Wastage (${wastage}%)`, amount: round((metalValue * wastage) / 100), kind: 'charge' });
        }

        const stone = toNumber(raw.stoneCharges ?? raw.stone_charges) ?? 0;
        if (stone > 0) lines.push({ code: 'stones', label: 'Stone charges', amount: round(stone), kind: 'charge' });

        const other = toNumber(raw.otherCharges ?? raw.other_charges) ?? 0;
        if (other > 0) lines.push({ code: 'other', label: 'Other charges', amount: round(other), kind: 'charge' });

        const tax = toNumber(raw.taxAmount ?? raw.tax_amount) ?? 0;
        if (tax > 0) lines.push({ code: 'tax', label: 'Tax', amount: round(tax), kind: 'tax' });

        const total = lines.reduce((sum, line) => sum + (line.kind === 'discount' ? -line.amount : line.amount), 0);
        if (lines.length > 0) lines.push({ code: 'total', label: 'Total', amount: round(total), kind: 'total' });
        return lines;
      },
      unitPrice: (raw: Record<string, unknown>, price: number) => {
        const net = toNumber(raw.netWeightG ?? raw.net_weight_g) ?? 0;
        return net > 0 ? { value: round(price / net, 4), unit: 'gram' } : null;
      },
    };
  }

  router() {
    return goldRouter;
  }

  async onPublished(listingId: number, connection: PoolConnection): Promise<void> {
    await execute(
      `UPDATE listing_documents SET is_public = 0
        WHERE listing_id = ? AND doc_type IN ('certificate','assay') AND is_public = 1`,
      [listingId],
      connection,
    ).catch(() => undefined);
    await refreshListingMarketDelta(listingId).catch(() => undefined);
  }
}

/** Row → API shape. DECIMALs arrive as strings; convert only what the client needs numeric. */
function mapGoldRow(row: Row): Record<string, unknown> {
  return {
    karat: toNumber(row.karat),
    fineness: row.fineness === null ? null : Number(row.fineness),
    purityPercent: toNumber(row.purity_percent),
    metalType: row.metal_type,
    grossWeightG: toNumber(row.gross_weight_g),
    netWeightG: toNumber(row.net_weight_g),
    stoneWeightG: toNumber(row.stone_weight_g),
    weightUnit: row.weight_unit,
    weightDisplay: toNumber(row.weight_display),
    quantity: Number(row.quantity ?? 1),
    pieceCount: row.piece_count === null ? null : Number(row.piece_count),
    brandId: row.brand_id === null ? null : Number(row.brand_id),
    brandName: row.brand_name,
    isHallmarked: row.is_hallmarked === 1,
    hallmarkAuthority: row.hallmark_authority,
    hallmarkCode: row.hallmark_code,
    hasCertificate: row.has_certificate === 1,
    certificateNumber: row.certificate_number,
    certificateAuthority: row.certificate_authority,
    hasProtectedCertificate: Boolean(row.certificate_id || row.certificate_url),
    hasProtectedAssay: Boolean(row.assay_report_url),
    ratePerGram: toNumber(row.rate_per_gram),
    rateCurrency: row.rate_currency,
    metalValue: toNumber(row.metal_value),
    makingCharges: toNumber(row.making_charges),
    makingChargeType: row.making_charge_type,
    wastagePercent: toNumber(row.wastage_percent),
    stoneCharges: toNumber(row.stone_charges),
    otherCharges: toNumber(row.other_charges),
    taxAmount: toNumber(row.tax_amount),
    buybackPercent: toNumber(row.buyback_percent),
    form: row.form,
    jewelleryType: row.jewellery_type,
    genderTarget: row.gender_target,
    sizeLabel: row.size_label,
    designStyle: row.design_style,
    gemstones: row.gemstones ?? null,
    hasGemstones: row.has_gemstones === 1,
    isInvestmentGrade: row.is_investment_grade === 1,
    isAntique: row.is_antique === 1,
    antiquePeriod: row.antique_period,
    isScrap: row.is_scrap === 1,
    yearOfManufacture: row.year_of_manufacture === null ? null : Number(row.year_of_manufacture),
    originCountryId: row.origin_country_id === null ? null : Number(row.origin_country_id),
    serialNumber: row.serial_number ?? null,
    packaging: row.packaging ?? null,
    fineGoldWeightG: toNumber(row.fine_gold_weight_g),
    certificateId: row.certificate_id === null || row.certificate_id === undefined ? null : Number(row.certificate_id),
    hallmarkId: row.hallmark_id === null || row.hallmark_id === undefined ? null : Number(row.hallmark_id),
    hasCertificateDocument: row.certificate_id !== null && row.certificate_id !== undefined,
    exchangeAccepted: row.exchange_accepted === 1,
    buybackAvailable: row.buyback_available === 1,
    deliveryAvailable: row.delivery_available === 1,
    insuredShipping: row.insured_shipping === 1,
    inspectionAllowed: row.inspection_allowed === 1,
    escrowAvailable: row.escrow_available === 1,
    authenticityScore: toNumber(row.authenticity_score),
    authenticityChecks: row.authenticity_checks ?? null,
    authenticityRisk: row.authenticity_risk ?? null,
    authenticityConfidence: toNumber(row.authenticity_confidence),
    authenticityModelId: row.authenticity_model_id ?? null,
    authenticityModelVersion: row.authenticity_model_version ?? null,
    authenticityDisclaimer:
      'AI authenticity assessment is a risk-support tool. It cannot prove physical gold is genuine.',
    aiFairPriceLow: toNumber(row.ai_fair_price_low),
    aiFairPriceHigh: toNumber(row.ai_fair_price_high),
    priceVsMarketPct: toNumber(row.price_vs_market_pct),
  };
}

export const goldModule = new GoldMarketplaceModule();
