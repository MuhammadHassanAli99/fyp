import 'package:collection/collection.dart';
import 'package:signals/signals.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/di/service_locator.dart';
import '../../core/init/app_init_state.dart';
import '../../core/result/async_state.dart';
import '../../data/models/locale_models.dart';
import '../../data/repositories/settings_repository.dart';

class LocaleOnboardingStore {
  LocaleOnboardingStore(this._repo);

  final SettingsRepository _repo;

  final countries = signal<AsyncState<List<CountryModel>>>(const AsyncIdle());
  final languages = signal<AsyncState<List<LanguageModel>>>(const AsyncIdle());
  final currencies = signal<AsyncState<List<CurrencyModel>>>(const AsyncIdle());
  final regions = signal<AsyncState<List<RegionModel>>>(const AsyncIdle());
  final cities = signal<AsyncState<List<CityModel>>>(const AsyncIdle());

  final selectedCountry = signal<String?>(null);
  final selectedLanguage = signal<String?>(null);
  final selectedCurrency = signal<String?>(null);
  final selectedTheme = signal<String>('system');
  final selectedRegion = signal<RegionModel?>(null);
  final selectedCity = signal<CityModel?>(null);
  final countryQuery = signal('');
  final detecting = signal(false);
  final locating = signal(false);
  final detectNote = signal<String?>(null);
  final step = signal(0);

  CountrySuggestion? get suggestion =>
      ServiceLocator.instance.appInitStore.snapshot.value.countrySuggestion;

  List<CountryModel> get filteredCountries {
    final all = countries.value.dataOrNull ?? const <CountryModel>[];
    final q = countryQuery.value.trim().toLowerCase();
    if (q.isEmpty) return all;
    return all
        .where(
          (c) =>
              c.name.toLowerCase().contains(q) ||
              (c.nativeName?.toLowerCase().contains(q) ?? false) ||
              c.code.toLowerCase() == q,
        )
        .toList();
  }

  Future<void> load() async {
    countries.value = const AsyncLoading();
    languages.value = const AsyncLoading();
    currencies.value = const AsyncLoading();
    detecting.value = true;

    final detected = await _repo.detectAndSeedIfNeeded();
    detecting.value = false;
    detectNote.value =
        'Suggested from ${detected.fromGps ? 'GPS' : 'device'}: ${detected.countryCode}';

    selectedCountry.value = _repo.countryCode;
    selectedLanguage.value = _repo.languageCode;
    selectedCurrency.value = _repo.currencyCode;
    selectedTheme.value = _repo.themeMode;

    final suggested = suggestion;
    if (suggested != null && suggested.iso2.isNotEmpty) {
      selectedCountry.value = suggested.iso2;
    }

    final c = await _repo.loadCountries();
    final l = await _repo.loadLanguages();
    final cur = await _repo.loadCurrencies();

    countries.value = c.when(
      success: (d) => AsyncData(d),
      failure: (m, code) => AsyncError(m, code: code),
    );
    languages.value = l.when(
      success: (d) => AsyncData(d),
      failure: (m, code) => AsyncError(m, code: code),
    );
    currencies.value = cur.when(
      success: (d) => AsyncData(d),
      failure: (m, code) => AsyncError(m, code: code),
    );

    final countryList = countries.value.dataOrNull ?? const <CountryModel>[];
    if (countryList.isNotEmpty &&
        !countryList.any((e) => e.code == selectedCountry.value)) {
      selectedCountry.value = countryList.first.code;
    }

    ServiceLocator.instance.appInitStore.setPhase(AppInitPhase.countrySelection);
  }

  Future<void> onCountryChanged(String? code) async {
    if (code == null) return;
    selectedCountry.value = code;
    await _repo.applyCountryDefaults(
      code,
      overrideLanguage: false,
      overrideCurrency: true,
    );
    selectedCurrency.value = _repo.currencyCode;
    selectedRegion.value = null;
    selectedCity.value = null;
    await _loadGeo();
  }

  Future<void> confirmSuggestedCountry() async {
    final code = selectedCountry.value ?? _repo.countryCode;
    await onCountryChanged(code);
    await _repo.confirmCountry(code);
    goLanguage();
  }

  void goLanguage() {
    step.value = 1;
    ServiceLocator.instance.appInitStore.setPhase(AppInitPhase.languageSelection);
  }

  void goCurrency() {
    step.value = 2;
    ServiceLocator.instance.appInitStore.setPhase(AppInitPhase.currencySelection);
  }

  Future<void> goLocation() async {
    step.value = 3;
    ServiceLocator.instance.appInitStore.setPhase(AppInitPhase.locationSelection);
    await _loadGeo();
  }

  Future<void> _loadGeo() async {
    final id = _repo.countryId ??
        countries.value.dataOrNull
            ?.where((c) => c.code == selectedCountry.value)
            .firstOrNull
            ?.id;
    if (id == null) return;
    regions.value = const AsyncLoading();
    final r = await _repo.loadRegions(id);
    regions.value = r.when(
      success: AsyncData.new,
      failure: (m, code) => AsyncError(m, code: code),
    );
    cities.value = const AsyncLoading();
    final cityResult = await _repo.loadCities(id, regionId: selectedRegion.value?.id);
    cities.value = cityResult.when(
      success: AsyncData.new,
      failure: (m, code) => AsyncError(m, code: code),
    );
  }

  Future<void> useGps() async {
    locating.value = true;
    final result = await _repo.detectGpsLocation();
    locating.value = false;
    result.when(
      success: (_) {},
      failure: (m, code) {
        detectNote.value = m;
      },
    );
  }

  Future<void> selectRegion(RegionModel? region) async {
    selectedRegion.value = region;
    selectedCity.value = null;
    await _repo.setRegion(id: region?.id, name: region?.name);
    await _repo.setLocationSource('manual');
    await _loadGeo();
  }

  Future<void> selectCity(CityModel? city) async {
    selectedCity.value = city;
    await _repo.setCity(id: city?.id, name: city?.name);
    await _repo.setLocationSource('manual');
  }

  Future<void> saveAndContinue() async {
    final country = selectedCountry.value ?? _repo.countryCode;
    final language = selectedLanguage.value ?? _repo.languageCode;
    final currency = selectedCurrency.value ?? _repo.currencyCode;
    await _repo.setCountry(country);
    await _repo.confirmCountry(country);
    await _repo.applyCountryDefaults(
      country,
      overrideLanguage: false,
      overrideCurrency: false,
    );
    await _repo.setLanguage(language);
    await _repo.setCurrency(currency);
    await _repo.setThemeMode(selectedTheme.value);
    await _repo.completeOnboarding();
    ServiceLocator.instance.settingsStore.reloadFromRepo();
    ServiceLocator.instance.appInitStore.markReady();
  }
}
