import type { Router } from 'express';
import type { PoolConnection } from '../db/pool';
import type { WhereBuilder } from '../db/sql';
import { AppError, ErrorCode } from '../core/errors';

/**
 * A marketplace is a plugin.
 *
 * Core code (listings, search, favourites, chat, payments, moderation) never
 * mentions "gold" or "property". Instead it asks the registered module for the
 * marketplace-specific behaviour it needs. Adding "Jobs" or "Electronics" later
 * (§30) means implementing this interface and inserting taxonomy rows — no
 * changes to the platform.
 */

export interface FilterContext {
  /** Raw, already-validated query object from the request. */
  query: Record<string, unknown>;
  countryId: number | null;
  currency: string;
  language: string;
  measurementSystem: 'metric' | 'imperial';
}

export interface SortOption {
  code: string;
  label: string;
  /** Fully-qualified SQL expression, always code-controlled. */
  expression: string;
  direction: 'ASC' | 'DESC';
  requiresLocation?: boolean;
}

/** Drives the comparison table (§15 Compare, spec lines 1–3). */
export interface CompareField {
  code: string;
  label: string;
  /** Where the value comes from: the detail table column or an EAV attribute code. */
  source: 'detail' | 'attribute' | 'listing' | 'computed';
  column?: string;
  attributeCode?: string;
  kind: 'text' | 'number' | 'boolean' | 'enum' | 'money' | 'date' | 'rating';
  unit?: string;
  /** 'higher' ⇒ a bigger number is better; used to pick a winner per row. */
  better?: 'higher' | 'lower' | 'none';
  group: string;
  /** Show even when every listing has the same value. */
  alwaysShow?: boolean;
}

export interface PricingBreakdownLine {
  code: string;
  label: string;
  amount: number;
  kind: 'base' | 'charge' | 'tax' | 'discount' | 'total';
}

export interface PricingModel {
  /** Explains how a total price is composed, e.g. gold = metal + making + tax. */
  breakdown(details: Record<string, unknown>, currency: string): PricingBreakdownLine[];
  /** Optional unit price for "per gram" / "per sqft" display and sorting. */
  unitPrice?(details: Record<string, unknown>, price: number): { value: number; unit: string } | null;
}

export interface ValidationResult<T = Record<string, unknown>> {
  details: T;
  /** Non-fatal notes surfaced to the seller, e.g. "22K usually means 916 fineness". */
  warnings: string[];
}

export interface MarketplaceModule {
  readonly code: string;
  readonly name: string;
  /** Table holding this marketplace's hot-path columns. */
  readonly detailTable: string;
  readonly supportedOperations: ReadonlyArray<'buy' | 'sell' | 'rent' | 'auction' | 'exchange'>;

  /** Validate + normalise the marketplace-specific half of a listing payload. */
  validateDetails(input: unknown, context: { operation: string; categoryCode: string | null; countryId: number | null }): Promise<ValidationResult>;

  /** Persist the detail row. Runs inside the listing's transaction. */
  saveDetails(listingId: number, details: Record<string, unknown>, connection: PoolConnection): Promise<void>;

  /** Load the detail row for a listing response. */
  loadDetails(listingId: number): Promise<Record<string, unknown> | null>;

  /** Load details for many listings at once — avoids N+1 on feeds. */
  loadDetailsBatch(listingIds: number[]): Promise<Map<number, Record<string, unknown>>>;

  /** Add module-specific conditions to a listing query. */
  applyFilters(builder: WhereBuilder, context: FilterContext): void;

  /** The JOIN needed for `applyFilters`/`sortOptions` to reference the detail table. */
  joinClause(): string;

  sortOptions(): SortOption[];

  comparableFields(): CompareField[];

  pricingModel(): PricingModel;

  /** Optional sub-router mounted at /api/v1/<code>. */
  router?(): Router;

  /** Hook for module-specific work after publish (indexing, valuation refresh). */
  onPublished?(listingId: number, connection: PoolConnection): Promise<void>;

  /** Recompute derived columns (price_per_sqm, canonical weights) before save. */
  deriveComputedColumns?(details: Record<string, unknown>, listing: { price: number | null; currency: string | null }): Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

class MarketplaceRegistry {
  private readonly byCode = new Map<string, MarketplaceModule>();
  private readonly byId = new Map<number, MarketplaceModule>();

  register(module: MarketplaceModule): void {
    if (this.byCode.has(module.code)) {
      throw new Error(`Marketplace module "${module.code}" is already registered`);
    }
    this.byCode.set(module.code, module);
  }

  /** Called at boot once marketplace ids are known from the database. */
  bindId(code: string, id: number): void {
    const module = this.byCode.get(code);
    if (module) this.byId.set(id, module);
  }

  get(code: string): MarketplaceModule | null {
    return this.byCode.get(code) ?? null;
  }

  getById(id: number): MarketplaceModule | null {
    return this.byId.get(id) ?? null;
  }

  require(code: string): MarketplaceModule {
    const module = this.get(code);
    if (!module) {
      throw new AppError(`Unknown marketplace "${code}"`, { status: 400, code: ErrorCode.UNSUPPORTED_MARKETPLACE });
    }
    return module;
  }

  requireById(id: number): MarketplaceModule {
    const module = this.getById(id);
    if (!module) {
      throw new AppError(`Marketplace ${id} is not available`, { status: 400, code: ErrorCode.UNSUPPORTED_MARKETPLACE });
    }
    return module;
  }

  all(): MarketplaceModule[] {
    return [...this.byCode.values()];
  }

  codes(): string[] {
    return [...this.byCode.keys()];
  }
}

export const marketplaceRegistry = new MarketplaceRegistry();

/** Shared guard used by every module's `validateDetails`. */
export function assertOperationSupported(module: MarketplaceModule, operation: string): void {
  if (!module.supportedOperations.includes(operation as never)) {
    throw new AppError(`${module.name} does not support "${operation}"`, {
      status: 400,
      code: ErrorCode.UNSUPPORTED_OPERATION,
      details: { supported: module.supportedOperations },
    });
  }
}
