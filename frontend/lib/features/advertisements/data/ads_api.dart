import '../../../core/network/api_client.dart';
import '../../reviews/data/review_models.dart';

class AdsApi {
  AdsApi(this._client);
  final ApiClient _client;

  Future<List<ServedAd>> serve(String placementCode, {int? categoryId, String? q}) => _client.get(
        '/ads/serve/$placementCode',
        queryParameters: {
          'categoryId': ?categoryId,
          if (q != null && q.isNotEmpty) 'q': q,
        },
        parser: parseServedAds,
      );

  Future<Map<String, dynamic>> recordImpression({
    required String token,
    bool viewable = true,
    int? listingId,
  }) =>
      _client.post(
        '/ads/impressions',
        data: {
          'token': token,
          'viewable': viewable,
          'listingId': ?listingId,
        },
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );

  Future<Map<String, dynamic>> recordClick({required String token, String? impressionUuid}) => _client.post(
        '/ads/clicks',
        data: {
          'token': token,
          'impressionUuid': ?impressionUuid,
        },
        parser: (data) => Map<String, dynamic>.from(data as Map? ?? {}),
      );

  Future<void> conversion({int? clickId, required String kind}) => _client.post(
        '/ads/conversions',
        data: {
          'clickId': ?clickId,
          'kind': kind,
        },
        parser: (_) {},
      );

  Future<List<AdCampaign>> campaigns() => _client.get(
        '/ads/campaigns',
        parser: (data) {
          if (data is! List) return const <AdCampaign>[];
          return [
            for (final row in data)
              if (row is Map) AdCampaign.fromJson(Map<String, dynamic>.from(row)),
          ];
        },
      );

  Future<Map<String, dynamic>> advertiser() => _client.get(
        '/ads/advertiser',
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );

  Future<Map<String, dynamic>> createCampaign(Map<String, dynamic> body) => _client.post(
        '/ads/campaigns',
        data: body,
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );

  Future<Map<String, dynamic>> campaign(String uuid) => _client.get(
        '/ads/campaigns/$uuid',
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );

  Future<Map<String, dynamic>> addCreative(String uuid, Map<String, dynamic> body) => _client.post(
        '/ads/campaigns/$uuid/creatives',
        data: body,
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );

  Future<Map<String, dynamic>> submit(String uuid) => _client.post(
        '/ads/campaigns/$uuid/submit',
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );

  Future<Map<String, dynamic>> pause(String uuid) => _client.post(
        '/ads/campaigns/$uuid/pause',
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );

  Future<Map<String, dynamic>> fund(String uuid, {required double amount, required String gatewayCode}) =>
      _client.post(
        '/ads/campaigns/$uuid/fund',
        data: {'amount': amount, 'gatewayCode': gatewayCode},
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );
}
