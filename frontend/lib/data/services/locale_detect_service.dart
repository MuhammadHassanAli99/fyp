import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import '../models/locale_models.dart';
import '../remote/geo_api.dart';
import '../remote/locale_api.dart';

class LocaleDetection {
  const LocaleDetection({
    this.countryCode,
    this.languageCode,
    this.currencyCode,
    this.timezone,
    this.measurement,
    this.cityId,
    this.cityName,
    this.regionId,
    this.regionName,
    this.postalCode,
    this.fromGps = false,
  });

  final String? countryCode;
  final String? languageCode;
  final String? currencyCode;
  final String? timezone;
  final String? measurement;
  final int? cityId;
  final String? cityName;
  final int? regionId;
  final String? regionName;
  final String? postalCode;
  final bool fromGps;
}

class LocaleDetectService {
  LocaleDetectService(this._localeApi, this._geoApi);

  final LocaleApi _localeApi;
  final GeoApi _geoApi;

  /// Device language (first matching supported code, else `en`).
  String detectDeviceLanguage({
    Set<String> supported = const {
      'en',
      'ar',
      'ur',
      'hi',
      'fr',
      'de',
      'es',
      'zh',
      'ja',
      'tr',
      'ru',
    },
  }) {
    final locales = ui.PlatformDispatcher.instance.locales;
    for (final locale in locales) {
      final code = locale.languageCode.toLowerCase();
      if (supported.contains(code)) return code;
    }
    final primary = ui.PlatformDispatcher.instance.locale.languageCode
        .toLowerCase();
    return supported.contains(primary) ? primary : 'en';
  }

  /// Prefer device locale region. GPS is opt-in — never requested here.
  Future<LocaleDetection> detect({bool tryGps = false}) async {
    final language = detectDeviceLanguage();
    ReverseGeoResult? geo;

    if (tryGps && !kIsWeb) {
      try {
        geo = await _reverseFromGps();
      } catch (_) {
        geo = null;
      }
    }

    String? countryCode = geo?.countryCode?.toUpperCase();
    if (countryCode == null || countryCode.isEmpty) {
      final device = ui.PlatformDispatcher.instance.locale;
      countryCode = device.countryCode?.toUpperCase();
    }
    countryCode ??= 'US';

    CountryDetailModel? detail;
    try {
      detail = await _localeApi.countryDetail(countryCode);
      countryCode = detail.country.code;
    } catch (_) {
      detail = null;
    }

    return LocaleDetection(
      countryCode: countryCode,
      languageCode: language,
      currencyCode: detail?.country.defaultCurrency,
      timezone: detail?.country.defaultTimezone,
      measurement: detail?.country.measurementSystem,
      cityId: geo?.cityId,
      cityName: geo?.cityName,
      regionId: geo?.regionId,
      regionName: geo?.regionName,
      postalCode: geo?.postalCode,
      fromGps: geo != null,
    );
  }

  Future<ReverseGeoResult?> _reverseFromGps() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return null;

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
    return _geoApi.reverse(lat: position.latitude, lng: position.longitude);
  }
}
