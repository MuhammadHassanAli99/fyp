import '../../core/network/api_client.dart';
import '../models/notification_models.dart';

class NotificationsApi {
  NotificationsApi(this._client);
  final ApiClient _client;

  Future<NotificationPage> list({
    int page = 1,
    int perPage = 30,
    String filter = 'all',
    bool unreadOnly = false,
  }) =>
      _client.get(
        '/notifications',
        queryParameters: {
          'page': page,
          'perPage': perPage,
          'filter': filter,
          'unreadOnly': unreadOnly,
        },
        parserWithMeta: (data, meta) {
          final items = (data as List? ?? [])
              .map((e) => NotificationItem.fromJson(Map<String, dynamic>.from(e as Map)))
              .toList();
          return NotificationPage(
            items: items,
            page: (meta?['page'] as num?)?.toInt() ?? page,
            perPage: (meta?['perPage'] as num?)?.toInt() ?? perPage,
            total: (meta?['total'] as num?)?.toInt() ?? items.length,
            hasMore: meta?['hasMore'] as bool? ?? false,
          );
        },
      );

  Future<NotificationItem> getOne(String uuid) => _client.get(
        '/notifications/$uuid',
        parser: (data) =>
            NotificationItem.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<int> unreadCount() => _client.get(
        '/notifications/unread-count',
        parser: (data) =>
            (Map<String, dynamic>.from(data as Map)['count'] as num?)?.toInt() ?? 0,
      );

  Future<int> markRead(String uuid) => _client.post(
        '/notifications/$uuid/read',
        parser: (data) =>
            (Map<String, dynamic>.from(data as Map)['unreadCount'] as num?)
                ?.toInt() ??
            0,
      );

  Future<int> markUnread(String uuid) => _client.post(
        '/notifications/$uuid/unread',
        parser: (data) =>
            (Map<String, dynamic>.from(data as Map)['unreadCount'] as num?)
                ?.toInt() ??
            0,
      );

  Future<int> markAllRead() => _client.post(
        '/notifications/read-all',
        parser: (data) =>
            (Map<String, dynamic>.from(data as Map)['unreadCount'] as num?)
                ?.toInt() ??
            0,
      );

  Future<int> hide(String uuid) => _client.delete(
        '/notifications/$uuid',
        parser: (data) =>
            (Map<String, dynamic>.from(data as Map)['unreadCount'] as num?)
                ?.toInt() ??
            0,
      );

  Future<NotificationPreferences> preferences() => _client.get(
        '/notifications/preferences',
        parser: (data) => NotificationPreferences.fromJson(
          Map<String, dynamic>.from(data as Map),
        ),
      );

  Future<NotificationPreferences> updatePreference(
    String categoryCode, {
    bool? pushEnabled,
    bool? emailEnabled,
    bool? smsEnabled,
    bool? inAppEnabled,
  }) =>
      _client.patch(
        '/notifications/preferences/$categoryCode',
        data: {
          'pushEnabled': ?pushEnabled,
          'emailEnabled': ?emailEnabled,
          'smsEnabled': ?smsEnabled,
          'inAppEnabled': ?inAppEnabled,
        },
        parser: (data) => NotificationPreferences.fromJson(
          Map<String, dynamic>.from(data as Map),
        ),
      );

  Future<NotificationPreferences> updateQuietHours({
    bool? enabled,
    String? startTime,
    String? endTime,
    String? timezone,
    bool? allowUrgent,
  }) =>
      _client.put(
        '/notifications/preferences/quiet-hours',
        data: {
          'enabled': ?enabled,
          'startTime': ?startTime,
          'endTime': ?endTime,
          'timezone': ?timezone,
          'allowUrgent': ?allowUrgent,
        },
        parser: (data) => NotificationPreferences.fromJson(
          Map<String, dynamic>.from(data as Map),
        ),
      );

  Future<List<ScheduledNotification>> scheduled() => _client.get(
        '/notifications/scheduled',
        parser: (data) => (data as List? ?? [])
            .map(
              (e) => ScheduledNotification.fromJson(
                Map<String, dynamic>.from(e as Map),
              ),
            )
            .toList(),
      );

  Future<bool> cancelScheduled(String uuid) => _client.post(
        '/notifications/scheduled/$uuid/cancel',
        parser: (data) =>
            Map<String, dynamic>.from(data as Map)['cancelled'] == true,
      );

  Future<void> registerPushToken(String token, {String provider = 'fcm'}) async {
    await _client.put(
      '/notifications/push-token',
      data: {'token': token, 'provider': provider},
      parser: (_) => true,
    );
  }
}
