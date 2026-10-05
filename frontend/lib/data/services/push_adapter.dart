import 'package:flutter/foundation.dart';

import '../repositories/notifications_repository.dart';

/// Platform-specific push. Desktop and web use in-app + realtime; native
/// mobile can register a provider token when one is supplied by the host.
class PushAdapter {
  PushAdapter(this._repo);

  final NotificationsRepository _repo;

  bool get supportsOsPush {
    if (kIsWeb) return false;
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS;
  }

  String get provider {
    if (kIsWeb) return 'webpush';
    return switch (defaultTargetPlatform) {
      TargetPlatform.iOS => 'apns',
      TargetPlatform.android => 'fcm',
      _ => 'webpush',
    };
  }

  /// Registers a token obtained outside this package (FCM/APNs). No-op when
  /// empty so desktop/web builds never depend on mobile-only plugins.
  Future<void> registerToken(String? token) async {
    if (token == null || token.length < 8) return;
    await _repo.registerPushToken(token, provider: provider);
  }
}
