import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../models/locale_models.dart';
import '../models/map_models.dart';
import '../remote/geo_api.dart';
import '../remote/maps_api.dart';

/// GPS + gazetteer + geocoding. Screens talk to this, not to Geolocator or a
/// map vendor SDK.
class LocationService {
  LocationService(this._geo, this._maps);

  final GeoApi _geo;
  final MapsApi _maps;

  Future<({double lat, double lng})?> currentGps() async {
    try {
      final enabled = await Geolocator.isLocationServiceEnabled();
      if (!enabled) return null;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return null;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: Duration(seconds: 8),
        ),
      );
      return (lat: position.latitude, lng: position.longitude);
    } catch (_) {
      return null;
    }
  }

  Future<ReverseGeoResult?> reverse({required double lat, required double lng}) async {
    try {
      return await _geo.reverse(lat: lat, lng: lng);
    } catch (_) {
      return null;
    }
  }

  Future<GeocodeResult?> forward(String query, {int? countryId}) async {
    try {
      return await _geo.geocode(query, countryId: countryId);
    } catch (_) {
      return null;
    }
  }

  Future<List<RegionModel>> regions(int countryId) => _geo.regions(countryId);

  Future<List<CityModel>> cities(int countryId, {int? regionId, String? search}) =>
      _geo.cities(countryId, regionId: regionId, search: search);

  Future<List<AreaModel>> areas(int cityId, {String? search}) =>
      _geo.areas(cityId, search: search);

  static String platformName() {
    if (kIsWeb) return 'web';
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return 'android';
      case TargetPlatform.iOS:
        return 'ios';
      case TargetPlatform.macOS:
        return 'macos';
      case TargetPlatform.windows:
        return 'windows';
      case TargetPlatform.linux:
        return 'linux';
      default:
        return 'web';
    }
  }

  Future<DistanceValue?> distance({
    required double fromLat,
    required double fromLng,
    required double toLat,
    required double toLng,
    String unit = 'km',
  }) async {
    try {
      return await _maps.distance(
        fromLat: fromLat,
        fromLng: fromLng,
        toLat: toLat,
        toLng: toLng,
        unit: unit,
      );
    } catch (_) {
      return null;
    }
  }
}
