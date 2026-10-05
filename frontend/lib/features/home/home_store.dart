import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/gold_models.dart';
import '../../data/models/listing_feed_query.dart';
import '../../data/models/listing_model.dart';
import '../../data/models/vehicle_models.dart';
import '../../data/repositories/gold_repository.dart';
import '../../data/repositories/listings_repository.dart';
import '../../data/repositories/property_repository.dart';
import '../../data/repositories/settings_repository.dart';
import '../../data/repositories/vehicle_repository.dart';
import '../../data/repositories/ai_repository.dart';

class HomeStore {
  HomeStore(
    this._listings,
    this._settings, {
    this._gold,
    this._property,
    this._vehicles,
    this._ai,
  }) {
    query = ListingFeedQuery(marketplace: marketplace);
  }

  final ListingsRepository _listings;
  final SettingsRepository _settings;
  final GoldRepository? _gold;
  final PropertyRepository? _property;
  final VehicleRepository? _vehicles;
  final AiRepository? _ai;

  late ListingFeedQuery query;
  final listings = signal<AsyncState<List<ListingModel>>>(const AsyncIdle());
  final filterTick = signal(0);
  final goldRates = signal<List<GoldRate>>([]);
  final goldForecasts = signal<List<GoldForecast>>([]);
  final goldPurities = signal<List<GoldPurity>>([]);
  final goldRateDisclaimer = signal<String?>(null);
  final vehicleCatalog = signal<VehicleCatalog?>(null);
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
    if (marketplace == 'vehicles') {
      await loadVehicleCatalog();
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

  Future<void> loadVehicleCatalog() async {
    final vehicles = _vehicles;
    if (vehicles == null) return;
    final result = await vehicles.catalog();
    result.when(
      success: (catalog) => vehicleCatalog.value = catalog,
      failure: (_, _) {},
    );
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
      'property' => 2,
      'vehicles' => 3,
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
    if (marketplace == 'property' && query.q != null) {
      _applyParsedPropertyQuery(query.q!);
      return;
    }
    if (marketplace == 'vehicles' && query.q != null) {
      _applyParsedVehicleQuery(query.q!);
      return;
    }
    load();
  }

  Future<void> _applyParsedPropertyQuery(String raw) async {
    final property = _property;
    if (property == null) {
      load();
      return;
    }
    final parsed = await property.parseQuery(raw);
    parsed.when(
      success: (result) {
        if (result.operation != null) query.operation = result.operation;
        if (result.propertyKind != null) query.propertyKind = result.propertyKind;
        if (result.bedroomsMin != null) query.bedroomsMin = result.bedroomsMin;
      },
      failure: (_, _) {},
    );
    load();
  }

  Future<void> _applyParsedVehicleQuery(String raw) async {
    final vehicles = _vehicles;
    if (vehicles == null) {
      load();
      return;
    }
    final parsed = await vehicles.parseQuery(raw);
    parsed.when(
      success: (result) {
        if (result.operation != null) query.operation = result.operation;
        if (result.vehicleType != null) query.vehicleType = result.vehicleType;
        if (result.fuelType != null) query.fuelType = result.fuelType;
        if (result.transmission != null) query.transmission = result.transmission;
        if (result.yearMin != null) query.yearMin = result.yearMin;
        if (result.mileageMax != null) query.mileageMax = result.mileageMax;
      },
      failure: (_, _) {},
    );
    load();
  }

  Future<void> saveCurrentSearch(String name) async {
    if (marketplace == 'vehicles') {
      final vehicles = _vehicles;
      if (vehicles == null) return;
      await vehicles.saveSearch(name: name, query: query.toQueryParameters());
      return;
    }
    final property = _property;
    if (property == null) return;
    await property.saveSearch(name: name, query: query.toQueryParameters());
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
