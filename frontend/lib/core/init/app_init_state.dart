/// Centralized before-login / cold-start phases.
///
/// Screens must not invent their own global init machine. [AppInitStore]
/// is the only writer; routers and splash/onboarding read this.
enum AppInitPhase {
  initializing,
  configLoading,
  countrySelection,
  languageSelection,
  currencySelection,
  locationSelection,
  ready,
  guest,
  authenticated,
  error,
  updateRequired,
  offlineReady,
}

class CountrySuggestion {
  const CountrySuggestion({
    required this.iso2,
    this.name,
    this.flag,
    this.source = 'device',
    this.confidence = 'low',
    this.needsConfirmation = true,
  });

  final String iso2;
  final String? name;
  final String? flag;
  final String source;
  final String confidence;
  final bool needsConfirmation;
}

class AppInitSnapshot {
  const AppInitSnapshot({
    required this.phase,
    this.offline = false,
    this.errorMessage,
    this.countrySuggestion,
  });

  final AppInitPhase phase;
  final bool offline;
  final String? errorMessage;
  final CountrySuggestion? countrySuggestion;

  bool get isSelecting =>
      phase == AppInitPhase.countrySelection ||
      phase == AppInitPhase.languageSelection ||
      phase == AppInitPhase.currencySelection ||
      phase == AppInitPhase.locationSelection;

  bool get canEnterApp =>
      phase == AppInitPhase.ready ||
      phase == AppInitPhase.guest ||
      phase == AppInitPhase.authenticated ||
      phase == AppInitPhase.offlineReady;
}
