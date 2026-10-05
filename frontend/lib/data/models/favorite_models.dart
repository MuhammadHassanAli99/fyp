class FavoriteItem {
  const FavoriteItem({
    required this.id,
    required this.marketplaceCode,
    required this.entityType,
    required this.entityId,
    required this.title,
    required this.availability,
    this.listingId,
    this.listingUuid,
    this.collectionId,
    this.note,
    this.imageUrl,
    this.price,
    this.currency,
    this.priceAtSave,
    this.status,
    this.categoryName,
    this.createdAt,
  });

  factory FavoriteItem.fromJson(Map<String, dynamic> json) => FavoriteItem(
        id: (json['id'] as num?)?.toInt() ?? 0,
        listingId: (json['listingId'] as num?)?.toInt(),
        listingUuid: json['listingUuid']?.toString(),
        marketplaceCode: (json['marketplaceCode'] ?? '').toString(),
        entityType: (json['entityType'] ?? 'listing').toString(),
        entityId: (json['entityId'] as num?)?.toInt() ?? 0,
        collectionId: (json['collectionId'] as num?)?.toInt(),
        note: json['note']?.toString(),
        title: (json['title'] ?? 'Saved item').toString(),
        imageUrl: json['imageUrl']?.toString(),
        price: (json['price'] as num?)?.toDouble(),
        currency: json['currency']?.toString(),
        priceAtSave: (json['priceAtSave'] as num?)?.toDouble(),
        status: json['status']?.toString(),
        availability: (json['availability'] ?? 'available').toString(),
        categoryName: json['categoryName']?.toString(),
        createdAt: json['createdAt']?.toString(),
      );

  final int id;
  final int? listingId;
  final String? listingUuid;
  final String marketplaceCode;
  final String entityType;
  final int entityId;
  final int? collectionId;
  final String? note;
  final String title;
  final String? imageUrl;
  final double? price;
  final String? currency;
  final double? priceAtSave;
  final String? status;
  final String availability;
  final String? categoryName;
  final String? createdAt;

  bool get isAvailable => availability == 'available';
  String get routeId => listingUuid ?? listingId?.toString() ?? '';

  FavoriteItem copyWith({int? collectionId, String? note}) => FavoriteItem(
        id: id,
        listingId: listingId,
        listingUuid: listingUuid,
        marketplaceCode: marketplaceCode,
        entityType: entityType,
        entityId: entityId,
        collectionId: collectionId ?? this.collectionId,
        note: note ?? this.note,
        title: title,
        imageUrl: imageUrl,
        price: price,
        currency: currency,
        priceAtSave: priceAtSave,
        status: status,
        availability: availability,
        categoryName: categoryName,
        createdAt: createdAt,
      );
}

class FavoritePage {
  const FavoritePage({
    required this.items,
    required this.page,
    required this.perPage,
    required this.total,
    required this.hasMore,
  });

  final List<FavoriteItem> items;
  final int page;
  final int perPage;
  final int total;
  final bool hasMore;
}

class FavoriteCollection {
  const FavoriteCollection({
    required this.id,
    required this.name,
    required this.visibility,
    required this.itemCount,
    required this.sortOrder,
    required this.isDefault,
    this.parentId,
    this.marketplaceCode,
    this.description,
    this.icon,
    this.color,
    this.shareToken,
    this.depth = 1,
  });

  factory FavoriteCollection.fromJson(Map<String, dynamic> json) =>
      FavoriteCollection(
        id: (json['id'] as num?)?.toInt() ?? 0,
        parentId: (json['parentId'] as num?)?.toInt(),
        marketplaceCode: json['marketplaceCode']?.toString(),
        name: (json['name'] ?? '').toString(),
        description: json['description']?.toString(),
        icon: json['icon']?.toString(),
        color: json['color']?.toString(),
        isDefault: json['isDefault'] as bool? ?? false,
        visibility: (json['visibility'] ?? 'private').toString(),
        shareToken: json['shareToken']?.toString(),
        itemCount: (json['itemCount'] as num?)?.toInt() ?? 0,
        sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
        depth: (json['depth'] as num?)?.toInt() ?? 1,
      );

  final int id;
  final int? parentId;
  final String? marketplaceCode;
  final String name;
  final String? description;
  final String? icon;
  final String? color;
  final bool isDefault;
  final String visibility;
  final String? shareToken;
  final int itemCount;
  final int sortOrder;
  final int depth;

  bool get isPrivate => visibility == 'private';
}

class FavoriteStatus {
  const FavoriteStatus({required this.saved, this.favoriteId});

  factory FavoriteStatus.fromJson(Map<String, dynamic> json) => FavoriteStatus(
        saved: json['saved'] as bool? ?? false,
        favoriteId: (json['favoriteId'] as num?)?.toInt(),
      );

  final bool saved;
  final int? favoriteId;
}

class ShareLink {
  const ShareLink({required this.token, required this.url, this.visibility});

  factory ShareLink.fromJson(Map<String, dynamic> json) => ShareLink(
        token: (json['token'] ?? '').toString(),
        url: (json['url'] ?? '').toString(),
        visibility: json['visibility']?.toString(),
      );

  final String token;
  final String url;
  final String? visibility;
}

class PendingFavoriteAction {
  const PendingFavoriteAction({
    required this.entityType,
    required this.entityId,
    this.listingId,
    this.marketplaceCode,
    this.route,
  });

  factory PendingFavoriteAction.fromJson(Map<String, dynamic> json) =>
      PendingFavoriteAction(
        listingId: (json['listingId'] as num?)?.toInt(),
        entityType: (json['entityType'] ?? 'listing').toString(),
        entityId: (json['entityId'] as num?)?.toInt() ?? 0,
        marketplaceCode: json['marketplaceCode']?.toString(),
        route: json['route']?.toString(),
      );

  final int? listingId;
  final String entityType;
  final int entityId;
  final String? marketplaceCode;
  final String? route;

  Map<String, dynamic> toJson() => {
        'listingId': listingId,
        'entityType': entityType,
        'entityId': entityId,
        'marketplaceCode': marketplaceCode,
        'route': route,
      };
}
