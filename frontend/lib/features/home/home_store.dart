import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/gold_models.dart';
import '../../data/models/listing_feed_query.dart';
import '../../data/models/listing_model.dart';
import '../../data/repositories/gold_repository.dart';
import '../../data/repositories/listings_repository.dart';
import '../../data/repositories/settings_repository.dart';
import '../../data/repositories/ai_repository.dart';

class HomeStore {
  HomeStore(
    this._listings,
    this._settings, {
    this._gold,
    this._ai,
  }) {
    query = ListingFeedQuery(marketplace: marketplace);
  }

  final ListingsRepository _listings;
  final SettingsRepository _settings;
  final GoldRepository? _gold;
  final AiRepository? _ai;

  late ListingFeedQuery query;
  final listings = signal<AsyncState<List<ListingModel>>>(const AsyncIdle());
  final filterTick = signal(0);
  final goldRates = signal<List<GoldRate>>([]);
  final goldForecasts = signal<List<GoldForecast>>([]);
  final goldPurities = signal<List<GoldPurity>>([]);
  final goldRateDisclaimer = signal<String?>(null);
  final recommended = signal<List<ListingModel>>([]);
  final recommendationNote = signal<String?>(null);
  final hasMore = signal(false);
  final loadingMore = signal(false);
  final loadMoreError = signal<String?>(null);

  String get marketplace => _settings.marketplaceCode ?? 'gold';

  Future<void> load() async {
    query.marketplace = marketplace;
    query.page = 1;
    query.cursor = null;
    loadMoreError.value = null;
    listings.value = AsyncLoading(previous: listings.value.dataOrNull);
    final result = await _listings.fetch(query);
    result.when(
      success: (page) {
        hasMore.value = page.hasMore;
        query.cursor = page.nextCursor;
        listings.value = AsyncData(page.items);
      },
      failure: (m, code) => listings.value = AsyncError(m, code: code),
    );
    unawaited(_loadDeferred());
  }

  Future<void> loadMore() async {
    if (!hasMore.value || loadingMore.value) return;
    loadingMore.value = true;
    loadMoreError.value = null;
    query.page += 1;
    final result = await _listings.fetch(query);
    result.when(
      success: (page) {
        hasMore.value = page.hasMore;
        query.cursor = page.nextCursor;
        final current = listings.value.dataOrNull ?? const <ListingModel>[];
        final seen = {for (final item in current) item.id};
        listings.value = AsyncData([
          ...current,
          ...page.items.where((item) => !seen.contains(item.id)),
        ]);
      },
      failure: (m, _) => loadMoreError.value = m,
    );
    loadingMore.value = false;
  }

  Future<void> _loadDeferred() async {
    if (marketplace == 'gold') {
      await loadGoldMarket();
    }
    await loadRecommendations();
  }

  Future<void> loadGoldMarket() async {
    final gold = _gold;
    if (gold == null) return;
    final catalog = await gold.catalog();
    catalog.when(
      success: (c) => goldPurities.value = c.displayPurities,
      failure: (_, _) {},
    );
    final rates = await gold.rates();
    rates.when(
      success: (r) {
        goldRates.value = r.rates;
        goldRateDisclaimer.value = r.disclaimer;
      },
      failure: (_, _) {},
    );
    final forecast = await gold.forecast(karat: 24);
    forecast.when(
      success: (items) => goldForecasts.value = items,
      failure: (_, _) {},
    );
  }

  void setSort(String apiValue) {
    query.sort = apiValue;
    query.page = 1;
    query.cursor = null;
    load();
  }

  Future<void> loadRecommendations() async {
    final ai = _ai;
    if (ai == null) {
      recommended.value = [];
      recommendationNote.value = null;
      return;
    }
    final marketplaceId = switch (marketplace) {
      'gold' => 1,
      _ => null,
    };
    final result = await ai.recommendations(marketplaceId: marketplaceId);
    if (result case Success(:final data)) {
      recommendationNote.value = data.explanation;
      if (data.cards.isNotEmpty) {
        recommended.value = data.cards.take(8).toList();
        return;
      }
      final items = <ListingModel>[];
      final fetched = await Future.wait(
        data.listingIds.take(8).map((id) => _listings.getById('$id')),
      );
      for (final listing in fetched) {
        listing.when(success: items.add, failure: (_, _) {});
      }
      recommended.value = items;
      return;
    }
    recommended.value = [];
    recommendationNote.value = null;
  }

  void setSearch(String value) {
    query.q = value.trim().isEmpty ? null : value.trim();
    query.page = 1;
    query.cursor = null;
    load();
  }

  void setOperation(String? operation) {
    query.operation = operation;
    query.page = 1;
    query.cursor = null;
    filterTick.value++;
    load();
  }

  void applyFilters(ListingFeedQuery next) {
    query = next;
    query.marketplace = marketplace;
    query.page = 1;
    query.cursor = null;
    filterTick.value++;
    load();
  }

  void clearFilters() {
    final sort = query.sort;
    final q = query.q;
    query.clearFilters();
    query.sort = sort;
    query.q = q;
    query.marketplace = marketplace;
    filterTick.value++;
    load();
  }
}
