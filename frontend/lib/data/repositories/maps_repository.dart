import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/map_models.dart';
import '../remote/maps_api.dart';

class MapsRepository {
  MapsRepository(this._api);
  final MapsApi _api;

  Future<Result<MapDescriptor>> capabilities({String? platform}) async {
    try {
      return Success(await _api.capabilities(platform: platform));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<MapSearchPage>> search({
    String? marketplace,
    Map<String, dynamic>? dsl,
    double? minLat,
    double? maxLat,
    double? minLng,
    double? maxLng,
    double? zoom,
    double? lat,
    double? lng,
    double? radiusKm,
    String? platform,
    String? style,
  }) async {
    try {
      return Success(
        await _api.search(
          marketplace: marketplace,
          dsl: dsl,
          minLat: minLat,
          maxLat: maxLat,
          minLng: minLng,
          maxLng: maxLng,
          zoom: zoom,
          lat: lat,
          lng: lng,
          radiusKm: radiusKm,
          platform: platform,
          style: style,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> directions({
    required double lat,
    required double lng,
    double? originLat,
    double? originLng,
    String? platform,
  }) async {
    try {
      return Success(
        await _api.directions(
          lat: lat,
          lng: lng,
          originLat: originLat,
          originLng: originLng,
          platform: platform,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> streetView({
    required double lat,
    required double lng,
    String? platform,
  }) async {
    try {
      return Success(await _api.streetView(lat: lat, lng: lng, platform: platform));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<NearbyPlace>>> places({
    required double lat,
    required double lng,
    int? listingId,
    String? types,
  }) async {
    try {
      return Success(await _api.places(lat: lat, lng: lng, listingId: listingId, types: types));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<void> track(String eventType, {int? listingId, Map<String, dynamic>? metadata}) =>
      _api.track(eventType: eventType, listingId: listingId, metadata: metadata);
}
