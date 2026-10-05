class GoldPurity {
  const GoldPurity({
    required this.karat,
    required this.fineness,
    required this.label,
    this.purityPercent,
    this.standardCode,
    this.verificationMethod,
  });

  factory GoldPurity.fromJson(Map<String, dynamic> json) => GoldPurity(
        karat: (json['karat'] as num?)?.toDouble() ?? 0,
        fineness: (json['fineness'] as num?)?.toInt() ?? 0,
        label: (json['label'] ?? '${json['karat']}K').toString(),
        purityPercent: (json['purityPercent'] as num?)?.toDouble(),
        standardCode: json['standardCode']?.toString(),
        verificationMethod: json['verificationMethod']?.toString(),
      );

  final double karat;
  final int fineness;
  final String label;
  final double? purityPercent;
  final String? standardCode;
  final String? verificationMethod;

  String get karatKey {
    final v = karat == karat.roundToDouble() ? karat.toInt().toString() : karat.toString();
    return v;
  }
}

class GoldBrand {
  const GoldBrand({
    required this.id,
    required this.name,
    this.slug,
    this.logoUrl,
    this.countryId,
    this.verificationStatus = 'unverified',
    this.isPopular = false,
  });

  factory GoldBrand.fromJson(Map<String, dynamic> json) => GoldBrand(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: (json['name'] ?? '').toString(),
        slug: json['slug']?.toString(),
        logoUrl: json['logoUrl']?.toString(),
        countryId: (json['countryId'] as num?)?.toInt(),
        verificationStatus: json['verificationStatus']?.toString() ?? 'unverified',
        isPopular: json['isPopular'] as bool? ?? false,
      );

  final int id;
  final String name;
  final String? slug;
  final String? logoUrl;
  final int? countryId;
  final String verificationStatus;
  final bool isPopular;
}

class GoldHallmarkAuthority {
  const GoldHallmarkAuthority({
    required this.id,
    required this.code,
    required this.name,
    this.countryId,
    this.verificationSource,
  });

  factory GoldHallmarkAuthority.fromJson(Map<String, dynamic> json) =>
      GoldHallmarkAuthority(
        id: (json['id'] as num?)?.toInt() ?? 0,
        code: (json['code'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        countryId: (json['countryId'] as num?)?.toInt(),
        verificationSource: json['verificationSource']?.toString(),
      );

  final int id;
  final String code;
  final String name;
  final int? countryId;
  final String? verificationSource;
}

class GoldCategoryLeaf {
  const GoldCategoryLeaf({
    required this.id,
    required this.code,
    required this.name,
    this.parentCode,
    this.parentName,
    this.isLeaf = true,
  });

  factory GoldCategoryLeaf.fromJson(Map<String, dynamic> json) =>
      GoldCategoryLeaf(
        id: (json['id'] as num?)?.toInt() ?? 0,
        code: (json['code'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        parentCode: json['parentCode']?.toString(),
        parentName: json['parentName']?.toString(),
        isLeaf: json['isLeaf'] as bool? ?? true,
      );

  final int id;
  final String code;
  final String name;
  final String? parentCode;
  final String? parentName;
  final bool isLeaf;
}

class GoldCategoryGroup {
  const GoldCategoryGroup({
    required this.code,
    required this.name,
    this.categories = const [],
  });

  factory GoldCategoryGroup.fromJson(Map<String, dynamic> json) {
    final raw = json['categories'] ?? json['categoryCodes'] ?? [];
    return GoldCategoryGroup(
      code: (json['code'] ?? '').toString(),
      name: (json['name'] ?? json['code'] ?? '').toString(),
      categories: raw is List
          ? raw
              .whereType<Map>()
              .map((e) => GoldCategoryLeaf.fromJson(Map<String, dynamic>.from(e)))
              .toList()
          : const [],
    );
  }

  final String code;
  final String name;
  final List<GoldCategoryLeaf> categories;
}

class GoldMakingChargeType {
  const GoldMakingChargeType({
    required this.code,
    required this.api,
    required this.label,
  });

  factory GoldMakingChargeType.fromJson(Map<String, dynamic> json) =>
      GoldMakingChargeType(
        code: (json['code'] ?? 'flat').toString(),
        api: (json['api'] ?? json['code'] ?? 'FIXED').toString(),
        label: (json['label'] ?? json['code'] ?? '').toString(),
      );

  final String code;
  final String api;
  final String label;
}

class GoldCatalog {
  const GoldCatalog({
    this.groups = const [],
    this.categories = const [],
    this.purities = const [],
    this.countryPurities = const [],
    this.brands = const [],
    this.hallmarkAuthorities = const [],
    this.makingChargeTypes = const [],
    this.weightUnits = const ['gram'],
    this.disclaimer,
  });

  factory GoldCatalog.fromJson(Map<String, dynamic> json) => GoldCatalog(
        groups: (json['groups'] as List? ?? [])
            .whereType<Map>()
            .map((e) => GoldCategoryGroup.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        categories: (json['categories'] as List? ?? [])
            .whereType<Map>()
            .map((e) => GoldCategoryLeaf.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        purities: (json['purities'] as List? ?? [])
            .whereType<Map>()
            .map((e) => GoldPurity.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        countryPurities: (json['countryPurities'] as List? ?? [])
            .whereType<Map>()
            .map((e) => GoldPurity.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        brands: (json['brands'] as List? ?? [])
            .whereType<Map>()
            .map((e) => GoldBrand.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        hallmarkAuthorities: (json['hallmarkAuthorities'] as List? ?? [])
            .whereType<Map>()
            .map((e) => GoldHallmarkAuthority.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        makingChargeTypes: (json['makingChargeTypes'] as List? ?? [])
            .whereType<Map>()
            .map((e) => GoldMakingChargeType.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        weightUnits: (json['weightUnits'] as List? ?? ['gram'])
            .map((e) => e.toString())
            .toList(),
        disclaimer: json['disclaimer']?.toString(),
      );

  final List<GoldCategoryGroup> groups;
  final List<GoldCategoryLeaf> categories;
  final List<GoldPurity> purities;
  final List<GoldPurity> countryPurities;
  final List<GoldBrand> brands;
  final List<GoldHallmarkAuthority> hallmarkAuthorities;
  final List<GoldMakingChargeType> makingChargeTypes;
  final List<String> weightUnits;
  final String? disclaimer;

  List<GoldPurity> get displayPurities =>
      countryPurities.isNotEmpty ? countryPurities : purities;
}

class GoldRate {
  const GoldRate({
    required this.karat,
    required this.currency,
    required this.ratePerGram,
    this.ratePerTola,
    this.changePercent,
    this.source,
    this.asOf,
    this.metal = 'gold',
  });

  factory GoldRate.fromJson(Map<String, dynamic> json) => GoldRate(
        karat: (json['karat'] as num?)?.toDouble() ?? 0,
        currency: json['currency']?.toString() ?? 'USD',
        ratePerGram: (json['ratePerGram'] as num?)?.toDouble() ?? 0,
        ratePerTola: (json['ratePerTola'] as num?)?.toDouble(),
        changePercent: (json['changePercent'] as num?)?.toDouble(),
        source: json['source']?.toString(),
        asOf: json['asOf']?.toString(),
        metal: json['metal']?.toString() ?? 'gold',
      );

  final double karat;
  final String currency;
  final double ratePerGram;
  final double? ratePerTola;
  final double? changePercent;
  final String? source;
  final String? asOf;
  final String metal;
}

class GoldRatesResponse {
  const GoldRatesResponse({
    required this.rates,
    required this.currency,
    this.disclaimer,
  });

  factory GoldRatesResponse.fromJson(Map<String, dynamic> json) =>
      GoldRatesResponse(
        rates: (json['rates'] as List? ?? [])
            .whereType<Map>()
            .map((e) => GoldRate.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        currency: json['currency']?.toString() ?? 'USD',
        disclaimer: json['disclaimer']?.toString(),
      );

  final List<GoldRate> rates;
  final String currency;
  final String? disclaimer;
}

class GoldForecast {
  const GoldForecast({
    required this.horizon,
    required this.predictedRate,
    this.lowerBound,
    this.upperBound,
    this.confidence,
    this.direction,
    this.modelId,
    this.modelVersion,
    this.targetDate,
    this.disclaimer,
  });

  factory GoldForecast.fromJson(Map<String, dynamic> json) => GoldForecast(
        horizon: json['horizon']?.toString() ?? '',
        predictedRate: (json['predictedRate'] as num?)?.toDouble() ?? 0,
        lowerBound: (json['lowerBound'] as num?)?.toDouble(),
        upperBound: (json['upperBound'] as num?)?.toDouble(),
        confidence: (json['confidence'] as num?)?.toDouble(),
        direction: json['direction']?.toString(),
        modelId: (json['modelId'] ?? json['model'])?.toString(),
        modelVersion: json['modelVersion']?.toString(),
        targetDate: json['targetDate']?.toString(),
        disclaimer: json['disclaimer']?.toString(),
      );

  final String horizon;
  final double predictedRate;
  final double? lowerBound;
  final double? upperBound;
  final double? confidence;
  final String? direction;
  final String? modelId;
  final String? modelVersion;
  final String? targetDate;
  final String? disclaimer;
}

class GoldRiskAssessment {
  const GoldRiskAssessment({
    required this.risk,
    required this.confidence,
    required this.recommendation,
    required this.disclaimer,
    this.score,
    this.reasons = const [],
    this.physicalVerificationRecommended = false,
    this.modelId,
    this.modelVersion,
  });

  factory GoldRiskAssessment.fromJson(Map<String, dynamic> json) =>
      GoldRiskAssessment(
        risk: json['risk']?.toString() ?? 'medium',
        confidence: (json['confidence'] as num?)?.toDouble() ?? 0,
        recommendation: json['recommendation']?.toString() ??
            'AI could not confidently assess authenticity.',
        disclaimer: json['disclaimer']?.toString() ??
            'AI authenticity assessment is a risk-support tool. It cannot prove physical gold is genuine.',
        score: (json['score'] as num?)?.toDouble(),
        reasons: (json['reasons'] as List? ?? [])
            .whereType<Map>()
            .map((e) => (e['label'] ?? e['detail'] ?? '').toString())
            .where((s) => s.isNotEmpty)
            .toList(),
        physicalVerificationRecommended:
            json['physicalVerificationRecommended'] as bool? ?? false,
        modelId: (json['model'] is Map ? json['model']['id'] : json['modelId'])
            ?.toString(),
        modelVersion: (json['model'] is Map
                ? json['model']['version']
                : json['modelVersion'])
            ?.toString(),
      );

  final String risk;
  final double confidence;
  final String recommendation;
  final String disclaimer;
  final double? score;
  final List<String> reasons;
  final bool physicalVerificationRecommended;
  final String? modelId;
  final String? modelVersion;

  String get headline => switch (risk) {
        'low' => 'AI authenticity assessment: Low risk',
        'high' => 'AI authenticity assessment: High risk',
        _ => 'AI could not confidently assess authenticity.',
      };
}

class ListingAuction {
  const ListingAuction({
    required this.id,
    this.uuid,
    this.status,
    this.currentBid,
    this.startPrice,
    this.bidIncrement,
    this.buyNowPrice,
    this.bidCount = 0,
    this.currency,
    this.startsAt,
    this.endsAt,
    this.serverNow,
  });

  factory ListingAuction.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const ListingAuction(id: 0);
    return ListingAuction(
      id: (json['id'] as num?)?.toInt() ?? 0,
      uuid: json['uuid']?.toString(),
      status: json['status']?.toString(),
      currentBid: (json['currentBid'] as num?)?.toDouble(),
      startPrice: (json['startPrice'] as num?)?.toDouble(),
      bidIncrement: (json['bidIncrement'] as num?)?.toDouble(),
      buyNowPrice: (json['buyNowPrice'] as num?)?.toDouble(),
      bidCount: (json['bidCount'] as num?)?.toInt() ?? 0,
      currency: json['currency']?.toString(),
      startsAt: json['startsAt'] != null
          ? DateTime.tryParse(json['startsAt'].toString())
          : null,
      endsAt: json['endsAt'] != null
          ? DateTime.tryParse(json['endsAt'].toString())
          : null,
      serverNow: json['serverNow'] != null
          ? DateTime.tryParse(json['serverNow'].toString())
          : null,
    );
  }

  final int id;
  final String? uuid;
  final String? status;
  final double? currentBid;
  final double? startPrice;
  final double? bidIncrement;
  final double? buyNowPrice;
  final int bidCount;
  final String? currency;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final DateTime? serverNow;

  bool get isLive => status == 'live';
  String get routeId => uuid ?? '$id';
}

class GoldBuyResult {
  const GoldBuyResult({
    required this.orderId,
    this.orderUuid,
    this.originalPrice,
    this.originalCurrency,
    this.disclaimer,
    this.requiresPhysicalVerification = false,
  });

  factory GoldBuyResult.fromJson(Map<String, dynamic> json) {
    final order = json['order'] is Map
        ? Map<String, dynamic>.from(json['order'] as Map)
        : json;
    return GoldBuyResult(
      orderId: (order['id'] ?? json['orderId'] ?? '').toString(),
      orderUuid: (order['uuid'] ?? json['orderUuid'])?.toString(),
      originalPrice: (json['originalPrice'] as num?)?.toDouble(),
      originalCurrency: json['originalCurrency']?.toString(),
      disclaimer: json['disclaimer']?.toString(),
      requiresPhysicalVerification:
          json['requiresPhysicalVerification'] as bool? ?? false,
    );
  }

  final String orderId;
  final String? orderUuid;
  final double? originalPrice;
  final String? originalCurrency;
  final String? disclaimer;
  final bool requiresPhysicalVerification;
}
