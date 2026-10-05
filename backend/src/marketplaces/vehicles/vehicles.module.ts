import { z } from 'zod';
import type { PoolConnection } from '../../db/pool';
import { queryOne, queryRows, execute, type Row } from '../../db/query';
import { buildBulkInsert, buildUpsert, toNumber, type WhereBuilder } from '../../db/sql';
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
import { vehiclesRouter } from './vehicles.routes';
import { createVehicleRecord } from './vehicles.assets';
import { getTypeRule } from './vehicles.catalog';
import { onVehiclePublished } from './vehicles.jobs';
import { dealRatingFor, isTypeOperationAllowed } from './vehicles.rules';

export const MILES_TO_KM = 1.60934;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Vehicle types that are driven on roads and therefore have a make/model/odometer. */
const ROAD_VEHICLES = ['car', 'motorcycle', 'bus', 'truck', 'van', 'taxi', 'rickshaw'] as const;

/**
 * VIN alphabet: I, O and Q are excluded by ISO 3779 precisely because they are
 * indistinguishable from 1 and 0 on a stamped plate.
 */
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * Sellers write "Pearl White", "Super White" and "Off White" for what a buyer
 * filters as one colour. The filter is unusable without a normalised bucket, so
 * every free-text colour is folded into a family on the way in.
 */
const COLOR_FAMILY: Record<string, string> = {
  white: 'white', 'pearl white': 'white', 'off white': 'white', 'super white': 'white', ivory: 'white', cream: 'white', alabaster: 'white',
  black: 'black', 'jet black': 'black', obsidian: 'black', midnight: 'black', onyx: 'black',
  silver: 'silver', 'metallic silver': 'silver', platinum: 'silver', chrome: 'silver',
  grey: 'grey', gray: 'grey', gunmetal: 'grey', graphite: 'grey', charcoal: 'grey', slate: 'grey',
  blue: 'blue', navy: 'blue', 'navy blue': 'blue', 'sky blue': 'blue', 'royal blue': 'blue', cobalt: 'blue', teal: 'blue', turquoise: 'blue',
  red: 'red', crimson: 'red', scarlet: 'red', cherry: 'red', ruby: 'red',
  brown: 'brown', bronze: 'brown', chocolate: 'brown', copper: 'brown', mocha: 'brown', walnut: 'brown',
  green: 'green', olive: 'green', emerald: 'green', 'bottle green': 'green', lime: 'green',
  beige: 'beige', sand: 'beige', champagne: 'beige', khaki: 'beige',
  gold: 'gold', golden: 'gold',
  maroon: 'maroon', burgundy: 'maroon', wine: 'maroon',
  yellow: 'yellow', mustard: 'yellow',
  orange: 'orange', amber: 'orange',
  purple: 'purple', violet: 'purple', magenta: 'purple', lavender: 'purple',
};

// Longest first, so "metallic silver" wins over "silver" and "silver" over "tan"-style
// short keys that would otherwise match inside an unrelated word.
const COLOR_FAMILY_KEYS = Object.keys(COLOR_FAMILY).sort((a, b) => b.length - a.length);

export function toColorFamily(colour: string | undefined | null): string | undefined {
  if (!colour) return undefined;
  const normalised = colour.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalised.length === 0) return undefined;
  const exact = COLOR_FAMILY[normalised];
  if (exact) return exact;
  for (const key of COLOR_FAMILY_KEYS) {
    if (normalised.includes(key)) return COLOR_FAMILY[key];
  }
  return 'other';
}

const vehicleDetailsSchema = z
  .object({
    vehicleType: z.string().trim().min(1).max(48),
    vehicleId: z.coerce.number().int().positive().optional(),

    makeId: z.coerce.number().int().positive().optional(),
    modelId: z.coerce.number().int().positive().optional(),
    variantId: z.coerce.number().int().positive().optional(),
    makeName: z.string().trim().max(96).optional(),
    modelName: z.string().trim().max(128).optional(),
    variantName: z.string().trim().max(160).optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    modelYear: z.coerce.number().int().min(1900).max(2100).optional(),
    trim: z.string().trim().max(96).optional(),
    generation: z.string().trim().max(64).optional(),
    manufacturingDate: z.string().regex(ISO_DATE, 'Use the YYYY-MM-DD format').optional(),
    countryOfManufacture: z.coerce.number().int().positive().optional(),
    vehicleCondition: z.string().trim().max(32).optional(),

    mileage: z.coerce.number().int().min(0).max(9_999_999).optional(),
    mileageUnit: z.enum(['km', 'mi', 'hours']).default('km'),
    engineHours: z.coerce.number().int().min(0).max(9_999_999).optional(),

    engineCc: z.coerce.number().int().min(0).max(65_535).optional(),
    engineType: z.string().trim().max(64).optional(),
    powerHp: z.coerce.number().int().min(0).max(65_535).optional(),
    torqueNm: z.coerce.number().int().min(0).max(65_535).optional(),
    cylinders: z.coerce.number().int().min(0).max(255).optional(),
    fuelType: z.string().trim().max(32).optional(),
    transmission: z.string().trim().max(32).optional(),
    drivetrain: z.string().trim().max(16).optional(),
    batteryKwh: z.coerce.number().min(0).max(10_000).optional(),
    rangeKm: z.coerce.number().int().min(0).max(65_535).optional(),
    batteryHealthPct: z.coerce.number().min(0).max(100).optional(),
    chargingType: z.string().trim().max(48).optional(),
    chargingTimeHours: z.coerce.number().min(0).max(1_000).optional(),
    acCharging: z.coerce.boolean().default(false),
    dcCharging: z.coerce.boolean().default(false),
    fastCharging: z.coerce.boolean().default(false),
    batteryWarrantyMonths: z.coerce.number().int().min(0).max(1_200).optional(),

    bodyType: z.enum([
      'sedan', 'hatchback', 'suv', 'crossover', 'coupe', 'convertible', 'wagon',
      'pickup', 'minivan', 'micro', 'mpv', 'roadster', 'limousine', 'other',
    ]).optional(),
    colorExterior: z.string().trim().max(48).optional(),
    colorInterior: z.string().trim().max(48).optional(),
    doors: z.coerce.number().int().min(0).max(255).optional(),
    seats: z.coerce.number().int().min(0).max(255).optional(),
    axles: z.coerce.number().int().min(0).max(255).optional(),
    wheels: z.coerce.number().int().min(0).max(255).optional(),
    lengthFt: z.coerce.number().min(0).max(10_000).optional(),
    capacityTons: z.coerce.number().min(0).max(100_000).optional(),
    passengerCapacity: z.coerce.number().int().min(0).max(65_535).optional(),

    vin: z.string().trim().max(32).optional(),
    chassisNumber: z.string().trim().max(48).optional(),
    engineNumber: z.string().trim().max(48).optional(),
    registrationNumber: z.string().trim().max(32).optional(),
    registrationCityId: z.coerce.number().int().positive().optional(),
    registrationYear: z.coerce.number().int().min(1900).max(2100).optional(),
    registrationStatus: z.enum(['registered', 'unregistered', 'applied', 'transferred', 'on_papers']).optional(),
    isImported: z.coerce.boolean().default(false),
    importYear: z.coerce.number().int().min(1900).max(2100).optional(),
    assembly: z.enum(['local', 'imported', 'ckd', 'cbu']).optional(),
    handDrive: z.enum(['left', 'right']).optional(),

    conditionGrade: z.enum(['excellent', 'very_good', 'good', 'fair', 'poor', 'salvage']).optional(),
    ownersCount: z.coerce.number().int().min(0).max(255).optional(),
    accidentHistory: z.enum(['none', 'minor', 'major', 'unknown']).optional(),
    accidentDetails: z.string().trim().max(500).optional(),
    serviceHistory: z.enum(['full', 'partial', 'none', 'unknown']).optional(),
    lastServiceKm: z.coerce.number().int().min(0).max(9_999_999).optional(),
    lastServiceAt: z.string().regex(ISO_DATE, 'Use the YYYY-MM-DD format').optional(),
    tyreCondition: z.enum(['new', 'good', 'average', 'needs_replacement']).optional(),
    hasModifications: z.coerce.boolean().default(false),
    modificationDetails: z.string().trim().max(500).optional(),

    insuranceStatus: z.enum(['valid', 'expired', 'none']).optional(),
    insuranceExpiry: z.string().regex(ISO_DATE, 'Use the YYYY-MM-DD format').optional(),
    taxPaidUntil: z.string().regex(ISO_DATE, 'Use the YYYY-MM-DD format').optional(),
    hasWarranty: z.coerce.boolean().default(false),
    warrantyUntil: z.string().regex(ISO_DATE, 'Use the YYYY-MM-DD format').optional(),
    warrantyKm: z.coerce.number().int().min(0).max(9_999_999).optional(),
    exchangeAccepted: z.coerce.boolean().default(false),
    financeAvailable: z.coerce.boolean().default(false),
    downPayment: z.coerce.number().min(0).optional(),
    monthlyInstallment: z.coerce.number().min(0).optional(),
    installmentMonths: z.coerce.number().int().min(0).max(65_535).optional(),

    rentPeriod: z.string().trim().max(32).optional(),
    withDriver: z.coerce.boolean().default(false),
    driverOptional: z.coerce.boolean().default(false),
    fuelPolicy: z.enum(['included', 'excluded', 'full_to_full', 'prepaid']).optional(),
    kmLimitPerDay: z.coerce.number().int().min(0).max(9_999_999).optional(),
    extraKmRate: z.coerce.number().min(0).optional(),
    securityDeposit: z.coerce.number().min(0).optional(),
    minRentalPeriod: z.coerce.number().int().min(0).max(65_535).optional(),
    minDriverAge: z.coerce.number().int().min(0).max(255).optional(),
    licenseRequired: z.coerce.boolean().default(true),

    featureIds: z.array(z.coerce.number().int().positive()).max(120).optional(),
  })
  .strip();

export type VehicleDetailsInput = z.infer<typeof vehicleDetailsSchema>;

/**
 * `validateDetails` is the only async hook, so it also fetches the two market
 * references the arithmetic needs. `deriveComputedColumns` then stays pure and
 * synchronous, as the interface requires.
 */
type VehicleDetails = VehicleDetailsInput & {
  mileageKm?: number | null;
  colorFamily?: string;
  marketMedianPrice?: number | null;
  marketCurrency?: string | null;
  launchPrice?: number | null;
  launchCurrency?: string | null;
  priceVsMarketPct?: number | null;
  depreciationPct?: number | null;
  dealRating?: 'great' | 'good' | 'fair' | 'high' | 'overpriced' | null;
};

const round = (value: number, decimals = 2): number => Number(value.toFixed(decimals));

/** §18 deal rating thresholds, expressed as percent above/below the market median. */
export { dealRatingFor } from './vehicles.rules';

class VehicleMarketplaceModule implements MarketplaceModule {
  readonly code = 'vehicles';
  readonly name = 'Vehicle Marketplace';
  readonly detailTable = 'vehicle_listing_details';
  readonly supportedOperations = ['buy', 'sell', 'rent', 'auction', 'exchange'] as const;

  async validateDetails(
    input: unknown,
    context: { operation: string; categoryCode: string | null; countryId: number | null },
  ): Promise<ValidationResult> {
    const parsed = vehicleDetailsSchema.safeParse(input ?? {});
    if (!parsed.success) {
      throw validationFailed(
        parsed.error.issues.map((issue) => ({
          field: `details.${issue.path.map(String).join('.')}`,
          message: issue.message,
          code: issue.code,
        })),
      );
    }

    const details = parsed.data as VehicleDetails;
    const warnings: string[] = [];
    const currentYear = new Date().getUTCFullYear();
    const typeRule = await getTypeRule(details.vehicleType);
    const isRoadVehicle = typeRule
      ? typeRule.requiresMakeModel
      : (ROAD_VEHICLES as readonly string[]).includes(details.vehicleType);

    if (typeRule && !isTypeOperationAllowed(typeRule.allowedOperations, context.operation)) {
      throw validationFailed([
        {
          field: 'operation',
          message: `${details.vehicleType} listings do not support ${context.operation}`,
        },
      ]);
    }

    await this.resolveIdentity(details);

    // A boat or an excavator is described by its specification, not by a
    // catalogue entry, so only road vehicles are held to make/model/year.
    if (isRoadVehicle) {
      const missing: string[] = [];
      if (!details.makeId && !details.makeName) missing.push('makeId');
      if (!details.modelId && !details.modelName) missing.push('modelId');
      if (details.year === undefined) missing.push('year');
      if (missing.length > 0) {
        throw validationFailed(
          missing.map((field) => ({ field: `details.${field}`, message: 'Make, model and year are required for road vehicles' })),
        );
      }
    }

    // Next year's models genuinely go on sale in the current year; anything
    // beyond that is a typo.
    if (details.year !== undefined && details.year > currentYear + 1) {
      throw validationFailed([{ field: 'details.year', message: `Year cannot be later than ${currentYear + 1}` }]);
    }

    if (details.mileageUnit === 'hours') {
      // Hour meters and odometers are not interchangeable, so an hour reading
      // must never end up in the km column the filters compare on.
      details.engineHours ??= details.mileage;
      details.mileageKm = null;
    } else if (details.mileage !== undefined) {
      details.mileageKm = Math.round(details.mileageUnit === 'mi' ? details.mileage * MILES_TO_KM : details.mileage);
    } else {
      details.mileageKm = null;
    }

    const isUsed =
      (details.year !== undefined && details.year < currentYear) || (details.ownersCount ?? 0) > 0;
    if (isRoadVehicle && isUsed && details.mileage === undefined) {
      throw validationFailed([
        { field: 'details.mileage', message: 'Mileage is required for a used vehicle — buyers cannot price one without it' },
      ]);
    }

    details.colorFamily = toColorFamily(details.colorExterior);

    if (context.operation === 'rent' && !details.rentPeriod) {
      throw validationFailed([
        { field: 'details.rentPeriod', message: 'Tell renters what the rate is per — hourly, daily, weekly…' },
      ]);
    }

    if (details.vin !== undefined) {
      details.vin = details.vin.toUpperCase();
      if (!VIN_PATTERN.test(details.vin)) {
        throw validationFailed([
          { field: 'details.vin', message: 'A VIN is 17 characters, letters and digits only, never I, O or Q' },
        ]);
      }
    }

    const age = details.year === undefined ? null : Math.max(0, currentYear - details.year);
    if (age !== null && age >= 2 && details.mileageKm !== null && details.mileageKm !== undefined) {
      const perYear = details.mileageKm / age;
      if (perYear < 2000) {
        warnings.push(
          `${details.mileageKm.toLocaleString('en-US')} km over ${age} years is unusually low — buyers will ask you to prove the odometer reading`,
        );
      }
    }
    if (details.accidentHistory === 'major' && !details.accidentDetails) {
      warnings.push('You declared major accident history without describing it — buyers assume the worst when the detail is missing');
    }
    if (details.fuelType === 'electric' && details.batteryHealthPct === undefined) {
      warnings.push('Battery health is what an EV buyer actually shops on — a listing without it looks like it has something to hide');
    }
    if (age !== null && age > 10 && details.serviceHistory === 'none') {
      warnings.push('No service history on a vehicle this old will cost you both buyers and price');
    }

    await this.attachMarketReferences(details, context.countryId);

    return { details: details as unknown as Record<string, unknown>, warnings };
  }

  /**
   * The catalogue and the free-text names are two views of the same vehicle.
   * Sellers arrive with either — an app picker sends ids, an import feed sends
   * names — and both paths must end up with the pair filled in, because search
   * reads the names and the price index joins on the ids.
   */
  private async resolveIdentity(details: VehicleDetails): Promise<void> {
    if (details.makeId) {
      const row = await queryOne<Row>('SELECT name FROM vehicle_makes WHERE id = ?', [details.makeId]);
      if (row) details.makeName = String(row.name);
    } else if (details.makeName) {
      const row = await queryOne<Row>('SELECT id, name FROM vehicle_makes WHERE LOWER(name) = LOWER(?) LIMIT 1', [details.makeName]);
      if (row) {
        details.makeId = Number(row.id);
        details.makeName = String(row.name);
      }
    }

    if (details.modelId) {
      const row = await queryOne<Row>('SELECT name, make_id FROM vehicle_models WHERE id = ?', [details.modelId]);
      if (row) {
        details.modelName = String(row.name);
        details.makeId ??= Number(row.make_id);
      }
    } else if (details.modelName) {
      const row = await queryOne<Row>(
        `SELECT id, name FROM vehicle_models
          WHERE LOWER(name) = LOWER(?) AND (? IS NULL OR make_id = ?)
          LIMIT 1`,
        [details.modelName, details.makeId ?? null, details.makeId ?? null],
      );
      if (row) {
        details.modelId = Number(row.id);
        details.modelName = String(row.name);
      }
    }

    if (details.variantId) {
      const row = await queryOne<Row>('SELECT name, model_id FROM vehicle_variants WHERE id = ?', [details.variantId]);
      if (row) {
        details.variantName = String(row.name);
        details.modelId ??= Number(row.model_id);
      }
    } else if (details.variantName && details.modelId) {
      const row = await queryOne<Row>(
        'SELECT id, name FROM vehicle_variants WHERE model_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
        [details.modelId, details.variantName],
      );
      if (row) {
        details.variantId = Number(row.id);
        details.variantName = String(row.name);
      }
    }
  }

  /** Loads the two reference prices that `deriveComputedColumns` needs to stay synchronous. */
  private async attachMarketReferences(details: VehicleDetails, countryId: number | null): Promise<void> {
    if (countryId && details.makeId) {
      const row = await queryOne<Row>(
        `SELECT median_price, avg_price, currency FROM vehicle_price_index
          WHERE country_id = ?
            AND make_id = ?
            AND (model_id IS NULL OR model_id = ?)
            AND (variant_id IS NULL OR variant_id = ?)
            AND (year IS NULL OR year = ?)
          ORDER BY (variant_id IS NULL), (model_id IS NULL), (year IS NULL), period_end DESC
          LIMIT 1`,
        [countryId, details.makeId, details.modelId ?? null, details.variantId ?? null, details.year ?? null],
      );
      details.marketMedianPrice = toNumber(row?.median_price) ?? toNumber(row?.avg_price);
      details.marketCurrency = (row?.currency as string | undefined) ?? null;
    }

    if (details.variantId) {
      const row = await queryOne<Row>('SELECT launch_price, launch_currency FROM vehicle_variants WHERE id = ?', [details.variantId]);
      details.launchPrice = toNumber(row?.launch_price);
      details.launchCurrency = (row?.launch_currency as string | undefined) ?? null;
    }
  }

  /** Pure arithmetic over the references gathered during validation. */
  deriveComputedColumns(
    raw: Record<string, unknown>,
    listing: { price: number | null; currency: string | null },
  ): Record<string, unknown> {
    const details = raw as VehicleDetails;
    const price = listing.price ?? 0;

    let priceVsMarketPct: number | null = null;
    let dealRating: VehicleDetails['dealRating'] = null;
    const marketPrice = details.marketMedianPrice ?? null;
    // Comparing an asking price against a median quoted in another currency
    // would produce a confident, wrong number — better to show nothing.
    if (price > 0 && marketPrice && marketPrice > 0 && details.marketCurrency === listing.currency) {
      priceVsMarketPct = round(((price - marketPrice) / marketPrice) * 100, 3);
      dealRating = dealRatingFor(priceVsMarketPct);
    }

    let depreciationPct: number | null = null;
    const launchPrice = details.launchPrice ?? null;
    if (price > 0 && launchPrice && launchPrice > 0 && details.launchCurrency === listing.currency) {
      depreciationPct = round(((launchPrice - price) / launchPrice) * 100, 3);
    }

    return { ...details, priceVsMarketPct, dealRating, depreciationPct };
  }

  async saveDetails(listingId: number, raw: Record<string, unknown>, connection: PoolConnection): Promise<void> {
    const d = raw as VehicleDetails;
    const listing = await queryOne<Row>(
      `SELECT user_id, business_id, country_id, region_id, city_id, latitude, longitude, title
         FROM listings WHERE id = ?`,
      [listingId],
      connection,
    );

    let vehicleId = d.vehicleId ?? null;
    if (vehicleId && listing) {
      const owned = await queryOne<Row>(
        'SELECT id, owner_user_id FROM vehicles WHERE id = ? AND deleted_at IS NULL',
        [vehicleId],
        connection,
      );
      if (!owned || Number(owned.owner_user_id) !== Number(listing.user_id)) {
        throw validationFailed([
          { field: 'details.vehicleId', message: 'You can only attach a vehicle you own' },
        ]);
      }
    }

    const existing = await queryOne<Row>(
      'SELECT vehicle_id FROM vehicle_listing_details WHERE listing_id = ?',
      [listingId],
      connection,
    );
    if (!vehicleId && existing?.vehicle_id != null) {
      vehicleId = Number(existing.vehicle_id);
    }

    if (!vehicleId && listing) {
      vehicleId = await createVehicleRecord(
        {
          ownerUserId: Number(listing.user_id),
          businessId: listing.business_id == null ? null : Number(listing.business_id),
          vehicleType: d.vehicleType,
          makeId: d.makeId ?? null,
          modelId: d.modelId ?? null,
          variantId: d.variantId ?? null,
          makeName: d.makeName ?? null,
          modelName: d.modelName ?? null,
          variantName: d.variantName ?? null,
          trim: d.trim ?? null,
          generation: d.generation ?? null,
          year: d.year ?? null,
          modelYear: d.modelYear ?? null,
          manufacturingDate: d.manufacturingDate ?? null,
          countryOfManufacture: d.countryOfManufacture ?? null,
          bodyType: d.bodyType ?? null,
          colorExterior: d.colorExterior ?? null,
          colorInterior: d.colorInterior ?? null,
          colorFamily: d.colorFamily ?? null,
          vehicleCondition: d.vehicleCondition ?? null,
          engineType: d.engineType ?? null,
          engineCc: d.engineCc ?? null,
          cylinders: d.cylinders ?? null,
          powerHp: d.powerHp ?? null,
          torqueNm: d.torqueNm ?? null,
          engineNumber: d.engineNumber ?? null,
          fuelType: d.fuelType ?? null,
          transmission: d.transmission ?? null,
          drivetrain: d.drivetrain ?? null,
          batteryKwh: d.batteryKwh ?? null,
          batteryHealthPct: d.batteryHealthPct ?? null,
          rangeKm: d.rangeKm ?? null,
          chargingType: d.chargingType ?? null,
          chargingTimeHours: d.chargingTimeHours ?? null,
          acCharging: d.acCharging,
          dcCharging: d.dcCharging,
          fastCharging: d.fastCharging,
          batteryWarrantyMonths: d.batteryWarrantyMonths ?? null,
          doors: d.doors ?? null,
          seats: d.seats ?? null,
          countryId: Number(listing.country_id ?? 1),
          regionId: listing.region_id == null ? null : Number(listing.region_id),
          cityId: listing.city_id == null ? null : Number(listing.city_id),
          latitude: listing.latitude == null ? null : Number(listing.latitude),
          longitude: listing.longitude == null ? null : Number(listing.longitude),
          seedListingId: listingId,
          vin: d.vin ?? null,
          featureIds: d.featureIds,
        },
        connection,
      );
    }
    d.vehicleId = vehicleId ?? undefined;

    const columns = {
      listing_id: listingId,
      vehicle_id: vehicleId,
      vehicle_type: d.vehicleType,
      make_id: d.makeId ?? null,
      model_id: d.modelId ?? null,
      variant_id: d.variantId ?? null,
      make_name: d.makeName ?? null,
      model_name: d.modelName ?? null,
      variant_name: d.variantName ?? null,
      trim: d.trim ?? null,
      year: d.year ?? null,
      model_year: d.modelYear ?? null,
      generation: d.generation ?? null,
      manufacturing_date: d.manufacturingDate ?? null,
      country_of_manufacture: d.countryOfManufacture ?? null,
      mileage: d.mileage ?? null,
      mileage_unit: d.mileageUnit,
      mileage_km: d.mileageKm ?? null,
      engine_hours: d.engineHours ?? null,
      engine_cc: d.engineCc ?? null,
      engine_type: d.engineType ?? null,
      power_hp: d.powerHp ?? null,
      torque_nm: d.torqueNm ?? null,
      cylinders: d.cylinders ?? null,
      fuel_type: d.fuelType ?? null,
      transmission: d.transmission ?? null,
      drivetrain: d.drivetrain ?? null,
      battery_kwh: d.batteryKwh ?? null,
      range_km: d.rangeKm ?? null,
      battery_health_pct: d.batteryHealthPct ?? null,
      charging_type: d.chargingType ?? null,
      charging_time_hours: d.chargingTimeHours ?? null,
      ac_charging: d.acCharging ? 1 : 0,
      dc_charging: d.dcCharging ? 1 : 0,
      fast_charging: d.fastCharging ? 1 : 0,
      battery_warranty_months: d.batteryWarrantyMonths ?? null,
      body_type: d.bodyType ?? null,
      color_exterior: d.colorExterior ?? null,
      color_interior: d.colorInterior ?? null,
      color_family: d.colorFamily ?? null,
      doors: d.doors ?? null,
      seats: d.seats ?? null,
      axles: d.axles ?? null,
      wheels: d.wheels ?? null,
      length_ft: d.lengthFt ?? null,
      capacity_tons: d.capacityTons ?? null,
      passenger_capacity: d.passengerCapacity ?? null,
      vin: d.vin ?? null,
      chassis_number: d.chassisNumber ?? null,
      engine_number: d.engineNumber ?? null,
      registration_number: d.registrationNumber ?? null,
      registration_city_id: d.registrationCityId ?? null,
      registration_year: d.registrationYear ?? null,
      registration_status: d.registrationStatus ?? null,
      is_imported: d.isImported ? 1 : 0,
      import_year: d.importYear ?? null,
      assembly: d.assembly ?? null,
      hand_drive: d.handDrive ?? null,
      condition_grade: d.conditionGrade ?? null,
      vehicle_condition: d.vehicleCondition ?? null,
      owners_count: d.ownersCount ?? null,
      accident_history: d.accidentHistory ?? null,
      accident_details: d.accidentDetails ?? null,
      service_history: d.serviceHistory ?? null,
      last_service_km: d.lastServiceKm ?? null,
      last_service_at: d.lastServiceAt ?? null,
      tyre_condition: d.tyreCondition ?? null,
      has_modifications: d.hasModifications ? 1 : 0,
      modification_details: d.modificationDetails ?? null,
      insurance_status: d.insuranceStatus ?? null,
      insurance_expiry: d.insuranceExpiry ?? null,
      tax_paid_until: d.taxPaidUntil ?? null,
      has_warranty: d.hasWarranty ? 1 : 0,
      warranty_until: d.warrantyUntil ?? null,
      warranty_km: d.warrantyKm ?? null,
      exchange_accepted: d.exchangeAccepted ? 1 : 0,
      finance_available: d.financeAvailable ? 1 : 0,
      down_payment: d.downPayment ?? null,
      monthly_installment: d.monthlyInstallment ?? null,
      installment_months: d.installmentMonths ?? null,
      rent_period: d.rentPeriod ?? null,
      with_driver: d.withDriver ? 1 : 0,
      driver_optional: d.driverOptional ? 1 : 0,
      fuel_policy: d.fuelPolicy ?? null,
      km_limit_per_day: d.kmLimitPerDay ?? null,
      extra_km_rate: d.extraKmRate ?? null,
      security_deposit: d.securityDeposit ?? null,
      min_rental_period: d.minRentalPeriod ?? null,
      min_driver_age: d.minDriverAge ?? null,
      license_required: d.licenseRequired ? 1 : 0,
      price_vs_market_pct: d.priceVsMarketPct ?? null,
      depreciation_pct: d.depreciationPct ?? null,
      deal_rating: d.dealRating ?? null,
    };

    const updatable = Object.keys(columns).filter((column) => column !== 'listing_id');
    const { sql, params } = buildUpsert(this.detailTable, columns, updatable);
    await execute(sql, params, connection);

    // An absent `featureIds` means "not part of this edit"; an empty array means
    // "the seller cleared them", so only touch the table when the key is present.
    if (d.featureIds) {
      await execute('DELETE FROM vehicle_listing_features WHERE listing_id = ?', [listingId], connection);
      const unique = [...new Set(d.featureIds)];
      if (unique.length > 0) {
        const insert = buildBulkInsert(
          'vehicle_listing_features',
          ['listing_id', 'feature_id'],
          unique.map((featureId) => [listingId, featureId]),
        );
        await execute(insert.sql, insert.params, connection);
      }
    }
  }

  async loadDetails(listingId: number): Promise<Record<string, unknown> | null> {
    const details = await this.loadDetailsBatch([listingId]);
    return details.get(listingId) ?? null;
  }

  async loadDetailsBatch(listingIds: number[]): Promise<Map<number, Record<string, unknown>>> {
    if (listingIds.length === 0) return new Map();
    const placeholders = listingIds.map(() => '?').join(', ');
    const [rows, featureRows] = await Promise.all([
      queryRows<Row>(`SELECT * FROM ${this.detailTable} WHERE listing_id IN (${placeholders})`, listingIds),
      queryRows<Row>(
        `SELECT listing_id, feature_id FROM vehicle_listing_features WHERE listing_id IN (${placeholders})`,
        listingIds,
      ),
    ]);

    const featuresByListing = new Map<number, number[]>();
    for (const row of featureRows) {
      const key = Number(row.listing_id);
      const existing = featuresByListing.get(key);
      if (existing) existing.push(Number(row.feature_id));
      else featuresByListing.set(key, [Number(row.feature_id)]);
    }

    return new Map(
      rows.map((row) => {
        const listingId = Number(row.listing_id);
        return [listingId, { ...mapVehicleRow(row), featureIds: featuresByListing.get(listingId) ?? [] }];
      }),
    );
  }

  joinClause(): string {
    return `LEFT JOIN ${this.detailTable} vd ON vd.listing_id = l.id`;
  }

  /** §10 filters, vehicle flavour. */
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
    const text = (key: string): string | undefined => {
      const raw = Array.isArray(q[key]) ? q[key]?.[0] : q[key];
      return raw === undefined || raw.trim().length === 0 ? undefined : raw.trim();
    };
    const ids = (key: string): number[] | undefined => list(key)?.map(Number).filter(Number.isFinite);

    builder.in('vd.vehicle_type', list('vehicleType'));
    builder.in('vd.make_id', ids('makeId'));
    builder.in('vd.model_id', ids('modelId'));
    builder.in('vd.variant_id', ids('variantId'));
    builder.between('vd.year', num('yearMin'), num('yearMax'));

    // A buyer in a miles market filters in miles; the column is kilometres.
    const mileageFactor = text('mileageUnit')?.toLowerCase() === 'mi' ? MILES_TO_KM : 1;
    const mileageMin = num('mileageMin');
    const mileageMax = num('mileageMax');
    builder.between(
      'vd.mileage_km',
      mileageMin === undefined ? undefined : Math.round(mileageMin * mileageFactor),
      mileageMax === undefined ? undefined : Math.round(mileageMax * mileageFactor),
    );

    builder.between('vd.engine_cc', num('engineMin'), num('engineMax'));
    builder.gte('vd.power_hp', num('powerMin'));
    builder.in('vd.fuel_type', list('fuelType'));
    builder.in('vd.transmission', list('transmission'));
    builder.in('vd.drivetrain', list('drivetrain'));
    builder.in('vd.body_type', list('bodyType'));
    builder.in('vd.color_family', list('colorFamily'));
    builder.gte('vd.seats', num('seatsMin'));
    builder.gte('vd.doors', num('doorsMin'));
    builder.eq('vd.registration_city_id', num('registrationCityId'));
    builder.in('vd.registration_status', list('registrationStatus'));
    builder.in('vd.assembly', list('assembly'));
    builder.in('vd.condition_grade', list('conditionGrade'));
    builder.in('vd.vehicle_condition', list('vehicleCondition'));
    builder.in('vd.accident_history', list('accidentHistory'));
    builder.in('vd.service_history', list('serviceHistory'));
    builder.lte('vd.owners_count', num('ownersMax'));
    builder.bool('vd.is_inspected', flag('inspected'));
    builder.gte('vd.inspection_score', num('inspectionScoreMin'));
    builder.in('vd.deal_rating', list('dealRating'));
    builder.bool('vd.finance_available', flag('financeAvailable'));
    builder.bool('vd.exchange_accepted', flag('exchangeAccepted'));
    builder.bool('vd.has_warranty', flag('hasWarranty'));
    builder.bool('vd.with_driver', flag('withDriver'));
    builder.in('vd.rent_period', list('rentPeriod'));
    builder.gte('vd.battery_kwh', num('batteryMin'));
    builder.gte('vd.range_km', num('rangeMin'));

    // Features are AND-ed: "sunroof AND cruise control" must return only
    // listings with both, which a single IN over the join table cannot express.
    const featureIds = ids('features')?.slice(0, 12);
    for (const featureId of featureIds ?? []) {
      builder.raw(
        'EXISTS (SELECT 1 FROM vehicle_listing_features vlf WHERE vlf.listing_id = l.id AND vlf.feature_id = ?)',
        featureId,
      );
    }
  }

  sortOptions(): SortOption[] {
    return [
      { code: 'mileage_asc', label: 'Mileage: lowest first', expression: 'vd.mileage_km', direction: 'ASC' },
      { code: 'mileage_desc', label: 'Mileage: highest first', expression: 'vd.mileage_km', direction: 'DESC' },
      { code: 'year_desc', label: 'Year: newest first', expression: 'vd.year', direction: 'DESC' },
      { code: 'year_asc', label: 'Year: oldest first', expression: 'vd.year', direction: 'ASC' },
      { code: 'engine_desc', label: 'Engine: largest first', expression: 'vd.engine_cc', direction: 'DESC' },
      { code: 'engine_asc', label: 'Engine: smallest first', expression: 'vd.engine_cc', direction: 'ASC' },
      { code: 'inspection_desc', label: 'Inspection score: highest', expression: 'vd.inspection_score', direction: 'DESC' },
      { code: 'best_deal', label: 'Best value vs market', expression: 'vd.price_vs_market_pct', direction: 'ASC' },
      { code: 'power_desc', label: 'Power: most first', expression: 'vd.power_hp', direction: 'DESC' },
    ];
  }

  /**
   * §15 Compare — the table spec lines 1–2 are about: a PakWheels-style manual
   * comparison of 3–4 vehicles, and the same rows feed the AI auto-compare.
   *
   * `topSpeedKmh`, `acceleration0100` and `mileageCity` are reference figures
   * for the variant rather than facts about the individual vehicle, so they are
   * resolved from `vehicle_variants` via `variantId` instead of the detail row.
   */
  comparableFields(): CompareField[] {
    return [
      { code: 'price', label: 'Price', source: 'listing', column: 'price', kind: 'money', better: 'lower', group: 'Price', alwaysShow: true },
      { code: 'priceVsMarketPct', label: 'Vs market', source: 'detail', column: 'price_vs_market_pct', kind: 'number', unit: '%', better: 'lower', group: 'Price' },
      { code: 'dealRating', label: 'Deal rating', source: 'detail', column: 'deal_rating', kind: 'enum', better: 'none', group: 'Price' },
      { code: 'monthlyInstallment', label: 'Monthly installment', source: 'detail', column: 'monthly_installment', kind: 'money', better: 'lower', group: 'Price' },

      { code: 'makeName', label: 'Make', source: 'detail', column: 'make_name', kind: 'text', better: 'none', group: 'Identity', alwaysShow: true },
      { code: 'modelName', label: 'Model', source: 'detail', column: 'model_name', kind: 'text', better: 'none', group: 'Identity', alwaysShow: true },
      { code: 'variantName', label: 'Variant', source: 'detail', column: 'variant_name', kind: 'text', better: 'none', group: 'Identity' },
      { code: 'year', label: 'Year', source: 'detail', column: 'year', kind: 'number', better: 'higher', group: 'Identity', alwaysShow: true },
      { code: 'generation', label: 'Generation', source: 'detail', column: 'generation', kind: 'text', better: 'none', group: 'Identity' },

      { code: 'engineCc', label: 'Engine', source: 'detail', column: 'engine_cc', kind: 'number', unit: 'cc', better: 'higher', group: 'Engine', alwaysShow: true },
      { code: 'powerHp', label: 'Power', source: 'detail', column: 'power_hp', kind: 'number', unit: 'hp', better: 'higher', group: 'Engine' },
      { code: 'torqueNm', label: 'Torque', source: 'detail', column: 'torque_nm', kind: 'number', unit: 'Nm', better: 'higher', group: 'Engine' },
      { code: 'cylinders', label: 'Cylinders', source: 'detail', column: 'cylinders', kind: 'number', better: 'none', group: 'Engine' },
      { code: 'fuelType', label: 'Fuel', source: 'detail', column: 'fuel_type', kind: 'enum', better: 'none', group: 'Engine', alwaysShow: true },
      { code: 'transmission', label: 'Transmission', source: 'detail', column: 'transmission', kind: 'enum', better: 'none', group: 'Engine', alwaysShow: true },
      { code: 'drivetrain', label: 'Drivetrain', source: 'detail', column: 'drivetrain', kind: 'enum', better: 'none', group: 'Engine' },

      { code: 'batteryKwh', label: 'Battery', source: 'detail', column: 'battery_kwh', kind: 'number', unit: 'kWh', better: 'higher', group: 'Electric' },
      { code: 'rangeKm', label: 'Range', source: 'detail', column: 'range_km', kind: 'number', unit: 'km', better: 'higher', group: 'Electric' },
      { code: 'batteryHealthPct', label: 'Battery health', source: 'detail', column: 'battery_health_pct', kind: 'number', unit: '%', better: 'higher', group: 'Electric' },

      { code: 'mileageCity', label: 'Fuel economy (city)', source: 'computed', kind: 'number', unit: 'km/l', better: 'higher', group: 'Performance & economy' },
      { code: 'topSpeedKmh', label: 'Top speed', source: 'computed', kind: 'number', unit: 'km/h', better: 'higher', group: 'Performance & economy' },
      { code: 'acceleration0100', label: '0–100 km/h', source: 'computed', kind: 'number', unit: 's', better: 'lower', group: 'Performance & economy' },

      { code: 'mileageKm', label: 'Odometer', source: 'detail', column: 'mileage_km', kind: 'number', unit: 'km', better: 'lower', group: 'Usage', alwaysShow: true },
      { code: 'engineHours', label: 'Engine hours', source: 'detail', column: 'engine_hours', kind: 'number', unit: 'h', better: 'lower', group: 'Usage' },
      { code: 'ownersCount', label: 'Previous owners', source: 'detail', column: 'owners_count', kind: 'number', better: 'lower', group: 'Usage' },

      { code: 'bodyType', label: 'Body', source: 'detail', column: 'body_type', kind: 'enum', better: 'none', group: 'Body' },
      { code: 'colorExterior', label: 'Exterior colour', source: 'detail', column: 'color_exterior', kind: 'text', better: 'none', group: 'Body' },
      { code: 'colorInterior', label: 'Interior colour', source: 'detail', column: 'color_interior', kind: 'text', better: 'none', group: 'Body' },
      { code: 'doors', label: 'Doors', source: 'detail', column: 'doors', kind: 'number', better: 'none', group: 'Body' },
      { code: 'seats', label: 'Seats', source: 'detail', column: 'seats', kind: 'number', better: 'higher', group: 'Body' },

      { code: 'conditionGrade', label: 'Condition', source: 'detail', column: 'condition_grade', kind: 'enum', better: 'none', group: 'Condition' },
      // "none" is the winning value here, which the renderer resolves from the enum order.
      { code: 'accidentHistory', label: 'Accident history', source: 'detail', column: 'accident_history', kind: 'enum', better: 'lower', group: 'Condition' },
      { code: 'serviceHistory', label: 'Service history', source: 'detail', column: 'service_history', kind: 'enum', better: 'none', group: 'Condition' },
      { code: 'tyreCondition', label: 'Tyres', source: 'detail', column: 'tyre_condition', kind: 'enum', better: 'none', group: 'Condition' },
      { code: 'hasModifications', label: 'Modified', source: 'detail', column: 'has_modifications', kind: 'boolean', better: 'lower', group: 'Condition' },
      { code: 'inspectionScore', label: 'Inspection score', source: 'detail', column: 'inspection_score', kind: 'rating', better: 'higher', group: 'Condition' },
      { code: 'inspectionGrade', label: 'Inspection grade', source: 'detail', column: 'inspection_grade', kind: 'text', better: 'none', group: 'Condition' },

      { code: 'registrationStatus', label: 'Registration', source: 'detail', column: 'registration_status', kind: 'enum', better: 'none', group: 'Paperwork' },
      { code: 'registrationYear', label: 'Registered in', source: 'detail', column: 'registration_year', kind: 'number', better: 'higher', group: 'Paperwork' },
      { code: 'assembly', label: 'Assembly', source: 'detail', column: 'assembly', kind: 'enum', better: 'none', group: 'Paperwork' },
      { code: 'isImported', label: 'Imported', source: 'detail', column: 'is_imported', kind: 'boolean', better: 'none', group: 'Paperwork' },
      { code: 'insuranceStatus', label: 'Insurance', source: 'detail', column: 'insurance_status', kind: 'enum', better: 'none', group: 'Paperwork' },
      { code: 'taxPaidUntil', label: 'Token tax paid until', source: 'detail', column: 'tax_paid_until', kind: 'date', better: 'higher', group: 'Paperwork' },
      { code: 'hasWarranty', label: 'Warranty', source: 'detail', column: 'has_warranty', kind: 'boolean', better: 'higher', group: 'Paperwork' },

      { code: 'financeAvailable', label: 'Finance available', source: 'detail', column: 'finance_available', kind: 'boolean', better: 'higher', group: 'Terms' },
      { code: 'downPayment', label: 'Down payment', source: 'detail', column: 'down_payment', kind: 'money', better: 'lower', group: 'Terms' },
      { code: 'exchangeAccepted', label: 'Exchange accepted', source: 'detail', column: 'exchange_accepted', kind: 'boolean', better: 'higher', group: 'Terms' },
    ];
  }

  pricingModel(): PricingModel {
    return {
      breakdown: (raw: Record<string, unknown>): PricingBreakdownLine[] => {
        const price = toNumber(raw.price) ?? 0;
        const rentPeriod = (raw.rentPeriod ?? raw.rent_period) as string | null;
        const lines: PricingBreakdownLine[] = [];

        if (price > 0) {
          lines.push({
            code: 'base',
            label: rentPeriod ? `Rate (${rentPeriod.replace(/_/g, ' ')})` : 'Price',
            amount: round(price),
            kind: 'base',
          });
        }

        const downPayment = toNumber(raw.downPayment ?? raw.down_payment) ?? 0;
        const installment = toNumber(raw.monthlyInstallment ?? raw.monthly_installment) ?? 0;
        const months = toNumber(raw.installmentMonths ?? raw.installment_months) ?? 0;
        if (downPayment > 0) {
          lines.push({ code: 'down_payment', label: 'Down payment', amount: round(downPayment), kind: 'charge' });
        }
        if (installment > 0 && months > 0) {
          // Informational: the financed total is what the buyer actually pays,
          // and it is almost always well above the cash price on the card.
          lines.push({
            code: 'installments',
            label: `Installments (${months} × ${round(installment)})`,
            amount: round(installment * months),
            kind: 'charge',
          });
        }

        const deposit = toNumber(raw.securityDeposit ?? raw.security_deposit) ?? 0;
        if (rentPeriod && deposit > 0) {
          lines.push({ code: 'deposit', label: 'Security deposit', amount: round(deposit), kind: 'charge' });
        }
        const extraKmRate = toNumber(raw.extraKmRate ?? raw.extra_km_rate) ?? 0;
        if (rentPeriod && extraKmRate > 0) {
          const kmLimit = toNumber(raw.kmLimitPerDay ?? raw.km_limit_per_day);
          lines.push({
            code: 'extra_km',
            label: kmLimit ? `Beyond ${kmLimit} km/day, per km` : 'Extra km, per km',
            amount: round(extraKmRate),
            kind: 'charge',
          });
        }

        return lines;
      },
      // A vehicle has no unit to divide by: per-kilometre or per-cc would be
      // meaningless to a buyer, unlike price per gram or per square metre.
      unitPrice: () => null,
    };
  }

  router() {
    return vehiclesRouter;
  }

  async onPublished(listingId: number, _connection: PoolConnection): Promise<void> {
    await onVehiclePublished(listingId).catch(() => undefined);
  }
}

/** Row → API shape. DECIMALs arrive as strings; convert only what the client needs numeric. */
function mapVehicleRow(row: Row): Record<string, unknown> {
  return {
    vehicleId: toInt(row.vehicle_id),
    vehicleType: row.vehicle_type,
    makeId: toInt(row.make_id),
    modelId: toInt(row.model_id),
    variantId: toInt(row.variant_id),
    makeName: row.make_name,
    modelName: row.model_name,
    variantName: row.variant_name,
    year: toInt(row.year),
    modelYear: toInt(row.model_year),
    trim: row.trim,
    generation: row.generation,
    manufacturingDate: toDateString(row.manufacturing_date),
    countryOfManufacture: toInt(row.country_of_manufacture),
    mileage: toInt(row.mileage),
    mileageUnit: row.mileage_unit,
    mileageKm: toInt(row.mileage_km),
    engineHours: toInt(row.engine_hours),
    engineCc: toInt(row.engine_cc),
    engineType: row.engine_type,
    powerHp: toInt(row.power_hp),
    torqueNm: toInt(row.torque_nm),
    cylinders: toInt(row.cylinders),
    fuelType: row.fuel_type,
    transmission: row.transmission,
    drivetrain: row.drivetrain,
    batteryKwh: toNumber(row.battery_kwh),
    rangeKm: toInt(row.range_km),
    batteryHealthPct: toNumber(row.battery_health_pct),
    chargingType: row.charging_type,
    chargingTimeHours: toNumber(row.charging_time_hours),
    acCharging: row.ac_charging === 1,
    dcCharging: row.dc_charging === 1,
    fastCharging: row.fast_charging === 1,
    batteryWarrantyMonths: toInt(row.battery_warranty_months),
    bodyType: row.body_type,
    colorExterior: row.color_exterior,
    colorInterior: row.color_interior,
    colorFamily: row.color_family,
    doors: toInt(row.doors),
    seats: toInt(row.seats),
    axles: toInt(row.axles),
    wheels: toInt(row.wheels),
    lengthFt: toNumber(row.length_ft),
    capacityTons: toNumber(row.capacity_tons),
    passengerCapacity: toInt(row.passenger_capacity),
    vin: row.vin,
    chassisNumber: row.chassis_number,
    engineNumber: row.engine_number,
    registrationNumber: row.registration_number,
    registrationCityId: toInt(row.registration_city_id),
    registrationYear: toInt(row.registration_year),
    registrationStatus: row.registration_status,
    isImported: row.is_imported === 1,
    importYear: toInt(row.import_year),
    assembly: row.assembly,
    handDrive: row.hand_drive,
    conditionGrade: row.condition_grade,
    vehicleCondition: row.vehicle_condition,
    ownersCount: toInt(row.owners_count),
    accidentHistory: row.accident_history,
    accidentDetails: row.accident_details,
    serviceHistory: row.service_history,
    lastServiceKm: toInt(row.last_service_km),
    lastServiceAt: toDateString(row.last_service_at),
    tyreCondition: row.tyre_condition,
    hasModifications: row.has_modifications === 1,
    modificationDetails: row.modification_details,
    isInspected: row.is_inspected === 1,
    inspectionScore: toNumber(row.inspection_score),
    inspectionGrade: row.inspection_grade,
    inspectionReportUrl: row.inspection_report_url,
    inspectedAt: toIsoString(row.inspected_at),
    inspectedBy: row.inspected_by,
    insuranceStatus: row.insurance_status,
    insuranceExpiry: toDateString(row.insurance_expiry),
    taxPaidUntil: toDateString(row.tax_paid_until),
    hasWarranty: row.has_warranty === 1,
    warrantyUntil: toDateString(row.warranty_until),
    warrantyKm: toInt(row.warranty_km),
    exchangeAccepted: row.exchange_accepted === 1,
    financeAvailable: row.finance_available === 1,
    downPayment: toNumber(row.down_payment),
    monthlyInstallment: toNumber(row.monthly_installment),
    installmentMonths: toInt(row.installment_months),
    rentPeriod: row.rent_period,
    withDriver: row.with_driver === 1,
    driverOptional: row.driver_optional === 1,
    fuelPolicy: row.fuel_policy,
    kmLimitPerDay: toInt(row.km_limit_per_day),
    extraKmRate: toNumber(row.extra_km_rate),
    securityDeposit: toNumber(row.security_deposit),
    minRentalPeriod: toInt(row.min_rental_period),
    minDriverAge: toInt(row.min_driver_age),
    licenseRequired: row.license_required === 1,
    aiEstimateLow: toNumber(row.ai_estimate_low),
    aiEstimateMid: toNumber(row.ai_estimate_mid),
    aiEstimateHigh: toNumber(row.ai_estimate_high),
    priceVsMarketPct: toNumber(row.price_vs_market_pct),
    depreciationPct: toNumber(row.depreciation_pct),
    dealRating: row.deal_rating,
  };
}

const toInt = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** DATE columns come back as Date objects; the API contract is a plain YYYY-MM-DD. */
const toDateString = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString().slice(0, 10) : (value as string | null) ?? null;

const toIsoString = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : (value as string | null) ?? null;

export const vehiclesModule = new VehicleMarketplaceModule();
