import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/notification_models.dart';
import '../remote/notifications_api.dart';

class NotificationsRepository {
  NotificationsRepository(this._api);
  final NotificationsApi _api;

  Future<Result<NotificationPage>> list({
    int page = 1,
    String filter = 'all',
  }) async {
    try {
      return Success(await _api.list(page: page, filter: filter));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<NotificationItem>> getOne(String uuid) async {
    try {
      return Success(await _api.getOne(uuid));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<int>> unreadCount() async {
    try {
      return Success(await _api.unreadCount());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<int>> markRead(String uuid) async {
    try {
      return Success(await _api.markRead(uuid));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<int>> markUnread(String uuid) async {
    try {
      return Success(await _api.markUnread(uuid));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<int>> markAllRead() async {
    try {
      return Success(await _api.markAllRead());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<int>> hide(String uuid) async {
    try {
      return Success(await _api.hide(uuid));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<NotificationPreferences>> preferences() async {
    try {
      return Success(await _api.preferences());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<NotificationPreferences>> updatePreference(
    String categoryCode, {
    bool? pushEnabled,
    bool? emailEnabled,
    bool? smsEnabled,
    bool? inAppEnabled,
  }) async {
    try {
      return Success(
        await _api.updatePreference(
          categoryCode,
          pushEnabled: pushEnabled,
          emailEnabled: emailEnabled,
          smsEnabled: smsEnabled,
          inAppEnabled: inAppEnabled,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<NotificationPreferences>> updateQuietHours({
    bool? enabled,
    String? startTime,
    String? endTime,
    String? timezone,
    bool? allowUrgent,
  }) async {
    try {
      return Success(
        await _api.updateQuietHours(
          enabled: enabled,
          startTime: startTime,
          endTime: endTime,
          timezone: timezone,
          allowUrgent: allowUrgent,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<ScheduledNotification>>> scheduled() async {
    try {
      return Success(await _api.scheduled());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<bool>> cancelScheduled(String uuid) async {
    try {
      return Success(await _api.cancelScheduled(uuid));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<void>> registerPushToken(String token, {String provider = 'fcm'}) async {
    try {
      await _api.registerPushToken(token, provider: provider);
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
