import 'dart:convert';

import 'package:collection/collection.dart';

import '../../core/auth/preference_merge.dart';
import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../../core/storage/prefs_storage.dart';
import '../local/settings_local.dart';
import '../models/locale_models.dart';
import '../remote/configuration_api.dart';
import '../remote/geo_api.dart';
import '../remote/locale_api.dart';
import '../remote/users_api.dart';
import '../services/fx_service.dart';
import '../services/locale_detect_service.dart';
import '../services/unit_converter.dart';

class SettingsRepository {
  SettingsRepository({
    required this._prefs,
    required this._local,
    required this._localeApi,
    required this._geoApi,
    required FxService fxService,
    required LocaleDetectService detectService,
    this._usersApi,
  })  : _fx = fxService,
        _detect = detectService;

  final PrefsStorage _prefs;
  final SettingsLocal _local;
  final LocaleApi _localeApi;
  final GeoApi _geoApi;
  final FxService _fx;
  final LocaleDetectService _detect;
  final UsersApi? _usersApi;

  Set<String> _rtlFromApi = {'ar', 'ur', 'fa', 'he', 'ps'};
  RemoteConfiguration? _cachedConfig;
  CountryDetailModel? _countryDetail;
  final UnitConverter unitConverter = UnitConverter();
  bool get hasCachedConfiguration =>
      _cachedConfig != null ||
      (_prefs.getString(PrefsKeys.cachedConfiguration)?.isNotEmpty ?? false);

  LocaleApi get localeApi => _localeApi;
  GeoApi get geoApi => _geoApi;
  FxService get fx => _fx;
  LocaleDetectService get detect => _detect;

  String get countryCode => _prefs.countryCode ?? 'US';
  String get languageCode => _prefs.languageCode ?? 'en';
  String get currencyCode => _prefs.currencyCode ?? 'USD';
  String get themeMode => _prefs.themeMode ?? 'system';
  String get measurement => _prefs.measurement ?? 'metric';
  String? get marketplaceCode => _prefs.marketplaceCode;
  bool get onboardingComplete => _prefs.onboardingComplete;
  String? get timezone => _prefs.timezone;
  String get dateFormat => _prefs.dateFormat ?? 'yyyy-MM-dd';
  String get timeFormat => _prefs.timeFormat ?? 'HH:mm';
  bool get showOriginalPrice => _prefs.showOriginalPrice;
  int? get countryId => _prefs.countryId;
  int? get regionId => _prefs.regionId;
  String? get regionName => _prefs.regionName;
  int? get cityId => _prefs.cityId;
  String? get cityName => _prefs.cityName;
  String? get postalCode => _prefs.postalCode;
  int? get areaId => _prefs.areaId;
  String? get areaName => _prefs.areaName;
  String? get locationSource => _prefs.locationSource;
  CountryDetailModel? get countryDetail => _countryDetail;
  String get displayAreaUnit => _countryDetail?.country.areaUnit ?? 'sqm';
  String get displayGoldWeightUnit =>
      _countryDetail?.country.goldWeightUnit ?? 'gram';
  String get displayDistanceUnit =>
      _countryDetail?.country.distanceUnit ?? 'km';
  String get displayVolumeUnit =>
      (_countryDetail?.country.measurementSystem == 'imperial') ? 'gal' : 'l';

  static const preferredLanguageCodes = {
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
  };

  static const preferredCurrencyCodes = <String>[
    'USD',
    'EUR',
    'GBP',
    'PKR',
    'INR',
    'SAR',
    'AED',
    'CAD',
    'AUD',
    'TRY',
    'JPY',
  ];

  Future<void> _mirror(String key, String value) async {
    await _prefs.setString(key, value);
    await _local.mirrorToDb(key, value);
  }

  Future<void> setCountry(String code) async {
    await _mirror(PrefsKeys.countryCode, code.toUpperCase());
  }

  Future<void> setLanguage(String code) async {
    await _mirror(PrefsKeys.languageCode, code.toLowerCase());
  }

  Future<void> setCurrency(String code) async {
    await _mirror(PrefsKeys.currencyCode, code.toUpperCase());
    _fx.clearCache();
  }

  Future<void> setThemeMode(String mode) async {
    await _mirror(PrefsKeys.themeMode, mode);
  }

  Future<void> setMeasurement(String value) async {
    await _mirror(PrefsKeys.measurement, value);
  }

  Future<void> setTimezone(String value) async {
    await _mirror(PrefsKeys.timezone, value);
  }

  Future<void> setDateFormat(String value) async {
    await _mirror(PrefsKeys.dateFormat, value);
  }

  Future<void> setTimeFormat(String value) async {
    await _mirror(PrefsKeys.timeFormat, value);
  }

  Future<void> setShowOriginalPrice(bool value) async {
    await _prefs.setBool(PrefsKeys.showOriginalPrice, value);
    await _local.mirrorToDb(PrefsKeys.showOriginalPrice, value.toString());
  }

  Future<void> setMarketplace(String code) async {
    await _mirror(PrefsKeys.marketplaceCode, code);
  }

  Future<void> setCountryId(int? id) async {
    if (id == null) {
      await _prefs.remove(PrefsKeys.countryId);
      return;
    }
    await _prefs.setInt(PrefsKeys.countryId, id);
  }

  Future<void> setRegion({int? id, String? name}) async {
    if (id == null) {
      await _prefs.remove(PrefsKeys.regionId);
    } else {
      await _prefs.setInt(PrefsKeys.regionId, id);
    }
    if (name == null || name.isEmpty) {
      await _prefs.remove(PrefsKeys.regionName);
    } else {
      await _mirror(PrefsKeys.regionName, name);
    }
  }

  Future<void> setCity({int? id, String? name}) async {
    if (id == null) {
      await _prefs.remove(PrefsKeys.cityId);
    } else {
      await _prefs.setInt(PrefsKeys.cityId, id);
    }
    if (name == null || name.isEmpty) {
      await _prefs.remove(PrefsKeys.cityName);
    } else {
      await _mirror(PrefsKeys.cityName, name);
    }
  }

  Future<void> setPostalCode(String? value) async {
    if (value == null || value.isEmpty) {
      await _prefs.remove(PrefsKeys.postalCode);
      return;
    }
    await _mirror(PrefsKeys.postalCode, value);
  }

  Future<void> completeOnboarding() => _prefs.setOnboardingComplete(true);

  /// Apply country defaults (currency, language, timezone, formats, measurement).
  Future<CountryDetailModel?> applyCountryDefaults(
    String iso2, {
    bool overrideLanguage = false,
    bool overrideCurrency = true,
  }) async {
    try {
      final detail = await _localeApi.countryDetail(iso2);
      _countryDetail = detail;
      final c = detail.country;
      await setCountry(c.code);
      await setCountryId(c.id);
      if (c.defaultTimezone != null) await setTimezone(c.defaultTimezone!);
      if (c.measurementSystem != null) {
        await setMeasurement(c.measurementSystem!);
      }
      if (c.dateFormat != null) await setDateFormat(c.dateFormat!);
      if (c.timeFormat != null) await setTimeFormat(c.timeFormat!);
      if (overrideCurrency && c.defaultCurrency != null) {
        await setCurrency(c.defaultCurrency!);
      }
      if (overrideLanguage) {
        final primary = detail.languages
                .where((l) => l.isPrimary)
                .map((l) => l.code)
                .firstOrNull ??
            c.defaultLanguage;
        if (primary != null) await setLanguage(primary);
      }
      return detail;
    } catch (_) {
      await setCountry(iso2);
      return null;
    }
  }

  Future<LocaleDetection> detectAndSeedIfNeeded({
    bool force = false,
  }) async {
    final hasCountry = _prefs.countryCode != null;
    if (hasCountry && !force) {
      return LocaleDetection(
        countryCode: countryCode,
        languageCode: languageCode,
        currencyCode: currencyCode,
        timezone: timezone,
        measurement: measurement,
        cityId: cityId,
        cityName: cityName,
        regionId: regionId,
        regionName: regionName,
        postalCode: postalCode,
      );
    }

    final detected = await _detect.detect(tryGps: false);
    if (_prefs.languageCode == null && detected.languageCode != null) {
      await setLanguage(detected.languageCode!);
    } else if (_prefs.languageCode == null) {
      await setLanguage(_detect.detectDeviceLanguage());
    }

    if (detected.countryCode != null) {
      await applyCountryDefaults(
        detected.countryCode!,
        overrideLanguage: _prefs.languageCode == null,
        overrideCurrency: _prefs.currencyCode == null,
      );
    } else if (_prefs.countryCode == null) {
      await setCountry('US');
      await setCurrency(_prefs.currencyCode ?? 'USD');
    }

    if (detected.cityId != null) {
      await setCity(id: detected.cityId, name: detected.cityName);
    }
    if (detected.regionId != null) {
      await setRegion(id: detected.regionId, name: detected.regionName);
    }
    if (detected.postalCode != null) {
      await setPostalCode(detected.postalCode);
    }
    return detected;
  }

  Future<void> hydrateFromCache() async {
    _fx.hydrate();
    final raw = _prefs.getString(PrefsKeys.cachedConfiguration);
    if (raw != null && raw.isNotEmpty) {
      try {
        _cachedConfig = RemoteConfiguration.fromJson(
          jsonDecode(raw) as Map<String, dynamic>,
        );
        if (_cachedConfig!.rtlLanguages.isNotEmpty) {
          _rtlFromApi = _cachedConfig!.rtlLanguages.map((e) => e.toLowerCase()).toSet();
        }
      } catch (_) {}
    }

    if (_prefs.countryCode != null) return;
    final country = await _local.fromDb(PrefsKeys.countryCode);
    final language = await _local.fromDb(PrefsKeys.languageCode);
    final currency = await _local.fromDb(PrefsKeys.currencyCode);
    final theme = await _local.fromDb(PrefsKeys.themeMode);
    if (country != null) await _prefs.setString(PrefsKeys.countryCode, country);
    if (language != null) await _prefs.setString(PrefsKeys.languageCode, language);
    if (currency != null) await _prefs.setString(PrefsKeys.currencyCode, currency);
    if (theme != null) await _prefs.setString(PrefsKeys.themeMode, theme);
  }

  Future<void> cacheConfiguration(RemoteConfiguration config) async {
    _cachedConfig = config;
    if (config.rtlLanguages.isNotEmpty) {
      _rtlFromApi = config.rtlLanguages.map((e) => e.toLowerCase()).toSet();
    }
    await _prefs.setString(
      PrefsKeys.cachedConfiguration,
      jsonEncode({
        'versions': {
          'configuration': config.versions.configuration,
          'countries': config.versions.countries,
          'languages': config.versions.languages,
          'currencies': config.versions.currencies,
          'exchangeRates': config.versions.exchangeRates,
          'features': config.versions.features,
          'exchangeRatesAsOf': config.versions.exchangeRatesAsOf,
        },
        'app': {
          'minAppVersion': config.minAppVersion,
          'forceUpdateBelow': config.forceUpdateBelow,
          'baseCurrency': config.baseCurrency,
          'defaultCountry': config.defaultCountry,
          'schemaCompatible': config.schemaCompatible,
        },
        'supportedCountryCodes': config.supportedCountryCodes,
        'supportedLanguageCodes': config.supportedLanguageCodes,
        'supportedCurrencyCodes': config.supportedCurrencyCodes,
        'rtlLanguages': config.rtlLanguages,
        'guestRestrictions': config.guestRestrictions,
        'features': config.features,
      }),
    );
  }

  Future<void> confirmCountry(String iso2) async {
    await setCountry(iso2);
    await _prefs.setBool(PrefsKeys.countryConfirmed, true);
  }

  Future<void> setLocationSource(String? source) async {
    if (source == null || source.isEmpty) {
      await _prefs.remove(PrefsKeys.locationSource);
      return;
    }
    await _mirror(PrefsKeys.locationSource, source);
  }

  Future<void> setArea({int? id, String? name}) async {
    if (id == null) {
      await _prefs.remove(PrefsKeys.areaId);
    } else {
      await _prefs.setInt(PrefsKeys.areaId, id);
    }
    if (name == null || name.isEmpty) {
      await _prefs.remove(PrefsKeys.areaName);
    } else {
      await _mirror(PrefsKeys.areaName, name);
    }
  }

  Future<void> setPendingRoute(String? route) async {
    if (route == null || route.isEmpty) {
      await _prefs.remove(PrefsKeys.pendingRoute);
      return;
    }
    await _prefs.setString(PrefsKeys.pendingRoute, route);
  }

  String? takePendingRoute() {
    final route = _prefs.pendingRoute;
    if (route != null) {
      _prefs.remove(PrefsKeys.pendingRoute);
    }
    return route;
  }

  PreferenceSnapshot localSnapshot() => PreferenceSnapshot(
        countryId: countryId,
        countryCode: countryCode,
        language: languageCode,
        currency: currencyCode,
        timezone: timezone,
        theme: themeMode,
        measurementSystem: measurement,
        regionId: regionId,
        cityId: cityId,
        areaId: areaId,
        postalCode: postalCode,
        locationSource: locationSource,
      );

  Future<void> applyMerged(PreferenceSnapshot merged) async {
    if (merged.countryCode != null) await setCountry(merged.countryCode!);
    if (merged.countryId != null) await setCountryId(merged.countryId);
    if (merged.language != null) await setLanguage(merged.language!);
    if (merged.currency != null) await setCurrency(merged.currency!);
    if (merged.timezone != null) await setTimezone(merged.timezone!);
    if (merged.theme != null) await setThemeMode(merged.theme!);
    if (merged.measurementSystem != null) {
      await setMeasurement(merged.measurementSystem!);
    }
    await setRegion(id: merged.regionId, name: regionName);
    await setCity(id: merged.cityId, name: cityName);
    await setArea(id: merged.areaId, name: areaName);
    await setPostalCode(merged.postalCode);
    await setLocationSource(merged.locationSource);
  }

  Future<void> mergeAfterLogin() async {
    final api = _usersApi;
    if (api == null) return;
    try {
      final result = await api.mergePreferences(localSnapshot());
      final prefs = result['preferences'] is Map
          ? Map<String, dynamic>.from(result['preferences'] as Map)
          : result;
      final location = result['location'] is Map
          ? Map<String, dynamic>.from(result['location'] as Map)
          : const <String, dynamic>{};
      final server = PreferenceSnapshot(
        countryId: (prefs['countryId'] as num?)?.toInt(),
        language: prefs['language']?.toString(),
        currency: prefs['currency']?.toString(),
        timezone: prefs['timezone']?.toString(),
        theme: prefs['theme']?.toString(),
        measurementSystem: prefs['measurementSystem']?.toString(),
        regionId: (location['regionId'] as num?)?.toInt(),
        cityId: (location['cityId'] as num?)?.toInt(),
        areaId: (location['areaId'] as num?)?.toInt(),
        postalCode: location['postalCode']?.toString(),
        locationSource: location['source']?.toString(),
      );
      final merged = mergePreferences(
        authenticated: server,
        local: localSnapshot(),
      );
      await applyMerged(merged);
    } catch (_) {
      // Offline login still keeps local guest prefs.
    }
  }

  Future<void> syncLocationToServer({String source = 'manual'}) async {
    final api = _usersApi;
    if (api == null) return;
    try {
      await api.putLocation({
        if (countryId != null) 'countryId': countryId,
        'regionId': regionId,
        'cityId': cityId,
        'areaId': areaId,
        'postalCode': postalCode,
        'source': source,
      });
    } catch (_) {}
  }

  Future<Result<List<CountryModel>>> loadCountries() async {
    try {
      return Success(await _localeApi.countries());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<LanguageModel>>> loadLanguages() async {
    try {
      final all = await _localeApi.languages();
      _rtlFromApi = {
        ..._rtlFromApi,
        for (final language in all)
          if (language.rtl) language.code.toLowerCase(),
      };
      final preferred = all
          .where((l) => preferredLanguageCodes.contains(l.code.toLowerCase()))
          .toList();
      return Success(preferred.isNotEmpty ? preferred : all);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<CurrencyModel>>> loadCurrencies() async {
    try {
      final all = await _localeApi.currencies();
      final preferred = all
          .where((c) => preferredCurrencyCodes.contains(c.code.toUpperCase()))
          .toList();
      // Keep stable order matching the spec list.
      preferred.sort((a, b) {
        final ai = preferredCurrencyCodes.indexOf(a.code.toUpperCase());
        final bi = preferredCurrencyCodes.indexOf(b.code.toUpperCase());
        return ai.compareTo(bi);
      });
      return Success(preferred.isNotEmpty ? preferred : all);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<RegionModel>>> loadRegions(int countryId) async {
    try {
      return Success(await _geoApi.regions(countryId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<CityModel>>> loadCities(
    int countryId, {
    int? regionId,
    String? search,
  }) async {
    try {
      return Success(
        await _geoApi.cities(
          countryId,
          regionId: regionId,
          search: search,
          popular: search == null || search.isEmpty,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ReverseGeoResult>> detectGpsLocation() async {
    try {
      final detected = await _detect.detect(tryGps: true);
      if (!detected.fromGps && detected.cityId == null) {
        return const Failure('Location unavailable. Enable GPS or pick a city.');
      }
      if (detected.countryCode != null) {
        await applyCountryDefaults(
          detected.countryCode!,
          overrideLanguage: false,
          overrideCurrency: true,
        );
      }
      await setRegion(id: detected.regionId, name: detected.regionName);
      await setCity(id: detected.cityId, name: detected.cityName);
      await setPostalCode(detected.postalCode);
      await setLocationSource('gps');
      return Success(
        ReverseGeoResult(
          countryCode: detected.countryCode,
          regionId: detected.regionId,
          regionName: detected.regionName,
          cityId: detected.cityId,
          cityName: detected.cityName,
          postalCode: detected.postalCode,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  bool isRtlLanguage([String? code]) {
    final c = (code ?? languageCode).toLowerCase();
    return _rtlFromApi.contains(c);
  }
}
