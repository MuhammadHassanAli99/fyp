import '../../core/network/api_client.dart';
import '../models/search_models.dart';

class SearchApi {
  SearchApi(this._client);
  final ApiClient _client;

  Future<SearchPage> search({
    required String query,
    String? marketplace,
    String searchType = 'text',
    bool useAi = false,
    double? lat,
    double? lng,
    double? radiusKm,
    int page = 1,
    int perPage = 24,
    String? sort,
    Map<String, dynamic>? dsl,
  }) {
    if (dsl != null) {
      return _client.post(
        '/search',
        data: {
          if (query.trim().isNotEmpty) 'q': query.trim(),
          'marketplace': ?marketplace,
          'searchType': searchType,
          'useAi': useAi,
          'lat': ?lat,
          'lng': ?lng,
          'radiusKm': ?radiusKm,
          'page': page,
          'perPage': perPage,
          'sort': ?sort,
          'dsl': dsl,
        },
        parserWithMeta: SearchPage.fromData,
      );
    }
    return _client.get(
        '/search',
        queryParameters: {
          if (query.trim().isNotEmpty) 'q': query.trim(),
          'marketplace': ?marketplace,
          'searchType': searchType,
          'useAi': useAi,
          'lat': ?lat,
          'lng': ?lng,
          'radiusKm': ?radiusKm,
          'page': page,
          'perPage': perPage,
          'sort': ?sort,
        },
        parserWithMeta: SearchPage.fromData,
      );
  }

  Future<List<SearchSuggestion>> suggest(String prefix, {int limit = 10}) =>
      _client.get(
        '/search/suggest',
        queryParameters: {'q': prefix, 'limit': limit},
        parser: (d) {
          if (d is! List) return const <SearchSuggestion>[];
          return d
              .whereType<Map>()
              .map((e) => SearchSuggestion.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<List<RecentSearchItem>> recent() => _client.get(
        '/search/recent',
        parser: (d) {
          if (d is! List) return const <RecentSearchItem>[];
          return d
              .whereType<Map>()
              .map((e) => RecentSearchItem.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<void> deleteRecent(int id) =>
      _client.delete('/search/recent/$id', parser: (_) {});

  Future<void> clearRecent() =>
      _client.delete('/search/recent', parser: (_) {});

  Future<List<TrendingSearchItem>> trending({String? period}) => _client.get(
        '/search/trending',
        queryParameters: {'limit': 10, 'period': ?period},
        parser: (d) {
          if (d is! List) return const <TrendingSearchItem>[];
          return d
              .whereType<Map>()
              .map((e) => TrendingSearchItem.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<List<SavedSearchRecord>> saved() => _client.get(
        '/search/saved',
        parser: (d) {
          if (d is! List) return const <SavedSearchRecord>[];
          return d
              .whereType<Map>()
              .map((e) => SavedSearchRecord.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<SavedSearchRecord> save({
    required String name,
    required Map<String, dynamic> query,
    String? originalQuery,
    String alertFrequency = 'instant',
  }) =>
      _client.post(
        '/search/saved',
        data: {
          'name': name,
          'query': query,
          'originalQuery': ?originalQuery,
          'alertFrequency': alertFrequency,
        },
        parser: (d) => SavedSearchRecord.fromJson(d as Map<String, dynamic>),
      );

  Future<void> updateSaved(
    int id, {
    String? alertFrequency,
    bool? isActive,
  }) =>
      _client.patch(
        '/search/saved/$id',
        data: {
          'alertFrequency': ?alertFrequency,
          'isActive': ?isActive,
        },
      );

  Future<void> deleteSaved(int id) =>
      _client.delete('/search/saved/$id', parser: (_) {});

  Future<SearchPage> voice({String? transcript, String? audioUrl}) =>
      _client.post(
        '/search/voice',
        data: {
          'transcript': ?transcript,
          'audioUrl': ?audioUrl,
        },
        parser: (d) {
          final map = Map<String, dynamic>.from(d as Map);
          final results = map['results'];
          if (results is Map) {
            return SearchPage.fromJson(Map<String, dynamic>.from(results));
          }
          return const SearchPage(items: []);
        },
      );

  Future<SearchPage> image({required String imageUrl}) => _client.post(
        '/search/image',
        data: {'imageUrl': imageUrl},
        parser: (d) {
          final map = Map<String, dynamic>.from(d as Map);
          final results = map['results'];
          if (results is Map) {
            final page = SearchPage.fromJson(Map<String, dynamic>.from(results));
            return SearchPage(
              items: page.items,
              total: page.total,
              page: page.page,
              perPage: page.perPage,
              explanation: page.explanation,
              clarification: page.clarification,
              zeroResult: page.zeroResult,
              groups: page.groups,
              parts: page.parts,
              disclaimer: map['disclaimer']?.toString() ?? page.disclaimer,
            );
          }
          return SearchPage(
            items: const [],
            disclaimer: map['disclaimer']?.toString(),
          );
        },
      );

  Future<void> track({
    required String eventType,
    String? listingId,
    int? position,
    String? query,
  }) =>
      _client.post(
        '/search/events',
        data: {
          'eventType': eventType,
          if (listingId != null) 'listingId': int.tryParse(listingId),
          'position': ?position,
          'query': ?query,
        },
        parser: (_) {},
      );
}
