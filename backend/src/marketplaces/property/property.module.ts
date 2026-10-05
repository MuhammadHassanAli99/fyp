import { z } from 'zod';
import type { PoolConnection } from '../../db/pool';
import { queryRows, execute, queryOne, type Row } from '../../db/query';
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
import { propertyRouter } from './property.routes';
import { AREA_TO_SQM_NUMBER, fromSqm, toSqm, toSqmDecimal } from './property.area';
import { getTypeRule } from './property.catalog';
import { isTypeOperationAllowed } from './property.rules';
import { createPropertyRecord } from './property.assets';
import { onPropertyPublished } from './property.jobs';
import { getMapProvider } from '../../providers/maps';

export { AREA_TO_SQM_NUMBER as AREA_TO_SQM, fromSqm, toSqm } from './property.area';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Built forms — a covered area is expected on these, and bedrooms make sense. */
const BUILT_KINDS = ['house', 'apartment', 'flat', 'villa', 'penthouse', 'studio', 'townhouse', 'farm_house'] as const;
const LAND_KINDS = ['residential_plot', 'commercial_plot', 'agricultural_land', 'industrial_land'] as const;

/** propertyKind → usageType, so the seller never has to answer a question we can infer. */
const KIND_TO_USAGE: Record<string, 'residential' | 'commercial' | 'rental' | 'land' | 'industrial'> = {
  house: 'residential',
  apartment: 'residential',
  flat: 'residential',
  villa: 'residential',
  farm_house: 'residential',
  penthouse: 'residential',
  studio: 'residential',
  townhouse: 'residential',
  office: 'commercial',
  shop: 'commercial',
  warehouse: 'commercial',
  factory: 'commercial',
  building: 'commercial',
  plaza: 'commercial',
  room: 'rental',
  hotel: 'rental',
  guest_house: 'rental',
  hostel: 'rental',
  residential_plot: 'land',
  commercial_plot: 'land',
  agricultural_land: 'land',
  industrial_land: 'land',
};

const propertyDetailsSchema = z
  .object({
    propertyKind: z.enum([
      'house', 'apartment', 'flat', 'villa', 'farm_house', 'penthouse', 'studio', 'townhouse',
      'office', 'shop', 'warehouse', 'factory', 'building', 'plaza',
      'room', 'hotel', 'guest_house', 'hostel',
      'residential_plot', 'commercial_plot', 'agricultural_land', 'industrial_land', 'other',
    ]),
    usageType: z.enum(['residential', 'commercial', 'rental', 'land', 'industrial', 'mixed']).optional(),

    bedrooms: z.coerce.number().int().min(0).max(255).optional(),
    bathrooms: z.coerce.number().int().min(0).max(255).optional(),
    kitchens: z.coerce.number().int().min(0).max(255).optional(),
    drawingRooms: z.coerce.number().int().min(0).max(255).optional(),
    diningRooms: z.coerce.number().int().min(0).max(255).optional(),
    servantQuarters: z.coerce.number().int().min(0).max(255).optional(),
    storeRooms: z.coerce.number().int().min(0).max(255).optional(),
    totalRooms: z.coerce.number().int().min(0).max(255).optional(),

    floors: z.coerce.number().int().min(0).max(255).optional(),
    // Signed: basements and lower-ground units are legitimately negative.
    floorNumber: z.coerce.number().int().min(-30).max(300).optional(),
    totalFloors: z.coerce.number().int().min(0).max(255).optional(),
    basements: z.coerce.number().int().min(0).max(255).optional(),

    areaValue: z.coerce.number().positive().max(100_000_000).optional(),
    areaUnit: z.string().trim().max(24).optional(),
    coveredAreaValue: z.coerce.number().positive().max(100_000_000).optional(),
    coveredAreaUnit: z.string().trim().max(24).optional(),
    plotDimensions: z.string().trim().max(64).optional(),
    frontageFt: z.coerce.number().min(0).max(100_000).optional(),
    depthFt: z.coerce.number().min(0).max(100_000).optional(),

    parkingSpaces: z.coerce.number().int().min(0).max(255).optional(),
    hasGarage: z.coerce.boolean().default(false),
    hasGarden: z.coerce.boolean().default(false),
    gardenAreaSqm: z.coerce.number().min(0).max(10_000_000).optional(),
    balconies: z.coerce.number().int().min(0).max(255).optional(),
    hasTerrace: z.coerce.boolean().default(false),
    hasLawn: z.coerce.boolean().default(false),

    hasSwimmingPool: z.coerce.boolean().default(false),
    hasGym: z.coerce.boolean().default(false),
    hasElevator: z.coerce.boolean().default(false),
    hasSecurity: z.coerce.boolean().default(false),
    hasCctv: z.coerce.boolean().default(false),
    hasBackupPower: z.coerce.boolean().default(false),
    hasCentralHeating: z.coerce.boolean().default(false),
    hasCentralCooling: z.coerce.boolean().default(false),
    isGatedCommunity: z.coerce.boolean().default(false),
    isCorner: z.coerce.boolean().default(false),
    isParkFacing: z.coerce.boolean().default(false),
    wheelchairAccessible: z.coerce.boolean().default(false),

    furnishing: z.enum(['unfurnished', 'semi_furnished', 'furnished', 'fully_furnished']).optional(),
    /** Free list of what the furnishing actually includes ("bed", "ac", "kitchen appliances"). */
    furnishingDetails: z.array(z.string().trim().max(96)).max(60).optional(),

    yearBuilt: z.coerce.number().int().min(1800).max(2100).optional(),
    ageYears: z.coerce.number().int().min(0).max(255).optional(),
    constructionStatus: z.enum(['ready', 'under_construction', 'off_plan', 'grey_structure', 'renovated']).optional(),
    facing: z.enum(['north', 'south', 'east', 'west', 'north_east', 'north_west', 'south_east', 'south_west']).optional(),
    roadWidthFt: z.coerce.number().min(0).max(1000).optional(),
    buildingName: z.string().trim().max(160).optional(),
    unitNumber: z.string().trim().max(48).optional(),
    plotNumber: z.string().trim().max(48).optional(),
    blockSector: z.string().trim().max(96).optional(),
    phase: z.string().trim().max(96).optional(),
    societyName: z.string().trim().max(160).optional(),

    ownershipType: z.enum(['freehold', 'leasehold', 'power_of_attorney', 'allotment', 'shared', 'other']).optional(),
    possessionStatus: z.enum(['vacant', 'occupied', 'tenanted', 'immediate', 'on_transfer']).optional(),
    possessionDate: z.string().regex(ISO_DATE, 'Use the YYYY-MM-DD format').optional(),
    isApproved: z.coerce.boolean().default(false),
    approvalAuthority: z.string().trim().max(160).optional(),
    hasOwnershipPapers: z.coerce.boolean().default(false),
    hasMap: z.coerce.boolean().default(false),
    hasNoc: z.coerce.boolean().default(false),
    isDisputed: z.coerce.boolean().default(false),

    rentPeriod: z.enum(['monthly', 'weekly', 'daily', 'nightly', 'yearly', 'per_semester']).optional(),
    securityDeposit: z.coerce.number().min(0).optional(),
    advanceMonths: z.coerce.number().int().min(0).max(255).optional(),
    maintenanceCharges: z.coerce.number().min(0).optional(),
    maintenancePeriod: z.enum(['monthly', 'quarterly', 'yearly']).optional(),
    utilitiesIncluded: z.coerce.boolean().default(false),
    /** Which utilities the rent covers ("electricity", "water", "internet"). */
    utilitiesDetails: z.array(z.string().trim().max(96)).max(30).optional(),
    minStayDays: z.coerce.number().int().min(0).max(65_535).optional(),
    maxStayDays: z.coerce.number().int().min(0).max(65_535).optional(),
    availableFrom: z.string().regex(ISO_DATE, 'Use the YYYY-MM-DD format').optional(),

    occupancyType: z.enum(['single', 'double', 'triple', 'shared', 'dormitory', 'entire_place']).optional(),
    beds: z.coerce.number().int().min(0).max(255).optional(),
    attachedBathroom: z.coerce.boolean().default(false),
    tenantPreference: z.enum(['any', 'family', 'bachelor', 'female', 'male', 'student', 'corporate']).optional(),
    petsAllowed: z.coerce.boolean().default(false),
    smokingAllowed: z.coerce.boolean().default(false),
    mealsIncluded: z.coerce.boolean().default(false),

    floorLoadCapacity: z.coerce.number().min(0).max(100_000_000).optional(),
    ceilingHeightFt: z.coerce.number().min(0).max(1000).optional(),
    loadingDocks: z.coerce.number().int().min(0).max(255).optional(),
    threePhasePower: z.coerce.boolean().default(false),

    waterSource: z.enum(['tubewell', 'canal', 'rain', 'well', 'none']).optional(),
    soilType: z.string().trim().max(96).optional(),
    isCultivated: z.coerce.boolean().default(false),

    propertyId: z.coerce.number().int().positive().optional(),
    locationPrivacy: z.enum(['public_exact', 'approximate', 'private']).optional(),
    parkingAvailable: z.coerce.boolean().optional(),
    parkingCovered: z.coerce.number().int().min(0).max(255).optional(),
    parkingOpen: z.coerce.number().int().min(0).max(255).optional(),
    parkingBasement: z.coerce.number().int().min(0).max(255).optional(),
    plotAreaValue: z.coerce.number().positive().max(100_000_000).optional(),
    plotAreaUnit: z.string().trim().max(24).optional(),
    landAreaValue: z.coerce.number().positive().max(100_000_000).optional(),
    landAreaUnit: z.string().trim().max(24).optional(),
    lengthM: z.coerce.number().min(0).max(100_000).optional(),
    widthM: z.coerce.number().min(0).max(100_000).optional(),
    developmentStatus: z.enum(['raw', 'semi_developed', 'developed', 'other']).optional(),
    irrigation: z.string().trim().max(96).optional(),
    landUse: z.string().trim().max(96).optional(),
    warehouseCapacity: z.coerce.number().min(0).optional(),
    powerCapacityKva: z.coerce.number().min(0).optional(),
    hasGenerator: z.coerce.boolean().default(false),
    hasLoadingArea: z.coerce.boolean().default(false),
    officeRooms: z.coerce.number().int().min(0).max(255).optional(),
    meetingRooms: z.coerce.number().int().min(0).max(255).optional(),
    hasReception: z.coerce.boolean().default(false),
    accessHours: z.string().trim().max(64).optional(),
    checkInTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    checkOutTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    occupancyMax: z.coerce.number().int().min(1).max(255).optional(),
    leaseMinMonths: z.coerce.number().int().min(0).max(120).optional(),
    leaseMaxMonths: z.coerce.number().int().min(0).max(360).optional(),
    projectId: z.coerce.number().int().positive().optional(),
    unitId: z.coerce.number().int().positive().optional(),

    amenityIds: z.array(z.coerce.number().int().positive()).max(80).optional(),
  })
  .strip();

export type PropertyDetailsInput = z.infer<typeof propertyDetailsSchema>;

/** Everything `validateDetails` adds on top of the seller's payload. */
type PropertyDetails = PropertyDetailsInput & {
  areaSqm?: number;
  coveredAreaSqm?: number | null;
  pricePerSqm?: number | null;
  plotAreaSqm?: number | null;
  landAreaSqm?: number | null;
  propertyId?: number;
};

const round = (value: number, decimals = 2): number => Number(value.toFixed(decimals));

class PropertyMarketplaceModule implements MarketplaceModule {
  readonly code = 'property';
  readonly name = 'Property Marketplace';
  readonly detailTable = 'property_listing_details';
  readonly supportedOperations = ['buy', 'sell', 'rent', 'exchange'] as const;

  async validateDetails(
    input: unknown,
    context: { operation: string; categoryCode: string | null; countryId: number | null },
  ): Promise<ValidationResult> {
    const parsed = propertyDetailsSchema.safeParse(input ?? {});
    if (!parsed.success) {
      throw validationFailed(
        parsed.error.issues.map((issue) => ({
          field: `details.${issue.path.map(String).join('.')}`,
          message: issue.message,
          code: issue.code,
        })),
      );
    }

    const details = parsed.data as PropertyDetails;
    const warnings: string[] = [];

    const rule = await getTypeRule(details.propertyKind);
    if (rule) {
      if (!isTypeOperationAllowed(rule.allowedOperations, context.operation)) {
        throw validationFailed([
          {
            field: 'operation',
            message: `${context.operation} is not allowed for ${details.propertyKind}. Allowed: ${rule.allowedOperations.join(', ')}`,
          },
        ]);
      }
      if (rule.requiresBedrooms && details.bedrooms === undefined) {
        warnings.push('This property type is usually filtered by bedroom count');
      }
      if (rule.requiresCoveredArea && details.coveredAreaValue === undefined) {
        warnings.push('Covered area is expected for this property type');
      }
    }

    details.usageType ??= KIND_TO_USAGE[details.propertyKind] ?? 'mixed';
    if (context.operation === 'rent') {
      details.usageType = 'rental';
    }

    // Area: every listing must carry one, and it is normalised immediately so
    // that nothing downstream ever has to know what a marla is.
    if (details.areaValue === undefined || details.areaUnit === undefined) {
      throw validationFailed([
        { field: 'details.areaValue', message: 'Area and its unit are required for a property listing' },
      ]);
    }
    details.areaUnit = details.areaUnit.toLowerCase();
    details.areaSqm = round(toSqm(details.areaValue, details.areaUnit), 3);

    if (details.coveredAreaValue !== undefined) {
      details.coveredAreaUnit = (details.coveredAreaUnit ?? details.areaUnit).toLowerCase();
      details.coveredAreaSqm = round(toSqm(details.coveredAreaValue, details.coveredAreaUnit), 3);
      if (details.coveredAreaSqm > details.areaSqm) {
        throw validationFailed([
          { field: 'details.coveredAreaValue', message: 'Covered area cannot be larger than the total area' },
        ]);
      }
    }
    if (details.plotAreaValue !== undefined) {
      const unit = (details.plotAreaUnit ?? details.areaUnit).toLowerCase();
      details.plotAreaUnit = unit;
      details.plotAreaSqm = round(toSqm(details.plotAreaValue, unit), 3);
    }
    if (details.landAreaValue !== undefined) {
      const unit = (details.landAreaUnit ?? details.areaUnit).toLowerCase();
      details.landAreaUnit = unit;
      details.landAreaSqm = round(toSqm(details.landAreaValue, unit), 3);
    }

    if (details.yearBuilt !== undefined && details.ageYears === undefined) {
      details.ageYears = Math.max(0, new Date().getUTCFullYear() - details.yearBuilt);
    }

    if (context.operation === 'rent' && !details.rentPeriod) {
      throw validationFailed([
        { field: 'details.rentPeriod', message: 'Tell buyers what the rent is per — monthly, weekly, daily…' },
      ]);
    }

    // Upper bounds catch a slipped decimal point, not a genuinely large estate.
    if (details.bedrooms !== undefined && details.bedrooms > 50) {
      throw validationFailed([{ field: 'details.bedrooms', message: 'Bedrooms cannot exceed 50' }]);
    }
    if (details.bathrooms !== undefined && details.bathrooms > 50) {
      throw validationFailed([{ field: 'details.bathrooms', message: 'Bathrooms cannot exceed 50' }]);
    }
    if (details.floors !== undefined && details.floors > 200) {
      throw validationFailed([{ field: 'details.floors', message: 'Floors cannot exceed 200' }]);
    }

    const isBuilt = (BUILT_KINDS as readonly string[]).includes(details.propertyKind);
    const isLand = (LAND_KINDS as readonly string[]).includes(details.propertyKind);

    if (isBuilt && details.coveredAreaValue === undefined) {
      warnings.push('Buyers compare built property on covered area — adding it makes this listing far easier to shortlist');
    }
    if (details.usageType === 'residential' && details.bedrooms === undefined) {
      warnings.push('Bedroom count is the single most used residential filter; listings without it are rarely seen');
    }
    if (isLand && details.bedrooms !== undefined && details.bedrooms > 0) {
      warnings.push('This is a land listing but it declares bedrooms — buyers will read that as an error');
    }
    // A sale of a tenanted property turns on when the buyer can actually move in.
    if (context.operation !== 'rent' && details.possessionStatus === 'tenanted' && !details.availableFrom) {
      warnings.push('The property is tenanted — state when possession becomes available or buyers will assume the worst');
    }

    return { details: details as unknown as Record<string, unknown>, warnings };
  }

  /** Keeps the per-area column that powers sorting and "above/below area average" honest. */
  deriveComputedColumns(
    raw: Record<string, unknown>,
    listing: { price: number | null; currency: string | null },
  ): Record<string, unknown> {
    const details = raw as PropertyDetails;
    const areaSqm = details.areaSqm ?? 0;
    const price = listing.price ?? 0;
    // For a rental this is rent-per-m² *per rent period*, not a sale value; the
    // filter and sort only ever compare rentals against rentals, so the mixed
    // meaning never surfaces in a single result set.
    const pricePerSqm = areaSqm > 0 && price > 0 ? round(price / areaSqm, 4) : null;
    return { ...details, pricePerSqm };
  }

  async saveDetails(listingId: number, raw: Record<string, unknown>, connection: PoolConnection): Promise<void> {
    const d = raw as PropertyDetails;
    const listing = await queryOne<Row>(
      `SELECT user_id, business_id, country_id, region_id, city_id, area_id, latitude, longitude,
              postal_code, title
         FROM listings WHERE id = ?`,
      [listingId],
      connection,
    );

    let propertyId = d.propertyId ?? null;
    if (propertyId && listing) {
      const owned = await queryOne<Row>(
        'SELECT id, owner_user_id FROM properties WHERE id = ? AND deleted_at IS NULL',
        [propertyId],
        connection,
      );
      if (!owned || Number(owned.owner_user_id) !== Number(listing.user_id)) {
        throw validationFailed([
          { field: 'details.propertyId', message: 'You can only attach a property you own' },
        ]);
      }
    }

    const lat = listing?.latitude == null ? null : Number(listing.latitude);
    const lng = listing?.longitude == null ? null : Number(listing.longitude);
    const privacy = d.locationPrivacy ?? 'approximate';
    let publicLat: number | null = null;
    let publicLng: number | null = null;
    if (lat != null && lng != null) {
      if (privacy === 'public_exact') {
        publicLat = lat;
        publicLng = lng;
      } else {
        const approx = getMapProvider().approximate(lat, lng, listingId);
        publicLat = approx.latitude;
        publicLng = approx.longitude;
      }
    }

    const hospitality = ['hotel', 'guest_house', 'hostel', 'room', 'serviced_apartment'].includes(d.propertyKind);
    if (!propertyId && listing) {
      propertyId = await createPropertyRecord(
        {
          ownerUserId: Number(listing.user_id),
          businessId: listing.business_id == null ? null : Number(listing.business_id),
          propertyKind: d.propertyKind,
          usageType: hospitality ? 'hospitality' : (d.usageType ?? 'mixed'),
          title: (listing.title as string | null) ?? null,
          countryId: Number(listing.country_id),
          regionId: listing.region_id == null ? null : Number(listing.region_id),
          cityId: listing.city_id == null ? null : Number(listing.city_id),
          areaId: listing.area_id == null ? null : Number(listing.area_id),
          neighborhood: d.societyName ?? null,
          buildingName: d.buildingName ?? null,
          postalCode: (listing.postal_code as string | null) ?? null,
          latitude: lat,
          longitude: lng,
          locationPrivacy: privacy,
          projectId: d.projectId ?? null,
          unitId: d.unitId ?? null,
        },
        connection,
      );
    }
    d.propertyId = propertyId ?? undefined;

    const columns = {
      listing_id: listingId,
      property_id: propertyId,
      property_kind: d.propertyKind,
      usage_type: d.usageType ?? 'mixed',
      bedrooms: d.bedrooms ?? null,
      bathrooms: d.bathrooms ?? null,
      kitchens: d.kitchens ?? null,
      drawing_rooms: d.drawingRooms ?? null,
      dining_rooms: d.diningRooms ?? null,
      servant_quarters: d.servantQuarters ?? null,
      store_rooms: d.storeRooms ?? null,
      total_rooms: d.totalRooms ?? null,
      floors: d.floors ?? null,
      floor_number: d.floorNumber ?? null,
      total_floors: d.totalFloors ?? null,
      basements: d.basements ?? null,
      area_value: d.areaValue ?? null,
      area_unit: d.areaUnit ?? null,
      area_sqm: d.areaSqm ?? null,
      covered_area_value: d.coveredAreaValue ?? null,
      covered_area_unit: d.coveredAreaUnit ?? null,
      covered_area_sqm: d.coveredAreaSqm ?? null,
      plot_dimensions: d.plotDimensions ?? null,
      frontage_ft: d.frontageFt ?? null,
      depth_ft: d.depthFt ?? null,
      price_per_sqm: d.pricePerSqm ?? null,
      parking_spaces: d.parkingSpaces ?? null,
      has_garage: d.hasGarage ? 1 : 0,
      has_garden: d.hasGarden ? 1 : 0,
      garden_area_sqm: d.gardenAreaSqm ?? null,
      balconies: d.balconies ?? null,
      has_terrace: d.hasTerrace ? 1 : 0,
      has_lawn: d.hasLawn ? 1 : 0,
      has_swimming_pool: d.hasSwimmingPool ? 1 : 0,
      has_gym: d.hasGym ? 1 : 0,
      has_elevator: d.hasElevator ? 1 : 0,
      has_security: d.hasSecurity ? 1 : 0,
      has_cctv: d.hasCctv ? 1 : 0,
      has_backup_power: d.hasBackupPower ? 1 : 0,
      has_central_heating: d.hasCentralHeating ? 1 : 0,
      has_central_cooling: d.hasCentralCooling ? 1 : 0,
      is_gated_community: d.isGatedCommunity ? 1 : 0,
      is_corner: d.isCorner ? 1 : 0,
      is_park_facing: d.isParkFacing ? 1 : 0,
      wheelchair_accessible: d.wheelchairAccessible ? 1 : 0,
      furnishing: d.furnishing ?? null,
      furnishing_details: d.furnishingDetails ? JSON.stringify(d.furnishingDetails) : null,
      year_built: d.yearBuilt ?? null,
      age_years: d.ageYears ?? null,
      construction_status: d.constructionStatus ?? null,
      facing: d.facing ?? null,
      road_width_ft: d.roadWidthFt ?? null,
      building_name: d.buildingName ?? null,
      unit_number: d.unitNumber ?? null,
      plot_number: d.plotNumber ?? null,
      block_sector: d.blockSector ?? null,
      phase: d.phase ?? null,
      society_name: d.societyName ?? null,
      ownership_type: d.ownershipType ?? null,
      possession_status: d.possessionStatus ?? null,
      possession_date: d.possessionDate ?? null,
      is_approved: d.isApproved ? 1 : 0,
      approval_authority: d.approvalAuthority ?? null,
      has_ownership_papers: d.hasOwnershipPapers ? 1 : 0,
      has_map: d.hasMap ? 1 : 0,
      has_noc: d.hasNoc ? 1 : 0,
      is_disputed: d.isDisputed ? 1 : 0,
      rent_period: d.rentPeriod ?? null,
      security_deposit: d.securityDeposit ?? null,
      advance_months: d.advanceMonths ?? null,
      maintenance_charges: d.maintenanceCharges ?? null,
      maintenance_period: d.maintenancePeriod ?? null,
      utilities_included: d.utilitiesIncluded ? 1 : 0,
      utilities_details: d.utilitiesDetails ? JSON.stringify(d.utilitiesDetails) : null,
      min_stay_days: d.minStayDays ?? null,
      max_stay_days: d.maxStayDays ?? null,
      available_from: d.availableFrom ?? null,
      occupancy_type: d.occupancyType ?? null,
      beds: d.beds ?? null,
      attached_bathroom: d.attachedBathroom ? 1 : 0,
      tenant_preference: d.tenantPreference ?? null,
      pets_allowed: d.petsAllowed ? 1 : 0,
      smoking_allowed: d.smokingAllowed ? 1 : 0,
      meals_included: d.mealsIncluded ? 1 : 0,
      floor_load_capacity: d.floorLoadCapacity ?? null,
      ceiling_height_ft: d.ceilingHeightFt ?? null,
      loading_docks: d.loadingDocks ?? null,
      three_phase_power: d.threePhasePower ? 1 : 0,
      water_source: d.waterSource ?? null,
      soil_type: d.soilType ?? null,
      is_cultivated: d.isCultivated ? 1 : 0,
      parking_available: d.parkingAvailable ? 1 : d.parkingSpaces && d.parkingSpaces > 0 ? 1 : 0,
      parking_covered: d.parkingCovered ?? 0,
      parking_open: d.parkingOpen ?? 0,
      parking_basement: d.parkingBasement ?? 0,
      plot_area_value: d.plotAreaValue ?? null,
      plot_area_unit: d.plotAreaUnit ?? null,
      plot_area_sqm: d.plotAreaSqm ?? null,
      land_area_value: d.landAreaValue ?? null,
      land_area_unit: d.landAreaUnit ?? null,
      land_area_sqm: d.landAreaSqm ?? null,
      length_m: d.lengthM ?? null,
      width_m: d.widthM ?? null,
      development_status: d.developmentStatus ?? null,
      irrigation: d.irrigation ?? null,
      land_use: d.landUse ?? null,
      warehouse_capacity: d.warehouseCapacity ?? null,
      power_capacity_kva: d.powerCapacityKva ?? null,
      has_generator: d.hasGenerator ? 1 : 0,
      has_loading_area: d.hasLoadingArea ? 1 : 0,
      office_rooms: d.officeRooms ?? null,
      meeting_rooms: d.meetingRooms ?? null,
      has_reception: d.hasReception ? 1 : 0,
      access_hours: d.accessHours ?? null,
      check_in_time: d.checkInTime ?? null,
      check_out_time: d.checkOutTime ?? null,
      occupancy_max: d.occupancyMax ?? null,
      lease_min_months: d.leaseMinMonths ?? null,
      lease_max_months: d.leaseMaxMonths ?? null,
      public_latitude: publicLat,
      public_longitude: publicLng,
      location_privacy: privacy,
      project_id: d.projectId ?? null,
      unit_id: d.unitId ?? null,
    };

    const updatable = Object.keys(columns).filter((column) => column !== 'listing_id');
    const { sql, params } = buildUpsert(this.detailTable, columns, updatable);
    await execute(sql, params, connection);

    // An absent `amenityIds` means "not part of this edit"; an empty array means
    // "the seller cleared them", so only touch the table when the key is present.
    if (d.amenityIds) {
      await execute('DELETE FROM property_listing_amenities WHERE listing_id = ?', [listingId], connection);
      const unique = [...new Set(d.amenityIds)];
      if (unique.length > 0) {
        const insert = buildBulkInsert(
          'property_listing_amenities',
          ['listing_id', 'amenity_id'],
          unique.map((amenityId) => [listingId, amenityId]),
        );
        await execute(insert.sql, insert.params, connection);
      }
    }

    if (propertyId) {
      const areas: Array<{ type: string; value?: number; unit?: string; sqm?: number | null }> = [
        { type: 'plot', value: d.plotAreaValue, unit: d.plotAreaUnit ?? d.areaUnit, sqm: d.plotAreaSqm },
        { type: 'land', value: d.landAreaValue, unit: d.landAreaUnit ?? d.areaUnit, sqm: d.landAreaSqm },
        { type: 'covered', value: d.coveredAreaValue, unit: d.coveredAreaUnit ?? d.areaUnit, sqm: d.coveredAreaSqm },
      ];
      for (const area of areas) {
        if (area.value === undefined || !area.unit) continue;
        const sqm = area.sqm ?? Number(toSqmDecimal(area.value, area.unit));
        await execute(
          `INSERT INTO property_areas (property_id, area_type, value, unit, value_sqm)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value), unit = VALUES(unit), value_sqm = VALUES(value_sqm)`,
          [propertyId, area.type, area.value, area.unit, sqm],
          connection,
        );
      }
      const covered = d.parkingCovered ?? 0;
      const open = d.parkingOpen ?? 0;
      const basement = d.parkingBasement ?? 0;
      const total = d.parkingSpaces ?? covered + open + basement;
      if (d.parkingAvailable || total > 0) {
        await execute(
          `INSERT INTO property_parking
             (property_id, available, covered_spaces, open_spaces, basement_spaces, total_spaces)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             available = VALUES(available), covered_spaces = VALUES(covered_spaces),
             open_spaces = VALUES(open_spaces), basement_spaces = VALUES(basement_spaces),
             total_spaces = VALUES(total_spaces)`,
          [propertyId, d.parkingAvailable || total > 0 ? 1 : 0, covered, open, basement, total],
          connection,
        );
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
    const [rows, amenityRows] = await Promise.all([
      queryRows<Row>(`SELECT * FROM ${this.detailTable} WHERE listing_id IN (${placeholders})`, listingIds),
      queryRows<Row>(
        `SELECT listing_id, amenity_id FROM property_listing_amenities WHERE listing_id IN (${placeholders})`,
        listingIds,
      ),
    ]);

    const amenitiesByListing = new Map<number, number[]>();
    for (const row of amenityRows) {
      const key = Number(row.listing_id);
      const existing = amenitiesByListing.get(key);
      if (existing) existing.push(Number(row.amenity_id));
      else amenitiesByListing.set(key, [Number(row.amenity_id)]);
    }

    return new Map(
      rows.map((row) => {
        const listingId = Number(row.listing_id);
        return [listingId, { ...mapPropertyRow(row), amenityIds: amenitiesByListing.get(listingId) ?? [] }];
      }),
    );
  }

  joinClause(): string {
    return `LEFT JOIN ${this.detailTable} pd ON pd.listing_id = l.id`;
  }

  /** §10 filters, property flavour. */
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

    // The client filters in whatever unit it is showing — "5 to 10 marla" — and
    // we convert to m² here, because that is the only unit the column holds.
    const requestedUnit = text('areaUnit')?.toLowerCase();
    const unitFactor = (requestedUnit === undefined ? 1 : AREA_TO_SQM_NUMBER[requestedUnit]) ?? 1;
    const areaMin = num('areaMin');
    const areaMax = num('areaMax');
    builder.between(
      'pd.area_sqm',
      areaMin === undefined ? undefined : areaMin * unitFactor,
      areaMax === undefined ? undefined : areaMax * unitFactor,
    );
    // A per-marla ceiling is a per-m² ceiling divided by m² per marla.
    const pricePerAreaMax = num('pricePerAreaMax');
    builder.lte('pd.price_per_sqm', pricePerAreaMax === undefined ? undefined : pricePerAreaMax / unitFactor);

    builder.in('pd.property_kind', list('propertyKind'));
    const usage = list('usageType')?.filter((value) => value !== 'hospitality');
    builder.in('pd.usage_type', usage);
    builder.between('pd.bedrooms', num('bedroomsMin'), num('bedroomsMax'));
    builder.between('pd.bathrooms', num('bathroomsMin'), num('bathroomsMax'));
    builder.in('pd.furnishing', list('furnishing'));
    builder.in('pd.construction_status', list('constructionStatus'));
    builder.in('pd.ownership_type', list('ownershipType'));
    builder.in('pd.possession_status', list('possessionStatus'));
    builder.in('pd.facing', list('facing'));
    builder.in('pd.tenant_preference', list('tenantPreference'));
    builder.in('pd.occupancy_type', list('occupancyType'));
    builder.in('pd.rent_period', list('rentPeriod'));
    builder.between('pd.year_built', num('yearBuiltMin'), num('yearBuiltMax'));
    builder.between('pd.floors', num('floorsMin'), num('floorsMax'));
    builder.gte('pd.parking_spaces', num('parkingMin'));
    builder.contains('pd.society_name', text('societyName'));

    builder.bool('pd.has_swimming_pool', flag('swimmingPool'));
    builder.bool('pd.has_gym', flag('gym'));
    builder.bool('pd.has_garden', flag('garden'));
    builder.bool('pd.has_elevator', flag('elevator'));
    builder.bool('pd.has_security', flag('security'));
    builder.bool('pd.has_cctv', flag('cctv'));
    builder.bool('pd.has_backup_power', flag('backupPower'));
    builder.bool('pd.is_gated_community', flag('gatedCommunity'));
    builder.bool('pd.is_corner', flag('cornerPlot'));
    builder.bool('pd.is_park_facing', flag('parkFacing'));
    builder.bool('pd.pets_allowed', flag('petsAllowed'));
    builder.bool('pd.utilities_included', flag('utilitiesIncluded'));
    builder.bool('pd.has_ownership_papers', flag('ownershipPapers'));
    builder.bool('pd.has_noc', flag('noc'));
    builder.bool('pd.is_approved', flag('approved'));
    builder.bool('l.installments_available', flag('installments'));

    // Amenities are AND-ed: "pool AND gym" must return only listings with both,
    // which a single IN over the join table cannot express.
    const amenityIds = list('amenities')
      ?.map(Number)
      .filter(Number.isFinite)
      .slice(0, 12);
    for (const amenityId of amenityIds ?? []) {
      builder.raw(
        'EXISTS (SELECT 1 FROM property_listing_amenities pla WHERE pla.listing_id = l.id AND pla.amenity_id = ?)',
        amenityId,
      );
    }

    builder.bool('pd.parking_available', flag('parking'));
    if (flag('balcony')) {
      builder.raw('pd.balconies > 0');
    }
    const minLat = num('minLat');
    const maxLat = num('maxLat');
    const minLng = num('minLng');
    const maxLng = num('maxLng');
    if (minLat !== undefined && maxLat !== undefined) {
      builder.raw('COALESCE(pd.public_latitude, l.latitude) BETWEEN ? AND ?', minLat, maxLat);
    }
    if (minLng !== undefined && maxLng !== undefined) {
      builder.raw('COALESCE(pd.public_longitude, l.longitude) BETWEEN ? AND ?', minLng, maxLng);
    }
    if (flag('verifiedProperty')) {
      builder.raw(
        `EXISTS (SELECT 1 FROM property_verifications pv
                  WHERE pv.property_id = pd.property_id AND pv.dimension = 'ownership' AND pv.status = 'verified')`,
      );
    }
    if (flag('agency')) {
      builder.raw(
        `EXISTS (SELECT 1 FROM business_profiles bp WHERE bp.id = l.business_id AND bp.kind = 'agency')`,
      );
    }
    if (flag('builder')) {
      builder.raw(
        `EXISTS (SELECT 1 FROM business_profiles bp WHERE bp.id = l.business_id AND bp.kind = 'builder')`,
      );
    }
    if (flag('readyToMove')) {
      builder.raw(`pd.possession_status IN ('vacant','immediate')`);
    }
    if (flag('newConstruction')) {
      builder.raw(`pd.construction_status IN ('under_construction','off_plan','grey_structure')`);
    }
    const usageGroups = list('usageType');
    if (usageGroups?.includes('hospitality')) {
      builder.in('pd.property_kind', ['hotel', 'guest_house', 'hostel', 'room', 'serviced_apartment']);
    }
  }

  sortOptions(): SortOption[] {
    return [
      { code: 'area_desc', label: 'Area: largest first', expression: 'pd.area_sqm', direction: 'DESC' },
      { code: 'area_asc', label: 'Area: smallest first', expression: 'pd.area_sqm', direction: 'ASC' },
      { code: 'price_per_area_asc', label: 'Price per area: low to high', expression: 'pd.price_per_sqm', direction: 'ASC' },
      { code: 'price_per_area_desc', label: 'Price per area: high to low', expression: 'pd.price_per_sqm', direction: 'DESC' },
      { code: 'bedrooms_desc', label: 'Bedrooms: most first', expression: 'pd.bedrooms', direction: 'DESC' },
      { code: 'bedrooms_asc', label: 'Bedrooms: fewest first', expression: 'pd.bedrooms', direction: 'ASC' },
      { code: 'year_built_desc', label: 'Newest built', expression: 'pd.year_built', direction: 'DESC' },
      { code: 'available_soonest', label: 'Available soonest', expression: 'pd.available_from', direction: 'ASC' },
      { code: 'trust', label: 'Most trusted', expression: 'ts.score', direction: 'DESC' },
    ];
  }

  /** §15 Compare — the rows of the property comparison table (spec line 4). */
  comparableFields(): CompareField[] {
    return [
      { code: 'price', label: 'Price', source: 'listing', column: 'price', kind: 'money', better: 'lower', group: 'Price', alwaysShow: true },
      { code: 'pricePerSqm', label: 'Price per m²', source: 'computed', kind: 'money', better: 'lower', group: 'Price' },

      { code: 'areaSqm', label: 'Total area', source: 'detail', column: 'area_sqm', kind: 'number', unit: 'm²', better: 'higher', group: 'Size', alwaysShow: true },
      { code: 'coveredAreaSqm', label: 'Covered area', source: 'detail', column: 'covered_area_sqm', kind: 'number', unit: 'm²', better: 'higher', group: 'Size' },
      { code: 'plotDimensions', label: 'Plot dimensions', source: 'detail', column: 'plot_dimensions', kind: 'text', better: 'none', group: 'Size' },

      { code: 'bedrooms', label: 'Bedrooms', source: 'detail', column: 'bedrooms', kind: 'number', better: 'higher', group: 'Rooms', alwaysShow: true },
      { code: 'bathrooms', label: 'Bathrooms', source: 'detail', column: 'bathrooms', kind: 'number', better: 'higher', group: 'Rooms', alwaysShow: true },
      { code: 'kitchens', label: 'Kitchens', source: 'detail', column: 'kitchens', kind: 'number', better: 'higher', group: 'Rooms' },
      { code: 'floors', label: 'Floors', source: 'detail', column: 'floors', kind: 'number', better: 'higher', group: 'Rooms' },
      { code: 'floorNumber', label: 'On floor', source: 'detail', column: 'floor_number', kind: 'number', better: 'none', group: 'Rooms' },
      { code: 'totalFloors', label: 'Floors in building', source: 'detail', column: 'total_floors', kind: 'number', better: 'none', group: 'Rooms' },
      { code: 'parkingSpaces', label: 'Parking spaces', source: 'detail', column: 'parking_spaces', kind: 'number', better: 'higher', group: 'Rooms' },
      { code: 'balconies', label: 'Balconies', source: 'detail', column: 'balconies', kind: 'number', better: 'higher', group: 'Rooms' },

      { code: 'furnishing', label: 'Furnishing', source: 'detail', column: 'furnishing', kind: 'enum', better: 'none', group: 'Condition', alwaysShow: true },
      { code: 'constructionStatus', label: 'Construction', source: 'detail', column: 'construction_status', kind: 'enum', better: 'none', group: 'Condition' },
      { code: 'yearBuilt', label: 'Year built', source: 'detail', column: 'year_built', kind: 'number', better: 'higher', group: 'Condition' },
      { code: 'ageYears', label: 'Age', source: 'detail', column: 'age_years', kind: 'number', unit: 'years', better: 'lower', group: 'Condition' },
      { code: 'facing', label: 'Facing', source: 'detail', column: 'facing', kind: 'enum', better: 'none', group: 'Condition' },

      { code: 'hasSwimmingPool', label: 'Swimming pool', source: 'detail', column: 'has_swimming_pool', kind: 'boolean', better: 'higher', group: 'Amenities' },
      { code: 'hasGym', label: 'Gym', source: 'detail', column: 'has_gym', kind: 'boolean', better: 'higher', group: 'Amenities' },
      { code: 'hasGarden', label: 'Garden', source: 'detail', column: 'has_garden', kind: 'boolean', better: 'higher', group: 'Amenities' },
      { code: 'hasElevator', label: 'Elevator', source: 'detail', column: 'has_elevator', kind: 'boolean', better: 'higher', group: 'Amenities' },
      { code: 'hasSecurity', label: 'Security', source: 'detail', column: 'has_security', kind: 'boolean', better: 'higher', group: 'Amenities' },
      { code: 'hasCctv', label: 'CCTV', source: 'detail', column: 'has_cctv', kind: 'boolean', better: 'higher', group: 'Amenities' },
      { code: 'hasBackupPower', label: 'Backup power', source: 'detail', column: 'has_backup_power', kind: 'boolean', better: 'higher', group: 'Amenities' },
      { code: 'isGatedCommunity', label: 'Gated community', source: 'detail', column: 'is_gated_community', kind: 'boolean', better: 'higher', group: 'Amenities' },
      { code: 'isCorner', label: 'Corner plot', source: 'detail', column: 'is_corner', kind: 'boolean', better: 'higher', group: 'Amenities' },
      { code: 'isParkFacing', label: 'Park facing', source: 'detail', column: 'is_park_facing', kind: 'boolean', better: 'higher', group: 'Amenities' },

      { code: 'ownershipType', label: 'Ownership', source: 'detail', column: 'ownership_type', kind: 'enum', better: 'none', group: 'Legal' },
      { code: 'possessionStatus', label: 'Possession', source: 'detail', column: 'possession_status', kind: 'enum', better: 'none', group: 'Legal' },
      { code: 'isApproved', label: 'Approved by authority', source: 'detail', column: 'is_approved', kind: 'boolean', better: 'higher', group: 'Legal' },
      { code: 'hasOwnershipPapers', label: 'Ownership papers', source: 'detail', column: 'has_ownership_papers', kind: 'boolean', better: 'higher', group: 'Legal' },
      { code: 'hasNoc', label: 'NOC', source: 'detail', column: 'has_noc', kind: 'boolean', better: 'higher', group: 'Legal' },
      // The one row where a "yes" is the bad answer.
      { code: 'isDisputed', label: 'Under dispute', source: 'detail', column: 'is_disputed', kind: 'boolean', better: 'lower', group: 'Legal' },

      { code: 'rentPeriod', label: 'Rent period', source: 'detail', column: 'rent_period', kind: 'enum', better: 'none', group: 'Rental terms' },
      { code: 'securityDeposit', label: 'Security deposit', source: 'detail', column: 'security_deposit', kind: 'money', better: 'lower', group: 'Rental terms' },
      { code: 'advanceMonths', label: 'Advance', source: 'detail', column: 'advance_months', kind: 'number', unit: 'months', better: 'lower', group: 'Rental terms' },
      { code: 'maintenanceCharges', label: 'Maintenance', source: 'detail', column: 'maintenance_charges', kind: 'money', better: 'lower', group: 'Rental terms' },
      { code: 'utilitiesIncluded', label: 'Utilities included', source: 'detail', column: 'utilities_included', kind: 'boolean', better: 'higher', group: 'Rental terms' },
      { code: 'tenantPreference', label: 'Tenant preference', source: 'detail', column: 'tenant_preference', kind: 'enum', better: 'none', group: 'Rental terms' },
      { code: 'petsAllowed', label: 'Pets allowed', source: 'detail', column: 'pets_allowed', kind: 'boolean', better: 'higher', group: 'Rental terms' },
      { code: 'availableFrom', label: 'Available from', source: 'detail', column: 'available_from', kind: 'date', better: 'lower', group: 'Rental terms' },
    ];
  }

  /**
   * A rent figure alone understates what a tenant actually has to pay on day
   * one: deposit plus advance plus maintenance routinely doubles it. Showing
   * the move-in total is the honest version of the headline price.
   */
  pricingModel(): PricingModel {
    return {
      breakdown: (raw: Record<string, unknown>): PricingBreakdownLine[] => {
        const price = toNumber(raw.price) ?? 0;
        const rentPeriod = (raw.rentPeriod ?? raw.rent_period) as string | null;
        const lines: PricingBreakdownLine[] = [];

        if (price > 0) {
          lines.push({
            code: 'base',
            label: rentPeriod ? `Rent (${rentPeriod.replace(/_/g, ' ')})` : 'Price',
            amount: round(price),
            kind: 'base',
          });
        }

        const deposit = toNumber(raw.securityDeposit ?? raw.security_deposit) ?? 0;
        if (deposit > 0) {
          lines.push({ code: 'deposit', label: 'Security deposit', amount: round(deposit), kind: 'charge' });
        }

        const advanceMonths = toNumber(raw.advanceMonths ?? raw.advance_months) ?? 0;
        if (advanceMonths > 0 && price > 0) {
          lines.push({
            code: 'advance',
            label: `Advance (${advanceMonths} month${advanceMonths === 1 ? '' : 's'})`,
            amount: round(price * advanceMonths),
            kind: 'charge',
          });
        }

        const maintenance = toNumber(raw.maintenanceCharges ?? raw.maintenance_charges) ?? 0;
        if (maintenance > 0) {
          lines.push({ code: 'maintenance', label: 'Maintenance charges', amount: round(maintenance), kind: 'charge' });
        }

        if (rentPeriod && lines.length > 1) {
          const total = lines.reduce((sum, line) => sum + line.amount, 0);
          lines.push({ code: 'total', label: 'Move-in cost', amount: round(total), kind: 'total' });
        }
        return lines;
      },
      unitPrice: (raw: Record<string, unknown>, price: number) => {
        const areaSqm = toNumber(raw.areaSqm ?? raw.area_sqm) ?? 0;
        return areaSqm > 0 ? { value: round(price / areaSqm, 4), unit: 'sqm' } : null;
      },
    };
  }

  router() {
    return propertyRouter;
  }

  async onPublished(listingId: number, _connection: PoolConnection): Promise<void> {
    await onPropertyPublished(listingId).catch(() => undefined);
  }
}

/** Row → API shape. DECIMALs arrive as strings; convert only what the client needs numeric. */
function mapPropertyRow(row: Row): Record<string, unknown> {
  return {
    propertyKind: row.property_kind,
    usageType: row.usage_type,
    propertyId: row.property_id === null || row.property_id === undefined ? null : Number(row.property_id),
    bedrooms: toInt(row.bedrooms),
    bathrooms: toInt(row.bathrooms),
    kitchens: toInt(row.kitchens),
    drawingRooms: toInt(row.drawing_rooms),
    diningRooms: toInt(row.dining_rooms),
    servantQuarters: toInt(row.servant_quarters),
    storeRooms: toInt(row.store_rooms),
    totalRooms: toInt(row.total_rooms),
    floors: toInt(row.floors),
    floorNumber: toInt(row.floor_number),
    totalFloors: toInt(row.total_floors),
    basements: toInt(row.basements),
    areaValue: toNumber(row.area_value),
    areaUnit: row.area_unit,
    areaSqm: toNumber(row.area_sqm),
    coveredAreaValue: toNumber(row.covered_area_value),
    coveredAreaUnit: row.covered_area_unit,
    coveredAreaSqm: toNumber(row.covered_area_sqm),
    plotDimensions: row.plot_dimensions,
    frontageFt: toNumber(row.frontage_ft),
    depthFt: toNumber(row.depth_ft),
    pricePerSqm: toNumber(row.price_per_sqm),
    parkingSpaces: toInt(row.parking_spaces),
    hasGarage: row.has_garage === 1,
    hasGarden: row.has_garden === 1,
    gardenAreaSqm: toNumber(row.garden_area_sqm),
    balconies: toInt(row.balconies),
    hasTerrace: row.has_terrace === 1,
    hasLawn: row.has_lawn === 1,
    hasSwimmingPool: row.has_swimming_pool === 1,
    hasGym: row.has_gym === 1,
    hasElevator: row.has_elevator === 1,
    hasSecurity: row.has_security === 1,
    hasCctv: row.has_cctv === 1,
    hasBackupPower: row.has_backup_power === 1,
    hasCentralHeating: row.has_central_heating === 1,
    hasCentralCooling: row.has_central_cooling === 1,
    isGatedCommunity: row.is_gated_community === 1,
    isCorner: row.is_corner === 1,
    isParkFacing: row.is_park_facing === 1,
    wheelchairAccessible: row.wheelchair_accessible === 1,
    furnishing: row.furnishing,
    furnishingDetails: row.furnishing_details ?? null,
    yearBuilt: toInt(row.year_built),
    ageYears: toInt(row.age_years),
    constructionStatus: row.construction_status,
    facing: row.facing,
    roadWidthFt: toNumber(row.road_width_ft),
    buildingName: row.building_name,
    unitNumber: row.unit_number,
    plotNumber: row.plot_number,
    blockSector: row.block_sector,
    phase: row.phase,
    societyName: row.society_name,
    ownershipType: row.ownership_type,
    possessionStatus: row.possession_status,
    possessionDate: toDateString(row.possession_date),
    isApproved: row.is_approved === 1,
    approvalAuthority: row.approval_authority,
    hasOwnershipPapers: row.has_ownership_papers === 1,
    hasMap: row.has_map === 1,
    hasNoc: row.has_noc === 1,
    isDisputed: row.is_disputed === 1,
    rentPeriod: row.rent_period,
    securityDeposit: toNumber(row.security_deposit),
    advanceMonths: toInt(row.advance_months),
    maintenanceCharges: toNumber(row.maintenance_charges),
    maintenancePeriod: row.maintenance_period,
    utilitiesIncluded: row.utilities_included === 1,
    utilitiesDetails: row.utilities_details ?? null,
    minStayDays: toInt(row.min_stay_days),
    maxStayDays: toInt(row.max_stay_days),
    availableFrom: toDateString(row.available_from),
    occupancyType: row.occupancy_type,
    beds: toInt(row.beds),
    attachedBathroom: row.attached_bathroom === 1,
    tenantPreference: row.tenant_preference,
    petsAllowed: row.pets_allowed === 1,
    smokingAllowed: row.smoking_allowed === 1,
    mealsIncluded: row.meals_included === 1,
    floorLoadCapacity: toNumber(row.floor_load_capacity),
    ceilingHeightFt: toNumber(row.ceiling_height_ft),
    loadingDocks: toInt(row.loading_docks),
    threePhasePower: row.three_phase_power === 1,
    waterSource: row.water_source,
    soilType: row.soil_type,
    isCultivated: row.is_cultivated === 1,
    parkingAvailable: row.parking_available === 1,
    parkingCovered: toInt(row.parking_covered),
    parkingOpen: toInt(row.parking_open),
    parkingBasement: toInt(row.parking_basement),
    plotAreaValue: toNumber(row.plot_area_value),
    plotAreaUnit: row.plot_area_unit,
    plotAreaSqm: toNumber(row.plot_area_sqm),
    landAreaValue: toNumber(row.land_area_value),
    landAreaUnit: row.land_area_unit,
    landAreaSqm: toNumber(row.land_area_sqm),
    lengthM: toNumber(row.length_m),
    widthM: toNumber(row.width_m),
    developmentStatus: row.development_status,
    irrigation: row.irrigation,
    landUse: row.land_use,
    warehouseCapacity: toNumber(row.warehouse_capacity),
    powerCapacityKva: toNumber(row.power_capacity_kva),
    hasGenerator: row.has_generator === 1,
    hasLoadingArea: row.has_loading_area === 1,
    officeRooms: toInt(row.office_rooms),
    meetingRooms: toInt(row.meeting_rooms),
    hasReception: row.has_reception === 1,
    accessHours: row.access_hours,
    checkInTime: row.check_in_time,
    checkOutTime: row.check_out_time,
    occupancyMax: toInt(row.occupancy_max),
    leaseMinMonths: toInt(row.lease_min_months),
    leaseMaxMonths: toInt(row.lease_max_months),
    locationPrivacy: row.location_privacy,
    publicLatitude: toNumber(row.public_latitude),
    publicLongitude: toNumber(row.public_longitude),
    projectId: row.project_id === null || row.project_id === undefined ? null : Number(row.project_id),
    unitId: row.unit_id === null || row.unit_id === undefined ? null : Number(row.unit_id),
    aiValuationLow: toNumber(row.ai_valuation_low),
    aiValuationMid: toNumber(row.ai_valuation_mid),
    aiValuationHigh: toNumber(row.ai_valuation_high),
    priceVsAreaAvgPct: toNumber(row.price_vs_area_avg_pct),
    investmentScore: toNumber(row.investment_score),
  };
}

const toInt = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** DATE columns come back as Date objects; the API contract is a plain YYYY-MM-DD. */
const toDateString = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString().slice(0, 10) : (value as string | null) ?? null;

export const propertyModule = new PropertyMarketplaceModule();
