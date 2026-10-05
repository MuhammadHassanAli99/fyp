class FilterOption {
  const FilterOption({required this.value, required this.label, this.count});

  factory FilterOption.fromJson(Map<String, dynamic> json) => FilterOption(
        value: (json['value'] ?? '').toString(),
        label: (json['label'] ?? json['value'] ?? '').toString(),
        count: (json['count'] as num?)?.toInt(),
      );

  final String value;
  final String label;
  final int? count;
}

class FilterDefinition {
  const FilterDefinition({
    required this.key,
    required this.label,
    required this.type,
    this.marketplace,
    this.category,
    this.subcategory,
    this.dataSource,
    this.allowedValues = const [],
    this.min,
    this.max,
    this.step,
    this.unit,
    this.currency,
    this.dependsOn,
    this.visibility = 'always',
    this.sortOrder = 100,
  });

  factory FilterDefinition.fromJson(Map<String, dynamic> json) => FilterDefinition(
        key: (json['key'] ?? '').toString(),
        label: (json['label'] ?? json['key'] ?? '').toString(),
        type: (json['type'] ?? 'text').toString(),
        marketplace: json['marketplace']?.toString(),
        category: json['category']?.toString(),
        subcategory: json['subcategory']?.toString(),
        dataSource: json['dataSource']?.toString(),
        allowedValues: (json['allowedValues'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => FilterOption.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        min: (json['min'] as num?)?.toDouble(),
        max: (json['max'] as num?)?.toDouble(),
        step: (json['step'] as num?)?.toDouble(),
        unit: json['unit']?.toString(),
        currency: json['currency']?.toString(),
        dependsOn: json['dependsOn']?.toString(),
        visibility: (json['visibility'] ?? 'always').toString(),
        sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 100,
      );

  final String key;
  final String label;
  final String type;
  final String? marketplace;
  final String? category;
  final String? subcategory;
  final String? dataSource;
  final List<FilterOption> allowedValues;
  final double? min;
  final double? max;
  final double? step;
  final String? unit;
  final String? currency;
  final String? dependsOn;
  final String visibility;
  final int sortOrder;

  bool get isDependent => dependsOn != null && dependsOn!.isNotEmpty;
}

class FilterLookupItem {
  const FilterLookupItem({required this.value, required this.label, this.parentValue});

  factory FilterLookupItem.fromJson(Map<String, dynamic> json) => FilterLookupItem(
        value: (json['value'] ?? json['id'] ?? '').toString(),
        label: (json['label'] ?? json['name'] ?? json['value'] ?? '').toString(),
        parentValue: json['parentValue']?.toString(),
      );

  final String value;
  final String label;
  final String? parentValue;
}

class FacetBucket {
  const FacetBucket({required this.value, required this.label, required this.count});

  factory FacetBucket.fromJson(Map<String, dynamic> json) => FacetBucket(
        value: (json['value'] ?? '').toString(),
        label: (json['label'] ?? json['value'] ?? '').toString(),
        count: (json['count'] as num?)?.toInt() ?? 0,
      );

  final String value;
  final String label;
  final int count;
}

class FacetGroup {
  const FacetGroup({required this.key, required this.label, this.buckets = const []});

  factory FacetGroup.fromJson(Map<String, dynamic> json) => FacetGroup(
        key: (json['key'] ?? '').toString(),
        label: (json['label'] ?? json['key'] ?? '').toString(),
        buckets: (json['buckets'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => FacetBucket.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
      );

  final String key;
  final String label;
  final List<FacetBucket> buckets;
}

const privateFilterKeys = {
  'ownerId',
  'userId',
  'sellerId',
  'fraudStatus',
  'fraudScore',
  'moderationStatus',
  'moderationNotes',
  'vin',
  'exactLatitude',
  'exactLongitude',
  'email',
  'phone',
  'guestUuid',
};
