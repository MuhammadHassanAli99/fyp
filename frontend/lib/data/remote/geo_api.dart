import '../../core/network/api_client.dart';
import '../models/locale_models.dart';
import '../models/map_models.dart';

class GeoApi {
  GeoApi(this._client);
  final ApiClient _client;

  Future<List<RegionModel>> regions(int countryId) => _client.get(
        '/geo/countries/$countryId/regions',
        parser: (d) => (d as List)
            .map((e) => RegionModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<List<CityModel>> cities(
    int countryId, {
    int? regionId,
    String? search,
    bool popular = false,
    int limit = 50,
  }) =>
      _client.get(
        '/geo/countries/$countryId/cities',
        queryParameters: {
          'regionId': ?regionId,
          if (search != null && search.isNotEmpty) 'search': search,
          if (popular) 'popular': true,
          'limit': limit,
        },
        parser: (d) => (d as List)
            .map((e) => CityModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<ReverseGeoResult> reverse({
    required double lat,
    required double lng,
  }) =>
      _client.get(
        '/geo/reverse',
        queryParameters: {'lat': lat, 'lng': lng},
        parser: (d) =>
            ReverseGeoResult.fromJson(d as Map<String, dynamic>),
      );

  Future<List<AreaModel>> areas(int cityId, {String? search}) => _client.get(
        '/geo/cities/$cityId/areas',
        queryParameters: {
          if (search != null && search.isNotEmpty) 'search': search,
        },
        parser: (d) => (d as List)
            .map((e) => AreaModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<GeocodeResult> geocode(String q, {int? countryId}) => _client.get(
        '/geo/geocode',
        queryParameters: {
          'q': q,
          'countryId': ?countryId,
        },
        parser: (d) => GeocodeResult.fromJson(d as Map<String, dynamic>),
      );

  Future<Map<String, dynamic>?> postal({
    required int countryId,
    required String q,
  }) =>
      _client.get(
        '/geo/postal',
        queryParameters: {'countryId': countryId, 'q': q},
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : null,
      );

  Future<CountryIpSuggestion?> suggestCountry() => _client.get(
        '/geo/suggest-country',
        parser: (d) {
          if (d is! Map) return null;
          final parsed = CountryIpSuggestion.fromJson(
            Map<String, dynamic>.from(d),
          );
          return parsed.iso2.isEmpty ? null : parsed;
        },
      );
}
