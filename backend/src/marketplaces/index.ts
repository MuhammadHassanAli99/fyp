// Registers every marketplace module at boot. Adding a marketplace (§30) means
// adding one import and one register call here.

import { queryRows, type Row } from '../db/query';
import { loggerFor } from '../config/logger';
import { marketplaceRegistry } from './module';
import { goldModule } from './gold/gold.module';
import { propertyModule } from './property/property.module';
import { vehiclesModule } from './vehicles/vehicles.module';

const log = loggerFor('marketplaces');

const MODULES = [goldModule, propertyModule, vehiclesModule];

/**
 * Explicit registration rather than import side effects: the boot sequence can
 * then guarantee ordering, and a test can register a subset without the module
 * graph deciding for it.
 */
export function registerMarketplaceModules(): void {
  for (const module of MODULES) {
    if (marketplaceRegistry.get(module.code)) continue;
    marketplaceRegistry.register(module);
  }
}

/**
 * Binds the database ids to the registered modules.
 *
 * Listings reference a marketplace by id, so nothing that reads a listing can
 * resolve its module until this has run. A mismatch either way is a
 * configuration error worth shouting about: a module with no row will never be
 * reachable, and a row with no module will hand users a marketplace the API
 * cannot serve.
 */
export async function bindMarketplaceIds(): Promise<void> {
  registerMarketplaceModules();

  const rows = await queryRows<Row>('SELECT id, code FROM marketplaces WHERE is_active = 1');
  const databaseCodes = new Set<string>();

  for (const row of rows) {
    const code = String(row.code);
    databaseCodes.add(code);
    if (!marketplaceRegistry.get(code)) {
      log.warn({ code, id: Number(row.id) }, 'marketplace is active in the database but no module implements it');
      continue;
    }
    marketplaceRegistry.bindId(code, Number(row.id));
  }

  for (const code of marketplaceRegistry.codes()) {
    if (!databaseCodes.has(code)) {
      log.warn({ code }, 'marketplace module is registered but has no active row in `marketplaces`');
    }
  }

  log.info({ bound: [...databaseCodes].filter((code) => marketplaceRegistry.get(code)) }, 'marketplace modules bound');
}

export { marketplaceRegistry } from './module';
export { goldModule } from './gold/gold.module';
export { propertyModule } from './property/property.module';
export { vehiclesModule } from './vehicles/vehicles.module';
