import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/favorite_models.dart';
import '../../data/models/listing_model.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/repositories/favorites_repository.dart';
import '../../data/services/realtime_client.dart';

class FavoritesStore {
  FavoritesStore(this._repo, this._auth, [this._realtime]);

  final FavoritesRepository _repo;
  final AuthRepository _auth;
  final RealtimeClient? _realtime;

  final items = signal<AsyncState<List<FavoriteItem>>>(const AsyncIdle());
  final collections = signal<AsyncState<List<FavoriteCollection>>>(const AsyncIdle());
  final savedIds = signal<Set<String>>({});
  final marketplaceFilter = signal<String?>(null);
  final collectionFilter = signal<int?>(null);
  final query = signal('');
  final sort = signal('newest');
  final errorMessage = signal<String?>(null);

  StreamSubscription<RealtimeEvent>? _sub;
  int _page = 1;
  bool _hasMore = true;
  bool _loadingMore = false;

  bool get isGuest => _auth.isGuest || !_auth.hasActiveSession;

  void listen() {
    _sub?.cancel();
    _sub = _realtime?.events.listen((event) {
      if (event.name == 'favorite:created' ||
          event.name == 'favorite:removed' ||
          event.name == 'collection:updated' ||
          event.name == 'compare:updated' ||
          event.name == 'connected') {
        unawaited(load());
        unawaited(_repo.flushOutbox());
      }
    });
  }

  void dispose() {
    _sub?.cancel();
  }

  Future<void> load() async {
    if (isGuest) {
      items.value = const AsyncData([]);
      collections.value = const AsyncData([]);
      return;
    }
    _page = 1;
    items.value = AsyncLoading(previous: items.value.dataOrNull);
    collections.value = AsyncLoading(previous: collections.value.dataOrNull);
    await _repo.flushOutbox();
    final result = await _repo.list(
      page: 1,
      collectionId: collectionFilter.value,
      marketplace: marketplaceFilter.value,
      q: query.value,
      sort: sort.value,
    );
    result.when(
      success: (page) {
        _hasMore = page.hasMore;
        items.value = AsyncData(page.items);
        savedIds.value = {
          for (final item in page.items)
            if (item.listingId != null) item.listingId.toString(),
        };
      },
      failure: (m, code) => items.value = AsyncError(m, code: code),
    );
    final cols = await _repo.collections();
    cols.when(
      success: (list) => collections.value = AsyncData(list),
      failure: (m, code) => collections.value = AsyncError(m, code: code),
    );
  }

  Future<void> loadMore() async {
    if (!_hasMore || _loadingMore || isGuest) return;
    _loadingMore = true;
    _page += 1;
    final result = await _repo.list(
      page: _page,
      collectionId: collectionFilter.value,
      marketplace: marketplaceFilter.value,
      q: query.value,
      sort: sort.value,
    );
    result.when(
      success: (page) {
        _hasMore = page.hasMore;
        final current = items.value.dataOrNull ?? const <FavoriteItem>[];
        items.value = AsyncData([...current, ...page.items]);
      },
      failure: (_, _) {},
    );
    _loadingMore = false;
  }

  Future<void> setMarketplace(String? code) async {
    marketplaceFilter.value = code;
    await load();
  }

  Future<void> setCollection(int? id) async {
    collectionFilter.value = id;
    await load();
  }

  Future<void> setSort(String next) async {
    sort.value = next;
    await load();
  }

  Future<void> search(String next) async {
    query.value = next;
    await load();
  }

  bool isSaved(String listingId) => savedIds.value.contains(listingId);

  Future<Result<void>> toggleListing(ListingModel listing) async {
    final id = int.tryParse(listing.id);
    if (id == null) return const Failure('Invalid listing');
    if (isSaved(listing.id)) {
      final current = items.value.dataOrNull ?? const <FavoriteItem>[];
      final matches = current.where((item) => item.listingId == id);
      final match = matches.isEmpty ? null : matches.first;
      if (match != null) {
        final result = await _repo.remove(match.id);
        if (result.isSuccess) {
          savedIds.value = {...savedIds.value}..remove(listing.id);
          items.value = AsyncData(current.where((item) => item.id != match.id).toList());
        }
        return result;
      }
      final result = await _repo.removeEntity(entityType: 'listing', entityId: id);
      if (result.isSuccess) {
        savedIds.value = {...savedIds.value}..remove(listing.id);
      }
      return result;
    }
    final result = await _repo.save(listingId: id);
    return result.when(
      success: (item) {
        savedIds.value = {...savedIds.value, listing.id};
        final current = items.value.dataOrNull ?? const <FavoriteItem>[];
        items.value = AsyncData([item, ...current]);
        return const Success<void>(null);
      },
      failure: (m, code) => Failure<void>(m, code: code),
    );
  }

  Future<Result<void>> togglePart({required int partId}) async {
    final result = await _repo.save(entityType: 'vehicle_part', entityId: partId);
    return result.when(
      success: (_) {
        unawaited(load());
        return const Success<void>(null);
      },
      failure: (m, code) => Failure<void>(m, code: code),
    );
  }

  Future<Result<FavoriteCollection>> createCollection(String name, {int? parentId, int? marketplaceId}) async {
    final result = await _repo.createCollection(name: name, parentId: parentId, marketplaceId: marketplaceId);
    if (result.isSuccess) await load();
    return result;
  }

  Future<Result<void>> renameCollection(int id, String name) async {
    final result = await _repo.renameCollection(id, name);
    if (result.isSuccess) await load();
    return result.when(
      success: (_) => const Success<void>(null),
      failure: (m, code) => Failure<void>(m, code: code),
    );
  }

  Future<Result<void>> deleteCollection(int id) async {
    final result = await _repo.deleteCollection(id);
    if (result.isSuccess) {
      if (collectionFilter.value == id) collectionFilter.value = null;
      await load();
    }
    return result;
  }

  Future<Result<void>> moveFavorite(int favoriteId, int? collectionId) async {
    final result = await _repo.move(favoriteId, collectionId);
    if (result.isSuccess) await load();
    return result.when(
      success: (_) => const Success<void>(null),
      failure: (m, code) => Failure<void>(m, code: code),
    );
  }

  Future<Result<ShareLink>> share({required String targetType, required int targetId}) {
    return _repo.share(targetType: targetType, targetId: targetId);
  }

  Future<void> consumePendingAction() async {
    if (isGuest) return;
    final pending = _repo.takePendingAction();
    if (pending == null) return;
    await _repo.save(
      listingId: pending.listingId,
      entityType: pending.entityType,
      entityId: pending.entityId,
    );
    await load();
  }

  Future<void> rememberGuestSave({
    required int entityId,
    String entityType = 'listing',
    int? listingId,
    String? marketplaceCode,
    String? route,
  }) {
    return _repo.setPendingAction(
      PendingFavoriteAction(
        listingId: listingId ?? (entityType == 'listing' ? entityId : null),
        entityType: entityType,
        entityId: entityId,
        marketplaceCode: marketplaceCode,
        route: route,
      ),
    );
  }
}
