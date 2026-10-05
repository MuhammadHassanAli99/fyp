class VehicleTypeRule {
  const VehicleTypeRule({
    required this.code,
    required this.allowedOperations,
    this.categoryCode,
    this.groupCode,
    this.requiresMakeModel = true,
    this.requiresMileage = true,
    this.usesEngineHours = false,
    this.isMarine = false,
    this.isMachinery = false,
  });

  factory VehicleTypeRule.fromJson(Map<String, dynamic> json) =>
      VehicleTypeRule(
        code: (json['code'] ?? '').toString(),
        categoryCode: json['categoryCode']?.toString(),
        groupCode: json['groupCode']?.toString(),
        allowedOperations: (json['allowedOperations'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
        requiresMakeModel: json['requiresMakeModel'] as bool? ?? true,
        requiresMileage: json['requiresMileage'] as bool? ?? true,
        usesEngineHours: json['usesEngineHours'] as bool? ?? false,
        isMarine: json['isMarine'] as bool? ?? false,
        isMachinery: json['isMachinery'] as bool? ?? false,
      );

  final String code;
  final String? categoryCode;
  final String? groupCode;
  final List<String> allowedOperations;
  final bool requiresMakeModel;
  final bool requiresMileage;
  final bool usesEngineHours;
  final bool isMarine;
  final bool isMachinery;

  String get label => code.replaceAll('_', ' ');
}

class VehicleNamedCode {
  const VehicleNamedCode({required this.code, required this.name, this.extra});

  factory VehicleNamedCode.fromJson(Map<String, dynamic> json) =>
      VehicleNamedCode(
        code: (json['code'] ?? json['id'] ?? '').toString(),
        name: (json['name'] ?? json['label'] ?? json['code'] ?? '').toString(),
        extra: json,
      );

  final String code;
  final String name;
  final Map<String, dynamic>? extra;
}

class VehicleInspectionChecklist {
  const VehicleInspectionChecklist({
    required this.code,
    required this.name,
    this.appliesTo = const [],
    this.items = const [],
  });

  factory VehicleInspectionChecklist.fromJson(Map<String, dynamic> json) =>
      VehicleInspectionChecklist(
        code: (json['code'] ?? '').toString(),
        name: (json['name'] ?? json['code'] ?? '').toString(),
        appliesTo: (json['appliesTo'] as List? ?? const [])
            .map((e) => e.toString())
            .toList(),
        items: (json['items'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => VehicleNamedCode.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
      );

  final String code;
  final String name;
  final List<String> appliesTo;
  final List<VehicleNamedCode> items;
}

class VehicleCatalog {
  const VehicleCatalog({
    required this.types,
    required this.fuels,
    required this.transmissions,
    required this.drives,
    required this.conditions,
    required this.mileageUnits,
    required this.rentalDurations,
    required this.documentTypes,
    required this.shippingModes,
    required this.partCategories,
    this.features = const [],
    this.inspectionChecklists = const [],
    this.operations = const ['buy', 'sell', 'rent', 'auction'],
    this.disclaimer,
  });

  factory VehicleCatalog.fromJson(Map<String, dynamic> json) {
    List<VehicleNamedCode> named(dynamic raw) => (raw as List? ?? const [])
        .whereType<Map>()
        .map((e) => VehicleNamedCode.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    return VehicleCatalog(
      types: (json['types'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => VehicleTypeRule.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      fuels: named(json['fuels']),
      transmissions: named(json['transmissions']),
      drives: named(json['drives']),
      conditions: named(json['conditions']),
      mileageUnits: named(json['mileageUnits']),
      rentalDurations: named(json['rentalDurations']),
      documentTypes: named(json['documentTypes']),
      shippingModes: named(json['shippingModes']),
      partCategories: named(json['partCategories']),
      features: named(json['features']),
      inspectionChecklists: (json['inspectionChecklists'] as List? ?? const [])
          .whereType<Map>()
          .map(
            (e) => VehicleInspectionChecklist.fromJson(
              Map<String, dynamic>.from(e),
            ),
          )
          .toList(),
      operations: (json['operations'] as List? ?? const ['buy', 'sell', 'rent', 'auction'])
          .map((e) => e.toString())
          .toList(),
      disclaimer: json['disclaimer']?.toString(),
    );
  }

  final List<VehicleTypeRule> types;
  final List<VehicleNamedCode> fuels;
  final List<VehicleNamedCode> transmissions;
  final List<VehicleNamedCode> drives;
  final List<VehicleNamedCode> conditions;
  final List<VehicleNamedCode> mileageUnits;
  final List<VehicleNamedCode> rentalDurations;
  final List<VehicleNamedCode> documentTypes;
  final List<VehicleNamedCode> shippingModes;
  final List<VehicleNamedCode> partCategories;
  final List<VehicleNamedCode> features;
  final List<VehicleInspectionChecklist> inspectionChecklists;
  final List<String> operations;
  final String? disclaimer;

  List<VehicleTypeRule> typesForOperation(String operation) {
    final mapped = operation == 'auction' || operation == 'exchange'
        ? 'sell'
        : operation;
    final filtered =
        types.where((t) => t.allowedOperations.contains(mapped)).toList();
    return filtered.isEmpty ? types : filtered;
  }

  VehicleTypeRule? typeFor(String code) {
    for (final type in types) {
      if (type.code == code) return type;
    }
    return null;
  }
}

class ParsedVehicleQuery {
  const ParsedVehicleQuery({
    required this.q,
    this.operation,
    this.vehicleType,
    this.fuelType,
    this.transmission,
    this.yearMin,
    this.mileageMax,
    this.cityHint,
  });

  factory ParsedVehicleQuery.fromJson(Map<String, dynamic> json) =>
      ParsedVehicleQuery(
        q: (json['q'] ?? '').toString(),
        operation: json['operation']?.toString(),
        vehicleType: json['vehicleType']?.toString(),
        fuelType: json['fuelType']?.toString(),
        transmission: json['transmission']?.toString(),
        yearMin: (json['yearMin'] as num?)?.toInt(),
        mileageMax: (json['mileageMax'] as num?)?.toInt(),
        cityHint: json['cityHint']?.toString(),
      );

  final String q;
  final String? operation;
  final String? vehicleType;
  final String? fuelType;
  final String? transmission;
  final int? yearMin;
  final int? mileageMax;
  final String? cityHint;
}

class VehicleValuation {
  const VehicleValuation({
    required this.valueLow,
    required this.valueMid,
    required this.valueHigh,
    required this.currency,
    required this.confidence,
    required this.disclaimer,
    this.legalDisclaimer,
    this.sampleSize,
  });

  factory VehicleValuation.fromJson(Map<String, dynamic> json) =>
      VehicleValuation(
        valueLow: (json['valueLow'] as num?)?.toDouble() ?? 0,
        valueMid: (json['valueMid'] as num?)?.toDouble() ?? 0,
        valueHigh: (json['valueHigh'] as num?)?.toDouble() ?? 0,
        currency: (json['currency'] ?? '').toString(),
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
        sampleSize: (json['sampleSize'] as num?)?.toInt(),
        disclaimer: (json['disclaimer'] ??
                'This is an automated estimate, not a guaranteed price.')
            .toString(),
        legalDisclaimer: json['legalDisclaimer']?.toString(),
      );

  final double valueLow;
  final double valueMid;
  final double valueHigh;
  final String currency;
  final double confidence;
  final int? sampleSize;
  final String disclaimer;
  final String? legalDisclaimer;
}

class VehicleMapMarker {
  const VehicleMapMarker({
    required this.listingId,
    required this.latitude,
    required this.longitude,
    required this.title,
    required this.approximate,
  });

  factory VehicleMapMarker.fromJson(Map<String, dynamic> json) =>
      VehicleMapMarker(
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

class VehiclePart {
  const VehiclePart({
    required this.id,
    required this.name,
    required this.price,
    required this.currency,
    this.sku,
    this.oemPartNumber,
    this.brand,
    this.categoryCode,
    this.conditionCode,
  });

  factory VehiclePart.fromJson(Map<String, dynamic> json) => VehiclePart(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: (json['name'] ?? '').toString(),
        sku: json['sku']?.toString(),
        oemPartNumber: json['oemPartNumber']?.toString(),
        brand: json['brand']?.toString(),
        categoryCode: json['categoryCode']?.toString(),
        conditionCode: json['conditionCode']?.toString(),
        price: (json['price'] as num?)?.toDouble() ?? 0,
        currency: (json['currency'] ?? '').toString(),
      );

  final int id;
  final String name;
  final String? sku;
  final String? oemPartNumber;
  final String? brand;
  final String? categoryCode;
  final String? conditionCode;
  final double price;
  final String currency;
}

class VehicleLandedCost {
  const VehicleLandedCost({
    required this.total,
    required this.currency,
    required this.components,
    required this.disclaimer,
    this.status = 'estimated',
  });

  factory VehicleLandedCost.fromJson(Map<String, dynamic> json) {
    final raw = json['components'];
    return VehicleLandedCost(
      total: (json['total'] as num?)?.toDouble() ?? 0,
      currency: (json['currency'] ?? '').toString(),
      status: (json['status'] ?? 'estimated').toString(),
      components: raw is Map
          ? raw.map((k, v) => MapEntry(k.toString(), (v as num?)?.toDouble() ?? 0))
          : const {},
      disclaimer: (json['disclaimer'] ??
              'Estimated landed cost. Not an authoritative customs calculation.')
          .toString(),
    );
  }

  final double total;
  final String currency;
  final String status;
  final Map<String, double> components;
  final String disclaimer;
}

class VehicleFinanceQuote {
  const VehicleFinanceQuote({
    required this.estimatedMonthly,
    required this.loanAmount,
    required this.downPayment,
    required this.termMonths,
    required this.currency,
    required this.isEstimate,
    required this.disclaimer,
  });

  factory VehicleFinanceQuote.fromJson(Map<String, dynamic> json) =>
      VehicleFinanceQuote(
        estimatedMonthly: (json['estimatedMonthly'] as num?)?.toDouble() ?? 0,
        loanAmount: (json['loanAmount'] as num?)?.toDouble() ?? 0,
        downPayment: (json['downPayment'] as num?)?.toDouble() ?? 0,
        termMonths: (json['termMonths'] as num?)?.toInt() ?? 0,
        currency: (json['currency'] ?? '').toString(),
        isEstimate: json['isEstimate'] as bool? ?? true,
        disclaimer: (json['disclaimer'] ??
                'This is an estimated monthly payment, not a lender offer.')
            .toString(),
      );

  final double estimatedMonthly;
  final double loanAmount;
  final double downPayment;
  final int termMonths;
  final String currency;
  final bool isEstimate;
  final String disclaimer;
}

class VehicleInsuranceQuote {
  const VehicleInsuranceQuote({
    required this.premium,
    required this.currency,
    required this.isEstimate,
    required this.disclaimer,
    this.coverage,
    this.providerCode,
  });

  factory VehicleInsuranceQuote.fromJson(Map<String, dynamic> json) =>
      VehicleInsuranceQuote(
        premium: (json['premium'] as num?)?.toDouble() ?? 0,
        currency: (json['currency'] ?? '').toString(),
        isEstimate: json['isEstimate'] as bool? ?? true,
        coverage: json['coverage']?.toString(),
        providerCode: json['providerCode']?.toString(),
        disclaimer: (json['disclaimer'] ??
                'This is a stub insurance quote, not a bindable policy.')
            .toString(),
      );

  final double premium;
  final String currency;
  final bool isEstimate;
  final String? coverage;
  final String? providerCode;
  final String disclaimer;
}
