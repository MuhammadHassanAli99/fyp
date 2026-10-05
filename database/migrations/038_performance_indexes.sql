-- =============================================================================
-- 038  Performance covering indexes for the published listing feed and card
--      media lookup. Additive KEY only. Does not denormalize thumbnails.
--      Matches DEFAULT_FEED_ORDER prefix (marketplace + published/expiration
--      + featured + search_rank + bump) and listing_media image/video probes.
-- =============================================================================

USE marketplace;

ALTER TABLE listings
  ADD KEY idx_listings_published_sort (
    marketplace_id,
    lifecycle_status,
    expiration_status,
    is_featured,
    search_rank,
    bump_at,
    id
  );

ALTER TABLE listing_media
  ADD KEY idx_listing_media_card (listing_id, kind, is_primary, sort_order);
