import 'package:flutter/foundation.dart';

import '../domain/device_security_snapshot.dart';
import 'android_security_provider.dart';
import 'desktop_security_provider.dart';
import 'ios_security_provider.dart';
import 'web_security_provider.dart';

class DeviceSecurityService {
  DeviceSecurityService({DeviceSecurityProvider? provider})
      : _provider = provider ?? resolveDeviceSecurityProvider();

  final DeviceSecurityProvider _provider;
  DeviceSecuritySnapshot? _cached;

  static DeviceSecurityProvider resolveDeviceSecurityProvider() {
    if (kIsWeb) return WebSecurityProvider();
    return switch (defaultTargetPlatform) {
      TargetPlatform.android => AndroidSecurityProvider(),
      TargetPlatform.iOS => IOSSecurityProvider(),
      _ => DesktopSecurityProvider(),
    };
  }

  Future<DeviceSecuritySnapshot> snapshot() async {
    return _cached ??= await _provider.collect();
  }

  Future<DeviceSecuritySnapshot> warm() => snapshot();
}
