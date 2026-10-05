import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/gold_models.dart';
import '../remote/gold_api.dart';

class GoldRepository {
  GoldRepository(this._api);
  final GoldApi _api;

  Future<Result<GoldCatalog>> catalog() async {
    try {
      return Success(await _api.catalog());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<GoldRatesResponse>> rates({String? karat}) async {
    try {
      return Success(await _api.rates(karat: karat));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<GoldForecast>>> forecast({int karat = 24}) async {
    try {
      return Success(await _api.forecast(karat: karat));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<GoldRiskAssessment>> assessListing(String listingId) async {
    try {
      return Success(await _api.assessListing(listingId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<GoldBuyResult>> buy(String listingId) async {
    try {
      return Success(await _api.buy(listingId));
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

  Future<Result<Map<String, dynamic>>> quote({
    required double karat,
    required double weight,
    double? stoneWeightG,
    double? makingCharges,
    String? makingChargeType,
  }) async {
    try {
      return Success(
        await _api.quote(
          karat: karat,
          weight: weight,
          stoneWeightG: stoneWeightG,
          makingCharges: makingCharges,
          makingChargeType: makingChargeType,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
