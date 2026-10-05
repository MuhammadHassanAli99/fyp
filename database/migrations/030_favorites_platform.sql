-- =============================================================================
-- 030  Favorites platform
--      Additive on 009_search_favorites_compare. One shared Favorites module
--      for Gold, Property, Vehicles and Vehicle Parts — not three copies.
--
--      Folders remain nested collections (parent_id). A second favorite_folders
--      table is not created: 009 already models the tree.
--      Compare stays on comparison_sets / comparison_items (009). This file
--      only adds the missing universal favorite identity, collection scope,
--      and share tokens.
-- =============================================================================

USE marketplace;

-- -----------------------------------------------------------------------------
-- Collections: marketplace-aware + explicit visibility.
-- Creating a collection MUST remain private until the owner shares it.
-- -----------------------------------------------------------------------------
ALTER TABLE favorite_collections
  ADD COLUMN marketplace_id TINYINT UNSIGNED NULL AFTER user_id,
  ADD COLUMN visibility ENUM('private','shared','public') NOT NULL DEFAULT 'private' AFTER is_public,
  ADD COLUMN share_expires_at TIMESTAMP NULL AFTER share_token,
  ADD KEY idx_favorite_collections_mp (user_id, marketplace_id, sort_order);

ALTER TABLE favorite_collections
  ADD CONSTRAINT fk_favorite_collections_mp FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE favorite_collections
   SET visibility = IF(is_public = 1, 'public', 'private')
 WHERE visibility = 'private' AND is_public = 1;

-- -----------------------------------------------------------------------------
-- Favorites: universal (marketplace, entity_type, entity_id) identity.
-- listing_id stays as a denormalised join key for listing entities and is
-- SET NULL on hard delete so the favorite row (and snapshots) survive.
-- -----------------------------------------------------------------------------
ALTER TABLE favorites DROP FOREIGN KEY fk_favorites_listing;
ALTER TABLE favorites DROP INDEX uk_favorites_user_listing;

ALTER TABLE favorites
  MODIFY listing_id BIGINT UNSIGNED NULL,
  ADD COLUMN marketplace_id TINYINT UNSIGNED NULL AFTER listing_id,
  ADD COLUMN entity_type ENUM('listing','vehicle_part') NOT NULL DEFAULT 'listing' AFTER marketplace_id,
  ADD COLUMN entity_id BIGINT UNSIGNED NULL AFTER entity_type,
  ADD COLUMN title_snapshot VARCHAR(255) NULL AFTER note,
  ADD COLUMN image_url_snapshot VARCHAR(512) NULL AFTER title_snapshot,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

UPDATE favorites f
INNER JOIN listings l ON l.id = f.listing_id
   SET f.marketplace_id = l.marketplace_id,
       f.entity_type = 'listing',
       f.entity_id = f.listing_id,
       f.title_snapshot = LEFT(l.title, 255);

DELETE FROM favorites WHERE marketplace_id IS NULL OR entity_id IS NULL;

ALTER TABLE favorites
  MODIFY marketplace_id TINYINT UNSIGNED NOT NULL,
  MODIFY entity_id BIGINT UNSIGNED NOT NULL;

ALTER TABLE favorites
  ADD UNIQUE KEY uk_favorites_user_entity (user_id, marketplace_id, entity_type, entity_id),
  ADD KEY idx_favorites_user_mp (user_id, marketplace_id, created_at),
  ADD KEY idx_favorites_user_type (user_id, entity_type, created_at),
  ADD KEY idx_favorites_entity (entity_type, entity_id),
  ADD CONSTRAINT fk_favorites_listing FOREIGN KEY (listing_id)
    REFERENCES listings (id) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_favorites_marketplace FOREIGN KEY (marketplace_id)
    REFERENCES marketplaces (id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- Share tokens for listing / favorite / collection / comparison.
-- Opaque tokens so sequential ids are not required in public URLs.
-- Private collections never receive a token until the owner shares them.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS share_tokens (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  token          CHAR(36)        NOT NULL,
  owner_user_id  BIGINT UNSIGNED NOT NULL,
  target_type    ENUM('listing','favorite','collection','comparison') NOT NULL,
  target_id      BIGINT UNSIGNED NOT NULL,
  access_policy  ENUM('public','restricted') NOT NULL DEFAULT 'public',
  expires_at     TIMESTAMP       NULL,
  revoked_at     TIMESTAMP       NULL,
  view_count     INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_share_tokens_token (token),
  KEY idx_share_tokens_target (target_type, target_id, revoked_at),
  KEY idx_share_tokens_owner (owner_user_id, created_at),
  CONSTRAINT fk_share_tokens_owner FOREIGN KEY (owner_user_id)
    REFERENCES users (id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE = InnoDB;
