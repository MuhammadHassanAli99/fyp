class SellerQuery {
  const SellerQuery({
    this.marketplace,
    this.companyId,
    this.period = '30d',
    this.status,
    this.page = 1,
    this.perPage = 20,
    this.export = false,
  });

  final String? marketplace;
  final int? companyId;
  final String period;
  final String? status;
  final int page;
  final int perPage;
  final bool export;

  Map<String, dynamic> toQuery() => {
        if (marketplace != null) 'marketplace': marketplace,
        if (companyId != null) 'companyId': companyId,
        'period': period,
        if (status != null) 'status': status,
        'page': page,
        'perPage': perPage,
        if (export) 'export': '1',
      };
}

class SellerCompany {
  const SellerCompany({
    required this.id,
    required this.name,
    required this.kind,
    required this.status,
    required this.verified,
  });

  factory SellerCompany.fromJson(Map<String, dynamic> json) => SellerCompany(
        id: (json['id'] as num?)?.toInt() ?? 0,
        name: json['name']?.toString() ?? '',
        kind: json['kind']?.toString() ?? '',
        status: json['status']?.toString() ?? '',
        verified: json['verified'] == true,
      );

  final int id;
  final String name;
  final String kind;
  final String status;
  final bool verified;
}

class SellerHeader {
  const SellerHeader({
    required this.displayName,
    required this.persona,
    required this.roles,
    required this.companies,
    this.avatarUrl,
    this.accountType,
    this.trustBand,
    this.trustScore,
    this.verificationStatus,
    this.planName,
    this.planStatus,
  });

  factory SellerHeader.fromJson(Map<String, dynamic> json) {
    final sub = json['subscription'];
    return SellerHeader(
      displayName: json['displayName']?.toString(),
      avatarUrl: json['avatarUrl']?.toString(),
      accountType: json['accountType']?.toString(),
      persona: json['persona']?.toString() ?? 'individual',
      roles: (json['roles'] as List? ?? const []).map((e) => e.toString()).toList(),
      trustBand: json['trustBand']?.toString(),
      trustScore: (json['trustScore'] as num?)?.toDouble(),
      verificationStatus: json['verificationStatus']?.toString(),
      planName: sub is Map ? sub['planName']?.toString() : null,
      planStatus: sub is Map ? sub['status']?.toString() : null,
      companies: (json['companies'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => SellerCompany.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
    );
  }

  final String? displayName;
  final String? avatarUrl;
  final String? accountType;
  final String persona;
  final List<String> roles;
  final String? trustBand;
  final double? trustScore;
  final String? verificationStatus;
  final String? planName;
  final String? planStatus;
  final List<SellerCompany> companies;
}

class SellerSummary {
  const SellerSummary({
    required this.header,
    required this.cards,
    required this.listings,
    required this.engagement,
  });

  factory SellerSummary.fromJson(Map<String, dynamic> json) => SellerSummary(
        header: SellerHeader.fromJson(
          Map<String, dynamic>.from(json['header'] as Map? ?? const {}),
        ),
        cards: Map<String, dynamic>.from(json['cards'] as Map? ?? const {}),
        listings: Map<String, dynamic>.from(json['listings'] as Map? ?? const {}),
        engagement: Map<String, dynamic>.from(json['engagement'] as Map? ?? const {}),
      );

  final SellerHeader header;
  final Map<String, dynamic> cards;
  final Map<String, dynamic> listings;
  final Map<String, dynamic> engagement;

  num card(String key) => (cards[key] as num?) ?? 0;
}

class SellerModuleDef {
  const SellerModuleDef({
    required this.id,
    required this.label,
    required this.iconName,
  });

  final String id;
  final String label;
  final String iconName;
}

const sellerCatalog = <SellerModuleDef>[
  SellerModuleDef(id: 'overview', label: 'Overview', iconName: 'dashboard'),
  SellerModuleDef(id: 'revenue', label: 'Revenue', iconName: 'payments'),
  SellerModuleDef(id: 'views', label: 'Views', iconName: 'visibility'),
  SellerModuleDef(id: 'leads', label: 'Leads', iconName: 'handshake'),
  SellerModuleDef(id: 'messages', label: 'Messages', iconName: 'chat'),
  SellerModuleDef(id: 'followers', label: 'Followers', iconName: 'group'),
  SellerModuleDef(id: 'listings', label: 'My ads', iconName: 'inventory_2'),
  SellerModuleDef(id: 'analytics', label: 'Analytics', iconName: 'insights'),
  SellerModuleDef(id: 'promotions', label: 'Promotions', iconName: 'campaign'),
  SellerModuleDef(id: 'invoices', label: 'Invoices', iconName: 'receipt'),
  SellerModuleDef(id: 'subscription', label: 'Plan', iconName: 'card_membership'),
];
