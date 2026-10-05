// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $CachedListingsTable extends CachedListings
    with TableInfo<$CachedListingsTable, CachedListing> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CachedListingsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _marketplaceMeta = const VerificationMeta(
    'marketplace',
  );
  @override
  late final GeneratedColumn<String> marketplace = GeneratedColumn<String>(
    'marketplace',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _titleMeta = const VerificationMeta('title');
  @override
  late final GeneratedColumn<String> title = GeneratedColumn<String>(
    'title',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _priceMeta = const VerificationMeta('price');
  @override
  late final GeneratedColumn<double> price = GeneratedColumn<double>(
    'price',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _currencyMeta = const VerificationMeta(
    'currency',
  );
  @override
  late final GeneratedColumn<String> currency = GeneratedColumn<String>(
    'currency',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _locationMeta = const VerificationMeta(
    'location',
  );
  @override
  late final GeneratedColumn<String> location = GeneratedColumn<String>(
    'location',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _imageUrlMeta = const VerificationMeta(
    'imageUrl',
  );
  @override
  late final GeneratedColumn<String> imageUrl = GeneratedColumn<String>(
    'image_url',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _payloadJsonMeta = const VerificationMeta(
    'payloadJson',
  );
  @override
  late final GeneratedColumn<String> payloadJson = GeneratedColumn<String>(
    'payload_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _cachedAtMeta = const VerificationMeta(
    'cachedAt',
  );
  @override
  late final GeneratedColumn<DateTime> cachedAt = GeneratedColumn<DateTime>(
    'cached_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sortKeyMeta = const VerificationMeta(
    'sortKey',
  );
  @override
  late final GeneratedColumn<String> sortKey = GeneratedColumn<String>(
    'sort_key',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    marketplace,
    title,
    price,
    currency,
    location,
    imageUrl,
    payloadJson,
    cachedAt,
    sortKey,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'cached_listings';
  @override
  VerificationContext validateIntegrity(
    Insertable<CachedListing> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('marketplace')) {
      context.handle(
        _marketplaceMeta,
        marketplace.isAcceptableOrUnknown(
          data['marketplace']!,
          _marketplaceMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_marketplaceMeta);
    }
    if (data.containsKey('title')) {
      context.handle(
        _titleMeta,
        title.isAcceptableOrUnknown(data['title']!, _titleMeta),
      );
    } else if (isInserting) {
      context.missing(_titleMeta);
    }
    if (data.containsKey('price')) {
      context.handle(
        _priceMeta,
        price.isAcceptableOrUnknown(data['price']!, _priceMeta),
      );
    } else if (isInserting) {
      context.missing(_priceMeta);
    }
    if (data.containsKey('currency')) {
      context.handle(
        _currencyMeta,
        currency.isAcceptableOrUnknown(data['currency']!, _currencyMeta),
      );
    } else if (isInserting) {
      context.missing(_currencyMeta);
    }
    if (data.containsKey('location')) {
      context.handle(
        _locationMeta,
        location.isAcceptableOrUnknown(data['location']!, _locationMeta),
      );
    }
    if (data.containsKey('image_url')) {
      context.handle(
        _imageUrlMeta,
        imageUrl.isAcceptableOrUnknown(data['image_url']!, _imageUrlMeta),
      );
    }
    if (data.containsKey('payload_json')) {
      context.handle(
        _payloadJsonMeta,
        payloadJson.isAcceptableOrUnknown(
          data['payload_json']!,
          _payloadJsonMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_payloadJsonMeta);
    }
    if (data.containsKey('cached_at')) {
      context.handle(
        _cachedAtMeta,
        cachedAt.isAcceptableOrUnknown(data['cached_at']!, _cachedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_cachedAtMeta);
    }
    if (data.containsKey('sort_key')) {
      context.handle(
        _sortKeyMeta,
        sortKey.isAcceptableOrUnknown(data['sort_key']!, _sortKeyMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CachedListing map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CachedListing(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      marketplace: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}marketplace'],
      )!,
      title: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}title'],
      )!,
      price: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}price'],
      )!,
      currency: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}currency'],
      )!,
      location: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}location'],
      ),
      imageUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}image_url'],
      ),
      payloadJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload_json'],
      )!,
      cachedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}cached_at'],
      )!,
      sortKey: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}sort_key'],
      ),
    );
  }

  @override
  $CachedListingsTable createAlias(String alias) {
    return $CachedListingsTable(attachedDatabase, alias);
  }
}

class CachedListing extends DataClass implements Insertable<CachedListing> {
  final String id;
  final String marketplace;
  final String title;
  final double price;
  final String currency;
  final String? location;
  final String? imageUrl;
  final String payloadJson;
  final DateTime cachedAt;
  final String? sortKey;
  const CachedListing({
    required this.id,
    required this.marketplace,
    required this.title,
    required this.price,
    required this.currency,
    this.location,
    this.imageUrl,
    required this.payloadJson,
    required this.cachedAt,
    this.sortKey,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['marketplace'] = Variable<String>(marketplace);
    map['title'] = Variable<String>(title);
    map['price'] = Variable<double>(price);
    map['currency'] = Variable<String>(currency);
    if (!nullToAbsent || location != null) {
      map['location'] = Variable<String>(location);
    }
    if (!nullToAbsent || imageUrl != null) {
      map['image_url'] = Variable<String>(imageUrl);
    }
    map['payload_json'] = Variable<String>(payloadJson);
    map['cached_at'] = Variable<DateTime>(cachedAt);
    if (!nullToAbsent || sortKey != null) {
      map['sort_key'] = Variable<String>(sortKey);
    }
    return map;
  }

  CachedListingsCompanion toCompanion(bool nullToAbsent) {
    return CachedListingsCompanion(
      id: Value(id),
      marketplace: Value(marketplace),
      title: Value(title),
      price: Value(price),
      currency: Value(currency),
      location: location == null && nullToAbsent
          ? const Value.absent()
          : Value(location),
      imageUrl: imageUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(imageUrl),
      payloadJson: Value(payloadJson),
      cachedAt: Value(cachedAt),
      sortKey: sortKey == null && nullToAbsent
          ? const Value.absent()
          : Value(sortKey),
    );
  }

  factory CachedListing.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CachedListing(
      id: serializer.fromJson<String>(json['id']),
      marketplace: serializer.fromJson<String>(json['marketplace']),
      title: serializer.fromJson<String>(json['title']),
      price: serializer.fromJson<double>(json['price']),
      currency: serializer.fromJson<String>(json['currency']),
      location: serializer.fromJson<String?>(json['location']),
      imageUrl: serializer.fromJson<String?>(json['imageUrl']),
      payloadJson: serializer.fromJson<String>(json['payloadJson']),
      cachedAt: serializer.fromJson<DateTime>(json['cachedAt']),
      sortKey: serializer.fromJson<String?>(json['sortKey']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'marketplace': serializer.toJson<String>(marketplace),
      'title': serializer.toJson<String>(title),
      'price': serializer.toJson<double>(price),
      'currency': serializer.toJson<String>(currency),
      'location': serializer.toJson<String?>(location),
      'imageUrl': serializer.toJson<String?>(imageUrl),
      'payloadJson': serializer.toJson<String>(payloadJson),
      'cachedAt': serializer.toJson<DateTime>(cachedAt),
      'sortKey': serializer.toJson<String?>(sortKey),
    };
  }

  CachedListing copyWith({
    String? id,
    String? marketplace,
    String? title,
    double? price,
    String? currency,
    Value<String?> location = const Value.absent(),
    Value<String?> imageUrl = const Value.absent(),
    String? payloadJson,
    DateTime? cachedAt,
    Value<String?> sortKey = const Value.absent(),
  }) => CachedListing(
    id: id ?? this.id,
    marketplace: marketplace ?? this.marketplace,
    title: title ?? this.title,
    price: price ?? this.price,
    currency: currency ?? this.currency,
    location: location.present ? location.value : this.location,
    imageUrl: imageUrl.present ? imageUrl.value : this.imageUrl,
    payloadJson: payloadJson ?? this.payloadJson,
    cachedAt: cachedAt ?? this.cachedAt,
    sortKey: sortKey.present ? sortKey.value : this.sortKey,
  );
  CachedListing copyWithCompanion(CachedListingsCompanion data) {
    return CachedListing(
      id: data.id.present ? data.id.value : this.id,
      marketplace: data.marketplace.present
          ? data.marketplace.value
          : this.marketplace,
      title: data.title.present ? data.title.value : this.title,
      price: data.price.present ? data.price.value : this.price,
      currency: data.currency.present ? data.currency.value : this.currency,
      location: data.location.present ? data.location.value : this.location,
      imageUrl: data.imageUrl.present ? data.imageUrl.value : this.imageUrl,
      payloadJson: data.payloadJson.present
          ? data.payloadJson.value
          : this.payloadJson,
      cachedAt: data.cachedAt.present ? data.cachedAt.value : this.cachedAt,
      sortKey: data.sortKey.present ? data.sortKey.value : this.sortKey,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CachedListing(')
          ..write('id: $id, ')
          ..write('marketplace: $marketplace, ')
          ..write('title: $title, ')
          ..write('price: $price, ')
          ..write('currency: $currency, ')
          ..write('location: $location, ')
          ..write('imageUrl: $imageUrl, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('cachedAt: $cachedAt, ')
          ..write('sortKey: $sortKey')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    marketplace,
    title,
    price,
    currency,
    location,
    imageUrl,
    payloadJson,
    cachedAt,
    sortKey,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CachedListing &&
          other.id == this.id &&
          other.marketplace == this.marketplace &&
          other.title == this.title &&
          other.price == this.price &&
          other.currency == this.currency &&
          other.location == this.location &&
          other.imageUrl == this.imageUrl &&
          other.payloadJson == this.payloadJson &&
          other.cachedAt == this.cachedAt &&
          other.sortKey == this.sortKey);
}

class CachedListingsCompanion extends UpdateCompanion<CachedListing> {
  final Value<String> id;
  final Value<String> marketplace;
  final Value<String> title;
  final Value<double> price;
  final Value<String> currency;
  final Value<String?> location;
  final Value<String?> imageUrl;
  final Value<String> payloadJson;
  final Value<DateTime> cachedAt;
  final Value<String?> sortKey;
  final Value<int> rowid;
  const CachedListingsCompanion({
    this.id = const Value.absent(),
    this.marketplace = const Value.absent(),
    this.title = const Value.absent(),
    this.price = const Value.absent(),
    this.currency = const Value.absent(),
    this.location = const Value.absent(),
    this.imageUrl = const Value.absent(),
    this.payloadJson = const Value.absent(),
    this.cachedAt = const Value.absent(),
    this.sortKey = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CachedListingsCompanion.insert({
    required String id,
    required String marketplace,
    required String title,
    required double price,
    required String currency,
    this.location = const Value.absent(),
    this.imageUrl = const Value.absent(),
    required String payloadJson,
    required DateTime cachedAt,
    this.sortKey = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       marketplace = Value(marketplace),
       title = Value(title),
       price = Value(price),
       currency = Value(currency),
       payloadJson = Value(payloadJson),
       cachedAt = Value(cachedAt);
  static Insertable<CachedListing> custom({
    Expression<String>? id,
    Expression<String>? marketplace,
    Expression<String>? title,
    Expression<double>? price,
    Expression<String>? currency,
    Expression<String>? location,
    Expression<String>? imageUrl,
    Expression<String>? payloadJson,
    Expression<DateTime>? cachedAt,
    Expression<String>? sortKey,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (marketplace != null) 'marketplace': marketplace,
      if (title != null) 'title': title,
      if (price != null) 'price': price,
      if (currency != null) 'currency': currency,
      if (location != null) 'location': location,
      if (imageUrl != null) 'image_url': imageUrl,
      if (payloadJson != null) 'payload_json': payloadJson,
      if (cachedAt != null) 'cached_at': cachedAt,
      if (sortKey != null) 'sort_key': sortKey,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CachedListingsCompanion copyWith({
    Value<String>? id,
    Value<String>? marketplace,
    Value<String>? title,
    Value<double>? price,
    Value<String>? currency,
    Value<String?>? location,
    Value<String?>? imageUrl,
    Value<String>? payloadJson,
    Value<DateTime>? cachedAt,
    Value<String?>? sortKey,
    Value<int>? rowid,
  }) {
    return CachedListingsCompanion(
      id: id ?? this.id,
      marketplace: marketplace ?? this.marketplace,
      title: title ?? this.title,
      price: price ?? this.price,
      currency: currency ?? this.currency,
      location: location ?? this.location,
      imageUrl: imageUrl ?? this.imageUrl,
      payloadJson: payloadJson ?? this.payloadJson,
      cachedAt: cachedAt ?? this.cachedAt,
      sortKey: sortKey ?? this.sortKey,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (marketplace.present) {
      map['marketplace'] = Variable<String>(marketplace.value);
    }
    if (title.present) {
      map['title'] = Variable<String>(title.value);
    }
    if (price.present) {
      map['price'] = Variable<double>(price.value);
    }
    if (currency.present) {
      map['currency'] = Variable<String>(currency.value);
    }
    if (location.present) {
      map['location'] = Variable<String>(location.value);
    }
    if (imageUrl.present) {
      map['image_url'] = Variable<String>(imageUrl.value);
    }
    if (payloadJson.present) {
      map['payload_json'] = Variable<String>(payloadJson.value);
    }
    if (cachedAt.present) {
      map['cached_at'] = Variable<DateTime>(cachedAt.value);
    }
    if (sortKey.present) {
      map['sort_key'] = Variable<String>(sortKey.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CachedListingsCompanion(')
          ..write('id: $id, ')
          ..write('marketplace: $marketplace, ')
          ..write('title: $title, ')
          ..write('price: $price, ')
          ..write('currency: $currency, ')
          ..write('location: $location, ')
          ..write('imageUrl: $imageUrl, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('cachedAt: $cachedAt, ')
          ..write('sortKey: $sortKey, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $DraftListingsTable extends DraftListings
    with TableInfo<$DraftListingsTable, DraftListing> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $DraftListingsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _marketplaceMeta = const VerificationMeta(
    'marketplace',
  );
  @override
  late final GeneratedColumn<String> marketplace = GeneratedColumn<String>(
    'marketplace',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _titleMeta = const VerificationMeta('title');
  @override
  late final GeneratedColumn<String> title = GeneratedColumn<String>(
    'title',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant(''),
  );
  static const VerificationMeta _payloadJsonMeta = const VerificationMeta(
    'payloadJson',
  );
  @override
  late final GeneratedColumn<String> payloadJson = GeneratedColumn<String>(
    'payload_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('{}'),
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    marketplace,
    title,
    payloadJson,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'draft_listings';
  @override
  VerificationContext validateIntegrity(
    Insertable<DraftListing> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('marketplace')) {
      context.handle(
        _marketplaceMeta,
        marketplace.isAcceptableOrUnknown(
          data['marketplace']!,
          _marketplaceMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_marketplaceMeta);
    }
    if (data.containsKey('title')) {
      context.handle(
        _titleMeta,
        title.isAcceptableOrUnknown(data['title']!, _titleMeta),
      );
    }
    if (data.containsKey('payload_json')) {
      context.handle(
        _payloadJsonMeta,
        payloadJson.isAcceptableOrUnknown(
          data['payload_json']!,
          _payloadJsonMeta,
        ),
      );
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  DraftListing map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return DraftListing(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      marketplace: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}marketplace'],
      )!,
      title: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}title'],
      )!,
      payloadJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload_json'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $DraftListingsTable createAlias(String alias) {
    return $DraftListingsTable(attachedDatabase, alias);
  }
}

class DraftListing extends DataClass implements Insertable<DraftListing> {
  final int id;
  final String marketplace;
  final String title;
  final String payloadJson;
  final DateTime updatedAt;
  const DraftListing({
    required this.id,
    required this.marketplace,
    required this.title,
    required this.payloadJson,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['marketplace'] = Variable<String>(marketplace);
    map['title'] = Variable<String>(title);
    map['payload_json'] = Variable<String>(payloadJson);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  DraftListingsCompanion toCompanion(bool nullToAbsent) {
    return DraftListingsCompanion(
      id: Value(id),
      marketplace: Value(marketplace),
      title: Value(title),
      payloadJson: Value(payloadJson),
      updatedAt: Value(updatedAt),
    );
  }

  factory DraftListing.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return DraftListing(
      id: serializer.fromJson<int>(json['id']),
      marketplace: serializer.fromJson<String>(json['marketplace']),
      title: serializer.fromJson<String>(json['title']),
      payloadJson: serializer.fromJson<String>(json['payloadJson']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'marketplace': serializer.toJson<String>(marketplace),
      'title': serializer.toJson<String>(title),
      'payloadJson': serializer.toJson<String>(payloadJson),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  DraftListing copyWith({
    int? id,
    String? marketplace,
    String? title,
    String? payloadJson,
    DateTime? updatedAt,
  }) => DraftListing(
    id: id ?? this.id,
    marketplace: marketplace ?? this.marketplace,
    title: title ?? this.title,
    payloadJson: payloadJson ?? this.payloadJson,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  DraftListing copyWithCompanion(DraftListingsCompanion data) {
    return DraftListing(
      id: data.id.present ? data.id.value : this.id,
      marketplace: data.marketplace.present
          ? data.marketplace.value
          : this.marketplace,
      title: data.title.present ? data.title.value : this.title,
      payloadJson: data.payloadJson.present
          ? data.payloadJson.value
          : this.payloadJson,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('DraftListing(')
          ..write('id: $id, ')
          ..write('marketplace: $marketplace, ')
          ..write('title: $title, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, marketplace, title, payloadJson, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is DraftListing &&
          other.id == this.id &&
          other.marketplace == this.marketplace &&
          other.title == this.title &&
          other.payloadJson == this.payloadJson &&
          other.updatedAt == this.updatedAt);
}

class DraftListingsCompanion extends UpdateCompanion<DraftListing> {
  final Value<int> id;
  final Value<String> marketplace;
  final Value<String> title;
  final Value<String> payloadJson;
  final Value<DateTime> updatedAt;
  const DraftListingsCompanion({
    this.id = const Value.absent(),
    this.marketplace = const Value.absent(),
    this.title = const Value.absent(),
    this.payloadJson = const Value.absent(),
    this.updatedAt = const Value.absent(),
  });
  DraftListingsCompanion.insert({
    this.id = const Value.absent(),
    required String marketplace,
    this.title = const Value.absent(),
    this.payloadJson = const Value.absent(),
    required DateTime updatedAt,
  }) : marketplace = Value(marketplace),
       updatedAt = Value(updatedAt);
  static Insertable<DraftListing> custom({
    Expression<int>? id,
    Expression<String>? marketplace,
    Expression<String>? title,
    Expression<String>? payloadJson,
    Expression<DateTime>? updatedAt,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (marketplace != null) 'marketplace': marketplace,
      if (title != null) 'title': title,
      if (payloadJson != null) 'payload_json': payloadJson,
      if (updatedAt != null) 'updated_at': updatedAt,
    });
  }

  DraftListingsCompanion copyWith({
    Value<int>? id,
    Value<String>? marketplace,
    Value<String>? title,
    Value<String>? payloadJson,
    Value<DateTime>? updatedAt,
  }) {
    return DraftListingsCompanion(
      id: id ?? this.id,
      marketplace: marketplace ?? this.marketplace,
      title: title ?? this.title,
      payloadJson: payloadJson ?? this.payloadJson,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (marketplace.present) {
      map['marketplace'] = Variable<String>(marketplace.value);
    }
    if (title.present) {
      map['title'] = Variable<String>(title.value);
    }
    if (payloadJson.present) {
      map['payload_json'] = Variable<String>(payloadJson.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('DraftListingsCompanion(')
          ..write('id: $id, ')
          ..write('marketplace: $marketplace, ')
          ..write('title: $title, ')
          ..write('payloadJson: $payloadJson, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }
}

class $OutboxEntriesTable extends OutboxEntries
    with TableInfo<$OutboxEntriesTable, OutboxEntry> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $OutboxEntriesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _methodMeta = const VerificationMeta('method');
  @override
  late final GeneratedColumn<String> method = GeneratedColumn<String>(
    'method',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _pathMeta = const VerificationMeta('path');
  @override
  late final GeneratedColumn<String> path = GeneratedColumn<String>(
    'path',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _bodyJsonMeta = const VerificationMeta(
    'bodyJson',
  );
  @override
  late final GeneratedColumn<String> bodyJson = GeneratedColumn<String>(
    'body_json',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _retryCountMeta = const VerificationMeta(
    'retryCount',
  );
  @override
  late final GeneratedColumn<int> retryCount = GeneratedColumn<int>(
    'retry_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
    defaultValue: const Constant('pending'),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    method,
    path,
    bodyJson,
    retryCount,
    createdAt,
    status,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'outbox_entries';
  @override
  VerificationContext validateIntegrity(
    Insertable<OutboxEntry> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('method')) {
      context.handle(
        _methodMeta,
        method.isAcceptableOrUnknown(data['method']!, _methodMeta),
      );
    } else if (isInserting) {
      context.missing(_methodMeta);
    }
    if (data.containsKey('path')) {
      context.handle(
        _pathMeta,
        path.isAcceptableOrUnknown(data['path']!, _pathMeta),
      );
    } else if (isInserting) {
      context.missing(_pathMeta);
    }
    if (data.containsKey('body_json')) {
      context.handle(
        _bodyJsonMeta,
        bodyJson.isAcceptableOrUnknown(data['body_json']!, _bodyJsonMeta),
      );
    }
    if (data.containsKey('retry_count')) {
      context.handle(
        _retryCountMeta,
        retryCount.isAcceptableOrUnknown(data['retry_count']!, _retryCountMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  OutboxEntry map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return OutboxEntry(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      method: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}method'],
      )!,
      path: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}path'],
      )!,
      bodyJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}body_json'],
      ),
      retryCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}retry_count'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
    );
  }

  @override
  $OutboxEntriesTable createAlias(String alias) {
    return $OutboxEntriesTable(attachedDatabase, alias);
  }
}

class OutboxEntry extends DataClass implements Insertable<OutboxEntry> {
  final int id;
  final String method;
  final String path;
  final String? bodyJson;
  final int retryCount;
  final DateTime createdAt;
  final String status;
  const OutboxEntry({
    required this.id,
    required this.method,
    required this.path,
    this.bodyJson,
    required this.retryCount,
    required this.createdAt,
    required this.status,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['method'] = Variable<String>(method);
    map['path'] = Variable<String>(path);
    if (!nullToAbsent || bodyJson != null) {
      map['body_json'] = Variable<String>(bodyJson);
    }
    map['retry_count'] = Variable<int>(retryCount);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['status'] = Variable<String>(status);
    return map;
  }

  OutboxEntriesCompanion toCompanion(bool nullToAbsent) {
    return OutboxEntriesCompanion(
      id: Value(id),
      method: Value(method),
      path: Value(path),
      bodyJson: bodyJson == null && nullToAbsent
          ? const Value.absent()
          : Value(bodyJson),
      retryCount: Value(retryCount),
      createdAt: Value(createdAt),
      status: Value(status),
    );
  }

  factory OutboxEntry.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return OutboxEntry(
      id: serializer.fromJson<int>(json['id']),
      method: serializer.fromJson<String>(json['method']),
      path: serializer.fromJson<String>(json['path']),
      bodyJson: serializer.fromJson<String?>(json['bodyJson']),
      retryCount: serializer.fromJson<int>(json['retryCount']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      status: serializer.fromJson<String>(json['status']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'method': serializer.toJson<String>(method),
      'path': serializer.toJson<String>(path),
      'bodyJson': serializer.toJson<String?>(bodyJson),
      'retryCount': serializer.toJson<int>(retryCount),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'status': serializer.toJson<String>(status),
    };
  }

  OutboxEntry copyWith({
    int? id,
    String? method,
    String? path,
    Value<String?> bodyJson = const Value.absent(),
    int? retryCount,
    DateTime? createdAt,
    String? status,
  }) => OutboxEntry(
    id: id ?? this.id,
    method: method ?? this.method,
    path: path ?? this.path,
    bodyJson: bodyJson.present ? bodyJson.value : this.bodyJson,
    retryCount: retryCount ?? this.retryCount,
    createdAt: createdAt ?? this.createdAt,
    status: status ?? this.status,
  );
  OutboxEntry copyWithCompanion(OutboxEntriesCompanion data) {
    return OutboxEntry(
      id: data.id.present ? data.id.value : this.id,
      method: data.method.present ? data.method.value : this.method,
      path: data.path.present ? data.path.value : this.path,
      bodyJson: data.bodyJson.present ? data.bodyJson.value : this.bodyJson,
      retryCount: data.retryCount.present
          ? data.retryCount.value
          : this.retryCount,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      status: data.status.present ? data.status.value : this.status,
    );
  }

  @override
  String toString() {
    return (StringBuffer('OutboxEntry(')
          ..write('id: $id, ')
          ..write('method: $method, ')
          ..write('path: $path, ')
          ..write('bodyJson: $bodyJson, ')
          ..write('retryCount: $retryCount, ')
          ..write('createdAt: $createdAt, ')
          ..write('status: $status')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, method, path, bodyJson, retryCount, createdAt, status);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is OutboxEntry &&
          other.id == this.id &&
          other.method == this.method &&
          other.path == this.path &&
          other.bodyJson == this.bodyJson &&
          other.retryCount == this.retryCount &&
          other.createdAt == this.createdAt &&
          other.status == this.status);
}

class OutboxEntriesCompanion extends UpdateCompanion<OutboxEntry> {
  final Value<int> id;
  final Value<String> method;
  final Value<String> path;
  final Value<String?> bodyJson;
  final Value<int> retryCount;
  final Value<DateTime> createdAt;
  final Value<String> status;
  const OutboxEntriesCompanion({
    this.id = const Value.absent(),
    this.method = const Value.absent(),
    this.path = const Value.absent(),
    this.bodyJson = const Value.absent(),
    this.retryCount = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.status = const Value.absent(),
  });
  OutboxEntriesCompanion.insert({
    this.id = const Value.absent(),
    required String method,
    required String path,
    this.bodyJson = const Value.absent(),
    this.retryCount = const Value.absent(),
    required DateTime createdAt,
    this.status = const Value.absent(),
  }) : method = Value(method),
       path = Value(path),
       createdAt = Value(createdAt);
  static Insertable<OutboxEntry> custom({
    Expression<int>? id,
    Expression<String>? method,
    Expression<String>? path,
    Expression<String>? bodyJson,
    Expression<int>? retryCount,
    Expression<DateTime>? createdAt,
    Expression<String>? status,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (method != null) 'method': method,
      if (path != null) 'path': path,
      if (bodyJson != null) 'body_json': bodyJson,
      if (retryCount != null) 'retry_count': retryCount,
      if (createdAt != null) 'created_at': createdAt,
      if (status != null) 'status': status,
    });
  }

  OutboxEntriesCompanion copyWith({
    Value<int>? id,
    Value<String>? method,
    Value<String>? path,
    Value<String?>? bodyJson,
    Value<int>? retryCount,
    Value<DateTime>? createdAt,
    Value<String>? status,
  }) {
    return OutboxEntriesCompanion(
      id: id ?? this.id,
      method: method ?? this.method,
      path: path ?? this.path,
      bodyJson: bodyJson ?? this.bodyJson,
      retryCount: retryCount ?? this.retryCount,
      createdAt: createdAt ?? this.createdAt,
      status: status ?? this.status,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (method.present) {
      map['method'] = Variable<String>(method.value);
    }
    if (path.present) {
      map['path'] = Variable<String>(path.value);
    }
    if (bodyJson.present) {
      map['body_json'] = Variable<String>(bodyJson.value);
    }
    if (retryCount.present) {
      map['retry_count'] = Variable<int>(retryCount.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('OutboxEntriesCompanion(')
          ..write('id: $id, ')
          ..write('method: $method, ')
          ..write('path: $path, ')
          ..write('bodyJson: $bodyJson, ')
          ..write('retryCount: $retryCount, ')
          ..write('createdAt: $createdAt, ')
          ..write('status: $status')
          ..write(')'))
        .toString();
  }
}

class $SettingsMirrorTable extends SettingsMirror
    with TableInfo<$SettingsMirrorTable, SettingsMirrorData> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SettingsMirrorTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'settings_mirror';
  @override
  VerificationContext validateIntegrity(
    Insertable<SettingsMirrorData> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  SettingsMirrorData map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SettingsMirrorData(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
    );
  }

  @override
  $SettingsMirrorTable createAlias(String alias) {
    return $SettingsMirrorTable(attachedDatabase, alias);
  }
}

class SettingsMirrorData extends DataClass
    implements Insertable<SettingsMirrorData> {
  final String key;
  final String value;
  const SettingsMirrorData({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  SettingsMirrorCompanion toCompanion(bool nullToAbsent) {
    return SettingsMirrorCompanion(key: Value(key), value: Value(value));
  }

  factory SettingsMirrorData.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SettingsMirrorData(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
    };
  }

  SettingsMirrorData copyWith({String? key, String? value}) =>
      SettingsMirrorData(key: key ?? this.key, value: value ?? this.value);
  SettingsMirrorData copyWithCompanion(SettingsMirrorCompanion data) {
    return SettingsMirrorData(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SettingsMirrorData(')
          ..write('key: $key, ')
          ..write('value: $value')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SettingsMirrorData &&
          other.key == this.key &&
          other.value == this.value);
}

class SettingsMirrorCompanion extends UpdateCompanion<SettingsMirrorData> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const SettingsMirrorCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SettingsMirrorCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value);
  static Insertable<SettingsMirrorData> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SettingsMirrorCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<int>? rowid,
  }) {
    return SettingsMirrorCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SettingsMirrorCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $CompareSetsTable extends CompareSets
    with TableInfo<$CompareSetsTable, CompareSet> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CompareSetsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _marketplaceMeta = const VerificationMeta(
    'marketplace',
  );
  @override
  late final GeneratedColumn<String> marketplace = GeneratedColumn<String>(
    'marketplace',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _listingIdsJsonMeta = const VerificationMeta(
    'listingIdsJson',
  );
  @override
  late final GeneratedColumn<String> listingIdsJson = GeneratedColumn<String>(
    'listing_ids_json',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _aiResultJsonMeta = const VerificationMeta(
    'aiResultJson',
  );
  @override
  late final GeneratedColumn<String> aiResultJson = GeneratedColumn<String>(
    'ai_result_json',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    marketplace,
    listingIdsJson,
    aiResultJson,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'compare_sets';
  @override
  VerificationContext validateIntegrity(
    Insertable<CompareSet> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('marketplace')) {
      context.handle(
        _marketplaceMeta,
        marketplace.isAcceptableOrUnknown(
          data['marketplace']!,
          _marketplaceMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_marketplaceMeta);
    }
    if (data.containsKey('listing_ids_json')) {
      context.handle(
        _listingIdsJsonMeta,
        listingIdsJson.isAcceptableOrUnknown(
          data['listing_ids_json']!,
          _listingIdsJsonMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_listingIdsJsonMeta);
    }
    if (data.containsKey('ai_result_json')) {
      context.handle(
        _aiResultJsonMeta,
        aiResultJson.isAcceptableOrUnknown(
          data['ai_result_json']!,
          _aiResultJsonMeta,
        ),
      );
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  CompareSet map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CompareSet(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      marketplace: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}marketplace'],
      )!,
      listingIdsJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}listing_ids_json'],
      )!,
      aiResultJson: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}ai_result_json'],
      ),
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $CompareSetsTable createAlias(String alias) {
    return $CompareSetsTable(attachedDatabase, alias);
  }
}

class CompareSet extends DataClass implements Insertable<CompareSet> {
  final String id;
  final String marketplace;
  final String listingIdsJson;
  final String? aiResultJson;
  final DateTime updatedAt;
  const CompareSet({
    required this.id,
    required this.marketplace,
    required this.listingIdsJson,
    this.aiResultJson,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['marketplace'] = Variable<String>(marketplace);
    map['listing_ids_json'] = Variable<String>(listingIdsJson);
    if (!nullToAbsent || aiResultJson != null) {
      map['ai_result_json'] = Variable<String>(aiResultJson);
    }
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  CompareSetsCompanion toCompanion(bool nullToAbsent) {
    return CompareSetsCompanion(
      id: Value(id),
      marketplace: Value(marketplace),
      listingIdsJson: Value(listingIdsJson),
      aiResultJson: aiResultJson == null && nullToAbsent
          ? const Value.absent()
          : Value(aiResultJson),
      updatedAt: Value(updatedAt),
    );
  }

  factory CompareSet.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CompareSet(
      id: serializer.fromJson<String>(json['id']),
      marketplace: serializer.fromJson<String>(json['marketplace']),
      listingIdsJson: serializer.fromJson<String>(json['listingIdsJson']),
      aiResultJson: serializer.fromJson<String?>(json['aiResultJson']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'marketplace': serializer.toJson<String>(marketplace),
      'listingIdsJson': serializer.toJson<String>(listingIdsJson),
      'aiResultJson': serializer.toJson<String?>(aiResultJson),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  CompareSet copyWith({
    String? id,
    String? marketplace,
    String? listingIdsJson,
    Value<String?> aiResultJson = const Value.absent(),
    DateTime? updatedAt,
  }) => CompareSet(
    id: id ?? this.id,
    marketplace: marketplace ?? this.marketplace,
    listingIdsJson: listingIdsJson ?? this.listingIdsJson,
    aiResultJson: aiResultJson.present ? aiResultJson.value : this.aiResultJson,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  CompareSet copyWithCompanion(CompareSetsCompanion data) {
    return CompareSet(
      id: data.id.present ? data.id.value : this.id,
      marketplace: data.marketplace.present
          ? data.marketplace.value
          : this.marketplace,
      listingIdsJson: data.listingIdsJson.present
          ? data.listingIdsJson.value
          : this.listingIdsJson,
      aiResultJson: data.aiResultJson.present
          ? data.aiResultJson.value
          : this.aiResultJson,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CompareSet(')
          ..write('id: $id, ')
          ..write('marketplace: $marketplace, ')
          ..write('listingIdsJson: $listingIdsJson, ')
          ..write('aiResultJson: $aiResultJson, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, marketplace, listingIdsJson, aiResultJson, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CompareSet &&
          other.id == this.id &&
          other.marketplace == this.marketplace &&
          other.listingIdsJson == this.listingIdsJson &&
          other.aiResultJson == this.aiResultJson &&
          other.updatedAt == this.updatedAt);
}

class CompareSetsCompanion extends UpdateCompanion<CompareSet> {
  final Value<String> id;
  final Value<String> marketplace;
  final Value<String> listingIdsJson;
  final Value<String?> aiResultJson;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const CompareSetsCompanion({
    this.id = const Value.absent(),
    this.marketplace = const Value.absent(),
    this.listingIdsJson = const Value.absent(),
    this.aiResultJson = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CompareSetsCompanion.insert({
    required String id,
    required String marketplace,
    required String listingIdsJson,
    this.aiResultJson = const Value.absent(),
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       marketplace = Value(marketplace),
       listingIdsJson = Value(listingIdsJson),
       updatedAt = Value(updatedAt);
  static Insertable<CompareSet> custom({
    Expression<String>? id,
    Expression<String>? marketplace,
    Expression<String>? listingIdsJson,
    Expression<String>? aiResultJson,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (marketplace != null) 'marketplace': marketplace,
      if (listingIdsJson != null) 'listing_ids_json': listingIdsJson,
      if (aiResultJson != null) 'ai_result_json': aiResultJson,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CompareSetsCompanion copyWith({
    Value<String>? id,
    Value<String>? marketplace,
    Value<String>? listingIdsJson,
    Value<String?>? aiResultJson,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return CompareSetsCompanion(
      id: id ?? this.id,
      marketplace: marketplace ?? this.marketplace,
      listingIdsJson: listingIdsJson ?? this.listingIdsJson,
      aiResultJson: aiResultJson ?? this.aiResultJson,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (marketplace.present) {
      map['marketplace'] = Variable<String>(marketplace.value);
    }
    if (listingIdsJson.present) {
      map['listing_ids_json'] = Variable<String>(listingIdsJson.value);
    }
    if (aiResultJson.present) {
      map['ai_result_json'] = Variable<String>(aiResultJson.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CompareSetsCompanion(')
          ..write('id: $id, ')
          ..write('marketplace: $marketplace, ')
          ..write('listingIdsJson: $listingIdsJson, ')
          ..write('aiResultJson: $aiResultJson, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  $AppDatabaseManager get managers => $AppDatabaseManager(this);
  late final $CachedListingsTable cachedListings = $CachedListingsTable(this);
  late final $DraftListingsTable draftListings = $DraftListingsTable(this);
  late final $OutboxEntriesTable outboxEntries = $OutboxEntriesTable(this);
  late final $SettingsMirrorTable settingsMirror = $SettingsMirrorTable(this);
  late final $CompareSetsTable compareSets = $CompareSetsTable(this);
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    cachedListings,
    draftListings,
    outboxEntries,
    settingsMirror,
    compareSets,
  ];
}

typedef $$CachedListingsTableCreateCompanionBuilder =
    CachedListingsCompanion Function({
      required String id,
      required String marketplace,
      required String title,
      required double price,
      required String currency,
      Value<String?> location,
      Value<String?> imageUrl,
      required String payloadJson,
      required DateTime cachedAt,
      Value<String?> sortKey,
      Value<int> rowid,
    });
typedef $$CachedListingsTableUpdateCompanionBuilder =
    CachedListingsCompanion Function({
      Value<String> id,
      Value<String> marketplace,
      Value<String> title,
      Value<double> price,
      Value<String> currency,
      Value<String?> location,
      Value<String?> imageUrl,
      Value<String> payloadJson,
      Value<DateTime> cachedAt,
      Value<String?> sortKey,
      Value<int> rowid,
    });

class $$CachedListingsTableFilterComposer
    extends Composer<_$AppDatabase, $CachedListingsTable> {
  $$CachedListingsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get marketplace => $composableBuilder(
    column: $table.marketplace,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<double> get price => $composableBuilder(
    column: $table.price,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get currency => $composableBuilder(
    column: $table.currency,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get location => $composableBuilder(
    column: $table.location,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get imageUrl => $composableBuilder(
    column: $table.imageUrl,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get cachedAt => $composableBuilder(
    column: $table.cachedAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get sortKey => $composableBuilder(
    column: $table.sortKey,
    builder: (column) => ColumnFilters(column),
  );
}

class $$CachedListingsTableOrderingComposer
    extends Composer<_$AppDatabase, $CachedListingsTable> {
  $$CachedListingsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get marketplace => $composableBuilder(
    column: $table.marketplace,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<double> get price => $composableBuilder(
    column: $table.price,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get currency => $composableBuilder(
    column: $table.currency,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get location => $composableBuilder(
    column: $table.location,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get imageUrl => $composableBuilder(
    column: $table.imageUrl,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get cachedAt => $composableBuilder(
    column: $table.cachedAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get sortKey => $composableBuilder(
    column: $table.sortKey,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$CachedListingsTableAnnotationComposer
    extends Composer<_$AppDatabase, $CachedListingsTable> {
  $$CachedListingsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get marketplace => $composableBuilder(
    column: $table.marketplace,
    builder: (column) => column,
  );

  GeneratedColumn<String> get title =>
      $composableBuilder(column: $table.title, builder: (column) => column);

  GeneratedColumn<double> get price =>
      $composableBuilder(column: $table.price, builder: (column) => column);

  GeneratedColumn<String> get currency =>
      $composableBuilder(column: $table.currency, builder: (column) => column);

  GeneratedColumn<String> get location =>
      $composableBuilder(column: $table.location, builder: (column) => column);

  GeneratedColumn<String> get imageUrl =>
      $composableBuilder(column: $table.imageUrl, builder: (column) => column);

  GeneratedColumn<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get cachedAt =>
      $composableBuilder(column: $table.cachedAt, builder: (column) => column);

  GeneratedColumn<String> get sortKey =>
      $composableBuilder(column: $table.sortKey, builder: (column) => column);
}

class $$CachedListingsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $CachedListingsTable,
          CachedListing,
          $$CachedListingsTableFilterComposer,
          $$CachedListingsTableOrderingComposer,
          $$CachedListingsTableAnnotationComposer,
          $$CachedListingsTableCreateCompanionBuilder,
          $$CachedListingsTableUpdateCompanionBuilder,
          (
            CachedListing,
            BaseReferences<_$AppDatabase, $CachedListingsTable, CachedListing>,
          ),
          CachedListing,
          PrefetchHooks Function()
        > {
  $$CachedListingsTableTableManager(
    _$AppDatabase db,
    $CachedListingsTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CachedListingsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CachedListingsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CachedListingsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> marketplace = const Value.absent(),
                Value<String> title = const Value.absent(),
                Value<double> price = const Value.absent(),
                Value<String> currency = const Value.absent(),
                Value<String?> location = const Value.absent(),
                Value<String?> imageUrl = const Value.absent(),
                Value<String> payloadJson = const Value.absent(),
                Value<DateTime> cachedAt = const Value.absent(),
                Value<String?> sortKey = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => CachedListingsCompanion(
                id: id,
                marketplace: marketplace,
                title: title,
                price: price,
                currency: currency,
                location: location,
                imageUrl: imageUrl,
                payloadJson: payloadJson,
                cachedAt: cachedAt,
                sortKey: sortKey,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String marketplace,
                required String title,
                required double price,
                required String currency,
                Value<String?> location = const Value.absent(),
                Value<String?> imageUrl = const Value.absent(),
                required String payloadJson,
                required DateTime cachedAt,
                Value<String?> sortKey = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => CachedListingsCompanion.insert(
                id: id,
                marketplace: marketplace,
                title: title,
                price: price,
                currency: currency,
                location: location,
                imageUrl: imageUrl,
                payloadJson: payloadJson,
                cachedAt: cachedAt,
                sortKey: sortKey,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$CachedListingsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $CachedListingsTable,
      CachedListing,
      $$CachedListingsTableFilterComposer,
      $$CachedListingsTableOrderingComposer,
      $$CachedListingsTableAnnotationComposer,
      $$CachedListingsTableCreateCompanionBuilder,
      $$CachedListingsTableUpdateCompanionBuilder,
      (
        CachedListing,
        BaseReferences<_$AppDatabase, $CachedListingsTable, CachedListing>,
      ),
      CachedListing,
      PrefetchHooks Function()
    >;
typedef $$DraftListingsTableCreateCompanionBuilder =
    DraftListingsCompanion Function({
      Value<int> id,
      required String marketplace,
      Value<String> title,
      Value<String> payloadJson,
      required DateTime updatedAt,
    });
typedef $$DraftListingsTableUpdateCompanionBuilder =
    DraftListingsCompanion Function({
      Value<int> id,
      Value<String> marketplace,
      Value<String> title,
      Value<String> payloadJson,
      Value<DateTime> updatedAt,
    });

class $$DraftListingsTableFilterComposer
    extends Composer<_$AppDatabase, $DraftListingsTable> {
  $$DraftListingsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get marketplace => $composableBuilder(
    column: $table.marketplace,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$DraftListingsTableOrderingComposer
    extends Composer<_$AppDatabase, $DraftListingsTable> {
  $$DraftListingsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get marketplace => $composableBuilder(
    column: $table.marketplace,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get title => $composableBuilder(
    column: $table.title,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$DraftListingsTableAnnotationComposer
    extends Composer<_$AppDatabase, $DraftListingsTable> {
  $$DraftListingsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get marketplace => $composableBuilder(
    column: $table.marketplace,
    builder: (column) => column,
  );

  GeneratedColumn<String> get title =>
      $composableBuilder(column: $table.title, builder: (column) => column);

  GeneratedColumn<String> get payloadJson => $composableBuilder(
    column: $table.payloadJson,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$DraftListingsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $DraftListingsTable,
          DraftListing,
          $$DraftListingsTableFilterComposer,
          $$DraftListingsTableOrderingComposer,
          $$DraftListingsTableAnnotationComposer,
          $$DraftListingsTableCreateCompanionBuilder,
          $$DraftListingsTableUpdateCompanionBuilder,
          (
            DraftListing,
            BaseReferences<_$AppDatabase, $DraftListingsTable, DraftListing>,
          ),
          DraftListing,
          PrefetchHooks Function()
        > {
  $$DraftListingsTableTableManager(_$AppDatabase db, $DraftListingsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$DraftListingsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$DraftListingsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$DraftListingsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<String> marketplace = const Value.absent(),
                Value<String> title = const Value.absent(),
                Value<String> payloadJson = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
              }) => DraftListingsCompanion(
                id: id,
                marketplace: marketplace,
                title: title,
                payloadJson: payloadJson,
                updatedAt: updatedAt,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required String marketplace,
                Value<String> title = const Value.absent(),
                Value<String> payloadJson = const Value.absent(),
                required DateTime updatedAt,
              }) => DraftListingsCompanion.insert(
                id: id,
                marketplace: marketplace,
                title: title,
                payloadJson: payloadJson,
                updatedAt: updatedAt,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$DraftListingsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $DraftListingsTable,
      DraftListing,
      $$DraftListingsTableFilterComposer,
      $$DraftListingsTableOrderingComposer,
      $$DraftListingsTableAnnotationComposer,
      $$DraftListingsTableCreateCompanionBuilder,
      $$DraftListingsTableUpdateCompanionBuilder,
      (
        DraftListing,
        BaseReferences<_$AppDatabase, $DraftListingsTable, DraftListing>,
      ),
      DraftListing,
      PrefetchHooks Function()
    >;
typedef $$OutboxEntriesTableCreateCompanionBuilder =
    OutboxEntriesCompanion Function({
      Value<int> id,
      required String method,
      required String path,
      Value<String?> bodyJson,
      Value<int> retryCount,
      required DateTime createdAt,
      Value<String> status,
    });
typedef $$OutboxEntriesTableUpdateCompanionBuilder =
    OutboxEntriesCompanion Function({
      Value<int> id,
      Value<String> method,
      Value<String> path,
      Value<String?> bodyJson,
      Value<int> retryCount,
      Value<DateTime> createdAt,
      Value<String> status,
    });

class $$OutboxEntriesTableFilterComposer
    extends Composer<_$AppDatabase, $OutboxEntriesTable> {
  $$OutboxEntriesTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get method => $composableBuilder(
    column: $table.method,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get path => $composableBuilder(
    column: $table.path,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get bodyJson => $composableBuilder(
    column: $table.bodyJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<int> get retryCount => $composableBuilder(
    column: $table.retryCount,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnFilters(column),
  );
}

class $$OutboxEntriesTableOrderingComposer
    extends Composer<_$AppDatabase, $OutboxEntriesTable> {
  $$OutboxEntriesTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<int> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get method => $composableBuilder(
    column: $table.method,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get path => $composableBuilder(
    column: $table.path,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get bodyJson => $composableBuilder(
    column: $table.bodyJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<int> get retryCount => $composableBuilder(
    column: $table.retryCount,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get status => $composableBuilder(
    column: $table.status,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$OutboxEntriesTableAnnotationComposer
    extends Composer<_$AppDatabase, $OutboxEntriesTable> {
  $$OutboxEntriesTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<int> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get method =>
      $composableBuilder(column: $table.method, builder: (column) => column);

  GeneratedColumn<String> get path =>
      $composableBuilder(column: $table.path, builder: (column) => column);

  GeneratedColumn<String> get bodyJson =>
      $composableBuilder(column: $table.bodyJson, builder: (column) => column);

  GeneratedColumn<int> get retryCount => $composableBuilder(
    column: $table.retryCount,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  GeneratedColumn<String> get status =>
      $composableBuilder(column: $table.status, builder: (column) => column);
}

class $$OutboxEntriesTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $OutboxEntriesTable,
          OutboxEntry,
          $$OutboxEntriesTableFilterComposer,
          $$OutboxEntriesTableOrderingComposer,
          $$OutboxEntriesTableAnnotationComposer,
          $$OutboxEntriesTableCreateCompanionBuilder,
          $$OutboxEntriesTableUpdateCompanionBuilder,
          (
            OutboxEntry,
            BaseReferences<_$AppDatabase, $OutboxEntriesTable, OutboxEntry>,
          ),
          OutboxEntry,
          PrefetchHooks Function()
        > {
  $$OutboxEntriesTableTableManager(_$AppDatabase db, $OutboxEntriesTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$OutboxEntriesTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$OutboxEntriesTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$OutboxEntriesTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                Value<String> method = const Value.absent(),
                Value<String> path = const Value.absent(),
                Value<String?> bodyJson = const Value.absent(),
                Value<int> retryCount = const Value.absent(),
                Value<DateTime> createdAt = const Value.absent(),
                Value<String> status = const Value.absent(),
              }) => OutboxEntriesCompanion(
                id: id,
                method: method,
                path: path,
                bodyJson: bodyJson,
                retryCount: retryCount,
                createdAt: createdAt,
                status: status,
              ),
          createCompanionCallback:
              ({
                Value<int> id = const Value.absent(),
                required String method,
                required String path,
                Value<String?> bodyJson = const Value.absent(),
                Value<int> retryCount = const Value.absent(),
                required DateTime createdAt,
                Value<String> status = const Value.absent(),
              }) => OutboxEntriesCompanion.insert(
                id: id,
                method: method,
                path: path,
                bodyJson: bodyJson,
                retryCount: retryCount,
                createdAt: createdAt,
                status: status,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$OutboxEntriesTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $OutboxEntriesTable,
      OutboxEntry,
      $$OutboxEntriesTableFilterComposer,
      $$OutboxEntriesTableOrderingComposer,
      $$OutboxEntriesTableAnnotationComposer,
      $$OutboxEntriesTableCreateCompanionBuilder,
      $$OutboxEntriesTableUpdateCompanionBuilder,
      (
        OutboxEntry,
        BaseReferences<_$AppDatabase, $OutboxEntriesTable, OutboxEntry>,
      ),
      OutboxEntry,
      PrefetchHooks Function()
    >;
typedef $$SettingsMirrorTableCreateCompanionBuilder =
    SettingsMirrorCompanion Function({
      required String key,
      required String value,
      Value<int> rowid,
    });
typedef $$SettingsMirrorTableUpdateCompanionBuilder =
    SettingsMirrorCompanion Function({
      Value<String> key,
      Value<String> value,
      Value<int> rowid,
    });

class $$SettingsMirrorTableFilterComposer
    extends Composer<_$AppDatabase, $SettingsMirrorTable> {
  $$SettingsMirrorTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnFilters(column),
  );
}

class $$SettingsMirrorTableOrderingComposer
    extends Composer<_$AppDatabase, $SettingsMirrorTable> {
  $$SettingsMirrorTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get key => $composableBuilder(
    column: $table.key,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get value => $composableBuilder(
    column: $table.value,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$SettingsMirrorTableAnnotationComposer
    extends Composer<_$AppDatabase, $SettingsMirrorTable> {
  $$SettingsMirrorTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get key =>
      $composableBuilder(column: $table.key, builder: (column) => column);

  GeneratedColumn<String> get value =>
      $composableBuilder(column: $table.value, builder: (column) => column);
}

class $$SettingsMirrorTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $SettingsMirrorTable,
          SettingsMirrorData,
          $$SettingsMirrorTableFilterComposer,
          $$SettingsMirrorTableOrderingComposer,
          $$SettingsMirrorTableAnnotationComposer,
          $$SettingsMirrorTableCreateCompanionBuilder,
          $$SettingsMirrorTableUpdateCompanionBuilder,
          (
            SettingsMirrorData,
            BaseReferences<
              _$AppDatabase,
              $SettingsMirrorTable,
              SettingsMirrorData
            >,
          ),
          SettingsMirrorData,
          PrefetchHooks Function()
        > {
  $$SettingsMirrorTableTableManager(
    _$AppDatabase db,
    $SettingsMirrorTable table,
  ) : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$SettingsMirrorTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$SettingsMirrorTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$SettingsMirrorTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> key = const Value.absent(),
                Value<String> value = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) =>
                  SettingsMirrorCompanion(key: key, value: value, rowid: rowid),
          createCompanionCallback:
              ({
                required String key,
                required String value,
                Value<int> rowid = const Value.absent(),
              }) => SettingsMirrorCompanion.insert(
                key: key,
                value: value,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SettingsMirrorTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $SettingsMirrorTable,
      SettingsMirrorData,
      $$SettingsMirrorTableFilterComposer,
      $$SettingsMirrorTableOrderingComposer,
      $$SettingsMirrorTableAnnotationComposer,
      $$SettingsMirrorTableCreateCompanionBuilder,
      $$SettingsMirrorTableUpdateCompanionBuilder,
      (
        SettingsMirrorData,
        BaseReferences<_$AppDatabase, $SettingsMirrorTable, SettingsMirrorData>,
      ),
      SettingsMirrorData,
      PrefetchHooks Function()
    >;
typedef $$CompareSetsTableCreateCompanionBuilder =
    CompareSetsCompanion Function({
      required String id,
      required String marketplace,
      required String listingIdsJson,
      Value<String?> aiResultJson,
      required DateTime updatedAt,
      Value<int> rowid,
    });
typedef $$CompareSetsTableUpdateCompanionBuilder =
    CompareSetsCompanion Function({
      Value<String> id,
      Value<String> marketplace,
      Value<String> listingIdsJson,
      Value<String?> aiResultJson,
      Value<DateTime> updatedAt,
      Value<int> rowid,
    });

class $$CompareSetsTableFilterComposer
    extends Composer<_$AppDatabase, $CompareSetsTable> {
  $$CompareSetsTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get marketplace => $composableBuilder(
    column: $table.marketplace,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get listingIdsJson => $composableBuilder(
    column: $table.listingIdsJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<String> get aiResultJson => $composableBuilder(
    column: $table.aiResultJson,
    builder: (column) => ColumnFilters(column),
  );

  ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnFilters(column),
  );
}

class $$CompareSetsTableOrderingComposer
    extends Composer<_$AppDatabase, $CompareSetsTable> {
  $$CompareSetsTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get marketplace => $composableBuilder(
    column: $table.marketplace,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get listingIdsJson => $composableBuilder(
    column: $table.listingIdsJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<String> get aiResultJson => $composableBuilder(
    column: $table.aiResultJson,
    builder: (column) => ColumnOrderings(column),
  );

  ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => ColumnOrderings(column),
  );
}

class $$CompareSetsTableAnnotationComposer
    extends Composer<_$AppDatabase, $CompareSetsTable> {
  $$CompareSetsTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  GeneratedColumn<String> get marketplace => $composableBuilder(
    column: $table.marketplace,
    builder: (column) => column,
  );

  GeneratedColumn<String> get listingIdsJson => $composableBuilder(
    column: $table.listingIdsJson,
    builder: (column) => column,
  );

  GeneratedColumn<String> get aiResultJson => $composableBuilder(
    column: $table.aiResultJson,
    builder: (column) => column,
  );

  GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);
}

class $$CompareSetsTableTableManager
    extends
        RootTableManager<
          _$AppDatabase,
          $CompareSetsTable,
          CompareSet,
          $$CompareSetsTableFilterComposer,
          $$CompareSetsTableOrderingComposer,
          $$CompareSetsTableAnnotationComposer,
          $$CompareSetsTableCreateCompanionBuilder,
          $$CompareSetsTableUpdateCompanionBuilder,
          (
            CompareSet,
            BaseReferences<_$AppDatabase, $CompareSetsTable, CompareSet>,
          ),
          CompareSet,
          PrefetchHooks Function()
        > {
  $$CompareSetsTableTableManager(_$AppDatabase db, $CompareSetsTable table)
    : super(
        TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              $$CompareSetsTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () =>
              $$CompareSetsTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              $$CompareSetsTableAnnotationComposer($db: db, $table: table),
          updateCompanionCallback:
              ({
                Value<String> id = const Value.absent(),
                Value<String> marketplace = const Value.absent(),
                Value<String> listingIdsJson = const Value.absent(),
                Value<String?> aiResultJson = const Value.absent(),
                Value<DateTime> updatedAt = const Value.absent(),
                Value<int> rowid = const Value.absent(),
              }) => CompareSetsCompanion(
                id: id,
                marketplace: marketplace,
                listingIdsJson: listingIdsJson,
                aiResultJson: aiResultJson,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String marketplace,
                required String listingIdsJson,
                Value<String?> aiResultJson = const Value.absent(),
                required DateTime updatedAt,
                Value<int> rowid = const Value.absent(),
              }) => CompareSetsCompanion.insert(
                id: id,
                marketplace: marketplace,
                listingIdsJson: listingIdsJson,
                aiResultJson: aiResultJson,
                updatedAt: updatedAt,
                rowid: rowid,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$CompareSetsTableProcessedTableManager =
    ProcessedTableManager<
      _$AppDatabase,
      $CompareSetsTable,
      CompareSet,
      $$CompareSetsTableFilterComposer,
      $$CompareSetsTableOrderingComposer,
      $$CompareSetsTableAnnotationComposer,
      $$CompareSetsTableCreateCompanionBuilder,
      $$CompareSetsTableUpdateCompanionBuilder,
      (
        CompareSet,
        BaseReferences<_$AppDatabase, $CompareSetsTable, CompareSet>,
      ),
      CompareSet,
      PrefetchHooks Function()
    >;

class $AppDatabaseManager {
  final _$AppDatabase _db;
  $AppDatabaseManager(this._db);
  $$CachedListingsTableTableManager get cachedListings =>
      $$CachedListingsTableTableManager(_db, _db.cachedListings);
  $$DraftListingsTableTableManager get draftListings =>
      $$DraftListingsTableTableManager(_db, _db.draftListings);
  $$OutboxEntriesTableTableManager get outboxEntries =>
      $$OutboxEntriesTableTableManager(_db, _db.outboxEntries);
  $$SettingsMirrorTableTableManager get settingsMirror =>
      $$SettingsMirrorTableTableManager(_db, _db.settingsMirror);
  $$CompareSetsTableTableManager get compareSets =>
      $$CompareSetsTableTableManager(_db, _db.compareSets);
}
