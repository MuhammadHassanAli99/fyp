class AdminSession {
  const AdminSession({
    required this.userId,
    required this.roles,
    required this.permissions,
    required this.modules,
    required this.isStaff,
    this.mfaSatisfied = false,
  });

  factory AdminSession.fromJson(Map<String, dynamic> json) => AdminSession(
        userId: (json['userId'] as num?)?.toInt() ?? 0,
        roles: (json['roles'] as List? ?? const []).map((e) => e.toString()).toList(),
        permissions: (json['permissions'] as List? ?? const []).map((e) => e.toString()).toList(),
        modules: (json['modules'] as List? ?? const []).map((e) => e.toString()).toList(),
        isStaff: json['isStaff'] == true,
        mfaSatisfied: json['mfaSatisfied'] == true,
      );

  final int userId;
  final List<String> roles;
  final List<String> permissions;
  final List<String> modules;
  final bool isStaff;
  final bool mfaSatisfied;

  bool can(String permission) =>
      permissions.contains('*') || permissions.contains(permission);
}

class AdminPage {
  const AdminPage({
    required this.items,
    required this.page,
    required this.perPage,
    required this.total,
    this.hasMore = false,
  });

  final List<Map<String, dynamic>> items;
  final int page;
  final int perPage;
  final int total;
  final bool hasMore;
}

class AdminModuleDef {
  const AdminModuleDef({
    required this.id,
    required this.label,
    required this.iconName,
    this.mobile = false,
  });

  final String id;
  final String label;
  final String iconName;
  final bool mobile;
}

const adminCatalog = <AdminModuleDef>[
  AdminModuleDef(id: 'dashboard', label: 'Dashboard', iconName: 'dashboard', mobile: true),
  AdminModuleDef(id: 'approvals', label: 'Approvals', iconName: 'verified', mobile: true),
  AdminModuleDef(id: 'system_health', label: 'Health', iconName: 'monitor_heart', mobile: true),
  AdminModuleDef(id: 'support', label: 'Support', iconName: 'support_agent', mobile: true),
  AdminModuleDef(id: 'fraud', label: 'Fraud', iconName: 'security', mobile: true),
  AdminModuleDef(id: 'kyc', label: 'KYC', iconName: 'badge', mobile: true),
  AdminModuleDef(id: 'users', label: 'Users', iconName: 'people'),
  AdminModuleDef(id: 'companies', label: 'Companies', iconName: 'apartment'),
  AdminModuleDef(id: 'employees', label: 'Employees', iconName: 'badge_outlined'),
  AdminModuleDef(id: 'roles', label: 'Roles', iconName: 'admin_panel_settings'),
  AdminModuleDef(id: 'listings', label: 'Listings', iconName: 'inventory_2'),
  AdminModuleDef(id: 'categories', label: 'Categories', iconName: 'category'),
  AdminModuleDef(id: 'countries', label: 'Countries', iconName: 'public'),
  AdminModuleDef(id: 'languages', label: 'Languages', iconName: 'translate'),
  AdminModuleDef(id: 'currencies', label: 'Currencies', iconName: 'payments'),
  AdminModuleDef(id: 'subscriptions', label: 'Subscriptions', iconName: 'card_membership'),
  AdminModuleDef(id: 'payments', label: 'Payments', iconName: 'account_balance'),
  AdminModuleDef(id: 'moderation', label: 'Moderation', iconName: 'gavel'),
  AdminModuleDef(id: 'reviews', label: 'Reviews', iconName: 'reviews'),
  AdminModuleDef(id: 'ads', label: 'Ads', iconName: 'campaign'),
  AdminModuleDef(id: 'analytics', label: 'Analytics', iconName: 'insights', mobile: true),
  AdminModuleDef(id: 'reports', label: 'Reports', iconName: 'summarize'),
  AdminModuleDef(id: 'cms', label: 'CMS', iconName: 'article'),
  AdminModuleDef(id: 'notifications', label: 'Notifications', iconName: 'notifications'),
  AdminModuleDef(id: 'sales', label: 'Sales', iconName: 'point_of_sale'),
  AdminModuleDef(id: 'audit', label: 'Audit', iconName: 'history'),
  AdminModuleDef(id: 'security', label: 'Security', iconName: 'security', mobile: true),
  AdminModuleDef(id: 'privacy', label: 'Privacy', iconName: 'policy'),
];
