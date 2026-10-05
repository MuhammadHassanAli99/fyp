import 'gold_models.dart';

List<ListingMediaItem> _parseMediaItems(Map<String, dynamic> json) {
  final media = json['media'];
  if (media is! List) return const [];
  final items = <ListingMediaItem>[];
  for (final item in media) {
    if (item is! Map) continue;
    final map = Map<String, dynamic>.from(item);
    final id = (map['id'] as num?)?.toInt();
    final url = (map['url'] ?? map['thumbUrl'])?.toString();
    if (id == null || url == null || url.isEmpty) continue;
    items.add(
      ListingMediaItem(
        id: id,
        url: url,
        kind: (map['kind'] ?? 'image').toString(),
        isAiEnhanced: map['isAiEnhanced'] == true,
      ),
    );
  }
  return items;
}

class ListingMediaItem {
  const ListingMediaItem({
    required this.id,
    required this.url,
    this.kind = 'image',
    this.isAiEnhanced = false,
  });

  final int id;
  final String url;
  final String kind;
  final bool isAiEnhanced;

  bool get isVideo {
    if (kind == 'video') return true;
    final lower = url.toLowerCase();
    return lower.contains('.m3u8') || lower.endsWith('.mp4') || lower.endsWith('.webm');
  }
}

List<String> _parseMediaUrls(Map<String, dynamic> json) {
  final media = json['media'];
  if (media is! List) return const [];
  final urls = <String>[];
  for (final item in media) {
    if (item is! Map) continue;
    final map = Map<String, dynamic>.from(item);
    final url = (map['url'] ?? map['thumbUrl'])?.toString();
    if (url != null && url.isNotEmpty) urls.add(url);
  }
  return urls;
}

String? _cardImageUrl(Map<String, dynamic> json) {
  for (final key in ['thumbnailUrl', 'cardUrl', 'primaryImage', 'imageUrl', 'thumbUrl']) {
    final value = json[key]?.toString();
    if (value != null && value.isNotEmpty) return value;
  }
  final media = json['media'];
  if (media is List && media.isNotEmpty && media.first is Map) {
    final first = Map<String, dynamic>.from(media.first as Map);
    for (final key in ['thumbUrl', 'cardUrl', 'url']) {
      final value = first[key]?.toString();
      if (value != null && value.isNotEmpty) return value;
    }
  }
  return null;
}

class ListingSeller {
  const ListingSeller({
    required this.id,
    this.displayName,
    this.avatarUrl,
    this.isBusiness = false,
    this.businessName,
    this.isVerified = false,
    this.rating,
    this.reviewCount,
    this.trustBand,
  });

  factory ListingSeller.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const ListingSeller(id: '');
    return ListingSeller(
      id: (json['id'] ?? '').toString(),
      displayName: json['displayName'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      isBusiness: json['isBusiness'] as bool? ?? false,
      businessName: json['businessName'] as String?,
      isVerified: json['isVerified'] as bool? ?? false,
      rating: (json['rating'] as num?)?.toDouble(),
      reviewCount: (json['reviewCount'] as num?)?.toInt(),
      trustBand: json['trustBand'] as String?,
    );
  }

  final String id;
  final String? displayName;
  final String? avatarUrl;
  final bool isBusiness;
  final String? businessName;
  final bool isVerified;
  final double? rating;
  final int? reviewCount;
  final String? trustBand;
}

class ListingModel {
  const ListingModel({
    required this.id,
    required this.title,
    required this.marketplace,
    required this.price,
    required this.currency,
    this.uuid,
    this.location,
    this.imageUrl,
    this.mediaUrls = const [],
    this.description,
    this.operation,
    this.countryId,
    this.cityId,
    this.categoryName,
    this.conditionCode,
    this.priceType,
    this.pricePeriod,
    this.priceNegotiable = false,
    this.mediaCount = 0,
    this.hasVideo = false,
    this.viewCount = 0,
    this.favoriteCount = 0,
    this.isFeatured = false,
    this.isBoosted = false,
    this.isUrgent = false,
    this.isVerified = false,
    this.isFavorited = false,
    this.attributes = const {},
    this.details = const {},
    this.seller,
    this.createdAt,
    this.status,
    this.lifecycleStatus,
    this.transactionStatus,
    this.moderationStatus,
    this.expirationStatus,
    this.expiresAt,
    this.completenessScore,
    this.canEdit = false,
    this.auction,
    this.placement,
    this.distanceKm,
    this.matchReasons = const [],
    this.allowChat = true,
    this.allowCalls = true,
    this.mediaItems = const [],
  });

  factory ListingModel.fromJson(Map<String, dynamic> json) {
    final city = json['cityName'] as String?;
    final area = json['areaName'] as String?;
    final location = json['location'] as String? ??
        (city != null || area != null
            ? [city, area].whereType<String>().where((s) => s.isNotEmpty).join(', ')
            : null);

    final detailsRaw = json['details'];
    final details = detailsRaw is Map
        ? Map<String, dynamic>.from(detailsRaw)
        : <String, dynamic>{};

    final attrsRaw = json['attributes'];
    Map<String, dynamic> attributes = {};
    if (attrsRaw is Map) {
      attributes = Map<String, dynamic>.from(attrsRaw);
    } else if (attrsRaw is List) {
      for (final item in attrsRaw) {
        if (item is Map && item['code'] != null) {
          attributes[item['code'].toString()] = item['value'];
        }
      }
    }

    return ListingModel(
      id: (json['id'] ?? json['uuid'] ?? '').toString(),
      uuid: json['uuid']?.toString(),
      title: json['title'] as String? ?? '',
      marketplace: json['marketplace'] as String? ??
          json['marketplaceCode'] as String? ??
          '',
      price: (json['price'] as num?)?.toDouble() ?? 0,
      currency: json['currency'] as String? ?? 'USD',
      location: location?.isEmpty == true ? null : location,
      imageUrl: _cardImageUrl(json),
      mediaUrls: _parseMediaUrls(json),
      mediaItems: _parseMediaItems(json),
      description: json['description'] as String?,
      operation: json['operation'] as String?,
      countryId: (json['countryId'] as num?)?.toInt(),
      cityId: (json['cityId'] as num?)?.toInt(),
      categoryName: json['categoryName'] as String?,
      conditionCode: json['conditionCode'] as String?,
      priceType: json['priceType'] as String?,
      pricePeriod: json['pricePeriod'] as String?,
      priceNegotiable: json['priceNegotiable'] as bool? ?? false,
      mediaCount: (json['mediaCount'] as num?)?.toInt() ?? 0,
      hasVideo: json['hasVideo'] as bool? ?? false,
      viewCount: (json['viewCount'] as num?)?.toInt() ?? 0,
      favoriteCount: (json['favoriteCount'] as num?)?.toInt() ?? 0,
      isFeatured: json['isFeatured'] as bool? ?? false,
      isBoosted: json['isBoosted'] as bool? ?? false,
      isUrgent: json['isUrgent'] as bool? ?? false,
      isVerified: json['isVerified'] as bool? ?? false,
      isFavorited: json['isFavorited'] as bool? ?? false,
      attributes: attributes,
      details: details,
      seller: ListingSeller.fromJson(
        json['seller'] is Map
            ? Map<String, dynamic>.from(json['seller'] as Map)
            : null,
      ),
      createdAt: json['createdAt'] != null
          ? DateTime.tryParse(json['createdAt'] as String)
          : null,
      status: json['status'] as String?,
      lifecycleStatus: json['lifecycleStatus'] as String?,
      transactionStatus: json['transactionStatus'] as String?,
      moderationStatus: json['moderationStatus'] as String?,
      expirationStatus: json['expirationStatus'] as String?,
      expiresAt: json['expiresAt'] != null
          ? DateTime.tryParse(json['expiresAt'] as String)
          : null,
      completenessScore: (json['completenessScore'] as num?)?.toInt(),
      canEdit: json['canEdit'] as bool? ?? false,
      auction: json['auction'] is Map
          ? ListingAuction.fromJson(
              Map<String, dynamic>.from(json['auction'] as Map),
            )
          : null,
      placement: json['placement'] as String?,
      distanceKm: (json['distanceKm'] as num?)?.toDouble(),
      matchReasons: (json['matchReasons'] as List?)
              ?.map((e) => e.toString())
              .toList() ??
          const [],
      allowChat: json['allowChat'] as bool? ?? true,
      allowCalls: json['allowCalls'] as bool? ?? true,
    );
  }

  final String id;
  final String? uuid;
  final String title;
  final String marketplace;
  final double price;
  final String currency;
  final String? location;
  final String? imageUrl;
  final List<String> mediaUrls;
  final List<ListingMediaItem> mediaItems;
  final String? description;
  final String? operation;
  final int? countryId;
  final int? cityId;
  final String? categoryName;
  final String? conditionCode;
  final String? priceType;
  final String? pricePeriod;
  final bool priceNegotiable;
  final int mediaCount;
  final bool hasVideo;
  final int viewCount;
  final int favoriteCount;
  final bool isFeatured;
  final bool isBoosted;
  final bool isUrgent;
  final bool isVerified;
  final bool isFavorited;
  final Map<String, dynamic> attributes;
  final Map<String, dynamic> details;
  final ListingSeller? seller;
  final DateTime? createdAt;
  final String? status;
  final String? lifecycleStatus;
  final String? transactionStatus;
  final String? moderationStatus;
  final String? expirationStatus;
  final DateTime? expiresAt;
  final int? completenessScore;
  final bool canEdit;
  final ListingAuction? auction;
  final String? placement;
  final double? distanceKm;
  final List<String> matchReasons;
  final bool allowChat;
  final bool allowCalls;

  bool get isSponsored => placement == 'sponsored';

  String get routeId => uuid ?? id;
  int? get numericId => int.tryParse(id);
  int? get firstMediaId => mediaItems.isEmpty ? null : mediaItems.first.id;
  bool get isProperty => marketplace == 'property';
  bool get isVehicle => marketplace == 'vehicles';
  bool get isGold => marketplace == 'gold';

  String get effectiveLifecycle => lifecycleStatus ?? status ?? '';

  bool matchesStatusFilter(String filter) {
    if (filter == 'sold') {
      return transactionStatus == 'sold' || status == 'sold';
    }
    if (filter == 'rented') {
      return transactionStatus == 'rented' || status == 'rented';
    }
    if (filter == 'published') {
      return effectiveLifecycle == 'published' && transactionStatus != 'sold';
    }
    return effectiveLifecycle == filter || status == filter;
  }

  List<String> get galleryUrls {
    if (mediaUrls.isNotEmpty) return mediaUrls;
    if (imageUrl != null && imageUrl!.isNotEmpty) return [imageUrl!];
    return const [];
  }

  T? detail<T>(String key) {
    final value = details[key];
    if (value is T) return value;
    if (T == int && value is num) return value.toInt() as T;
    if (T == double && value is num) return value.toDouble() as T;
    if (T == String && value != null) return value.toString() as T;
    if (T == bool && value is num) return (value != 0) as T;
    return null;
  }

  // ── Gold ─────────────────────────────────────────────────────────────────
  double? get karat => detail<double>('karat');
  int? get fineness => detail<int>('fineness');
  double? get netWeightG => detail<double>('netWeightG');
  double? get grossWeightG => detail<double>('grossWeightG');
  double? get stoneWeightG => detail<double>('stoneWeightG');
  double? get fineGoldWeightG => detail<double>('fineGoldWeightG');
  String? get weightUnit => detail<String>('weightUnit');
  String? get form => detail<String>('form');
  String? get jewelleryType => detail<String>('jewelleryType');
  String? get metalType => detail<String>('metalType');
  String? get brandName => detail<String>('brandName');
  String? get serialNumber => detail<String>('serialNumber');
  String? get packaging => detail<String>('packaging');
  String? get hallmarkCode => detail<String>('hallmarkCode');
  String? get certificateNumber => detail<String>('certificateNumber');
  String? get makingChargeType => detail<String>('makingChargeType');
  String? get authenticityRisk => detail<String>('authenticityRisk');
  double? get authenticityConfidence => detail<double>('authenticityConfidence');
  String? get authenticityDisclaimer => detail<String>('authenticityDisclaimer');
  bool get isHallmarked => detail<bool>('isHallmarked') ?? false;
  bool get hasCertificate => detail<bool>('hasCertificate') ?? false;
  bool get isInvestmentGrade => detail<bool>('isInvestmentGrade') ?? false;
  bool get buybackAvailable => detail<bool>('buybackAvailable') ?? false;
  double? get makingCharges => detail<double>('makingCharges');
  String get weightLabel {
    final net = netWeightG;
    if (net == null) return '';
    final unit = weightUnit ?? 'gram';
    final shown = net == net.roundToDouble() ? net.toInt().toString() : net.toStringAsFixed(2);
    return '$shown $unit';
  }

  // ── Property (Zameen-style) ──────────────────────────────────────────────
  int? get bedrooms => detail<int>('bedrooms');
  int? get bathrooms => detail<int>('bathrooms');
  double? get areaValue => detail<double>('areaValue') ?? detail<double>('areaSqm');
  String? get areaUnit => detail<String>('areaUnit') ?? 'sqm';
  String? get propertyKind => detail<String>('propertyKind');
  String? get furnishing => detail<String>('furnishing');
  String? get societyName => detail<String>('societyName');
  int? get parkingSpaces => detail<int>('parkingSpaces');
  double? get pricePerSqm => detail<double>('pricePerSqm');
  String get areaLabel {
    final v = areaValue;
    if (v == null) return '';
    final unit = areaUnit ?? 'sqm';
    final shown = v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);
    return '$shown $unit';
  }

  // ── Vehicles (PakWheels-style) ───────────────────────────────────────────
  int? get makeId => detail<int>('makeId');
  int? get modelId => detail<int>('modelId');
  String? get makeName => detail<String>('makeName');
  String? get modelName => detail<String>('modelName');
  String? get variantName => detail<String>('variantName');
  int? get year => detail<int>('year');
  int? get mileageKm => detail<int>('mileageKm') ?? detail<int>('mileage');
  String? get fuelType => detail<String>('fuelType');
  String? get transmission => detail<String>('transmission');
  String? get bodyType => detail<String>('bodyType');
  String? get colorExterior => detail<String>('colorExterior');
  int? get engineCc => detail<int>('engineCc');
  String? get dealRating => detail<String>('dealRating');
  bool get isInspected => detail<bool>('isInspected') ?? false;
  num? get inspectionScore {
    final value = details['inspectionScore'];
    if (value is num) return value;
    return null;
  }
  bool get financeAvailable => detail<bool>('financeAvailable') ?? false;

  bool get hasSwimmingPool => detail<bool>('hasSwimmingPool') ?? false;
  bool get hasGym => detail<bool>('hasGym') ?? false;
  bool get hasGarden => detail<bool>('hasGarden') ?? false;
  bool get hasElevator => detail<bool>('hasElevator') ?? false;
  bool get hasSecurity => detail<bool>('hasSecurity') ?? false;
  bool get isGatedCommunity => detail<bool>('isGatedCommunity') ?? false;
  String get vehicleTitleLine {
    final parts = [year?.toString(), makeName, modelName, variantName]
        .whereType<String>()
        .where((s) => s.isNotEmpty);
    return parts.isEmpty ? title : parts.join(' ');
  }

  String get mileageLabel {
    final km = mileageKm;
    if (km == null) return '';
    if (km >= 1000) {
      final k = km / 1000;
      return '${k == k.roundToDouble() ? k.toInt() : k.toStringAsFixed(1)}k km';
    }
    return '$km km';
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'uuid': uuid,
        'title': title,
        'marketplace': marketplace,
        'price': price,
        'currency': currency,
        'location': location,
        'imageUrl': imageUrl,
        'description': description,
        'operation': operation,
        'categoryName': categoryName,
        'details': details,
        'attributes': attributes,
        'createdAt': createdAt?.toIso8601String(),
        'status': status,
        'lifecycleStatus': lifecycleStatus,
        'transactionStatus': transactionStatus,
      };
}

class ListingsPage {
  const ListingsPage({
    required this.items,
    this.page = 1,
    this.total = 0,
    this.hasMore = false,
    this.nextCursor,
  });

  factory ListingsPage.fromJson(dynamic json) {
    if (json is List) {
      return ListingsPage(
        items: json
            .map((e) => ListingModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
    }

    final map = json as Map<String, dynamic>;
    final items = (map['items'] as List? ?? map['listings'] as List? ?? [])
        .map((e) => ListingModel.fromJson(e as Map<String, dynamic>))
        .toList();
    final meta = map['meta'] as Map<String, dynamic>?;
    return ListingsPage(
      items: items,
      page: (meta?['page'] as num?)?.toInt() ?? 1,
      total: (meta?['total'] as num?)?.toInt() ?? items.length,
      hasMore: meta?['hasMore'] as bool? ?? false,
      nextCursor: meta?['nextCursor']?.toString(),
    );
  }

  final List<ListingModel> items;
  final int page;
  final int total;
  final bool hasMore;
  final String? nextCursor;
}

/// Backend `parseSort` grammar. Marketplace extras use their module codes.
class ListingSortOption {
  const ListingSortOption(this.apiValue, this.label);
  final String apiValue;
  final String label;
}

abstract final class ListingSorts {
  static const newest = ListingSortOption('newest', 'Newest');
  static const priceAsc = ListingSortOption('price', 'Price: Low to High');
  static const priceDesc = ListingSortOption('-price', 'Price: High to Low');
  static const relevance = ListingSortOption('relevance', 'Relevance');
  static const popular = ListingSortOption('popular', 'Most viewed');
  static const featured = ListingSortOption('featured', 'Featured first');

  static const propertyAreaDesc = ListingSortOption('area_desc', 'Largest area');
  static const propertyAreaAsc = ListingSortOption('area_asc', 'Smallest area');
  static const propertyPricePerArea =
      ListingSortOption('price_per_area_asc', 'Price per area');
  static const propertyBedrooms =
      ListingSortOption('bedrooms_desc', 'Most bedrooms');
  static const propertyTrust = ListingSortOption('trust', 'Most trusted');
  static const propertyDistance = ListingSortOption('distance', 'Distance');

  static const vehicleMileageAsc =
      ListingSortOption('mileage_asc', 'Lowest mileage');
  static const vehicleYearDesc = ListingSortOption('year_desc', 'Newest model year');
  static const vehicleBestDeal = ListingSortOption('best_deal', 'Best deal');
  static const vehicleInspection =
      ListingSortOption('inspection_desc', 'Highest inspection score');

  static const goldWeightDesc =
      ListingSortOption('weight_desc', 'Heaviest first');
  static const goldWeightAsc =
      ListingSortOption('weight_asc', 'Lightest first');
  static const goldKaratDesc =
      ListingSortOption('karat_desc', 'Highest karat');
  static const goldPricePerGram =
      ListingSortOption('price_per_gram_asc', 'Price per gram');
  static const goldBestDeal = ListingSortOption('best_deal', 'Best value');
  static const goldEndingSoon =
      ListingSortOption('ending_soon', 'Auction ending soon');
  static const goldTrust = ListingSortOption('trust', 'Highest trust');

  static List<ListingSortOption> forMarketplace(String? code) {
    final common = [newest, priceAsc, priceDesc, popular, featured, relevance];
    return switch (code) {
      'property' => [
          ...common,
          propertyAreaDesc,
          propertyAreaAsc,
          propertyPricePerArea,
          propertyBedrooms,
          propertyTrust,
          propertyDistance,
        ],
      'vehicles' => [
          ...common,
          vehicleYearDesc,
          vehicleMileageAsc,
          vehicleBestDeal,
          vehicleInspection,
        ],
      'gold' => [
          ...common,
          goldWeightDesc,
          goldWeightAsc,
          goldKaratDesc,
          goldPricePerGram,
          goldBestDeal,
          goldEndingSoon,
          goldTrust,
        ],
      _ => common,
    };
  }
}

/// Back-compat enum used by older call sites.
enum ListingSort {
  newest('newest'),
  priceAsc('price'),
  priceDesc('-price'),
  relevance('relevance');

  const ListingSort(this.apiValue);
  final String apiValue;
}
