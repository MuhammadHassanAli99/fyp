import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

import '../domain/device_security_snapshot.dart';

class AndroidSecurityProvider implements DeviceSecurityProvider {
  AndroidSecurityProvider({DeviceInfoPlugin? plugin})
      : _plugin = plugin ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _plugin;

  @override
  Future<DeviceSecuritySnapshot> collect() async {
    final info = await _plugin.androidInfo;
    final fingerprint = info.fingerprint.toLowerCase();
    final tags = info.tags.toLowerCase();
    final testKeys = fingerprint.contains('test-keys') || tags.contains('test-keys');
    return DeviceSecuritySnapshot(
      isRooted: testKeys,
      isJailbroken: false,
      isEmulator: !info.isPhysicalDevice,
      isDebugging: kDebugMode,
      isAutomation: false,
      deviceModel: info.model,
      osVersion: info.version.release,
      manufacturer: info.manufacturer,
      platform: 'android',
    );
  }
}
