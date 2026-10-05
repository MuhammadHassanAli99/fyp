class CompareCell {
  const CompareCell({
    required this.display,
    this.raw,
    this.isBest = false,
  });

  final String display;
  final dynamic raw;
  final bool isBest;

  bool get isTruthy {
    if (raw is bool) return raw as bool;
    final t = display.trim().toLowerCase();
    return t == 'yes' || t == 'true' || t == '1' || t == '✓' || t == 'check';
  }

  bool get isFalsy {
    if (raw is bool) return !(raw as bool);
    final t = display.trim().toLowerCase();
    return t == 'no' || t == 'false' || t == '0' || t == '✗' || t == 'x';
  }

  bool get isBooleanLike => isTruthy || isFalsy;
}

class CompareField {
  const CompareField({
    required this.key,
    required this.label,
    required this.values,
    this.group,
    this.differs = true,
    this.kind,
  });

  final String key;
  final String label;
  final String? group;
  final bool differs;
  final String? kind;
  final List<CompareCell> values;
}

class CompareItem {
  const CompareItem({
    required this.id,
    required this.title,
    this.price,
    this.currency,
    this.imageUrl,
    this.conditionCode,
    this.details = const {},
    this.rating,
    this.reviewCount,
  });

  factory CompareItem.fromJson(Map<String, dynamic> json) {
    final detailsRaw = json['details'];
    final details = detailsRaw is Map
        ? Map<String, dynamic>.from(detailsRaw)
        : <String, dynamic>{};
    final seller = json['seller'];
    double? rating;
    int? reviewCount;
    if (seller is Map) {
      rating = (seller['rating'] as num?)?.toDouble();
      reviewCount = (seller['reviewCount'] as num?)?.toInt();
    }
    return CompareItem(
      id: (json['id'] ?? json['uuid'] ?? '').toString(),
      title: json['title'] as String? ?? '',
      price: (json['price'] as num?)?.toDouble(),
      currency: json['currency'] as String?,
      imageUrl: (json['primaryImage'] ?? json['imageUrl'] ?? json['thumbnailUrl'])
          ?.toString(),
      conditionCode: json['conditionCode'] as String?,
      details: details,
      rating: rating,
      reviewCount: reviewCount,
    );
  }

  final String id;
  final String title;
  final double? price;
  final String? currency;
  final String? imageUrl;
  final String? conditionCode;
  final Map<String, dynamic> details;
  final double? rating;
  final int? reviewCount;

  String? detail(String key) {
    final v = details[key];
    return v?.toString();
  }
}

class ComparisonModel {
  const ComparisonModel({
    required this.id,
    required this.marketplace,
    required this.listingIds,
    this.listingTitles = const [],
    this.items = const [],
    this.fields = const [],
    this.groups = const [],
    this.aiSummary,
    this.aiRecommendation,
    this.aiDifferences = const [],
    this.aiProsCons = const {},
    this.aiEligible = false,
    this.updatedAt,
  });

  factory ComparisonModel.fromJson(Map<String, dynamic> json) {
    final items = (json['items'] as List? ?? [])
        .whereType<Map>()
        .map((e) => CompareItem.fromJson(Map<String, dynamic>.from(e)))
        .toList();

    final listingIds = items.isNotEmpty
        ? items.map((e) => e.id).toList()
        : (json['listingIds'] as List? ?? []).map((e) => e.toString()).toList();

    final listingTitles = items.isNotEmpty
        ? items.map((e) => e.title).toList()
        : (json['listingTitles'] as List? ?? [])
            .map((e) => e.toString())
            .toList();

    final rows = (json['rows'] as List? ?? json['fields'] as List? ?? [])
        .whereType<Map>()
        .map((raw) {
          final m = Map<String, dynamic>.from(raw);
          final valuesRaw = m['values'] as List? ?? [];
          final values = valuesRaw.map((v) {
            if (v is Map) {
              final cell = Map<String, dynamic>.from(v);
              return CompareCell(
                display: (cell['display'] ?? cell['raw'] ?? '—').toString(),
                raw: cell['raw'],
                isBest: cell['isBest'] as bool? ?? false,
              );
            }
            return CompareCell(display: v?.toString() ?? '—');
          }).toList();

          return CompareField(
            key: (m['code'] ?? m['key'] ?? '').toString(),
            label: (m['label'] ?? m['code'] ?? '').toString(),
            group: m['group'] as String?,
            differs: m['differs'] as bool? ?? true,
            kind: m['kind'] as String?,
            values: values,
          );
        })
        .toList();

    final groups = (json['groups'] as List? ?? [])
        .map((e) => e.toString())
        .where((e) => e.isNotEmpty)
        .toList();

    final ai = json['aiVerdict'];
    String? aiSummary;
    String? aiRecommendation;
    List<String> aiDifferences = const [];
    Map<String, CompareProsCons> aiProsCons = const {};

    if (ai is Map) {
      final map = Map<String, dynamic>.from(ai);
      aiSummary = map['summary'] as String?;
      aiRecommendation = map['recommendation'] as String?;
      aiDifferences = (map['differences'] as List? ?? [])
          .map((e) => e.toString())
          .toList();
      final prosConsRaw = map['prosCons'];
      if (prosConsRaw is Map) {
        aiProsCons = prosConsRaw.map((key, value) {
          final entry = value is Map
              ? Map<String, dynamic>.from(value)
              : <String, dynamic>{};
          return MapEntry(
            key.toString(),
            CompareProsCons(
              pros: (entry['pros'] as List? ?? []).map((e) => e.toString()).toList(),
              cons: (entry['cons'] as List? ?? []).map((e) => e.toString()).toList(),
            ),
          );
        });
      }
    } else if (ai is String) {
      aiSummary = ai;
    }

    return ComparisonModel(
      id: (json['uuid'] ?? json['id'] ?? '').toString(),
      marketplace: json['marketplaceCode'] as String? ??
          json['marketplace'] as String? ??
          '',
      listingIds: listingIds,
      listingTitles: listingTitles,
      items: items,
      fields: rows,
      groups: groups.isNotEmpty
          ? groups
          : rows
              .map((r) => r.group)
              .whereType<String>()
              .toSet()
              .toList(),
      aiSummary: aiSummary,
      aiRecommendation: aiRecommendation,
      aiDifferences: aiDifferences,
      aiProsCons: aiProsCons,
      aiEligible: json['aiEligible'] as bool? ?? false,
      updatedAt: json['updatedAt'] != null
          ? DateTime.tryParse(json['updatedAt'] as String)
          : null,
    );
  }

  final String id;
  final String marketplace;
  final List<String> listingIds;
  final List<String> listingTitles;
  final List<CompareItem> items;
  final List<CompareField> fields;
  final List<String> groups;
  final String? aiSummary;
  final String? aiRecommendation;
  final List<String> aiDifferences;
  final Map<String, CompareProsCons> aiProsCons;
  final bool aiEligible;
  final DateTime? updatedAt;

  /// Back-compat for screens that still read [aiVerdict].
  String? get aiVerdict {
    if (aiSummary == null && aiRecommendation == null) return null;
    return [aiSummary, aiRecommendation].whereType<String>().join('\n\n');
  }

  ComparisonModel copyWith({
    String? aiSummary,
    String? aiRecommendation,
    List<String>? aiDifferences,
    Map<String, CompareProsCons>? aiProsCons,
  }) {
    return ComparisonModel(
      id: id,
      marketplace: marketplace,
      listingIds: listingIds,
      listingTitles: listingTitles,
      items: items,
      fields: fields,
      groups: groups,
      aiSummary: aiSummary ?? this.aiSummary,
      aiRecommendation: aiRecommendation ?? this.aiRecommendation,
      aiDifferences: aiDifferences ?? this.aiDifferences,
      aiProsCons: aiProsCons ?? this.aiProsCons,
      aiEligible: aiEligible,
      updatedAt: updatedAt,
    );
  }
}

class CompareProsCons {
  const CompareProsCons({this.pros = const [], this.cons = const []});
  final List<String> pros;
  final List<String> cons;
}

/// Pair suggestion for “comparisons with similar cars”.
class CompareSuggestionPair {
  const CompareSuggestionPair({
    required this.left,
    required this.right,
    required this.anchorTitle,
  });

  final CompareItem left;
  final CompareItem right;
  final String anchorTitle;
}
