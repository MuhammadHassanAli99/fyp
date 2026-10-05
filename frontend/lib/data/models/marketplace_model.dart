class MarketplaceModel {
  const MarketplaceModel({
    required this.code,
    required this.name,
    this.id,
    this.description,
    this.iconUrl,
    this.operations = const ['sell'],
  });

  factory MarketplaceModel.fromJson(Map<String, dynamic> json) =>
      MarketplaceModel(
        id: (json['id'] as num?)?.toInt(),
        code: (json['code'] ?? '').toString(),
        name: (json['name'] ?? '').toString(),
        description: json['description'] as String? ??
            json['tagline'] as String?,
        iconUrl: json['iconUrl'] as String? ?? json['icon'] as String?,
        operations: (json['operations'] as List?)
                ?.map((e) => e.toString())
                .toList() ??
            const ['sell'],
      );

  final int? id;
  final String code;
  final String name;
  final String? description;
  final String? iconUrl;
  final List<String> operations;

  int get resolvedId =>
      id ??
      switch (code) {
        'gold' => 1,
        'property' => 2,
        'vehicles' => 3,
        _ => 1,
      };
}

class CategoryModel {
  const CategoryModel({
    required this.id,
    required this.name,
    required this.marketplace,
    this.parentId,
    this.code,
    this.slug,
    this.isLeaf = true,
    this.depth = 0,
    this.children = const [],
  });

  factory CategoryModel.fromJson(Map<String, dynamic> json) {
    final childrenRaw = json['children'];
    return CategoryModel(
      id: (json['id'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      marketplace: (json['marketplace'] ?? json['marketplaceCode'] ?? '')
          .toString(),
      parentId: json['parentId']?.toString(),
      code: json['code']?.toString(),
      slug: json['slug']?.toString(),
      isLeaf: json['isLeaf'] as bool? ?? true,
      depth: (json['depth'] as num?)?.toInt() ?? 0,
      children: childrenRaw is List
          ? childrenRaw
              .map((e) => CategoryModel.fromJson(e as Map<String, dynamic>))
              .toList()
          : const [],
    );
  }

  final String id;
  final String name;
  final String marketplace;
  final String? parentId;
  final String? code;
  final String? slug;
  final bool isLeaf;
  final int depth;
  final List<CategoryModel> children;

  int? get intId => int.tryParse(id);

  /// Flatten nested category trees into leaf options with breadcrumb labels.
  static List<({CategoryModel category, String label})> flattenLeaves(
    List<CategoryModel> roots, {
    String prefix = '',
  }) {
    final out = <({CategoryModel category, String label})>[];
    for (final node in roots) {
      final label = prefix.isEmpty ? node.name : '$prefix › ${node.name}';
      if (node.isLeaf || node.children.isEmpty) {
        if (node.isLeaf) out.add((category: node, label: label));
      } else {
        out.addAll(flattenLeaves(node.children, prefix: label));
      }
    }
    return out;
  }
}
