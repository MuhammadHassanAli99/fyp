import '../../core/network/api_client.dart';

class RemoteConfiguration {
  const RemoteConfiguration({
    required this.versions,
    this.minAppVersion,
    this.forceUpdateBelow,
    this.baseCurrency = 'USD',
    this.defaultCountry = 'US',
    this.supportedCountryCodes = const [],
    this.supportedLanguageCodes = const [],
    this.supportedCurrencyCodes = const [],
    this.rtlLanguages = const ['ar', 'ur'],
    this.guestRestrictions = const {},
    this.features = const {},
    this.schemaCompatible = true,
  });

  factory RemoteConfiguration.fromJson(Map<String, dynamic> json) {
    final versions = Map<String, dynamic>.from(json['versions'] as Map? ?? {});
    final app = json['app'] is Map
        ? Map<String, dynamic>.from(json['app'] as Map)
        : json;
    return RemoteConfiguration(
      versions: ConfigVersions.fromJson(versions),
      minAppVersion: (app['minAppVersion'] ?? json['minAppVersion'])?.toString(),
      forceUpdateBelow:
          (app['forceUpdateBelow'] ?? json['forceUpdateBelow'])?.toString(),
      baseCurrency: (app['baseCurrency'] ?? 'USD').toString(),
      defaultCountry: (app['defaultCountry'] ?? 'US').toString(),
      supportedCountryCodes: _stringList(json['supportedCountryCodes']),
      supportedLanguageCodes: _stringList(json['supportedLanguageCodes']),
      supportedCurrencyCodes: _stringList(json['supportedCurrencyCodes']),
      rtlLanguages: _stringList(json['rtlLanguages'], fallback: const ['ar', 'ur']),
      guestRestrictions: Map<String, dynamic>.from(
        json['guestRestrictions'] as Map? ?? {},
      ),
      features: Map<String, dynamic>.from(json['features'] as Map? ?? {}),
      schemaCompatible: app['schemaCompatible'] as bool? ?? true,
    );
  }

  final ConfigVersions versions;
  final String? minAppVersion;
  final String? forceUpdateBelow;
  final String baseCurrency;
  final String defaultCountry;
  final List<String> supportedCountryCodes;
  final List<String> supportedLanguageCodes;
  final List<String> supportedCurrencyCodes;
  final List<String> rtlLanguages;
  final Map<String, dynamic> guestRestrictions;
  final Map<String, dynamic> features;
  final bool schemaCompatible;
}

class ConfigVersions {
  const ConfigVersions({
    this.configuration = 0,
    this.countries = 0,
    this.languages = 0,
    this.currencies = 0,
    this.exchangeRates = 0,
    this.features = 0,
    this.exchangeRatesAsOf,
  });

  factory ConfigVersions.fromJson(Map<String, dynamic> json) => ConfigVersions(
        configuration: (json['configuration'] as num?)?.toInt() ?? 0,
        countries: (json['countries'] as num?)?.toInt() ?? 0,
        languages: (json['languages'] as num?)?.toInt() ?? 0,
        currencies: (json['currencies'] as num?)?.toInt() ?? 0,
        exchangeRates: (json['exchangeRates'] as num?)?.toInt() ?? 0,
        features: (json['features'] as num?)?.toInt() ?? 0,
        exchangeRatesAsOf: json['exchangeRatesAsOf']?.toString(),
      );

  final int configuration;
  final int countries;
  final int languages;
  final int currencies;
  final int exchangeRates;
  final int features;
  final String? exchangeRatesAsOf;

  bool isNewerThan(ConfigVersions local) =>
      configuration > local.configuration ||
      countries > local.countries ||
      languages > local.languages ||
      currencies > local.currencies ||
      exchangeRates > local.exchangeRates ||
      features > local.features;
}

List<String> _stringList(dynamic value, {List<String> fallback = const []}) {
  if (value is List) {
    return value.map((e) => e.toString()).toList();
  }
  return fallback;
}

class ConfigurationApi {
  ConfigurationApi(this._client);
  final ApiClient _client;

  Future<RemoteConfiguration> fetch() => _client.get(
        '/configuration',
        parser: (d) =>
            RemoteConfiguration.fromJson(d as Map<String, dynamic>),
      );
}
