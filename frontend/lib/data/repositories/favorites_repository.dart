import 'dart:convert';

import '../../core/database/app_database.dart';
import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../../core/storage/prefs_storage.dart';
import '../models/favorite_models.dart';
import '../remote/favorites_api.dart';

class FavoritesRepository {
  FavoritesRepository(this._api, this._database, this._prefs);

  final FavoritesApi _api;
  final AppDatabase _database;
  final PrefsStorage _prefs;

  Future<Result<FavoritePage>> list({
    int page = 1,
    int perPage = 24,
    int? collectionId,
    String? marketplace,
    String? entityType,
    String? q,
    String sort = 'newest',
  }) async {
    try {
      return Success(
        await _api.list(
          page: page,
          perPage: perPage,
          collectionId: collectionId,
          marketplace: marketplace,
          entityType: entityType,
          q: q,
          sort: sort,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<FavoriteItem>> save({
    int? listingId,
    String entityType = 'listing',
    int? entityId,
    int? collectionId,
  }) async {
    try {
      return Success(
        await _api.save(
          listingId: listingId,
          entityType: listingId == null ? entityType : null,
          entityId: listingId == null ? entityId : null,
          collectionId: collectionId,
        ),
      );
    } on ApiException catch (e) {
      if (e is NetworkException) {
        await _database.enqueueOutbox(
          method: 'POST',
          path: '/favorites',
          bodyJson: jsonEncode({
            'listingId': ?listingId,
            'entityType': entityType,
            'entityId': ?entityId,
            'collectionId': ?collectionId,
          }),
        );
      }
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<void>> remove(int id) async {
    try {
      await _api.remove(id);
      return const Success(null);
    }     on ApiException catch (e) {
      if (e is NetworkException) {
        await _database.enqueueOutbox(method: 'DELETE', path: '/favorites/$id');
      }
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<void>> removeEntity({required String entityType, required int entityId}) async {
    try {
      await _api.removeEntity(entityType: entityType, entityId: entityId);
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<FavoriteStatus>> status({int? listingId, String? entityType, int? entityId}) async {
    try {
      return Success(await _api.status(listingId: listingId, entityType: entityType, entityId: entityId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<FavoriteCollection>>> collections() async {
    try {
      return Success(await _api.collections());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<FavoriteCollection>> createCollection({
    required String name,
    String? description,
    int? parentId,
    int? marketplaceId,
  }) async {
    try {
      return Success(
        await _api.createCollection(
          name: name,
          description: description,
          parentId: parentId,
          marketplaceId: marketplaceId,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<FavoriteCollection>> renameCollection(int id, String name) async {
    try {
      return Success(await _api.updateCollection(id, name: name));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<void>> deleteCollection(int id) async {
    try {
      await _api.deleteCollection(id);
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<FavoriteItem>> move(int id, int? collectionId) async {
    try {
      return Success(await _api.move(id, collectionId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ShareLink>> share({
    required String targetType,
    required int targetId,
    String accessPolicy = 'restricted',
  }) async {
    try {
      return Success(
        await _api.share(targetType: targetType, targetId: targetId, accessPolicy: accessPolicy),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> resolveShare(String token) async {
    try {
      return Success(await _api.resolveShare(token));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<void> flushOutbox() async {
    final pending = await _database.pendingOutbox();
    for (final entry in pending) {
      try {
        if (entry.method == 'POST' && entry.path == '/favorites') {
          final body = entry.bodyJson == null
              ? <String, dynamic>{}
              : jsonDecode(entry.bodyJson!) as Map<String, dynamic>;
          await _api.save(
            listingId: (body['listingId'] as num?)?.toInt(),
            entityType: body['entityType']?.toString(),
            entityId: (body['entityId'] as num?)?.toInt(),
            collectionId: (body['collectionId'] as num?)?.toInt(),
          );
        } else if (entry.method == 'DELETE' && entry.path.startsWith('/favorites/')) {
          await _api.remove(int.parse(entry.path.split('/').last));
        }
        await _database.markOutboxDone(entry.id);
      } catch (_) {
        await _database.incrementOutboxRetry(entry.id);
      }
    }
  }

  Future<void> setPendingAction(PendingFavoriteAction action) async {
    await _prefs.setString(PrefsKeys.pendingFavorite, jsonEncode(action.toJson()));
  }

  PendingFavoriteAction? takePendingAction() {
    final raw = _prefs.getString(PrefsKeys.pendingFavorite);
    if (raw == null || raw.isEmpty) return null;
    _prefs.remove(PrefsKeys.pendingFavorite);
    try {
      return PendingFavoriteAction.fromJson(
        Map<String, dynamic>.from(jsonDecode(raw) as Map),
      );
    } catch (_) {
      return null;
    }
  }
}
