class AnalyticsQuery {
  const AnalyticsQuery({
    this.marketplace,
    this.companyId,
    this.sellerId,
    this.period = '30d',
    this.from,
    this.to,
    this.funnel,
    this.heatmap,
    this.exportCsv = false,
  });

  final String? marketplace;
  final int? companyId;
  final int? sellerId;
  final String period;
  final String? from;
  final String? to;
  final String? funnel;
  final String? heatmap;
  final bool exportCsv;

  Map<String, dynamic> toQuery() => {
        if (marketplace != null) 'marketplace': marketplace,
        if (companyId != null) 'companyId': companyId,
        if (sellerId != null) 'sellerId': sellerId,
        'period': period,
        if (from != null) 'from': from,
        if (to != null) 'to': to,
        if (funnel != null) 'funnel': funnel,
        if (heatmap != null) 'heatmap': heatmap,
        if (exportCsv) 'export': true,
      };

  AnalyticsQuery copyWith({
    String? marketplace,
    int? companyId,
    String? period,
    bool clearMarketplace = false,
    bool clearCompany = false,
  }) =>
      AnalyticsQuery(
        marketplace: clearMarketplace ? null : marketplace ?? this.marketplace,
        companyId: clearCompany ? null : companyId ?? this.companyId,
        sellerId: sellerId,
        period: period ?? this.period,
        from: from,
        to: to,
        funnel: funnel,
        heatmap: heatmap,
      );
}

class AnalyticsOverview {
  const AnalyticsOverview({
    required this.cards,
    required this.salesSeries,
    required this.usersSeries,
    this.mode,
    this.persona,
    this.canExport = false,
  });

  factory AnalyticsOverview.fromJson(Map<String, dynamic> json) {
    final cards = Map<String, dynamic>.from(json['cards'] as Map? ?? json);
    final series = Map<String, dynamic>.from(json['series'] as Map? ?? const {});
    final scope = Map<String, dynamic>.from(json['scope'] as Map? ?? const {});
    return AnalyticsOverview(
      cards: cards,
      salesSeries: _series(series['sales']),
      usersSeries: _series(series['users']),
      mode: scope['mode']?.toString(),
      persona: scope['persona']?.toString(),
      canExport: json['canExport'] == true,
    );
  }

  final Map<String, dynamic> cards;
  final List<({String date, double value})> salesSeries;
  final List<({String date, double value})> usersSeries;
  final String? mode;
  final String? persona;
  final bool canExport;
}

class AnalyticsFilters {
  const AnalyticsFilters({
    required this.canExport,
    required this.mode,
    required this.persona,
    required this.marketplaces,
  });

  factory AnalyticsFilters.fromJson(Map<String, dynamic> json) => AnalyticsFilters(
        canExport: json['canExport'] == true,
        mode: json['mode']?.toString() ?? 'own',
        persona: json['persona']?.toString() ?? 'individual',
        marketplaces: [
          for (final row in json['marketplaces'] as List? ?? const [])
            if (row is Map && row['allowed'] == true) row['code'].toString(),
        ],
      );

  final bool canExport;
  final String mode;
  final String persona;
  final List<String> marketplaces;
}

List<({String date, double value})> _series(dynamic raw) {
  if (raw is! List) return const [];
  return [
    for (final row in raw)
      if (row is Map)
        (
          date: (row['date'] ?? '').toString(),
          value: ((row['value'] ?? row['gross'] ?? row['revenue'] ?? row['net'] ?? 0) as num)
              .toDouble(),
        ),
  ];
}

double asDouble(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

List<Map<String, dynamic>> asMaps(dynamic value) {
  if (value is! List) return const [];
  return [
    for (final row in value)
      if (row is Map) Map<String, dynamic>.from(row),
  ];
}
