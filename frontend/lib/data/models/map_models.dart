import 'filter_models.dart';

class MapCapabilities {
  const MapCapabilities({
    this.map = true,
    this.satellite = false,
    this.hybrid = false,
    this.streetView = false,
    this.directions = false,
    this.places = false,
    this.geocoding = false,
    this.reverseGeocoding = false,
    this.distance = false,
    this.radiusSearch = false,
  });

  factory MapCapabilities.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const MapCapabilities();
    bool flag(String key) => json[key] == true;
    return MapCapabilities(
      map: flag('map'),
      satellite: flag('satellite'),
      hybrid: flag('hybrid'),
      streetView: flag('streetView'),
      directions: flag('directions'),
      places: flag('places'),
      geocoding: flag('geocoding'),
      reverseGeocoding: flag('reverseGeocoding'),
      distance: flag('distance'),
      radiusSearch: flag('radiusSearch'),
    );
  }

  final bool map;
  final bool satellite;
  final bool hybrid;
  final bool streetView;
  final bool directions;
  final bool places;
  final bool geocoding;
  final bool reverseGeocoding;
  final bool distance;
  final bool radiusSearch;
}

class MapProviderInfo {
  const MapProviderInfo({
    required this.code,
    required this.name,
    this.tileUrl,
    this.satelliteTileUrl,
    this.hybridTileUrl,
    this.attribution,
    this.capabilities = const MapCapabilities(),
    this.isDefault = false,
  });

  factory MapProviderInfo.fromJson(Map<String, dynamic> json) => MapProviderInfo(
        code: (json['code'] ?? 'openstreetmap').toString(),
        name: (json['name'] ?? json['code'] ?? 'Map').toString(),
        tileUrl: json['tileUrl']?.toString(),
        satelliteTileUrl: json['satelliteTileUrl']?.toString(),
        hybridTileUrl: json['hybridTileUrl']?.toString(),
        attribution: json['attribution']?.toString(),
        capabilities: MapCapabilities.fromJson(
          json['capabilities'] is Map ? Map<String, dynamic>.from(json['capabilities'] as Map) : null,
        ),
        isDefault: json['isDefault'] == true,
      );

  final String code;
  final String name;
  final String? tileUrl;
  final String? satelliteTileUrl;
  final String? hybridTileUrl;
  final String? attribution;
  final MapCapabilities capabilities;
  final bool isDefault;
}

class MapDescriptor {
  const MapDescriptor({
    required this.provider,
    required this.capabilities,
    this.styleOptions = const ['standard'],
    this.providers = const [],
    this.streetViewDisclaimer,
  });

  factory MapDescriptor.fromJson(Map<String, dynamic> json) {
    final providerRaw = json['provider'];
    return MapDescriptor(
      provider: MapProviderInfo.fromJson(
        providerRaw is Map ? Map<String, dynamic>.from(providerRaw) : const {'code': 'openstreetmap'},
      ),
      capabilities: MapCapabilities.fromJson(
        json['capabilities'] is Map ? Map<String, dynamic>.from(json['capabilities'] as Map) : null,
      ),
      styleOptions: (json['styleOptions'] as List? ?? const ['standard']).map((e) => e.toString()).toList(),
      providers: (json['providers'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => MapProviderInfo.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      streetViewDisclaimer: json['streetViewDisclaimer']?.toString(),
    );
  }

  final MapProviderInfo provider;
  final MapCapabilities capabilities;
  final List<String> styleOptions;
  final List<MapProviderInfo> providers;
  final String? streetViewDisclaimer;
}

class DistanceValue {
  const DistanceValue({required this.value, required this.unit, this.meters});

  factory DistanceValue.fromJson(Map<String, dynamic> json) => DistanceValue(
        value: (json['value'] as num?)?.toDouble() ?? 0,
        unit: (json['unit'] ?? 'km').toString(),
        meters: (json['meters'] as num?)?.toDouble(),
      );

  final double value;
  final String unit;
  final double? meters;

  String get label => unit == 'm' ? '${value.round()} m' : '$value $unit';
}

class MapMarkerItem {
  const MapMarkerItem({
    required this.kind,
    required this.latitude,
    required this.longitude,
    this.id,
    this.listingId,
    this.title,
    this.count = 1,
    this.approximate = false,
    this.marketplace,
    this.price,
    this.currency,
    this.attributes = const {},
  });

  factory MapMarkerItem.fromJson(Map<String, dynamic> json) => MapMarkerItem(
        kind: (json['kind'] ?? 'listing').toString(),
        id: json['id']?.toString(),
        listingId: (json['listingId'] as num?)?.toInt(),
        latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
        longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
        title: json['title']?.toString(),
        count: (json['count'] as num?)?.toInt() ?? 1,
        approximate: json['approximate'] == true,
        marketplace: json['marketplace']?.toString(),
        price: (json['price'] as num?)?.toDouble(),
        currency: json['currency']?.toString(),
        attributes: json['attributes'] is Map
            ? Map<String, dynamic>.from(json['attributes'] as Map)
            : const {},
      );

  final String kind;
  final String? id;
  final int? listingId;
  final double latitude;
  final double longitude;
  final String? title;
  final int count;
  final bool approximate;
  final String? marketplace;
  final double? price;
  final String? currency;
  final Map<String, dynamic> attributes;

  bool get isCluster => kind == 'cluster' || count > 1 && listingId == null;
}

class MapSearchPage {
  const MapSearchPage({
    this.items = const [],
    this.total = 0,
    this.clustered = false,
    this.dsl,
    this.facets = const [],
  });

  factory MapSearchPage.fromJson(Map<String, dynamic> json) => MapSearchPage(
        items: (json['items'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => MapMarkerItem.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        total: (json['total'] as num?)?.toInt() ?? 0,
        clustered: json['clustered'] == true,
        dsl: json['dsl'] is Map ? Map<String, dynamic>.from(json['dsl'] as Map) : null,
        facets: (json['facets'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => FacetGroup.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
      );

  final List<MapMarkerItem> items;
  final int total;
  final bool clustered;
  final Map<String, dynamic>? dsl;
  final List<FacetGroup> facets;
}

class NearbyPlace {
  const NearbyPlace({
    required this.id,
    required this.type,
    required this.name,
    required this.latitude,
    required this.longitude,
    this.distance,
  });

  factory NearbyPlace.fromJson(Map<String, dynamic> json) => NearbyPlace(
        id: (json['id'] ?? '').toString(),
        type: (json['type'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
        longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
        distance: json['distance'] is Map
            ? DistanceValue.fromJson(Map<String, dynamic>.from(json['distance'] as Map))
            : null,
      );

  final String id;
  final String type;
  final String name;
  final double latitude;
  final double longitude;
  final DistanceValue? distance;
}

class GeocodeResult {
  const GeocodeResult({
    required this.query,
    this.latitude,
    this.longitude,
    this.cityName,
    this.cityId,
    this.areaName,
    this.areaId,
    this.countryId,
    this.precision = 'none',
  });

  factory GeocodeResult.fromJson(Map<String, dynamic> json) {
    final city = json['city'];
    final area = json['area'];
    final country = json['country'];
    return GeocodeResult(
      query: (json['query'] ?? '').toString(),
      latitude: (json['latitude'] as num?)?.toDouble(),
      longitude: (json['longitude'] as num?)?.toDouble(),
      cityName: city is Map ? city['name']?.toString() : null,
      cityId: city is Map ? (city['id'] as num?)?.toInt() : null,
      areaName: area is Map ? area['name']?.toString() : null,
      areaId: area is Map ? (area['id'] as num?)?.toInt() : null,
      countryId: country is Map ? (country['id'] as num?)?.toInt() : null,
      precision: (json['precision'] ?? 'none').toString(),
    );
  }

  final String query;
  final double? latitude;
  final double? longitude;
  final String? cityName;
  final int? cityId;
  final String? areaName;
  final int? areaId;
  final int? countryId;
  final String precision;
}

/// Client-side fallback when the server returns unclustered points.
/// Server-side geohash clustering is preferred; this keeps Flutter memory bounded.
List<MapMarkerItem> clusterClientSide(
  List<MapMarkerItem> items, {
  required double zoom,
  int maxMarkers = 200,
}) {
  if (items.length <= 40 || zoom >= 14) {
    return items.take(maxMarkers).toList();
  }
  final cell = zoom >= 12 ? 0.05 : zoom >= 10 ? 0.1 : 0.25;
  final buckets = <String, List<MapMarkerItem>>{};
  for (final item in items) {
    if (item.isCluster) {
      buckets['cluster:${item.id}'] = [item];
      continue;
    }
    final key =
        '${(item.latitude / cell).floor()}:${(item.longitude / cell).floor()}';
    (buckets[key] ??= []).add(item);
  }
  return buckets.entries.map((entry) {
    final group = entry.value;
    if (group.length == 1) return group.first;
    var lat = 0.0;
    var lng = 0.0;
    var count = 0;
    for (final marker in group) {
      lat += marker.latitude;
      lng += marker.longitude;
      count += marker.count;
    }
    return MapMarkerItem(
      kind: 'cluster',
      id: entry.key,
      latitude: lat / group.length,
      longitude: lng / group.length,
      count: count,
    );
  }).take(maxMarkers).toList();
}

