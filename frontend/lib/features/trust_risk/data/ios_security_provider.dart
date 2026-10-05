import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

import '../domain/device_security_snapshot.dart';

class IOSSecurityProvider implements DeviceSecurityProvider {
  IOSSecurityProvider({DeviceInfoPlugin? plugin})
      : _plugin = plugin ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _plugin;

  @override
  Future<DeviceSecuritySnapshot> collect() async {
    final info = await _plugin.iosInfo;
    return DeviceSecuritySnapshot(
      isRooted: false,
      isJailbroken: false,
      isEmulator: !info.isPhysicalDevice,
      isDebugging: kDebugMode,
      isAutomation: false,
      deviceModel: info.utsname.machine,
      osVersion: info.systemVersion,
      manufacturer: 'Apple',
      platform: 'ios',
    );
  }
}
