import 'filter_models.dart';
import 'listing_model.dart';
import '../../features/reviews/data/review_models.dart';

ListingModel listingFromSearchJson(Map<String, dynamic> json) {
  final nested = json['listing'];
  if (nested is Map) {
    return ListingModel.fromJson({
      ...Map<String, dynamic>.from(nested),
      'placement': json['placement'] ?? nested['placement'],
      'distanceKm': json['distanceKm'] ?? nested['distanceKm'],
      'matchReasons': json['matchReasons'] ?? nested['matchReasons'],
      'marketplace': json['marketplace'] ?? nested['marketplace'],
    });
  }
  return ListingModel.fromJson(json);
}

class SearchSuggestion {
  const SearchSuggestion({
    required this.term,
    required this.kind,
    this.marketplaceId,
  });

  factory SearchSuggestion.fromJson(Map<String, dynamic> json) =>
      SearchSuggestion(
        term: (json['term'] ?? '').toString(),
        kind: (json['kind'] ?? 'keyword').toString(),
        marketplaceId: (json['marketplaceId'] as num?)?.toInt(),
      );

  final String term;
  final String kind;
  final int? marketplaceId;
}

class RecentSearchItem {
  const RecentSearchItem({
    required this.id,
    required this.term,
    this.marketplaceId,
    this.lastAt,
    this.searchType,
  });

  factory RecentSearchItem.fromJson(Map<String, dynamic> json) =>
      RecentSearchItem(
        id: (json['id'] as num?)?.toInt() ?? 0,
        term: (json['term'] ?? json['query'] ?? '').toString(),
        marketplaceId: (json['marketplaceId'] as num?)?.toInt(),
        lastAt: json['lastAt']?.toString(),
        searchType: json['searchType']?.toString(),
      );

  final int id;
  final String term;
  final int? marketplaceId;
  final String? lastAt;
  final String? searchType;
}

class TrendingSearchItem {
  const TrendingSearchItem({
    required this.term,
    this.searchCount = 0,
    this.rank = 0,
  });

  factory TrendingSearchItem.fromJson(Map<String, dynamic> json) =>
      TrendingSearchItem(
        term: (json['term'] ?? '').toString(),
        searchCount: (json['searchCount'] as num?)?.toInt() ?? 0,
        rank: (json['rank'] as num?)?.toInt() ?? 0,
      );

  final String term;
  final int searchCount;
  final int rank;
}

class SearchClarification {
  const SearchClarification({
    required this.needed,
    this.questions = const [],
    this.missing = const [],
  });

  factory SearchClarification.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const SearchClarification(needed: false);
    return SearchClarification(
      needed: json['needed'] as bool? ?? false,
      questions: (json['questions'] as List?)?.map((e) => e.toString()).toList() ??
          const [],
      missing:
          (json['missing'] as List?)?.map((e) => e.toString()).toList() ??
              const [],
    );
  }

  final bool needed;
  final List<String> questions;
  final List<String> missing;
}

class ZeroResultHelp {
  const ZeroResultHelp({required this.message, this.suggestions = const []});

  factory ZeroResultHelp.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const ZeroResultHelp(message: '');
    }
    return ZeroResultHelp(
      message: (json['message'] ?? '').toString(),
      suggestions:
          (json['suggestions'] as List?)?.map((e) => e.toString()).toList() ??
              const [],
    );
  }

  final String message;
  final List<String> suggestions;
}

class VehiclePartHit {
  const VehiclePartHit({
    required this.id,
    required this.name,
    this.brand,
    this.price,
    this.currency,
  });

  factory VehiclePartHit.fromJson(Map<String, dynamic> json) => VehiclePartHit(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: (json['name'] ?? '').toString(),
        brand: json['brand']?.toString(),
        price: (json['price'] as num?)?.toDouble(),
        currency: json['currency']?.toString(),
      );

  final int id;
  final String name;
  final String? brand;
  final double? price;
  final String? currency;
}

class SearchPage {
  const SearchPage({
    required this.items,
    this.total = 0,
    this.page = 1,
    this.perPage = 24,
    this.hasMore = false,
    this.explanation,
    this.clarification = const SearchClarification(needed: false),
    this.zeroResult,
    this.groups = const {},
    this.parts = const [],
    this.disclaimer,
    this.dsl,
    this.facets = const [],
    this.contextualAds = const [],
  });

  factory SearchPage.fromData(dynamic data, Map<String, dynamic>? meta) {
    if (data is Map<String, dynamic>) {
      final page = SearchPage.fromJson(data);
      return SearchPage(
        items: page.items,
        total: page.total != 0 ? page.total : (meta?['total'] as num?)?.toInt() ?? 0,
        page: page.page,
        perPage: page.perPage,
        hasMore: meta?['hasMore'] as bool? ?? page.hasMore,
        explanation: page.explanation ?? meta?['explanation']?.toString(),
        clarification: page.clarification.needed
            ? page.clarification
            : SearchClarification.fromJson(
                meta?['clarification'] is Map
                    ? Map<String, dynamic>.from(meta!['clarification'] as Map)
                    : null,
              ),
        zeroResult: page.zeroResult ??
            ZeroResultHelp.fromJson(
              meta?['zeroResult'] is Map
                  ? Map<String, dynamic>.from(meta!['zeroResult'] as Map)
                  : null,
            ),
        groups: page.groups.isNotEmpty ? page.groups : _parseGroups(meta?['groups']),
        parts: page.parts.isNotEmpty ? page.parts : _parseParts(meta?['parts']),
        disclaimer: page.disclaimer,
        dsl: page.dsl ?? meta?['dsl'],
        facets: page.facets.isNotEmpty ? page.facets : _parseFacets(meta?['facets']),
        contextualAds: page.contextualAds.isNotEmpty
            ? page.contextualAds
            : _parseAds(meta?['contextualAds'] ?? data['contextualAds']),
      );
    }
    final items = <ListingModel>[];
    if (data is List) {
      for (final row in data) {
        if (row is Map) {
          items.add(listingFromSearchJson(Map<String, dynamic>.from(row)));
        }
      }
    }
    final zero = meta?['zeroResult'];
    final clarification = meta?['clarification'];
    return SearchPage(
      items: items,
      total: (meta?['total'] as num?)?.toInt() ?? items.length,
      page: (meta?['page'] as num?)?.toInt() ?? 1,
      perPage: (meta?['perPage'] as num?)?.toInt() ?? 24,
      hasMore: meta?['hasMore'] as bool? ??
          (((meta?['page'] as num?)?.toInt() ?? 1) *
                  ((meta?['perPage'] as num?)?.toInt() ?? 24) <
              ((meta?['total'] as num?)?.toInt() ?? items.length)),
      explanation: meta?['explanation']?.toString(),
      clarification: SearchClarification.fromJson(
        clarification is Map ? Map<String, dynamic>.from(clarification) : null,
      ),
      zeroResult: ZeroResultHelp.fromJson(
        zero is Map ? Map<String, dynamic>.from(zero) : null,
      ),
      groups: _parseGroups(meta?['groups']),
      parts: _parseParts(meta?['parts']),
      dsl: meta?['dsl'],
      facets: _parseFacets(meta?['facets']),
      contextualAds: _parseAds(meta?['contextualAds']),
    );
  }

  factory SearchPage.fromJson(Map<String, dynamic> json) {
    final itemsRaw = json['items'];
    final items = <ListingModel>[];
    if (itemsRaw is List) {
      for (final row in itemsRaw) {
        if (row is Map) {
          items.add(listingFromSearchJson(Map<String, dynamic>.from(row)));
        }
      }
    }
    return SearchPage(
      items: items,
      total: (json['total'] as num?)?.toInt() ?? items.length,
      page: (json['page'] as num?)?.toInt() ?? 1,
      perPage: (json['perPage'] as num?)?.toInt() ?? 24,
      hasMore: json['hasMore'] as bool? ??
          (((json['page'] as num?)?.toInt() ?? 1) *
                  ((json['perPage'] as num?)?.toInt() ?? 24) <
              ((json['total'] as num?)?.toInt() ?? items.length)),
      explanation: json['explanation']?.toString(),
      clarification: SearchClarification.fromJson(
        json['clarification'] is Map
            ? Map<String, dynamic>.from(json['clarification'] as Map)
            : null,
      ),
      zeroResult: ZeroResultHelp.fromJson(
        json['zeroResult'] is Map
            ? Map<String, dynamic>.from(json['zeroResult'] as Map)
            : null,
      ),
      groups: _parseGroups(json['groups']),
      parts: _parseParts(json['parts']),
      disclaimer: json['disclaimer']?.toString(),
      dsl: json['dsl'],
      facets: _parseFacets(json['facets']),
      contextualAds: _parseAds(json['contextualAds']),
    );
  }

  final List<ListingModel> items;
  final int total;
  final int page;
  final int perPage;
  final bool hasMore;
  final String? explanation;
  final SearchClarification clarification;
  final ZeroResultHelp? zeroResult;
  final Map<String, List<ListingModel>> groups;
  final List<VehiclePartHit> parts;
  final String? disclaimer;
  final Object? dsl;
  final List<FacetGroup> facets;
  final List<ServedAd> contextualAds;

  Map<String, dynamic>? get dslAsMap {
    if (dsl is Map) return Map<String, dynamic>.from(dsl as Map);
    if (dsl is List && (dsl as List).isNotEmpty && (dsl as List).first is Map) {
      return Map<String, dynamic>.from((dsl as List).first as Map);
    }
    return null;
  }

  static Map<String, List<ListingModel>> _parseGroups(dynamic raw) {
    if (raw is! Map) return const {};
    final out = <String, List<ListingModel>>{};
    raw.forEach((key, value) {
      if (value is List) {
        out[key.toString()] = value
            .whereType<Map>()
            .map((e) => listingFromSearchJson(Map<String, dynamic>.from(e)))
            .toList();
      }
    });
    return out;
  }

  static List<VehiclePartHit> _parseParts(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((e) => VehiclePartHit.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  static List<FacetGroup> _parseFacets(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((e) => FacetGroup.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }

  static List<ServedAd> _parseAds(dynamic raw) {
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((e) => ServedAd.fromJson(Map<String, dynamic>.from(e)))
        .toList();
  }
}

class SavedSearchRecord {
  const SavedSearchRecord({
    required this.id,
    required this.name,
    this.originalQuery,
    this.alertFrequency,
    this.newResultCount,
    this.isActive = true,
    this.query = const {},
  });

  factory SavedSearchRecord.fromJson(Map<String, dynamic> json) =>
      SavedSearchRecord(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: (json['name'] ?? '').toString(),
        originalQuery: json['originalQuery']?.toString(),
        alertFrequency: json['alertFrequency']?.toString(),
        newResultCount: (json['newResultCount'] as num?)?.toInt(),
        isActive: json['isActive'] as bool? ?? true,
        query: json['query'] is Map
            ? Map<String, dynamic>.from(json['query'] as Map)
            : const {},
      );

  final int id;
  final String name;
  final String? originalQuery;
  final String? alertFrequency;
  final int? newResultCount;
  final bool isActive;
  final Map<String, dynamic> query;
}
