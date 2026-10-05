import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:signals/signals.dart';

import '../../data/remote/configuration_api.dart';
import '../../data/remote/geo_api.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/repositories/catalog_repository.dart';
import '../../data/repositories/settings_repository.dart';
import '../auth/auth_status.dart';
import '../platform/platform_info.dart';
import '../storage/prefs_storage.dart';
import 'app_init_state.dart';

/// Single writer for before-login initialization. Splash, onboarding and the
/// router read [snapshot]; they do not run their own detection pipelines.
class AppInitStore {
  AppInitStore({
    required this._prefs,
    required this._settings,
    required this._auth,
    required this._catalog,
    required this._configurationApi,
    required this._geoApi,
  });

  final PrefsStorage _prefs;
  final SettingsRepository _settings;
  final AuthRepository _auth;
  final CatalogRepository _catalog;
  final ConfigurationApi _configurationApi;
  final GeoApi _geoApi;

  final snapshot = signal(
    const AppInitSnapshot(phase: AppInitPhase.initializing),
  );

  AppInitPhase get phase => snapshot.value.phase;
  bool get offline => snapshot.value.offline;

  Future<void> run() async {
    snapshot.value = const AppInitSnapshot(phase: AppInitPhase.initializing);
    // Platform detection is side-effect free — [PlatformInfo] is the adapter.
    final _ = PlatformInfo.code;

    snapshot.value = const AppInitSnapshot(phase: AppInitPhase.configLoading);
    await _settings.hydrateFromCache();

    final online = await _hasNetwork();
    var usedOfflineCache = false;

    try {
      await _auth.checkCompatibility();
      if (_auth.status == AuthStatus.updateRequired) {
        snapshot.value = const AppInitSnapshot(phase: AppInitPhase.updateRequired);
        return;
      }
    } catch (_) {
      // Compatibility check is advisory when offline.
    }

    try {
      final remote = await _configurationApi.fetch();
      await _settings.cacheConfiguration(remote);
      if (!remote.schemaCompatible) {
        snapshot.value = const AppInitSnapshot(phase: AppInitPhase.updateRequired);
        return;
      }
    } catch (_) {
      if (_settings.hasCachedConfiguration) {
        usedOfflineCache = true;
      }
    }

    try {
      await _catalog.bootstrap();
    } catch (_) {
      usedOfflineCache = usedOfflineCache || _catalog.hasCachedMarketplaces;
    }

    await _auth.restoreSession();
    if (_auth.status == AuthStatus.updateRequired) {
      snapshot.value = const AppInitSnapshot(phase: AppInitPhase.updateRequired);
      return;
    }

    if (!_prefs.onboardingComplete || !_prefs.countryConfirmed) {
      final suggestion = await _suggestCountry();
      snapshot.value = AppInitSnapshot(
        phase: AppInitPhase.countrySelection,
        offline: !online || usedOfflineCache,
        countrySuggestion: suggestion,
      );
      return;
    }

    if (_auth.status == AuthStatus.error && !usedOfflineCache && online) {
      snapshot.value = AppInitSnapshot(
        phase: AppInitPhase.error,
        errorMessage: _auth.lastError,
      );
      return;
    }

    _markSessionReady(offline: !online || usedOfflineCache);
  }

  void setPhase(AppInitPhase phase) {
    snapshot.value = AppInitSnapshot(
      phase: phase,
      offline: snapshot.value.offline,
      countrySuggestion: snapshot.value.countrySuggestion,
      errorMessage: snapshot.value.errorMessage,
    );
  }

  void markReady() => _markSessionReady(offline: snapshot.value.offline);

  void _markSessionReady({required bool offline}) {
    if (_auth.isGuest) {
      snapshot.value = AppInitSnapshot(
        phase: AppInitPhase.guest,
        offline: offline,
      );
      return;
    }
    if (_auth.hasActiveSession && _auth.status == AuthStatus.authenticated) {
      snapshot.value = AppInitSnapshot(
        phase: AppInitPhase.authenticated,
        offline: offline,
      );
      return;
    }
    snapshot.value = AppInitSnapshot(
      phase: offline ? AppInitPhase.offlineReady : AppInitPhase.ready,
      offline: offline,
    );
  }

  Future<CountrySuggestion> _suggestCountry() async {
    try {
      final ip = await _geoApi.suggestCountry();
      if (ip != null && ip.iso2.isNotEmpty) {
        return CountrySuggestion(
          iso2: ip.iso2,
          name: ip.name,
          flag: ip.flag,
          source: ip.source,
          confidence: ip.confidence,
        );
      }
    } catch (_) {}
    return CountrySuggestion(
      iso2: _settings.countryCode,
      source: 'device',
      confidence: 'low',
      needsConfirmation: true,
    );
  }

  Future<bool> _hasNetwork() async {
    try {
      final results = await Connectivity().checkConnectivity();
      return results.any((r) => r != ConnectivityResult.none);
    } catch (_) {
      return true;
    }
  }
}
