import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../data/models/notification_models.dart';
import '../../data/repositories/notifications_repository.dart';
import '../../data/services/realtime_client.dart';

class NotificationCenterStore {
  NotificationCenterStore(this._repo, [this._realtime]);

  final NotificationsRepository _repo;
  final RealtimeClient? _realtime;

  final filter = signal('all');
  final items = signal<AsyncState<List<NotificationItem>>>(const AsyncIdle());
  final unread = signal(0);
  StreamSubscription<RealtimeEvent>? _sub;
  int _page = 1;
  bool _hasMore = true;
  bool _loadingMore = false;

  static const filters = [
    'all',
    'unread',
    'gold',
    'property',
    'vehicles',
    'messages',
    'security',
    'payments',
    'system',
  ];

  void listen() {
    _sub?.cancel();
    _sub = _realtime?.events.listen((event) {
      if (event.name == 'notification:new' ||
          event.name == 'notification:read' ||
          event.name == 'notification:updated' ||
          event.name == 'notification:unread_count' ||
          event.name == 'connected') {
        load();
      }
    });
  }

  Future<void> load() async {
    _page = 1;
    items.value = AsyncLoading(previous: items.value.dataOrNull);
    final result = await _repo.list(page: 1, filter: filter.value);
    result.when(
      success: (page) {
        _hasMore = page.hasMore;
        items.value = AsyncData(page.items);
      },
      failure: (m, code) => items.value = AsyncError(m, code: code),
    );
    final count = await _repo.unreadCount();
    count.when(success: (n) => unread.value = n, failure: (_, _) {});
  }

  Future<void> loadMore() async {
    if (!_hasMore || _loadingMore) return;
    _loadingMore = true;
    _page += 1;
    final result = await _repo.list(page: _page, filter: filter.value);
    result.when(
      success: (page) {
        _hasMore = page.hasMore;
        final current = items.value.dataOrNull ?? const <NotificationItem>[];
        items.value = AsyncData([...current, ...page.items]);
      },
      failure: (_, _) {},
    );
    _loadingMore = false;
  }

  Future<void> setFilter(String next) async {
    filter.value = next;
    await load();
  }

  Future<void> markRead(String uuid) async {
    final result = await _repo.markRead(uuid);
    result.when(
      success: (count) {
        unread.value = count;
        final current = items.value.dataOrNull;
        if (current == null) return;
        items.value = AsyncData([
          for (final item in current)
            if (item.uuid == uuid) item.copyWith(readAt: DateTime.now().toIso8601String()) else item,
        ]);
      },
      failure: (_, _) {},
    );
  }

  Future<void> markAllRead() async {
    final result = await _repo.markAllRead();
    result.when(
      success: (count) {
        unread.value = count;
        final current = items.value.dataOrNull;
        if (current == null) return;
        final stamp = DateTime.now().toIso8601String();
        items.value = AsyncData([
          for (final item in current) item.copyWith(readAt: stamp),
        ]);
      },
      failure: (_, _) {},
    );
  }

  Future<void> hide(String uuid) async {
    final result = await _repo.hide(uuid);
    result.when(
      success: (count) {
        unread.value = count;
        final current = items.value.dataOrNull;
        if (current == null) return;
        items.value = AsyncData([
          for (final item in current)
            if (item.uuid != uuid) item,
        ]);
      },
      failure: (_, _) {},
    );
  }

  void dispose() {
    _sub?.cancel();
  }
}

class NotificationSettingsStore {
  NotificationSettingsStore(this._repo);

  final NotificationsRepository _repo;
  final prefs = signal<AsyncState<NotificationPreferences>>(const AsyncIdle());

  Future<void> load() async {
    prefs.value = AsyncLoading(previous: prefs.value.dataOrNull);
    final result = await _repo.preferences();
    result.when(
      success: (data) => prefs.value = AsyncData(data),
      failure: (m, code) => prefs.value = AsyncError(m, code: code),
    );
  }

  Future<void> setChannel(String categoryCode, {bool? push, bool? email, bool? sms, bool? inApp}) async {
    final result = await _repo.updatePreference(
      categoryCode,
      pushEnabled: push,
      emailEnabled: email,
      smsEnabled: sms,
      inAppEnabled: inApp,
    );
    result.when(
      success: (data) => prefs.value = AsyncData(data),
      failure: (_, _) {},
    );
  }

  Future<void> setQuietHours({
    bool? enabled,
    String? startTime,
    String? endTime,
    String? timezone,
    bool? allowUrgent,
  }) async {
    final result = await _repo.updateQuietHours(
      enabled: enabled,
      startTime: startTime,
      endTime: endTime,
      timezone: timezone,
      allowUrgent: allowUrgent,
    );
    result.when(
      success: (data) => prefs.value = AsyncData(data),
      failure: (_, _) {},
    );
  }
}
