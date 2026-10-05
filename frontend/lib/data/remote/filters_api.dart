import '../../core/network/api_client.dart';
import '../models/filter_models.dart';

class FiltersApi {
  FiltersApi(this._client);
  final ApiClient _client;

  Future<List<FilterDefinition>> definitions({
    String? marketplace,
    String? category,
    String? subcategory,
  }) =>
      _client.get(
        '/filters/definitions',
        queryParameters: {
          'marketplace': ?marketplace,
          'category': ?category,
          'subcategory': ?subcategory,
        },
        parser: (d) {
          if (d is! List) return const <FilterDefinition>[];
          return d
              .whereType<Map>()
              .map((e) => FilterDefinition.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<List<FilterLookupItem>> lookups({
    required String key,
    String? marketplace,
    String? parentKey,
    String? parentValue,
    String? q,
    int? countryId,
  }) =>
      _client.get(
        '/filters/lookups',
        queryParameters: {
          'key': key,
          'marketplace': ?marketplace,
          'parentKey': ?parentKey,
          'parentValue': ?parentValue,
          'q': ?q,
          'countryId': ?countryId,
        },
        parser: (d) {
          if (d is! List) return const <FilterLookupItem>[];
          return d
              .whereType<Map>()
              .map((e) => FilterLookupItem.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<Map<String, dynamic>> validate({
    String? marketplace,
    String? category,
    Map<String, dynamic>? values,
  }) =>
      _client.post(
        '/filters/validate',
        data: {
          'marketplace': ?marketplace,
          'category': ?category,
          'values': ?values,
        },
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );
}
