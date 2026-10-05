import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/property_models.dart';
import '../models/vehicle_models.dart';
import '../remote/marketplace_apis.dart';

class VehicleRepository {
  VehicleRepository(this._api);
  final VehiclesApi _api;

  Future<Result<VehicleCatalog>> catalog() async {
    try {
      return Success(await _api.catalog());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ParsedVehicleQuery>> parseQuery(String q) async {
    try {
      return Success(await _api.parseQuery(q));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<VehicleMapMarker>>> markers({
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

  Future<Result<VehicleValuation>> valuate(Map<String, dynamic> body) async {
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

  Future<Result<Map<String, dynamic>>> book(
    String listingId, {
    required String startDate,
    required String endDate,
    String? durationCode,
  }) async {
    try {
      return Success(
        await _api.book(
          listingId,
          startDate: startDate,
          endDate: endDate,
          durationCode: durationCode,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> placeBid(
    String auctionId, {
    required double amount,
    required String idempotencyKey,
  }) async {
    try {
      return Success(
        await _api.placeBid(
          auctionId,
          amount: amount,
          idempotencyKey: idempotencyKey,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<VehiclePart>>> searchParts({
    String? q,
    String? oem,
    String? categoryCode,
    int? makeId,
    int? year,
  }) async {
    try {
      return Success(
        await _api.searchParts(
          q: q,
          oem: oem,
          categoryCode: categoryCode,
          makeId: makeId,
          year: year,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> buyPart(int partId, {int quantity = 1}) async {
    try {
      return Success(await _api.buyPart(partId, quantity: quantity));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<VehicleLandedCost>> landedCost(Map<String, dynamic> body) async {
    try {
      return Success(await _api.landedCost(body));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<VehicleFinanceQuote>> financeQuote(Map<String, dynamic> body) async {
    try {
      return Success(await _api.financeQuote(body));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<VehicleInsuranceQuote>> insuranceQuote(Map<String, dynamic> body) async {
    try {
      return Success(await _api.insuranceQuote(body));
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
