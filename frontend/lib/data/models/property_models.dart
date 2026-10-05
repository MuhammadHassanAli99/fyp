class PropertyTypeRule {
  const PropertyTypeRule({
    required this.code,
    required this.usageGroup,
    required this.allowedOperations,
    this.categoryCode,
    this.requiresBedrooms = false,
    this.requiresCoveredArea = false,
    this.isLand = false,
    this.isHospitality = false,
  });

  factory PropertyTypeRule.fromJson(Map<String, dynamic> json) =>
      PropertyTypeRule(
        code: (json['code'] ?? '').toString(),
        usageGroup: (json['usageGroup'] ?? '').toString(),
        categoryCode: json['categoryCode']?.toString(),
        allowedOperations: (json['allowedOperations'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
        requiresBedrooms: json['requiresBedrooms'] as bool? ?? false,
        requiresCoveredArea: json['requiresCoveredArea'] as bool? ?? false,
        isLand: json['isLand'] as bool? ?? false,
        isHospitality: json['isHospitality'] as bool? ?? false,
      );

  final String code;
  final String usageGroup;
  final String? categoryCode;
  final List<String> allowedOperations;
  final bool requiresBedrooms;
  final bool requiresCoveredArea;
  final bool isLand;
  final bool isHospitality;

  String get label => code.replaceAll('_', ' ');
}

class PropertyNamedCode {
  const PropertyNamedCode({required this.code, required this.name, this.extra});

  factory PropertyNamedCode.fromJson(Map<String, dynamic> json) =>
      PropertyNamedCode(
        code: (json['code'] ?? json['id'] ?? '').toString(),
        name: (json['name'] ?? json['label'] ?? json['symbol'] ?? json['code'] ?? '')
            .toString(),
        extra: json,
      );

  final String code;
  final String name;
  final Map<String, dynamic>? extra;
}

class PropertyCatalog {
  const PropertyCatalog({
    required this.types,
    required this.areaUnits,
    required this.rentalDurations,
    required this.furnishing,
    required this.documentTypes,
    this.groups = const [],
    this.disclaimer,
  });

  factory PropertyCatalog.fromJson(Map<String, dynamic> json) {
    List<PropertyNamedCode> named(dynamic raw) => (raw as List? ?? const [])
        .whereType<Map>()
        .map((e) => PropertyNamedCode.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    return PropertyCatalog(
      types: (json['types'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => PropertyTypeRule.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      areaUnits: named(json['areaUnits']),
      rentalDurations: named(json['rentalDurations']),
      furnishing: named(json['furnishing']),
      documentTypes: named(json['documentTypes']),
      groups: (json['groups'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => PropertyNamedCode.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      disclaimer: json['disclaimer']?.toString(),
    );
  }

  final List<PropertyTypeRule> types;
  final List<PropertyNamedCode> areaUnits;
  final List<PropertyNamedCode> rentalDurations;
  final List<PropertyNamedCode> furnishing;
  final List<PropertyNamedCode> documentTypes;
  final List<PropertyNamedCode> groups;
  final String? disclaimer;

  List<PropertyTypeRule> typesForOperation(String operation) {
    final mapped = operation == 'auction' || operation == 'exchange'
        ? 'sell'
        : operation;
    final filtered =
        types.where((t) => t.allowedOperations.contains(mapped)).toList();
    return filtered.isEmpty ? types : filtered;
  }
}

class ParsedPropertyQuery {
  const ParsedPropertyQuery({
    required this.q,
    this.operation,
    this.propertyKind,
    this.bedroomsMin,
    this.cityHint,
  });

  factory ParsedPropertyQuery.fromJson(Map<String, dynamic> json) =>
      ParsedPropertyQuery(
        q: (json['q'] ?? '').toString(),
        operation: json['operation']?.toString(),
        propertyKind: json['propertyKind']?.toString(),
        bedroomsMin: (json['bedroomsMin'] as num?)?.toInt(),
        cityHint: json['cityHint']?.toString(),
      );

  final String q;
  final String? operation;
  final String? propertyKind;
  final int? bedroomsMin;
  final String? cityHint;
}

class PropertyValuation {
  const PropertyValuation({
    required this.valueLow,
    required this.valueMid,
    required this.valueHigh,
    required this.currency,
    required this.confidence,
    required this.disclaimer,
    this.sampleSize,
    this.explanation,
  });

  factory PropertyValuation.fromJson(Map<String, dynamic> json) =>
      PropertyValuation(
        valueLow: (json['valueLow'] as num?)?.toDouble() ?? 0,
        valueMid: (json['valueMid'] as num?)?.toDouble() ?? 0,
        valueHigh: (json['valueHigh'] as num?)?.toDouble() ?? 0,
        currency: (json['currency'] ?? '').toString(),
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
        sampleSize: (json['sampleSize'] as num?)?.toInt(),
        explanation: json['explanation']?.toString(),
        disclaimer: (json['disclaimer'] ??
                'This is an automated estimate, not a guaranteed market price.')
            .toString(),
      );

  final double valueLow;
  final double valueMid;
  final double valueHigh;
  final String currency;
  final double confidence;
  final int? sampleSize;
  final String? explanation;
  final String disclaimer;
}

class PropertyMapMarker {
  const PropertyMapMarker({
    required this.listingId,
    required this.latitude,
    required this.longitude,
    required this.title,
    required this.approximate,
  });

  factory PropertyMapMarker.fromJson(Map<String, dynamic> json) =>
      PropertyMapMarker(
        listingId: (json['listingId'] as num?)?.toInt() ?? 0,
        latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
        longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
        title: (json['title'] ?? '').toString(),
        approximate: json['approximate'] as bool? ?? true,
      );

  final int listingId;
  final double latitude;
  final double longitude;
  final String title;
  final bool approximate;
}

class SavedSearchItem {
  const SavedSearchItem({
    required this.id,
    required this.name,
    this.alertFrequency,
    this.newResultCount,
  });

  factory SavedSearchItem.fromJson(Map<String, dynamic> json) => SavedSearchItem(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: (json['name'] ?? '').toString(),
        alertFrequency: json['alertFrequency']?.toString(),
        newResultCount: (json['newResultCount'] as num?)?.toInt(),
      );

  final int id;
  final String name;
  final String? alertFrequency;
  final int? newResultCount;
}
