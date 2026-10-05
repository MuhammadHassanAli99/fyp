import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../local/settings_local.dart';
import '../models/create_listing_input.dart';
import '../models/listing_feed_query.dart';
import '../models/listing_model.dart';
import '../remote/listings_api.dart';

class ListingsRepository {
  ListingsRepository({
    required this._api,
    required this._cache,
  });

  final ListingsApi _api;
  final ListingCacheLocal _cache;

  Future<Result<ListingsPage>> fetch(ListingFeedQuery query) async {
    try {
      final page = await _api.fetch(query);
      await _cache.cacheListings(query.marketplace, page.items);
      return Success(page);
    } on ApiException catch (e) {
      final cached = await _cache.getCached(query.marketplace);
      if (cached.isNotEmpty) {
        return Success(ListingsPage(items: cached));
      }
      return Failure(e.message, code: e.code);
    } catch (e) {
      final cached = await _cache.getCached(query.marketplace);
      if (cached.isNotEmpty) {
        return Success(ListingsPage(items: cached));
      }
      return Failure(e.toString());
    }
  }

  Future<Result<ListingModel>> getById(String id) async {
    try {
      final listing = await _api.getById(id);
      return Success(listing);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ListingsPage>> mine({String? marketplace}) async {
    try {
      return Success(await _api.mine(marketplace: marketplace));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<CreateListingResult>> create(CreateListingRequest request) async {
    try {
      return Success(await _api.create(request));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> addMedia(
    String listingId, {
    required String url,
    String? thumbUrl,
    String kind = 'image',
    bool isPrimary = false,
  }) async {
    try {
      return Success(
        await _api.addMedia(
          listingId,
          url: url,
          thumbUrl: thumbUrl,
          kind: kind,
          isPrimary: isPrimary,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> saveDraft({
    String? uuid,
    required int marketplaceId,
    int? categoryId,
    int? step,
    required Map<String, dynamic> data,
  }) async {
    try {
      return Success(
        await _api.saveDraft(
          uuid: uuid,
          marketplaceId: marketplaceId,
          categoryId: categoryId,
          step: step,
          data: data,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> submit(String id) => _wrap(() => _api.submit(id));
  Future<Result<Map<String, dynamic>>> archive(String id) => _wrap(() => _api.archive(id));
  Future<Result<Map<String, dynamic>>> restore(String id) => _wrap(() => _api.restore(id));
  Future<Result<Map<String, dynamic>>> renew(String id) => _wrap(() => _api.renew(id));
  Future<Result<Map<String, dynamic>>> appeal(String id, String note) =>
      _wrap(() => _api.appeal(id, note));
  Future<Result<Map<String, dynamic>>> setTransaction(String id, String status) =>
      _wrap(() => _api.setTransaction(id, status: status));
  Future<Result<Map<String, dynamic>>> promote(
    String id, {
    String? packageCode,
    String? kind,
    bool useQuota = true,
  }) =>
      _wrap(
        () => _api.promote(
          id,
          packageCode: packageCode,
          kind: kind,
          useQuota: useQuota,
        ),
      );
  Future<Result<List<Map<String, dynamic>>>> promotionPackages() =>
      _wrapList(() => _api.promotionPackages());
  Future<Result<List<Map<String, dynamic>>>> promotions(String id) =>
      _wrapList(() => _api.promotions(id));
  Future<Result<Map<String, dynamic>>> analytics(String id) =>
      _wrap(() => _api.analytics(id));
  Future<Result<List<Map<String, dynamic>>>> events(String id) =>
      _wrapList(() => _api.events(id));

  Future<Result<Map<String, dynamic>>> _wrap(
    Future<Map<String, dynamic>> Function() run,
  ) async {
    try {
      return Success(await run());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<Map<String, dynamic>>>> _wrapList(
    Future<List<Map<String, dynamic>>> Function() run,
  ) async {
    try {
      return Success(await run());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
