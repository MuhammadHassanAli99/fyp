class PreferenceSnapshot {
  const PreferenceSnapshot({
    this.countryId,
    this.countryCode,
    this.language,
    this.currency,
    this.timezone,
    this.theme,
    this.measurementSystem,
    this.regionId,
    this.cityId,
    this.areaId,
    this.postalCode,
    this.locationSource,
  });

  final int? countryId;
  final String? countryCode;
  final String? language;
  final String? currency;
  final String? timezone;
  final String? theme;
  final String? measurementSystem;
  final int? regionId;
  final int? cityId;
  final int? areaId;
  final String? postalCode;
  final String? locationSource;

  Map<String, dynamic> toJson() => {
        if (countryId != null) 'countryId': countryId,
        if (language != null) 'language': language,
        if (currency != null) 'currency': currency,
        if (timezone != null) 'timezone': timezone,
        if (theme != null) 'theme': theme,
        if (measurementSystem != null) 'measurementSystem': measurementSystem,
        if (regionId != null) 'regionId': regionId,
        if (cityId != null) 'cityId': cityId,
        if (areaId != null) 'areaId': areaId,
        if (postalCode != null) 'postalCode': postalCode,
        if (locationSource != null) 'locationSource': locationSource,
      };
}

T? firstDefined<T>(List<T?> candidates) {
  for (final candidate in candidates) {
    if (candidate == null) continue;
    if (candidate is String && candidate.isEmpty) continue;
    return candidate;
  }
  return null;
}

/// Same precedence as the backend merge: authenticated > local > country > app.
PreferenceSnapshot mergePreferences({
  required PreferenceSnapshot authenticated,
  required PreferenceSnapshot local,
  PreferenceSnapshot? countryDefault,
  PreferenceSnapshot? appDefault,
}) {
  final country = countryDefault ?? const PreferenceSnapshot();
  final app = appDefault ??
      const PreferenceSnapshot(
        language: 'en',
        currency: 'USD',
        timezone: 'UTC',
        theme: 'system',
        measurementSystem: 'metric',
      );

  return PreferenceSnapshot(
    countryId: firstDefined([
      authenticated.countryId,
      local.countryId,
      country.countryId,
      app.countryId,
    ]),
    countryCode: firstDefined([
      authenticated.countryCode,
      local.countryCode,
      country.countryCode,
      app.countryCode,
    ]),
    language: firstDefined([
      authenticated.language,
      local.language,
      country.language,
      app.language,
    ]),
    currency: firstDefined([
      authenticated.currency,
      local.currency,
      country.currency,
      app.currency,
    ]),
    timezone: firstDefined([
      authenticated.timezone,
      local.timezone,
      country.timezone,
      app.timezone,
    ]),
    theme: firstDefined([
      authenticated.theme,
      local.theme,
      country.theme,
      app.theme,
    ]),
    measurementSystem: firstDefined([
      authenticated.measurementSystem,
      local.measurementSystem,
      country.measurementSystem,
      app.measurementSystem,
    ]),
    regionId: firstDefined([
      authenticated.regionId,
      local.regionId,
      country.regionId,
      app.regionId,
    ]),
    cityId: firstDefined([authenticated.cityId, local.cityId, country.cityId, app.cityId]),
    areaId: firstDefined([authenticated.areaId, local.areaId, country.areaId, app.areaId]),
    postalCode: firstDefined([
      authenticated.postalCode,
      local.postalCode,
      country.postalCode,
      app.postalCode,
    ]),
    locationSource: firstDefined([
      authenticated.locationSource,
      local.locationSource,
      country.locationSource,
      app.locationSource,
    ]),
  );
}
