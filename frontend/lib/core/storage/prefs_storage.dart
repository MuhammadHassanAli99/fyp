import 'package:shared_preferences/shared_preferences.dart';

abstract final class PrefsKeys {
  static const onboardingComplete = 'onboarding_complete';
  static const countryCode = 'country_code';
  static const languageCode = 'language_code';
  static const currencyCode = 'currency_code';
  static const timezone = 'timezone';
  static const themeMode = 'theme_mode';
  static const measurement = 'measurement';
  static const marketplaceCode = 'marketplace_code';
  static const deviceId = 'device_id';
  static const isGuest = 'is_guest';
  static const guestId = 'guest_id';
  static const dateFormat = 'date_format';
  static const timeFormat = 'time_format';
  static const showOriginalPrice = 'show_original_price';
  static const countryId = 'country_id';
  static const regionId = 'region_id';
  static const regionName = 'region_name';
  static const cityId = 'city_id';
  static const cityName = 'city_name';
  static const postalCode = 'postal_code';
  static const areaId = 'area_id';
  static const areaName = 'area_name';
  static const locationSource = 'location_source';
  static const countryConfirmed = 'country_confirmed';
  static const pendingFavorite = 'pending_favorite';
  static const pendingRoute = 'pending_route';
  static const configVersions = 'config_versions';
  static const cachedConfiguration = 'cached_configuration';
  static const fxRatesCache = 'fx_rates_cache';
  static const fxRatesFetchedAt = 'fx_rates_fetched_at';
  static const lastPublicSearch = 'last_public_search';
}

class PrefsStorage {
  PrefsStorage(this._prefs);
  final SharedPreferences _prefs;

  static Future<PrefsStorage> create() async =>
      PrefsStorage(await SharedPreferences.getInstance());

  String? getString(String key) => _prefs.getString(key);
  Future<bool> setString(String key, String value) =>
      _prefs.setString(key, value);

  bool? getBool(String key) => _prefs.getBool(key);
  Future<bool> setBool(String key, bool value) => _prefs.setBool(key, value);

  int? getInt(String key) => _prefs.getInt(key);
  Future<bool> setInt(String key, int value) => _prefs.setInt(key, value);

  Future<bool> remove(String key) => _prefs.remove(key);

  bool get onboardingComplete =>
      _prefs.getBool(PrefsKeys.onboardingComplete) ?? false;

  Future<void> setOnboardingComplete(bool value) =>
      setBool(PrefsKeys.onboardingComplete, value);

  String? get countryCode => getString(PrefsKeys.countryCode);
  String? get languageCode => getString(PrefsKeys.languageCode);
  String? get currencyCode => getString(PrefsKeys.currencyCode);
  String? get timezone => getString(PrefsKeys.timezone);
  String? get themeMode => getString(PrefsKeys.themeMode);
  String? get measurement => getString(PrefsKeys.measurement);
  String? get marketplaceCode => getString(PrefsKeys.marketplaceCode);
  String? get deviceId => getString(PrefsKeys.deviceId);
  bool get isGuest => getBool(PrefsKeys.isGuest) ?? false;
  String? get guestId => getString(PrefsKeys.guestId);
  String? get dateFormat => getString(PrefsKeys.dateFormat);
  String? get timeFormat => getString(PrefsKeys.timeFormat);
  bool get showOriginalPrice =>
      getBool(PrefsKeys.showOriginalPrice) ?? true;
  int? get countryId => getInt(PrefsKeys.countryId);
  int? get regionId => getInt(PrefsKeys.regionId);
  String? get regionName => getString(PrefsKeys.regionName);
  int? get cityId => getInt(PrefsKeys.cityId);
  String? get cityName => getString(PrefsKeys.cityName);
  String? get postalCode => getString(PrefsKeys.postalCode);
  int? get areaId => getInt(PrefsKeys.areaId);
  String? get areaName => getString(PrefsKeys.areaName);
  String? get locationSource => getString(PrefsKeys.locationSource);
  bool get countryConfirmed => getBool(PrefsKeys.countryConfirmed) ?? false;
  String? get pendingRoute => getString(PrefsKeys.pendingRoute);
}
