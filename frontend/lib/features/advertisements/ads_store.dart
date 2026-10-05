import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../core/network/api_exception.dart';
import '../reviews/data/review_models.dart';
import 'data/ads_api.dart';

class AdsStore {
  AdsStore(this._api);

  final AdsApi _api;
  final campaigns = signal<AsyncState<List<AdCampaign>>>(const AsyncIdle());
  final advertiser = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final busy = signal(false);
  final errorMessage = signal<String?>(null);

  Future<void> load() async {
    campaigns.value = AsyncLoading(previous: campaigns.value.dataOrNull);
    advertiser.value = AsyncLoading(previous: advertiser.value.dataOrNull);
    try {
      campaigns.value = AsyncData(await _api.campaigns());
    } on ApiException catch (e) {
      campaigns.value = AsyncError(e.message, code: e.code);
    }
    try {
      advertiser.value = AsyncData(await _api.advertiser());
    } on ApiException catch (e) {
      advertiser.value = AsyncError(e.message, code: e.code);
    }
  }

  Future<List<ServedAd>> serve(String code) async {
    try {
      return await _api.serve(code);
    } catch (_) {
      return const [];
    }
  }

  Future<String?> recordImpression(ServedAd ad, {int? listingId}) async {
    try {
      final result = await _api.recordImpression(token: ad.impressionToken, listingId: listingId);
      return result['uuid']?.toString();
    } catch (_) {
      return null;
    }
  }

  int? lastClickId;

  Future<void> recordClick(ServedAd ad, {String? impressionUuid}) async {
    try {
      final result = await _api.recordClick(token: ad.impressionToken, impressionUuid: impressionUuid);
      lastClickId = (result['clickId'] as num?)?.toInt();
    } catch (_) {}
  }

  Future<void> recordConversion({required String kind}) async {
    final clickId = lastClickId;
    if (clickId == null) return;
    try {
      await _api.conversion(clickId: clickId, kind: kind);
    } catch (_) {}
  }
}
