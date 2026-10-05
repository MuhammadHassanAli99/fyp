import '../../data/models/filter_models.dart';
import '../../data/models/listing_feed_query.dart';

const _geoKeys = {'countryId', 'regionId', 'cityId', 'areaId', 'radiusKm'};

const _publicKeys = {
  'marketplace',
  'category',
  'subcategory',
  'operation',
  'availability',
  'countryId',
  'regionId',
  'cityId',
  'areaId',
  'radiusKm',
  'minPrice',
  'maxPrice',
  'currency',
};

/// Normalized filter state. One map of values instead of hundreds of booleans.
class FilterState {
  FilterState({
    this.marketplace,
    this.category,
    this.subcategory,
    this.operation,
    this.availability,
    this.currency,
    Map<String, dynamic>? values,
  }) : values = values ?? <String, dynamic>{};

  String? marketplace;
  String? category;
  String? subcategory;
  String? operation;
  String? availability;
  String? currency;
  final Map<String, dynamic> values;

  bool get isEmpty =>
      operation == null &&
      category == null &&
      availability == null &&
      values.isEmpty;

  int get activeCount {
    var n = 0;
    if (operation != null) n++;
    if (category != null) n++;
    if (availability != null) n++;
    n += values.entries.where((e) => _isActive(e.value)).length;
    return n;
  }

  static bool _isActive(dynamic value) {
    if (value == null || value == false || value == '') return false;
    if (value is List) return value.isNotEmpty;
    if (value is Map) {
      return value.values.any((item) => item != null && item != false && item != '');
    }
    return true;
  }

  FilterState copy() => FilterState(
        marketplace: marketplace,
        category: category,
        subcategory: subcategory,
        operation: operation,
        availability: availability,
        currency: currency,
        values: Map<String, dynamic>.from(values),
      );

  void clear() {
    operation = null;
    category = null;
    subcategory = null;
    availability = null;
    values.clear();
  }

  void setValue(String key, dynamic value) {
    if (privateFilterKeys.contains(key)) return;
    if (key == 'operation') {
      operation = value?.toString();
      return;
    }
    if (key == 'category') {
      category = value?.toString();
      values.removeWhere((k, _) => k == 'subcategory');
      return;
    }
    if (key == 'subcategory') {
      subcategory = value?.toString();
      return;
    }
    if (key == 'availability') {
      availability = value?.toString();
      return;
    }
    if (value == null || value == false || value == '') {
      values.remove(key);
      return;
    }
    values[key] = value;
  }

  dynamic valueOf(String key) {
    if (key == 'operation') return operation;
    if (key == 'category') return category;
    if (key == 'subcategory') return subcategory;
    if (key == 'availability') return availability;
    return values[key];
  }

  void remove(String key) => setValue(key, null);

  /// Public query string. Never includes private user fields or raw GPS of a home.
  Map<String, String> toQueryParameters() {
    final params = <String, String>{};
    if (marketplace != null) params['marketplace'] = marketplace!;
    if (category != null) params['category'] = category!;
    if (subcategory != null) params['subcategory'] = subcategory!;
    if (operation != null) params['operation'] = operation!;
    if (availability != null) params['availability'] = availability!;
    for (final entry in values.entries) {
      if (privateFilterKeys.contains(entry.key)) continue;
      if (entry.key == 'lat' || entry.key == 'lng') continue;
      final value = entry.value;
      if (value is Map) {
        if (entry.key == 'price') {
          if (value['min'] != null) params['minPrice'] = '${value['min']}';
          if (value['max'] != null) params['maxPrice'] = '${value['max']}';
          if (value['currency'] != null) params['currency'] = '${value['currency']}';
        } else {
          if (value['min'] != null) params['${entry.key}Min'] = '${value['min']}';
          if (value['max'] != null) params['${entry.key}Max'] = '${value['max']}';
        }
        if (value['cityId'] != null) params['cityId'] = '${value['cityId']}';
        if (value['radiusKm'] != null) params['radiusKm'] = '${value['radiusKm']}';
        if (value['countryId'] != null) params['countryId'] = '${value['countryId']}';
        if (value['regionId'] != null) params['regionId'] = '${value['regionId']}';
        if (value['areaId'] != null) params['areaId'] = '${value['areaId']}';
      } else if (value is List) {
        params[entry.key] = value.join(',');
      } else if (_isActive(value)) {
        params[entry.key] = '$value';
      }
    }
    return params;
  }

  Map<String, dynamic> toDsl() {
    final filters = <String, dynamic>{};
    final location = Map<String, dynamic>.from(values['location'] as Map? ?? {});
    for (final entry in values.entries) {
      if (privateFilterKeys.contains(entry.key)) continue;
      if (entry.key == 'location' || entry.key == 'price') continue;
      if (entry.key == 'lat' || entry.key == 'lng') continue;
      if (_geoKeys.contains(entry.key)) {
        location[entry.key] = num.tryParse('${entry.value}') ?? entry.value;
        continue;
      }
      final value = entry.value;
      if (value is Map && (value.containsKey('min') || value.containsKey('max'))) {
        if (value['min'] != null) filters[_minKey(entry.key)] = value['min'];
        if (value['max'] != null) filters[_maxKey(entry.key)] = value['max'];
        if (value['unit'] != null) filters['areaUnit'] = value['unit'];
      } else {
        filters[entry.key] = value;
      }
    }
    return {
      'marketplace': marketplace,
      'category': category,
      'operation': operation,
      'availability': availability,
      'filters': filters,
      if (values['price'] is Map) 'price': values['price'],
      if (location.isNotEmpty) 'location': location,
    };
  }

  static String _minKey(String key) => key.endsWith('Min') ? key : '${key}Min';
  static String _maxKey(String key) => key.endsWith('Max') ? key : key.endsWith('Min') ? key.replaceAll('Min', 'Max') : '${key}Max';

  factory FilterState.fromQueryParameters(Map<String, String> params, {String? marketplace}) {
    final state = FilterState(marketplace: params['marketplace'] ?? marketplace);
    for (final entry in params.entries) {
      if (privateFilterKeys.contains(entry.key)) continue;
      if (!_publicKeys.contains(entry.key) && entry.key.length > 64) continue;
      switch (entry.key) {
        case 'marketplace':
          state.marketplace = entry.value;
        case 'category':
          state.category = entry.value;
        case 'subcategory':
          state.subcategory = entry.value;
        case 'operation':
          state.operation = entry.value;
        case 'availability':
          state.availability = entry.value;
        case 'minPrice':
        case 'maxPrice':
        case 'priceMin':
        case 'priceMax':
          final price = Map<String, dynamic>.from(state.values['price'] as Map? ?? {});
          if (entry.key == 'minPrice' || entry.key == 'priceMin') {
            price['min'] = double.tryParse(entry.value);
          }
          if (entry.key == 'maxPrice' || entry.key == 'priceMax') {
            price['max'] = double.tryParse(entry.value);
          }
          if (params['currency'] != null) price['currency'] = params['currency'];
          state.values['price'] = price;
        case 'currency':
          state.currency = entry.value;
        case 'cityId':
        case 'regionId':
        case 'countryId':
        case 'areaId':
        case 'radiusKm':
          final location = Map<String, dynamic>.from(state.values['location'] as Map? ?? {});
          location[entry.key] = num.tryParse(entry.value) ?? entry.value;
          state.values['location'] = location;
        default:
          if (entry.value.contains(',')) {
            state.values[entry.key] = entry.value.split(',');
          } else if (entry.value == 'true' || entry.value == 'false') {
            state.values[entry.key] = entry.value == 'true';
          } else {
            state.values[entry.key] = num.tryParse(entry.value) ?? entry.value;
          }
      }
    }
    return state;
  }

  ListingFeedQuery toListingFeedQuery(ListingFeedQuery base) {
    final q = base.copy();
    q.marketplace = marketplace ?? q.marketplace;
    q.operation = operation;
    final price = values['price'];
    if (price is Map) {
      q.priceMin = (price['min'] as num?)?.toDouble();
      q.priceMax = (price['max'] as num?)?.toDouble();
    }
    q.verifiedSeller = values['verifiedSeller'] == true;
    q.withPhotos = values['withPhotos'] == true;
    q.featuredOnly = values['featuredOnly'] == true;
    q.karat = values['karat'] is List
        ? ((values['karat'] as List).isEmpty ? null : (values['karat'] as List).first.toString())
        : values['karat']?.toString();
    q.form = values['form']?.toString();
    q.hallmarked = values['hallmarked'] == true;
    q.certified = values['certified'] == true;
    q.investmentGrade = values['investmentGrade'] == true;
    q.antique = values['antique'] == true;
    q.scrap = values['scrap'] == true;
    q.brandId = int.tryParse('${values['brandId'] ?? ''}');
    q.sellerType = values['sellerType']?.toString();
    final weight = values['weightMin'];
    if (weight is Map) {
      q.weightMin = (weight['min'] as num?)?.toDouble();
      q.weightMax = (weight['max'] as num?)?.toDouble();
    }
    q.propertyKind = values['propertyKind']?.toString();
    q.usageType = values['usageType']?.toString();
    q.bedroomsMin = (values['bedroomsMin'] as num?)?.toInt();
    q.bathroomsMin = (values['bathroomsMin'] as num?)?.toInt();
    final area = values['areaMin'];
    if (area is Map) {
      q.areaMin = (area['min'] as num?)?.toDouble();
      q.areaMax = (area['max'] as num?)?.toDouble();
    }
    q.areaUnit = values['areaUnit']?.toString();
    q.furnishing = values['furnishing']?.toString();
    q.swimmingPool = values['swimmingPool'] == true;
    q.gym = values['gym'] == true;
    q.garden = values['garden'] == true;
    q.balcony = values['balcony'] == true;
    q.elevator = values['elevator'] == true;
    q.gatedCommunity = values['gatedCommunity'] == true;
    q.vehicleType = values['vehicleType']?.toString();
    q.makeId = int.tryParse('${values['makeId'] ?? ''}');
    q.modelId = int.tryParse('${values['modelId'] ?? ''}');
    final year = values['yearMin'];
    if (year is Map) {
      q.yearMin = (year['min'] as num?)?.toInt();
      q.yearMax = (year['max'] as num?)?.toInt();
    } else {
      q.yearMin = (values['yearMin'] as num?)?.toInt();
      q.yearMax = (values['yearMax'] as num?)?.toInt();
    }
    q.mileageMax = (values['mileageMax'] as num?)?.toInt();
    q.fuelType = values['fuelType'] is List
        ? ((values['fuelType'] as List).isEmpty ? null : (values['fuelType'] as List).first.toString())
        : values['fuelType']?.toString();
    q.transmission = values['transmission'] is List
        ? ((values['transmission'] as List).isEmpty
            ? null
            : (values['transmission'] as List).first.toString())
        : values['transmission']?.toString();
    q.bodyType = values['bodyType']?.toString();
    q.inspected = values['inspected'] == true;
    q.financeAvailable = values['financeAvailable'] == true;
    final location = values['location'];
    q.cityId = int.tryParse('${values['cityId'] ?? (location is Map ? location['cityId'] : '') ?? ''}');
    return q;
  }

  factory FilterState.fromListingFeedQuery(ListingFeedQuery q) {
    final state = FilterState(marketplace: q.marketplace, operation: q.operation);
    void put(String key, dynamic value) {
      if (value == null || value == false) return;
      state.values[key] = value;
    }

    if (q.priceMin != null || q.priceMax != null) {
      state.values['price'] = {'min': q.priceMin, 'max': q.priceMax};
    }
    put('verifiedSeller', q.verifiedSeller);
    put('withPhotos', q.withPhotos);
    put('featuredOnly', q.featuredOnly);
    put('karat', q.karat);
    put('form', q.form);
    put('hallmarked', q.hallmarked);
    put('certified', q.certified);
    put('investmentGrade', q.investmentGrade);
    put('antique', q.antique);
    put('scrap', q.scrap);
    put('brandId', q.brandId);
    put('sellerType', q.sellerType);
    if (q.weightMin != null || q.weightMax != null) {
      state.values['weightMin'] = {'min': q.weightMin, 'max': q.weightMax};
    }
    put('propertyKind', q.propertyKind);
    put('usageType', q.usageType);
    put('bedroomsMin', q.bedroomsMin);
    put('bathroomsMin', q.bathroomsMin);
    if (q.areaMin != null || q.areaMax != null) {
      state.values['areaMin'] = {'min': q.areaMin, 'max': q.areaMax, 'unit': q.areaUnit};
    }
    put('areaUnit', q.areaUnit);
    put('furnishing', q.furnishing);
    put('swimmingPool', q.swimmingPool);
    put('gym', q.gym);
    put('garden', q.garden);
    put('balcony', q.balcony);
    put('elevator', q.elevator);
    put('gatedCommunity', q.gatedCommunity);
    put('vehicleType', q.vehicleType);
    put('makeId', q.makeId);
    put('modelId', q.modelId);
    if (q.yearMin != null || q.yearMax != null) {
      state.values['yearMin'] = {'min': q.yearMin, 'max': q.yearMax};
    }
    put('mileageMax', q.mileageMax);
    put('fuelType', q.fuelType);
    put('transmission', q.transmission);
    put('bodyType', q.bodyType);
    put('inspected', q.inspected);
    put('financeAvailable', q.financeAvailable);
    if (q.cityId != null) {
      state.values['cityId'] = q.cityId;
      state.values['location'] = {'cityId': q.cityId};
    }
    return state;
  }
}
