import 'package:signals/signals.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../data/models/search_models.dart';
import '../../data/repositories/search_repository.dart';
import '../../data/repositories/settings_repository.dart';
import '../filters/filter_state.dart';

class SearchStore {
  SearchStore(this._search, this._settings) {
    filterState.marketplace = _settings.marketplaceCode;
  }

  final SearchRepository _search;
  final SettingsRepository _settings;

  final query = signal('');
  final useAi = signal(false);
  final globalScope = signal(false);
  final nearby = signal(false);
  final sort = signal('relevance');
  final radiusKm = signal<double>(25);
  final lat = signal<double?>(null);
  final lng = signal<double?>(null);
  final filterTick = signal(0);
  FilterState filterState = FilterState();
  final results = signal<AsyncState<SearchPage>>(const AsyncIdle());
  final suggestions = signal<List<SearchSuggestion>>([]);
  final recent = signal<List<RecentSearchItem>>([]);
  final trending = signal<List<TrendingSearchItem>>([]);
  final saved = signal<List<SavedSearchRecord>>([]);
  bool _loadingMore = false;

  String get marketplace => _settings.marketplaceCode ?? 'gold';

  String? get marketplaceParam => globalScope.value ? null : marketplace;

  void applyFilters(FilterState next) {
    filterState = next.copy();
    filterState.marketplace = marketplaceParam ?? filterState.marketplace ?? marketplace;
    filterTick.value++;
  }

  Map<String, dynamic>? get activeDsl {
    if (filterState.isEmpty && !nearby.value) return null;
    final dsl = filterState.toDsl();
    dsl['marketplace'] = marketplaceParam ?? filterState.marketplace;
    if (nearby.value && lat.value != null && lng.value != null) {
      final location = Map<String, dynamic>.from(dsl['location'] as Map? ?? {});
      location['lat'] = lat.value;
      location['lng'] = lng.value;
      location['radiusKm'] = radiusKm.value;
      dsl['location'] = location;
    }
    return dsl;
  }

  String get searchType {
    if (nearby.value) return 'nearby';
    if (globalScope.value) return 'global';
    if (useAi.value) return 'ai';
    return 'text';
  }

  SearchPage? get page => results.value.dataOrNull;

  Future<void> loadDiscovery() async {
    final rec = await _search.recent();
    rec.when(success: (items) => recent.value = items, failure: (_, _) {});
    final trend = await _search.trending();
    trend.when(success: (items) => trending.value = items, failure: (_, _) {});
    final savedResult = await _search.saved();
    savedResult.when(success: (items) => saved.value = items, failure: (_, _) {});
  }

  Future<void> suggest(String prefix) async {
    if (prefix.trim().isEmpty) {
      suggestions.value = const [];
      return;
    }
    final result = await _search.suggest(prefix.trim());
    result.when(
      success: (items) => suggestions.value = items,
      failure: (_, _) => suggestions.value = const [],
    );
  }

  Future<void> run({int page = 1}) async {
    final q = query.value.trim();
    if (q.isEmpty && !nearby.value && filterState.isEmpty) {
      results.value = const AsyncIdle();
      return;
    }
    results.value = AsyncLoading(previous: results.value.dataOrNull);
    final result = await _search.search(
      query: q,
      marketplace: marketplaceParam,
      searchType: searchType,
      useAi: useAi.value || searchType == 'ai',
      lat: nearby.value ? lat.value : null,
      lng: nearby.value ? lng.value : null,
      radiusKm: nearby.value ? radiusKm.value : null,
      page: page,
      sort: sort.value,
      dsl: activeDsl,
    );
    result.when(
      success: (data) {
        results.value = AsyncData(data);
        suggestions.value = const [];
        _trackImpressions(data);
        loadDiscovery();
      },
      failure: (message, code) =>
          results.value = AsyncError(message, code: code),
    );
  }

  Future<void> loadMore() async {
    final current = page;
    if (current == null || !current.hasMore || _loadingMore) return;
    _loadingMore = true;
    final result = await _search.search(
      query: query.value.trim(),
      marketplace: marketplaceParam,
      searchType: searchType,
      useAi: useAi.value || searchType == 'ai',
      lat: nearby.value ? lat.value : null,
      lng: nearby.value ? lng.value : null,
      radiusKm: nearby.value ? radiusKm.value : null,
      page: current.page + 1,
      sort: sort.value,
      dsl: activeDsl,
    );
    result.when(
      success: (data) {
        final seen = {for (final item in current.items) item.id};
        results.value = AsyncData(
          SearchPage(
            items: [
              ...current.items,
              ...data.items.where((item) => !seen.contains(item.id)),
            ],
            total: data.total != 0 ? data.total : current.total,
            page: data.page,
            perPage: data.perPage,
            hasMore: data.hasMore,
            explanation: current.explanation,
            clarification: current.clarification,
            zeroResult: current.zeroResult,
            groups: current.groups,
            parts: current.parts,
            disclaimer: current.disclaimer,
            dsl: current.dsl,
            facets: current.facets,
            contextualAds: current.contextualAds,
          ),
        );
        _trackImpressions(data);
      },
      failure: (_, _) {},
    );
    _loadingMore = false;
  }

  Future<void> applyVoice(SearchPage page) async {
    results.value = AsyncData(page);
    if (page.items.isNotEmpty || (page.zeroResult?.message.isNotEmpty ?? false)) {
      _trackImpressions(page);
    }
    await loadDiscovery();
  }

  Future<void> applyImage(SearchPage page) async {
    results.value = AsyncData(page);
    _trackImpressions(page);
    await loadDiscovery();
  }

  Future<void> applyClarification(String answer) async {
    query.value = '${query.value} $answer'.trim();
    await run();
  }

  Future<void> applySuggestion(String term) async {
    suggestions.value = const [];
    final radius = RegExp(r'(\d+)\s*km', caseSensitive: false).firstMatch(term);
    if (radius != null && term.toLowerCase().contains('radius')) {
      nearby.value = true;
      radiusKm.value = double.parse(radius.group(1)!);
      await run();
      return;
    }
    query.value = term;
    await run();
  }

  Future<String?> saveCurrent({String alertFrequency = 'instant'}) async {
    final q = query.value.trim();
    if (q.isEmpty) return 'Type a search before saving it.';
    final dsl = page?.dslAsMap ??
        activeDsl ??
        {
          'originalQuery': q,
          'keywords': q,
          'marketplace': marketplaceParam,
        };
    final result = await _search.save(
      name: q.length > 80 ? q.substring(0, 80) : q,
      query: dsl,
      originalQuery: q,
      alertFrequency: alertFrequency,
    );
    return result.when(
      success: (_) {
        loadDiscovery();
        return null;
      },
      failure: (message, _) => message,
    );
  }

  Future<void> deleteRecent(int id) async {
    await _search.deleteRecent(id);
    await loadDiscovery();
  }

  Future<void> clearRecent() async {
    await _search.clearRecent();
    await loadDiscovery();
  }

  Future<void> deleteSaved(int id) async {
    await _search.deleteSaved(id);
    await loadDiscovery();
  }

  Future<void> updateSaved(
    int id, {
    String? alertFrequency,
    bool? isActive,
  }) async {
    await _search.updateSaved(id, alertFrequency: alertFrequency, isActive: isActive);
    await loadDiscovery();
  }

  Future<void> trackClick(String listingId, int position) => _search.trackClick(
        listingId: listingId,
        query: query.value,
        position: position,
      );

  void _trackImpressions(SearchPage page) {
    final items = page.items.take(20).toList();
    for (var i = 0; i < items.length; i++) {
      _search.trackImpression(
        listingId: items[i].id,
        query: query.value,
        position: i,
      );
    }
  }
}
