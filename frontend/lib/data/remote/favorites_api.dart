import '../../core/network/api_client.dart';
import '../models/favorite_models.dart';

class FavoritesApi {
  FavoritesApi(this._client);
  final ApiClient _client;

  Future<FavoritePage> list({
    int page = 1,
    int perPage = 24,
    int? collectionId,
    String? marketplace,
    String? entityType,
    int? categoryId,
    String? q,
    String sort = 'newest',
  }) =>
      _client.get(
        '/favorites',
        queryParameters: {
          'page': page,
          'perPage': perPage,
          'sort': sort,
          'collectionId': ?collectionId,
          if (marketplace != null && marketplace.isNotEmpty) 'marketplace': marketplace,
          'entityType': ?entityType,
          'categoryId': ?categoryId,
          if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
        },
        parserWithMeta: (data, meta) {
          final items = (data as List? ?? [])
              .map((e) => FavoriteItem.fromJson(Map<String, dynamic>.from(e as Map)))
              .toList();
          return FavoritePage(
            items: items,
            page: (meta?['page'] as num?)?.toInt() ?? page,
            perPage: (meta?['perPage'] as num?)?.toInt() ?? perPage,
            total: (meta?['total'] as num?)?.toInt() ?? items.length,
            hasMore: meta?['hasMore'] as bool? ?? false,
          );
        },
      );

  Future<FavoriteStatus> status({int? listingId, String? entityType, int? entityId}) =>
      _client.get(
        '/favorites/status',
        queryParameters: {
          'listingId': ?listingId,
          'entityType': ?entityType,
          'entityId': ?entityId,
        },
        parser: (data) =>
            FavoriteStatus.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<FavoriteItem> save({
    int? listingId,
    String? entityType,
    int? entityId,
    int? collectionId,
  }) =>
      _client.post(
        '/favorites',
        data: {
          'listingId': ?listingId,
          'entityType': ?entityType,
          'entityId': ?entityId,
          'collectionId': ?collectionId,
        },
        parser: (data) {
          final map = Map<String, dynamic>.from(data as Map);
          final favorite = map['favorite'];
          if (favorite is Map) {
            return FavoriteItem.fromJson(Map<String, dynamic>.from(favorite));
          }
          return FavoriteItem.fromJson(map);
        },
      );

  Future<void> remove(int id) => _client.delete('/favorites/$id');

  Future<void> removeEntity({required String entityType, required int entityId}) =>
      _client.delete('/favorites/entity/$entityType/$entityId');

  Future<FavoriteItem> move(int id, int? collectionId) => _client.post(
        '/favorites/$id/move',
        data: {'collectionId': collectionId},
        parser: (data) =>
            FavoriteItem.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<List<FavoriteCollection>> collections() => _client.get(
        '/favorites/collections',
        parser: (data) => (data as List? ?? [])
            .map((e) => FavoriteCollection.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList(),
      );

  Future<FavoriteCollection> createCollection({
    required String name,
    String? description,
    int? parentId,
    int? marketplaceId,
  }) =>
      _client.post(
        '/favorites/collections',
        data: {
          'name': name,
          'description': ?description,
          'parentId': ?parentId,
          'marketplaceId': ?marketplaceId,
        },
        parser: (data) =>
            FavoriteCollection.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<FavoriteCollection> updateCollection(
    int id, {
    String? name,
    int? parentId,
  }) =>
      _client.patch(
        '/favorites/collections/$id',
        data: {
          'name': ?name,
          'parentId': ?parentId,
        },
        parser: (data) =>
            FavoriteCollection.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<void> deleteCollection(int id) =>
      _client.delete('/favorites/collections/$id');

  Future<ShareLink> share({
    required String targetType,
    required int targetId,
    String accessPolicy = 'restricted',
  }) =>
      _client.post(
        '/favorites/share',
        data: {
          'targetType': targetType,
          'targetId': targetId,
          'accessPolicy': accessPolicy,
        },
        parser: (data) => ShareLink.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<Map<String, dynamic>> resolveShare(String token) => _client.get(
        '/share/$token',
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );
}
