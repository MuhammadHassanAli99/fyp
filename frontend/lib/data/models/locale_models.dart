class CountryModel {
  const CountryModel({
    required this.code,
    required this.name,
    this.id,
    this.iso3,
    this.flag,
    this.nativeName,
    this.defaultCurrency,
    this.defaultLanguage,
    this.defaultTimezone,
    this.measurementSystem,
    this.dateFormat,
    this.timeFormat,
    this.dialCode,
    this.areaUnit,
    this.weightUnit,
    this.distanceUnit,
    this.goldWeightUnit,
    this.requiresKyc,
    this.requiresAml,
  });

  factory CountryModel.fromJson(Map<String, dynamic> json) {
    final code = (json['iso2'] ?? json['code'] ?? '').toString();
    return CountryModel(
      id: (json['id'] as num?)?.toInt(),
      code: code,
      iso3: json['iso3']?.toString(),
      name: (json['name'] ?? '').toString(),
      nativeName: json['nativeName'] as String?,
      flag: (json['flagEmoji'] ?? json['flag']) as String?,
      defaultCurrency: json['defaultCurrency']?.toString(),
      defaultLanguage: json['defaultLanguage']?.toString(),
      defaultTimezone: json['defaultTimezone']?.toString(),
      measurementSystem: json['measurementSystem']?.toString(),
      dateFormat: json['dateFormat']?.toString(),
      timeFormat: json['timeFormat']?.toString(),
      dialCode: json['dialCode']?.toString(),
      areaUnit: json['areaUnit']?.toString(),
      weightUnit: json['weightUnit']?.toString(),
      distanceUnit: json['distanceUnit']?.toString(),
      goldWeightUnit: json['goldWeightUnit']?.toString(),
      requiresKyc: json['requiresKyc'] == true,
      requiresAml: json['requiresAml'] == true,
    );
  }

  final int? id;
  final String code;
  final String? iso3;
  final String name;
  final String? nativeName;
  final String? flag;
  final String? defaultCurrency;
  final String? defaultLanguage;
  final String? defaultTimezone;
  final String? measurementSystem;
  final String? dateFormat;
  final String? timeFormat;
  final String? dialCode;
  final String? areaUnit;
  final String? weightUnit;
  final String? distanceUnit;
  final String? goldWeightUnit;
  final bool? requiresKyc;
  final bool? requiresAml;

  String get displayName =>
      flag != null && flag!.isNotEmpty ? '$flag $name' : name;
}

class CountryDetailModel {
  const CountryDetailModel({
    required this.country,
    this.languages = const [],
    this.currencies = const [],
    this.postalCodeRegex,
    this.addressFormat = const [],
    this.phoneFormat,
  });

  factory CountryDetailModel.fromJson(Map<String, dynamic> json) {
    return CountryDetailModel(
      country: CountryModel.fromJson(json),
      languages: (json['languages'] as List? ?? [])
          .whereType<Map>()
          .map((e) => LanguageModel.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      currencies: (json['currencies'] as List? ?? [])
          .whereType<Map>()
          .map((e) => CurrencyModel.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      postalCodeRegex: json['postalCodeRegex']?.toString(),
      addressFormat: (json['addressFormat'] as List? ?? const [])
          .map((e) => e.toString())
          .toList(),
      phoneFormat: json['phoneFormat']?.toString(),
    );
  }

  final CountryModel country;
  final List<LanguageModel> languages;
  final List<CurrencyModel> currencies;
  final String? postalCodeRegex;
  final List<String> addressFormat;
  final String? phoneFormat;
}

class LanguageModel {
  const LanguageModel({
    required this.code,
    required this.name,
    this.nativeName,
    this.rtl = false,
    this.isPrimary = false,
  });

  factory LanguageModel.fromJson(Map<String, dynamic> json) {
    final direction = json['direction']?.toString().toLowerCase();
    return LanguageModel(
      code: (json['code'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      nativeName: json['nativeName'] as String?,
      rtl: direction == 'rtl' || json['rtl'] == true,
      isPrimary: json['isPrimary'] == true,
    );
  }

  final String code;
  final String name;
  final String? nativeName;
  final bool rtl;
  final bool isPrimary;

  String get displayName =>
      nativeName != null && nativeName!.isNotEmpty ? '$name ($nativeName)' : name;
}

class CurrencyModel {
  const CurrencyModel({
    required this.code,
    required this.name,
    this.symbol,
    this.decimalDigits,
  });

  factory CurrencyModel.fromJson(Map<String, dynamic> json) => CurrencyModel(
        code: (json['code'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        symbol: json['symbol'] as String?,
        decimalDigits: (json['decimalDigits'] as num?)?.toInt(),
      );

  final String code;
  final String name;
  final String? symbol;
  final int? decimalDigits;

  String get displayName => '$code — $name';
}

class ConvertedAmount {
  const ConvertedAmount({
    required this.amount,
    required this.currency,
    this.rate,
    this.fetchedAt,
    this.stale = false,
  });

  factory ConvertedAmount.fromJson(Map<String, dynamic> json) => ConvertedAmount(
        amount: (json['amount'] as num?)?.toDouble() ?? 0,
        currency: (json['currency'] ?? '').toString(),
        rate: (json['rate'] as num?)?.toDouble(),
        fetchedAt: DateTime.tryParse(
          (json['fetchedAt'] ?? json['asOf'] ?? '').toString(),
        ),
        stale: json['stale'] == true,
      );

  final double amount;
  final String currency;
  final double? rate;
  final DateTime? fetchedAt;
  final bool stale;
}

class RegionModel {
  const RegionModel({
    required this.id,
    required this.name,
    this.code,
    this.kind,
  });

  factory RegionModel.fromJson(Map<String, dynamic> json) => RegionModel(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: (json['name'] ?? '').toString(),
        code: json['code']?.toString(),
        kind: json['kind']?.toString(),
      );

  final int id;
  final String name;
  final String? code;
  final String? kind;
}

class CityModel {
  const CityModel({
    required this.id,
    required this.name,
    this.regionId,
    this.regionName,
    this.postalCode,
    this.latitude,
    this.longitude,
  });

  factory CityModel.fromJson(Map<String, dynamic> json) => CityModel(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: (json['name'] ?? '').toString(),
        regionId: (json['regionId'] as num?)?.toInt(),
        regionName: json['regionName']?.toString() ??
            (json['region'] is Map
                ? (json['region'] as Map)['name']?.toString()
                : null),
        postalCode: json['postalCode']?.toString(),
        latitude: (json['latitude'] as num?)?.toDouble(),
        longitude: (json['longitude'] as num?)?.toDouble(),
      );

  final int id;
  final String name;
  final int? regionId;
  final String? regionName;
  final String? postalCode;
  final double? latitude;
  final double? longitude;
}

class ReverseGeoResult {
  const ReverseGeoResult({
    this.countryId,
    this.countryCode,
    this.countryName,
    this.regionId,
    this.regionName,
    this.cityId,
    this.cityName,
    this.postalCode,
  });

  factory ReverseGeoResult.fromJson(Map<String, dynamic> json) {
    final country = json['country'];
    final region = json['region'];
    final city = json['city'];
    return ReverseGeoResult(
      countryId: (json['countryId'] as num?)?.toInt() ??
          (country is Map ? (country['id'] as num?)?.toInt() : null),
      countryCode: (json['countryCode'] ??
              (country is Map ? country['iso2'] : null))
          ?.toString(),
      countryName: (json['countryName'] ??
              (country is Map ? country['name'] : null))
          ?.toString(),
      regionId: (json['regionId'] as num?)?.toInt() ??
          (region is Map ? (region['id'] as num?)?.toInt() : null),
      regionName: (json['regionName'] ??
              (region is Map ? region['name'] : null))
          ?.toString(),
      cityId: (json['cityId'] as num?)?.toInt() ??
          (city is Map ? (city['id'] as num?)?.toInt() : null),
      cityName: (json['cityName'] ?? (city is Map ? city['name'] : null))
          ?.toString(),
      postalCode: json['postalCode']?.toString(),
    );
  }

  final int? countryId;
  final String? countryCode;
  final String? countryName;
  final int? regionId;
  final String? regionName;
  final int? cityId;
  final String? cityName;
  final String? postalCode;
}

class AreaModel {
  const AreaModel({
    required this.id,
    required this.name,
    this.cityId,
  });

  factory AreaModel.fromJson(Map<String, dynamic> json) => AreaModel(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: (json['name'] ?? '').toString(),
        cityId: (json['cityId'] as num?)?.toInt(),
      );

  final int id;
  final String name;
  final int? cityId;
}

class CountryIpSuggestion {
  const CountryIpSuggestion({
    required this.iso2,
    this.name,
    this.flag,
    this.source = 'default',
    this.confidence = 'low',
  });

  factory CountryIpSuggestion.fromJson(Map<String, dynamic> json) =>
      CountryIpSuggestion(
        iso2: (json['iso2'] ?? json['countryCode'] ?? '').toString(),
        name: json['name']?.toString(),
        flag: (json['flagEmoji'] ?? json['flag'])?.toString(),
        source: (json['source'] ?? 'default').toString(),
        confidence: (json['confidence'] ?? 'low').toString(),
      );

  final String iso2;
  final String? name;
  final String? flag;
  final String source;
  final String confidence;
}
