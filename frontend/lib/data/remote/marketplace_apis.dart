import '../../core/network/api_client.dart';
import '../models/property_models.dart';
import '../models/vehicle_models.dart';

class NamedOption {
  const NamedOption({required this.id, required this.name, this.code});
  factory NamedOption.fromJson(Map<String, dynamic> json) => NamedOption(
        id: (json['id'] ?? json['code'] ?? '').toString(),
        name: (json['name'] ?? json['label'] ?? json['code'] ?? '').toString(),
        code: json['code']?.toString(),
      );
  final String id;
  final String name;
  final String? code;
  int? get intId => int.tryParse(id);
}

class PropertyApi {
  PropertyApi(this._client);
  final ApiClient _client;

  Future<List<AmenityGroup>> amenities() => _client.get(
        '/property/amenities',
        parser: (d) {
          if (d is! List) return <AmenityGroup>[];
          return d
              .map((e) => AmenityGroup.fromJson(e as Map<String, dynamic>))
              .toList();
        },
      );

  Future<List<NamedOption>> areaUnits() => _client.get(
        '/property/area-units',
        parser: (d) {
          final raw = d is Map ? (d['units'] ?? d['items']) : d;
          if (raw is! List) return <NamedOption>[];
          return raw
              .map((e) {
                final map = e as Map<String, dynamic>;
                return NamedOption(
                  id: (map['code'] ?? map['id'] ?? '').toString(),
                  name: (map['name'] ?? map['symbol'] ?? map['code'] ?? '')
                      .toString(),
                  code: map['code']?.toString(),
                );
              })
              .toList();
        },
      );

  Future<PropertyCatalog> catalog() => _client.get(
        '/property/catalog',
        parser: (d) => PropertyCatalog.fromJson(d as Map<String, dynamic>),
      );

  Future<ParsedPropertyQuery> parseQuery(String q) => _client.get(
        '/property/search/parse',
        queryParameters: {'q': q},
        parser: (d) => ParsedPropertyQuery.fromJson(d as Map<String, dynamic>),
      );

  Future<List<PropertyMapMarker>> markers({
    required double minLat,
    required double maxLat,
    required double minLng,
    required double maxLng,
  }) =>
      _client.get(
        '/property/maps/markers',
        queryParameters: {
          'minLat': minLat,
          'maxLat': maxLat,
          'minLng': minLng,
          'maxLng': maxLng,
        },
        parser: (d) {
          final list = d is List ? d : (d is Map ? d['items'] : null);
          if (list is! List) return <PropertyMapMarker>[];
          return list
              .whereType<Map>()
              .map(
                (e) => PropertyMapMarker.fromJson(Map<String, dynamic>.from(e)),
              )
              .toList();
        },
      );

  Future<Map<String, dynamic>> publicLocation(String listingId) => _client.get(
        '/property/listings/$listingId/location',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> badges(String listingId) => _client.get(
        '/property/listings/$listingId/badges',
        parser: (d) => Map<String, dynamic>.from(d as Map? ?? const {}),
      );

  Future<PropertyValuation> valuate(Map<String, dynamic> body) => _client.post(
        '/property/ai/valuate',
        data: body,
        parser: (d) => PropertyValuation.fromJson(d as Map<String, dynamic>),
      );

  Future<Map<String, dynamic>> createOffer(
    String listingId, {
    required double amount,
    String? currency,
    String? message,
    String? conditions,
    double? depositAmount,
  }) =>
      _client.post(
        '/property/listings/$listingId/offers',
        data: {
          'amount': amount,
          'currency': ?currency,
          'message': ?message,
          'conditions': ?conditions,
          'depositAmount': ?depositAmount,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> buy(
    String listingId, {
    String gatewayCode = 'manual',
    int? offerId,
  }) =>
      _client.post(
        '/property/listings/$listingId/buy',
        data: {
          'gatewayCode': gatewayCode,
          'offerId': ?offerId,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> apply(
    String listingId, {
    String? message,
    int? occupants,
    String? desiredStart,
  }) =>
      _client.post(
        '/property/listings/$listingId/apply',
        data: {
          'message': ?message,
          'occupants': ?occupants,
          'desiredStart': ?desiredStart,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> book(
    String listingId, {
    required String checkIn,
    required String checkOut,
    int guests = 1,
    String gatewayCode = 'manual',
  }) =>
      _client.post(
        '/property/listings/$listingId/book',
        data: {
          'checkIn': checkIn,
          'checkOut': checkOut,
          'guests': guests,
          'gatewayCode': gatewayCode,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> availability(String listingId) => _client.get(
        '/property/listings/$listingId/availability',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<List<SavedSearchItem>> savedSearches() => _client.get(
        '/search/saved',
        parser: (d) {
          if (d is! List) return <SavedSearchItem>[];
          return d
              .whereType<Map>()
              .map((e) => SavedSearchItem.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<SavedSearchItem> saveSearch({
    required String name,
    required Map<String, dynamic> query,
    int marketplaceId = 2,
    String alertFrequency = 'instant',
  }) =>
      _client.post(
        '/search/saved',
        data: {
          'name': name,
          'marketplaceId': marketplaceId,
          'query': query,
          'alertFrequency': alertFrequency,
          'alertChannel': 'push',
        },
        parser: (d) => SavedSearchItem.fromJson(d as Map<String, dynamic>),
      );

  Future<void> deleteSavedSearch(int id) => _client.delete('/search/saved/$id');
}

class AmenityGroup {
  const AmenityGroup({required this.name, required this.items});
  factory AmenityGroup.fromJson(Map<String, dynamic> json) {
    final itemsRaw = json['amenities'] ?? json['items'] ?? json['options'] ?? [];
    final groupCode =
        (json['groupCode'] ?? json['group'] ?? json['code'])?.toString();
    return AmenityGroup(
      name: (json['name'] ??
              json['label'] ??
              groupCode ??
              'Amenities')
          .toString(),
      items: (itemsRaw as List)
          .map((e) => NamedOption.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
  final String name;
  final List<NamedOption> items;
}

class VehiclesApi {
  VehiclesApi(this._client);
  final ApiClient _client;

  Future<List<NamedOption>> makes({String? vehicleType, bool? popular}) =>
      _client.get(
        '/vehicles/makes',
        queryParameters: {
          'vehicleType': ?vehicleType,
          if (popular == true) 'popular': true,
        },
        parser: (d) {
          if (d is! List) return <NamedOption>[];
          return d
              .map((e) => NamedOption.fromJson(e as Map<String, dynamic>))
              .toList();
        },
      );

  Future<List<NamedOption>> models(int makeId, {String? vehicleType}) =>
      _client.get(
        '/vehicles/makes/$makeId/models',
        queryParameters: {
          'vehicleType': ?vehicleType,
        },
        parser: (d) {
          if (d is! List) return <NamedOption>[];
          return d
              .map((e) => NamedOption.fromJson(e as Map<String, dynamic>))
              .toList();
        },
      );

  Future<List<NamedOption>> features() => _client.get(
        '/vehicles/features',
        parser: (d) {
          if (d is! List) return <NamedOption>[];
          return d
              .map((e) => NamedOption.fromJson(e as Map<String, dynamic>))
              .toList();
        },
      );

  Future<List<VehicleVariantOption>> variants(int modelId, {int? year}) =>
      _client.get(
        '/vehicles/models/$modelId/variants',
        queryParameters: {
          'year': ?year,
        },
        parser: (d) {
          if (d is! List) return <VehicleVariantOption>[];
          return d
              .map(
                (e) =>
                    VehicleVariantOption.fromJson(e as Map<String, dynamic>),
              )
              .toList();
        },
      );

  Future<VehicleCatalog> catalog() => _client.get(
        '/vehicles/catalog',
        parser: (d) => VehicleCatalog.fromJson(d as Map<String, dynamic>),
      );

  Future<ParsedVehicleQuery> parseQuery(String q) => _client.get(
        '/vehicles/search/parse',
        queryParameters: {'q': q},
        parser: (d) => ParsedVehicleQuery.fromJson(d as Map<String, dynamic>),
      );

  Future<List<VehicleMapMarker>> markers({
    required double minLat,
    required double maxLat,
    required double minLng,
    required double maxLng,
  }) =>
      _client.get(
        '/vehicles/maps/markers',
        queryParameters: {
          'minLat': minLat,
          'maxLat': maxLat,
          'minLng': minLng,
          'maxLng': maxLng,
        },
        parser: (d) {
          final list = d is List ? d : (d is Map ? d['items'] : null);
          if (list is! List) return <VehicleMapMarker>[];
          return list
              .whereType<Map>()
              .map(
                (e) => VehicleMapMarker.fromJson(Map<String, dynamic>.from(e)),
              )
              .toList();
        },
      );

  Future<Map<String, dynamic>> badges(String listingId) => _client.get(
        '/vehicles/listings/$listingId/badges',
        parser: (d) => Map<String, dynamic>.from(d as Map? ?? const {}),
      );

  Future<VehicleValuation> valuate(Map<String, dynamic> body) => _client.post(
        '/vehicles/ai/valuate',
        data: body,
        parser: (d) => VehicleValuation.fromJson(d as Map<String, dynamic>),
      );

  Future<Map<String, dynamic>> createOffer(
    String listingId, {
    required double amount,
    String? currency,
    String? message,
  }) =>
      _client.post(
        '/vehicles/listings/$listingId/offers',
        data: {
          'amount': amount,
          'currency': ?currency,
          'message': ?message,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> buy(
    String listingId, {
    String gatewayCode = 'manual',
    int? offerId,
  }) =>
      _client.post(
        '/vehicles/listings/$listingId/buy',
        data: {
          'gatewayCode': gatewayCode,
          'offerId': ?offerId,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> book(
    String listingId, {
    required String startDate,
    required String endDate,
    String? durationCode,
    String gatewayCode = 'manual',
  }) =>
      _client.post(
        '/vehicles/listings/$listingId/book',
        data: {
          'startDate': startDate,
          'endDate': endDate,
          'durationCode': ?durationCode,
          'gatewayCode': gatewayCode,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> placeBid(
    String auctionId, {
    required double amount,
    required String idempotencyKey,
  }) =>
      _client.post(
        '/auctions/$auctionId/bids',
        data: {
          'amount': amount,
          'idempotencyKey': idempotencyKey,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<List<VehiclePart>> searchParts({
    String? q,
    String? oem,
    String? categoryCode,
    int? makeId,
    int? year,
  }) =>
      _client.get(
        '/vehicles/parts',
        queryParameters: {
          'q': ?q,
          'oem': ?oem,
          'categoryCode': ?categoryCode,
          'makeId': ?makeId,
          'year': ?year,
        },
        parser: (d) {
          final list = d is List ? d : (d is Map ? d['items'] : null);
          if (list is! List) return <VehiclePart>[];
          return list
              .whereType<Map>()
              .map((e) => VehiclePart.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<Map<String, dynamic>> buyPart(int partId, {int quantity = 1}) =>
      _client.post(
        '/vehicles/parts/$partId/buy',
        data: {'quantity': quantity, 'gatewayCode': 'manual'},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<VehicleLandedCost> landedCost(Map<String, dynamic> body) =>
      _client.post(
        '/vehicles/trade/landed-cost',
        data: body,
        parser: (d) => VehicleLandedCost.fromJson(d as Map<String, dynamic>),
      );

  Future<VehicleFinanceQuote> financeQuote(Map<String, dynamic> body) =>
      _client.post(
        '/vehicles/finance/quote',
        data: body,
        parser: (d) => VehicleFinanceQuote.fromJson(d as Map<String, dynamic>),
      );

  Future<VehicleInsuranceQuote> insuranceQuote(Map<String, dynamic> body) =>
      _client.post(
        '/vehicles/insurance/quote',
        data: body,
        parser: (d) => VehicleInsuranceQuote.fromJson(d as Map<String, dynamic>),
      );

  Future<List<SavedSearchItem>> savedSearches() => _client.get(
        '/search/saved',
        parser: (d) {
          if (d is! List) return <SavedSearchItem>[];
          return d
              .whereType<Map>()
              .map((e) => SavedSearchItem.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<SavedSearchItem> saveSearch({
    required String name,
    required Map<String, dynamic> query,
    int marketplaceId = 3,
    String alertFrequency = 'instant',
  }) =>
      _client.post(
        '/search/saved',
        data: {
          'name': name,
          'marketplaceId': marketplaceId,
          'query': query,
          'alertFrequency': alertFrequency,
          'alertChannel': 'push',
        },
        parser: (d) => SavedSearchItem.fromJson(d as Map<String, dynamic>),
      );

  Future<void> deleteSavedSearch(int id) => _client.delete('/search/saved/$id');
}

class VehicleVariantOption {
  const VehicleVariantOption({
    required this.id,
    required this.name,
    this.yearFrom,
    this.yearTo,
    this.engineCc,
    this.fuelType,
    this.transmission,
    this.launchPrice,
    this.launchCurrency,
  });

  factory VehicleVariantOption.fromJson(Map<String, dynamic> json) =>
      VehicleVariantOption(
        id: (json['id'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        yearFrom: (json['yearFrom'] as num?)?.toInt(),
        yearTo: (json['yearTo'] as num?)?.toInt(),
        engineCc: (json['engineCc'] as num?)?.toInt(),
        fuelType: json['fuelType']?.toString(),
        transmission: json['transmission']?.toString(),
        launchPrice: (json['launchPrice'] as num?)?.toDouble(),
        launchCurrency: json['launchCurrency']?.toString(),
      );

  final String id;
  final String name;
  final int? yearFrom;
  final int? yearTo;
  final int? engineCc;
  final String? fuelType;
  final String? transmission;
  final double? launchPrice;
  final String? launchCurrency;

  int? get intId => int.tryParse(id);

  String get yearLabel {
    if (yearFrom == null && yearTo == null) return 'All years';
    if (yearFrom != null && yearTo != null && yearFrom != yearTo) {
      return '$yearFrom - $yearTo';
    }
    return '${yearFrom ?? yearTo}';
  }
}
