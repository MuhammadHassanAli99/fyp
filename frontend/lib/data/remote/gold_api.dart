import '../../core/network/api_client.dart';
import '../models/gold_models.dart';

class GoldApi {
  GoldApi(this._client);
  final ApiClient _client;

  Future<GoldCatalog> catalog() => _client.get(
        '/gold/catalog',
        parser: (d) => GoldCatalog.fromJson(d as Map<String, dynamic>),
      );

  Future<GoldRatesResponse> rates({String? karat}) => _client.get(
        '/gold/rates',
        queryParameters: {
          'karat': ?karat,
        },
        parser: (d) => GoldRatesResponse.fromJson(d as Map<String, dynamic>),
      );

  Future<List<Map<String, dynamic>>> rateHistory({
    int karat = 24,
    int days = 30,
  }) =>
      _client.get(
        '/gold/rates/history',
        queryParameters: {'karat': karat, 'days': days},
        parser: (d) {
          final map = d as Map<String, dynamic>;
          final points = map['points'] as List? ?? [];
          return points
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList();
        },
      );

  Future<List<GoldForecast>> forecast({int karat = 24}) => _client.get(
        '/gold/rates/forecast',
        queryParameters: {'karat': karat},
        parser: (d) {
          final map = d as Map<String, dynamic>;
          return (map['predictions'] as List? ?? [])
              .whereType<Map>()
              .map((e) => GoldForecast.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<GoldRiskAssessment> assessListing(String listingId) => _client.post(
        '/gold/listings/$listingId/assess',
        parser: (d) => GoldRiskAssessment.fromJson(d as Map<String, dynamic>),
      );

  Future<GoldBuyResult> buy(
    String listingId, {
    String gatewayCode = 'manual',
    int quantity = 1,
  }) =>
      _client.post(
        '/gold/listings/$listingId/buy',
        data: {'gatewayCode': gatewayCode, 'quantity': quantity},
        parser: (d) => GoldBuyResult.fromJson(d as Map<String, dynamic>),
      );

  Future<Map<String, dynamic>> placeBid(
    String auctionId, {
    required double amount,
    required String idempotencyKey,
  }) =>
      _client.post(
        '/gold/auctions/$auctionId/bids',
        data: {'amount': amount, 'idempotencyKey': idempotencyKey},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> quote({
    required double karat,
    required double weight,
    String weightUnit = 'gram',
    double? stoneWeightG,
    double? makingCharges,
    String? makingChargeType,
  }) =>
      _client.post(
        '/gold/quote',
        data: {
          'karat': karat,
          'weight': weight,
          'weightUnit': weightUnit,
          'stoneWeightG': ?stoneWeightG,
          'makingCharges': ?makingCharges,
          'makingChargeType': ?makingChargeType,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );
}
