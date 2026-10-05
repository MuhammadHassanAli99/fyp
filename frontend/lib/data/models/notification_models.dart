class NotificationItem {
  const NotificationItem({
    required this.id,
    required this.uuid,
    required this.categoryCode,
    required this.marketplace,
    required this.title,
    this.body,
    this.imageUrl,
    this.icon,
    required this.actionType,
    this.actionTarget,
    this.deepLink,
    required this.priority,
    this.groupKey,
    this.itemCount = 1,
    this.readAt,
    required this.createdAt,
    this.expiresAt,
  });

  factory NotificationItem.fromJson(Map<String, dynamic> json) => NotificationItem(
        id: (json['id'] as num?)?.toInt() ?? 0,
        uuid: json['uuid'] as String? ?? '',
        categoryCode: json['categoryCode'] as String? ?? '',
        marketplace: json['marketplace'] as String? ?? 'GENERAL',
        title: json['title'] as String? ?? '',
        body: json['body'] as String?,
        imageUrl: json['imageUrl'] as String?,
        icon: json['icon'] as String?,
        actionType: json['actionType'] as String? ?? 'none',
        actionTarget: json['actionTarget'] as String?,
        deepLink: json['deepLink'] as String?,
        priority: json['priority'] as String? ?? 'normal',
        groupKey: json['groupKey'] as String?,
        itemCount: (json['itemCount'] as num?)?.toInt() ?? 1,
        readAt: json['readAt'] as String?,
        createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now(),
        expiresAt: DateTime.tryParse(json['expiresAt'] as String? ?? ''),
      );

  final int id;
  final String uuid;
  final String categoryCode;
  final String marketplace;
  final String title;
  final String? body;
  final String? imageUrl;
  final String? icon;
  final String actionType;
  final String? actionTarget;
  final String? deepLink;
  final String priority;
  final String? groupKey;
  final int itemCount;
  final String? readAt;
  final DateTime createdAt;
  final DateTime? expiresAt;

  bool get isRead => readAt != null && readAt!.isNotEmpty;

  NotificationItem copyWith({String? readAt, bool clearRead = false}) => NotificationItem(
        id: id,
        uuid: uuid,
        categoryCode: categoryCode,
        marketplace: marketplace,
        title: title,
        body: body,
        imageUrl: imageUrl,
        icon: icon,
        actionType: actionType,
        actionTarget: actionTarget,
        deepLink: deepLink,
        priority: priority,
        groupKey: groupKey,
        itemCount: itemCount,
        readAt: clearRead ? null : (readAt ?? this.readAt),
        createdAt: createdAt,
        expiresAt: expiresAt,
      );
}

class NotificationPage {
  const NotificationPage({
    required this.items,
    required this.page,
    required this.perPage,
    required this.total,
    required this.hasMore,
  });

  final List<NotificationItem> items;
  final int page;
  final int perPage;
  final int total;
  final bool hasMore;
}

class NotificationCategoryPref {
  const NotificationCategoryPref({
    required this.categoryCode,
    required this.name,
    this.groupCode,
    required this.policyGroup,
    required this.marketplace,
    required this.locked,
    required this.pushEnabled,
    required this.emailEnabled,
    required this.smsEnabled,
    required this.inAppEnabled,
  });

  factory NotificationCategoryPref.fromJson(Map<String, dynamic> json) =>
      NotificationCategoryPref(
        categoryCode: json['categoryCode'] as String? ?? '',
        name: json['name'] as String? ?? '',
        groupCode: json['groupCode'] as String?,
        policyGroup: json['policyGroup'] as String? ?? 'MARKETPLACE',
        marketplace: json['marketplace'] as String? ?? 'GENERAL',
        locked: json['locked'] as bool? ?? false,
        pushEnabled: json['pushEnabled'] as bool? ?? true,
        emailEnabled: json['emailEnabled'] as bool? ?? false,
        smsEnabled: json['smsEnabled'] as bool? ?? false,
        inAppEnabled: json['inAppEnabled'] as bool? ?? true,
      );

  final String categoryCode;
  final String name;
  final String? groupCode;
  final String policyGroup;
  final String marketplace;
  final bool locked;
  final bool pushEnabled;
  final bool emailEnabled;
  final bool smsEnabled;
  final bool inAppEnabled;
}

class QuietHoursPref {
  const QuietHoursPref({
    required this.enabled,
    this.startTime,
    this.endTime,
    this.timezone,
    required this.allowUrgent,
    this.daysOfWeek,
  });

  factory QuietHoursPref.fromJson(Map<String, dynamic> json) => QuietHoursPref(
        enabled: json['enabled'] as bool? ?? false,
        startTime: json['startTime'] as String?,
        endTime: json['endTime'] as String?,
        timezone: json['timezone'] as String?,
        allowUrgent: json['allowUrgent'] as bool? ?? true,
        daysOfWeek: (json['daysOfWeek'] as List?)
            ?.map((e) => (e as num).toInt())
            .toList(),
      );

  final bool enabled;
  final String? startTime;
  final String? endTime;
  final String? timezone;
  final bool allowUrgent;
  final List<int>? daysOfWeek;
}

class NotificationPreferences {
  const NotificationPreferences({
    required this.quietHours,
    required this.categories,
  });

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) =>
      NotificationPreferences(
        quietHours: QuietHoursPref.fromJson(
          Map<String, dynamic>.from(json['quietHours'] as Map? ?? const {}),
        ),
        categories: (json['categories'] as List? ?? [])
            .map((e) => NotificationCategoryPref.fromJson(
                  Map<String, dynamic>.from(e as Map),
                ))
            .toList(),
      );

  final QuietHoursPref quietHours;
  final List<NotificationCategoryPref> categories;
}

class ScheduledNotification {
  const ScheduledNotification({
    required this.uuid,
    required this.categoryCode,
    required this.channel,
    required this.scheduledFor,
    required this.status,
    this.timezone,
  });

  factory ScheduledNotification.fromJson(Map<String, dynamic> json) =>
      ScheduledNotification(
        uuid: json['uuid'] as String? ?? '',
        categoryCode: json['categoryCode'] as String? ?? '',
        channel: json['channel'] as String? ?? 'push',
        scheduledFor: json['scheduledFor'] as String? ?? '',
        status: json['status'] as String? ?? 'scheduled',
        timezone: json['timezone'] as String?,
      );

  final String uuid;
  final String categoryCode;
  final String channel;
  final String scheduledFor;
  final String status;
  final String? timezone;
}
