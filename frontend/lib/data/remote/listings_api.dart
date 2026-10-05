import '../../core/network/api_client.dart';
import '../models/create_listing_input.dart';
import '../models/listing_feed_query.dart';
import '../models/listing_model.dart';

class ListingsApi {
  ListingsApi(this._client);
  final ApiClient _client;

  Future<ListingsPage> fetch(ListingFeedQuery query) => _client.get(
        '/listings',
        queryParameters: query.toQueryParameters(),
        parserWithMeta: (data, meta) {
          if (data is List) {
            final items = data
                .map((e) => ListingModel.fromJson(e as Map<String, dynamic>))
                .toList();
            return ListingsPage(
              items: items,
              page: (meta?['page'] as num?)?.toInt() ?? 1,
              total: (meta?['total'] as num?)?.toInt() ?? items.length,
              hasMore: meta?['hasMore'] as bool? ?? false,
              nextCursor: meta?['nextCursor']?.toString(),
            );
          }
          return ListingsPage.fromJson(data);
        },
      );

  Future<ListingModel> getById(String id) => _client.get(
        '/listings/$id',
        parser: (d) => ListingModel.fromJson(d as Map<String, dynamic>),
      );

  Future<ListingsPage> mine({String? marketplace, int page = 1}) => _client.get(
        '/listings/mine',
        queryParameters: {
          'marketplace': ?marketplace,
          'page': page,
          'perPage': 50,
          'sort': 'newest',
        },
        parserWithMeta: (data, meta) {
          if (data is List) {
            final items = data
                .map((e) => ListingModel.fromJson(e as Map<String, dynamic>))
                .toList();
            return ListingsPage(
              items: items,
              page: (meta?['page'] as num?)?.toInt() ?? 1,
              total: (meta?['total'] as num?)?.toInt() ?? items.length,
              hasMore: meta?['hasMore'] as bool? ?? false,
              nextCursor: meta?['nextCursor']?.toString(),
            );
          }
          return ListingsPage.fromJson(data);
        },
      );

  Future<CreateListingResult> create(CreateListingRequest request) =>
      _client.post(
        '/listings',
        data: request.toJson(),
        parser: (d) {
          final map = d as Map<String, dynamic>;
          // Backend returns { listing, warnings } or the listing object itself.
          final listingJson = map['listing'] is Map
              ? Map<String, dynamic>.from(map['listing'] as Map)
              : map;
          final warnings = (map['warnings'] as List?)
                  ?.map((e) => e.toString())
                  .toList() ??
              const <String>[];
          return CreateListingResult(
            listing: ListingModel.fromJson(listingJson),
            warnings: warnings,
          );
        },
      );

  Future<Map<String, dynamic>> addMedia(
    String listingId, {
    required String url,
    String? thumbUrl,
    String kind = 'image',
    bool isPrimary = false,
  }) =>
      _client.post(
        '/listings/$listingId/media',
        data: {
          'url': url,
          'thumbUrl': ?thumbUrl,
          'kind': kind,
          'isPrimary': isPrimary,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> saveDraft({
    String? uuid,
    required int marketplaceId,
    int? categoryId,
    int? step,
    required Map<String, dynamic> data,
  }) =>
      _client.put(
        '/listings/drafts',
        data: {
          'uuid': ?uuid,
          'marketplaceId': marketplaceId,
          'categoryId': ?categoryId,
          'step': ?step,
          'data': data,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<List<Map<String, dynamic>>> listDrafts() => _client.get(
        '/listings/drafts',
        parser: (d) {
          final list = d is List ? d : (d as Map)['items'] as List? ?? const [];
          return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        },
      );

  Future<Map<String, dynamic>> submit(String id) => _client.post(
        '/listings/$id/submit',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> archive(String id, {String? reason}) =>
      _client.post(
        '/listings/$id/archive',
        data: {'reason': ?reason},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> restore(String id) => _client.post(
        '/listings/$id/restore',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> renew(String id) => _client.post(
        '/listings/$id/renew',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> appeal(String id, String note) => _client.post(
        '/listings/$id/appeal',
        data: {'note': note},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> setTransaction(
    String id, {
    required String status,
    DateTime? startsAt,
    DateTime? endsAt,
  }) =>
      _client.post(
        '/listings/$id/transaction',
        data: {
          'status': status,
          if (startsAt != null) 'startsAt': startsAt.toIso8601String(),
          if (endsAt != null) 'endsAt': endsAt.toIso8601String(),
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> promote(
    String id, {
    String? packageCode,
    String? kind,
    int days = 7,
    bool useQuota = true,
  }) =>
      _client.post(
        '/listings/$id/promotions',
        data: {
          'packageCode': ?packageCode,
          'kind': ?kind,
          'days': days,
          'useQuota': useQuota,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<List<Map<String, dynamic>>> promotionPackages() => _client.get(
        '/listings/promotion-packages',
        parser: (d) {
          final list = d is List ? d : const [];
          return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        },
      );

  Future<List<Map<String, dynamic>>> promotions(String id) => _client.get(
        '/listings/$id/promotions',
        parser: (d) {
          final list = d is List ? d : const [];
          return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        },
      );

  Future<Map<String, dynamic>> analytics(String id, {int days = 30}) =>
      _client.get(
        '/listings/$id/analytics',
        queryParameters: {'days': days},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<List<Map<String, dynamic>>> events(String id) => _client.get(
        '/listings/$id/events',
        parser: (d) {
          final list = d is List ? d : const [];
          return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        },
      );
}
