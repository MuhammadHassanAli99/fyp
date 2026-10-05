import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/search_models.dart';
import '../remote/search_api.dart';

class SearchRepository {
  SearchRepository(this._api);
  final SearchApi _api;

  Future<Result<SearchPage>> search({
    required String query,
    String? marketplace,
    String searchType = 'text',
    bool useAi = false,
    double? lat,
    double? lng,
    double? radiusKm,
    int page = 1,
    String? sort,
    Map<String, dynamic>? dsl,
  }) async {
    try {
      return Success(
        await _api.search(
          query: query,
          marketplace: marketplace,
          searchType: searchType,
          useAi: useAi,
          lat: lat,
          lng: lng,
          radiusKm: radiusKm,
          page: page,
          sort: sort,
          dsl: dsl,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<SearchSuggestion>>> suggest(String prefix) async {
    try {
      return Success(await _api.suggest(prefix));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<List<RecentSearchItem>>> recent() async {
    try {
      return Success(await _api.recent());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<List<TrendingSearchItem>>> trending() async {
    try {
      return Success(await _api.trending());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<List<SavedSearchRecord>>> saved() async {
    try {
      return Success(await _api.saved());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<SavedSearchRecord>> save({
    required String name,
    required Map<String, dynamic> query,
    String? originalQuery,
    String alertFrequency = 'instant',
  }) async {
    try {
      return Success(
        await _api.save(
          name: name,
          query: query,
          originalQuery: originalQuery,
          alertFrequency: alertFrequency,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<void>> deleteSaved(int id) async {
    try {
      await _api.deleteSaved(id);
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<void>> updateSaved(
    int id, {
    String? alertFrequency,
    bool? isActive,
  }) async {
    try {
      await _api.updateSaved(id, alertFrequency: alertFrequency, isActive: isActive);
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<void>> deleteRecent(int id) async {
    try {
      await _api.deleteRecent(id);
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<void>> clearRecent() async {
    try {
      await _api.clearRecent();
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<SearchPage>> voice({String? transcript, String? audioUrl}) async {
    try {
      return Success(await _api.voice(transcript: transcript, audioUrl: audioUrl));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<SearchPage>> image({required String imageUrl}) async {
    try {
      return Success(await _api.image(imageUrl: imageUrl));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<void> trackClick({required String listingId, String? query, int? position}) =>
      _api.track(
        eventType: 'click',
        listingId: listingId,
        query: query,
        position: position,
      );

  Future<void> trackImpression({
    required String listingId,
    String? query,
    int? position,
  }) =>
      _api.track(
        eventType: 'impression',
        listingId: listingId,
        query: query,
        position: position,
      );
}
