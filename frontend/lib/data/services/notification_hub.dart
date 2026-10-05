import 'dart:async';

import 'package:signals/signals.dart';

import '../models/notification_models.dart';
import '../repositories/notifications_repository.dart';
import 'realtime_client.dart';

/// App-wide unread badge + live inbox events. Reuses the existing Socket.IO client.
class NotificationHub {
  NotificationHub(this.realtime, this._repo);

  final RealtimeClient realtime;
  final NotificationsRepository _repo;
  StreamSubscription<RealtimeEvent>? _sub;

  final unreadCount = signal(0);
  final latest = signal<NotificationItem?>(null);

  void start() {
    _sub?.cancel();
    _sub = realtime.events.listen((event) {
      switch (event.name) {
        case 'connected':
          unawaited(refreshUnread());
        case 'notification:unread_count':
          final count = event.map?['count'];
          if (count is num) unreadCount.value = count.toInt();
        case 'notification:new':
          final map = event.map;
          if (map != null) {
            latest.value = NotificationItem.fromJson(map);
            unreadCount.value = unreadCount.value + 1;
          }
        case 'notification:read':
          unawaited(refreshUnread());
      }
    });
  }

  Future<void> refreshUnread() async {
    final result = await _repo.unreadCount();
    result.when(
      success: (count) => unreadCount.value = count,
      failure: (_, _) {},
    );
  }

  Future<void> dispose() async {
    await _sub?.cancel();
  }
}
