import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/property_models.dart';
import '../remote/marketplace_apis.dart';

class PropertyRepository {
  PropertyRepository(this._api);
  final PropertyApi _api;

  Future<Result<PropertyCatalog>> catalog() async {
    try {
      return Success(await _api.catalog());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ParsedPropertyQuery>> parseQuery(String q) async {
    try {
      return Success(await _api.parseQuery(q));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<PropertyMapMarker>>> markers({
    required double minLat,
    required double maxLat,
    required double minLng,
    required double maxLng,
  }) async {
    try {
      return Success(
        await _api.markers(
          minLat: minLat,
          maxLat: maxLat,
          minLng: minLng,
          maxLng: maxLng,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> badges(String listingId) async {
    try {
      return Success(await _api.badges(listingId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<PropertyValuation>> valuate(Map<String, dynamic> body) async {
    try {
      return Success(await _api.valuate(body));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> createOffer(
    String listingId, {
    required double amount,
    String? message,
  }) async {
    try {
      return Success(
        await _api.createOffer(listingId, amount: amount, message: message),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> buy(String listingId) async {
    try {
      return Success(await _api.buy(listingId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> apply(
    String listingId, {
    String? message,
  }) async {
    try {
      return Success(await _api.apply(listingId, message: message));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> book(
    String listingId, {
    required String checkIn,
    required String checkOut,
  }) async {
    try {
      return Success(
        await _api.book(listingId, checkIn: checkIn, checkOut: checkOut),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<SavedSearchItem>>> savedSearches() async {
    try {
      return Success(await _api.savedSearches());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<SavedSearchItem>> saveSearch({
    required String name,
    required Map<String, dynamic> query,
  }) async {
    try {
      return Success(await _api.saveSearch(name: name, query: query));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<void>> deleteSavedSearch(int id) async {
    try {
      await _api.deleteSavedSearch(id);
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
