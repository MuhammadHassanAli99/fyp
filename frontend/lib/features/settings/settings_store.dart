import 'package:collection/collection.dart';
import 'package:signals/signals.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../data/models/locale_models.dart';
import '../../data/repositories/settings_repository.dart';

class SettingsStore {
  SettingsStore(this._repo) {
    _syncFromRepo();
  }

  final SettingsRepository _repo;

  final languageCode = signal('en');
  final currencyCode = signal('USD');
  final countryCode = signal('US');
  final themeMode = signal('system');
  final measurement = signal('metric');
  final timezone = signal<String?>(null);
  final dateFormat = signal('yyyy-MM-dd');
  final timeFormat = signal('HH:mm');
  final showOriginalPrice = signal(true);
  final regionId = signal<int?>(null);
  final regionName = signal<String?>(null);
  final cityId = signal<int?>(null);
  final cityName = signal<String?>(null);
  final postalCode = signal<String?>(null);
  final countryId = signal<int?>(null);

  final countries = signal<AsyncState<List<CountryModel>>>(const AsyncIdle());
  final languages = signal<AsyncState<List<LanguageModel>>>(const AsyncIdle());
  final currencies = signal<AsyncState<List<CurrencyModel>>>(const AsyncIdle());
  final regions = signal<AsyncState<List<RegionModel>>>(const AsyncIdle());
  final cities = signal<AsyncState<List<CityModel>>>(const AsyncIdle());
  final locating = signal(false);
  final statusMessage = signal<String?>(null);

  bool get isRtl => _repo.isRtlLanguage(languageCode.value);

  void reloadFromRepo() => _syncFromRepo();

  void _syncFromRepo() {
    languageCode.value = _repo.languageCode;
    currencyCode.value = _repo.currencyCode;
    countryCode.value = _repo.countryCode;
    themeMode.value = _repo.themeMode;
    measurement.value = _repo.measurement;
    timezone.value = _repo.timezone;
    dateFormat.value = _repo.dateFormat;
    timeFormat.value = _repo.timeFormat;
    showOriginalPrice.value = _repo.showOriginalPrice;
    countryId.value = _repo.countryId;
    regionId.value = _repo.regionId;
    regionName.value = _repo.regionName;
    cityId.value = _repo.cityId;
    cityName.value = _repo.cityName;
    postalCode.value = _repo.postalCode;
  }

  Future<void> loadCatalogs() async {
    countries.value = const AsyncLoading();
    languages.value = const AsyncLoading();
    currencies.value = const AsyncLoading();

    final c = await _repo.loadCountries();
    final l = await _repo.loadLanguages();
    final cur = await _repo.loadCurrencies();

    countries.value = c.when(
      success: AsyncData.new,
      failure: (m, code) => AsyncError(m, code: code),
    );
    languages.value = l.when(
      success: AsyncData.new,
      failure: (m, code) => AsyncError(m, code: code),
    );
    currencies.value = cur.when(
      success: AsyncData.new,
      failure: (m, code) => AsyncError(m, code: code),
    );

    // Ensure countryId is known for geo pickers.
    final list = countries.value.dataOrNull ?? const <CountryModel>[];
    final match = list.where((e) => e.code == countryCode.value).firstOrNull;
    if (match?.id != null) {
      countryId.value = match!.id;
      await _repo.setCountryId(match.id);
      await loadRegionsAndCities();
    }
  }

  Future<void> loadRegionsAndCities() async {
    final id = countryId.value;
    if (id == null) {
      regions.value = const AsyncData([]);
      cities.value = const AsyncData([]);
      return;
    }
    regions.value = const AsyncLoading();
    final r = await _repo.loadRegions(id);
    regions.value = r.when(
      success: AsyncData.new,
      failure: (m, code) => AsyncError(m, code: code),
    );

    cities.value = const AsyncLoading();
    final cityResult = await _repo.loadCities(id, regionId: regionId.value);
    cities.value = cityResult.when(
      success: AsyncData.new,
      failure: (m, code) => AsyncError(m, code: code),
    );
  }

  Future<void> setLanguage(String code) async {
    languageCode.value = code;
    await _repo.setLanguage(code);
  }

  Future<void> setCurrency(String code) async {
    currencyCode.value = code;
    await _repo.setCurrency(code);
  }

  Future<void> setCountry(String code, {bool cascadeDefaults = true}) async {
    countryCode.value = code;
    await _repo.setCountry(code);

    final list = countries.value.dataOrNull ?? const <CountryModel>[];
    final match = list.where((e) => e.code == code).firstOrNull;
    countryId.value = match?.id;
    await _repo.setCountryId(match?.id);

    // Reset location when country changes.
    regionId.value = null;
    regionName.value = null;
    cityId.value = null;
    cityName.value = null;
    postalCode.value = null;
    await _repo.setRegion();
    await _repo.setCity();
    await _repo.setPostalCode(null);

    if (cascadeDefaults) {
      final detail = await _repo.applyCountryDefaults(
        code,
        overrideLanguage: false,
        overrideCurrency: true,
      );
      _syncFromRepo();
      if (detail?.country.id != null) {
        countryId.value = detail!.country.id;
      }
    }

    await loadRegionsAndCities();
  }

  Future<void> setThemeMode(String mode) async {
    themeMode.value = mode;
    await _repo.setThemeMode(mode);
  }

  Future<void> setMeasurement(String value) async {
    measurement.value = value;
    await _repo.setMeasurement(value);
  }

  Future<void> setShowOriginalPrice(bool value) async {
    showOriginalPrice.value = value;
    await _repo.setShowOriginalPrice(value);
  }

  Future<void> setRegion(RegionModel? region) async {
    regionId.value = region?.id;
    regionName.value = region?.name;
    await _repo.setRegion(id: region?.id, name: region?.name);
    cityId.value = null;
    cityName.value = null;
    await _repo.setCity();
    await loadRegionsAndCities();
  }

  Future<void> setCity(CityModel? city) async {
    cityId.value = city?.id;
    cityName.value = city?.name;
    await _repo.setCity(id: city?.id, name: city?.name);
    if (city?.postalCode != null && city!.postalCode!.isNotEmpty) {
      postalCode.value = city.postalCode;
      await _repo.setPostalCode(city.postalCode);
    }
    if (city?.regionId != null) {
      regionId.value = city!.regionId;
      regionName.value = city.regionName;
      await _repo.setRegion(id: city.regionId, name: city.regionName);
    }
  }

  Future<void> setPostalCode(String value) async {
    postalCode.value = value;
    await _repo.setPostalCode(value);
  }

  Future<void> detectLocation() async {
    locating.value = true;
    statusMessage.value = null;
    final result = await _repo.detectGpsLocation();
    locating.value = false;
    result.when(
      success: (geo) {
        _syncFromRepo();
        statusMessage.value = geo.cityName != null
            ? 'Location set to ${geo.cityName}'
            : 'Location updated from GPS';
        loadCatalogs();
      },
      failure: (m, code) {
        statusMessage.value = m;
      },
    );
  }
}
