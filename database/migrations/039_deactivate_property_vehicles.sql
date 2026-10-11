-- =============================================================================
-- 039  Deactivate Property and Vehicles marketplaces.
--
--      The backend is now Gold-only: the Property and Vehicles marketplace
--      modules (backend/src/marketplaces/property, backend/src/marketplaces/
--      vehicles) and their AI valuation routes/jobs have been removed from
--      the Node/TypeScript API.
--
--      This migration does NOT drop any tables, columns, categories or rows
--      created by 007_property.sql / 008_vehicles.sql / 023_property_marketplace.sql
--      / 024_vehicle_marketplace.sql (history is preserved and FKs stay
--      intact for any existing listings/data). It only flips the catalog
--      switches so the two marketplaces stop being offered to clients:
--        - marketplaces.is_active = 0 for code IN ('property', 'vehicles')
--        - marketplace_countries.is_active = 0 for those marketplace ids
--
--      New databases get the same result from the updated seed in
--      database/seeds/03_marketplaces.sql.
-- =============================================================================

USE marketplace;

UPDATE marketplaces
   SET is_active = 0, is_coming_soon = 0
 WHERE code IN ('property', 'vehicles');

UPDATE marketplace_countries
   SET is_active = 0
 WHERE marketplace_id IN (SELECT id FROM marketplaces WHERE code IN ('property', 'vehicles'));
