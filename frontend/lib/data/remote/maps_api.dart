import '../../core/network/api_client.dart';
import '../models/map_models.dart';

class MapsApi {
  MapsApi(this._client);
  final ApiClient _client;

  Future<MapDescriptor> capabilities({String? provider, String? platform}) =>
      _client.get(
        '/maps/capabilities',
        queryParameters: {
          'provider': ?provider,
          'platform': ?platform,
        },
        parser: (d) => MapDescriptor.fromJson(d as Map<String, dynamic>),
      );

  Future<MapSearchPage> search({
    String? marketplace,
    Map<String, dynamic>? dsl,
    Map<String, dynamic>? filters,
    double? minLat,
    double? maxLat,
    double? minLng,
    double? maxLng,
    double? zoom,
    double? lat,
    double? lng,
    double? radiusKm,
    String? provider,
    String? platform,
    String? style,
  }) =>
      _client.post(
        '/maps/search',
        data: {
          'marketplace': ?marketplace,
          'dsl': ?dsl,
          'filters': ?filters,
          if (minLat != null && maxLat != null && minLng != null && maxLng != null)
            'bounds': {
              'minLat': minLat,
              'maxLat': maxLat,
              'minLng': minLng,
              'maxLng': maxLng,
            },
          'zoom': ?zoom,
          'lat': ?lat,
          'lng': ?lng,
          'radiusKm': ?radiusKm,
          'provider': ?provider,
          'platform': ?platform,
          'style': ?style,
        },
        parser: (d) => MapSearchPage.fromJson(d as Map<String, dynamic>),
      );

  Future<Map<String, dynamic>> directions({
    required double lat,
    required double lng,
    double? originLat,
    double? originLng,
    String? provider,
    String? platform,
  }) =>
      _client.get(
        '/maps/directions',
        queryParameters: {
          'lat': lat,
          'lng': lng,
          'originLat': ?originLat,
          'originLng': ?originLng,
          'provider': ?provider,
          'platform': ?platform,
        },
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );

  Future<Map<String, dynamic>> streetView({
    required double lat,
    required double lng,
    String? provider,
    String? platform,
  }) =>
      _client.get(
        '/maps/street-view',
        queryParameters: {
          'lat': lat,
          'lng': lng,
          'provider': ?provider,
          'platform': ?platform,
        },
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );

  Future<DistanceValue> distance({
    required double fromLat,
    required double fromLng,
    required double toLat,
    required double toLng,
    String unit = 'km',
  }) =>
      _client.get(
        '/maps/distance',
        queryParameters: {
          'fromLat': fromLat,
          'fromLng': fromLng,
          'toLat': toLat,
          'toLng': toLng,
          'unit': unit,
        },
        parser: (d) => DistanceValue.fromJson(d as Map<String, dynamic>),
      );

  Future<List<NearbyPlace>> places({
    required double lat,
    required double lng,
    int? radiusM,
    String? types,
    int? listingId,
  }) =>
      _client.get(
        '/maps/places',
        queryParameters: {
          'lat': lat,
          'lng': lng,
          'radiusM': ?radiusM,
          'types': ?types,
          'listingId': ?listingId,
        },
        parser: (d) {
          final items = d is Map ? d['items'] : d;
          if (items is! List) return const <NearbyPlace>[];
          return items
              .whereType<Map>()
              .map((e) => NearbyPlace.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<void> track({
    required String eventType,
    int? listingId,
    Map<String, dynamic>? metadata,
  }) =>
      _client.post(
        '/maps/events',
        data: {
          'eventType': eventType,
          'listingId': ?listingId,
          'metadata': ?metadata,
        },
        parser: (_) {},
      );
}
