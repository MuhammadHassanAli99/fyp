import { reindexPending } from './search.document';
import { embedPendingListings } from './search.embed';
import { purgeExpiredSearchCache } from './search.cache';
import { rollupTrendingSearches } from './search.trending';
import { refreshSuggestionWeights } from './search.suggestions';
import { matchListingToSavedSearches, runSavedSearchDigests } from './search.saved';

export async function runSearchReindex(): Promise<number> {
  return reindexPending();
}

export async function runSearchEmbed(): Promise<number> {
  return embedPendingListings();
}

export async function runSearchCachePurge(): Promise<number> {
  return purgeExpiredSearchCache();
}

export async function runTrendingRollup(): Promise<number> {
  return rollupTrendingSearches();
}

export async function runSuggestionRefresh(): Promise<number> {
  return refreshSuggestionWeights();
}

export async function runSavedSearchInstant(listingId: number): Promise<number> {
  return matchListingToSavedSearches(listingId);
}

export async function runSavedSearchDigestsJob(): Promise<number> {
  const daily = await runSavedSearchDigests('daily');
  const weekly = await runSavedSearchDigests('weekly');
  return daily + weekly;
}
