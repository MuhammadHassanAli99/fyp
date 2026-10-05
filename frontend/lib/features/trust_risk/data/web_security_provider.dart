import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

import '../domain/device_security_snapshot.dart';

class WebSecurityProvider implements DeviceSecurityProvider {
  WebSecurityProvider({DeviceInfoPlugin? plugin})
      : _plugin = plugin ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _plugin;

  @override
  Future<DeviceSecuritySnapshot> collect() async {
    final info = await _plugin.webBrowserInfo;
    return DeviceSecuritySnapshot(
      isRooted: false,
      isJailbroken: false,
      isEmulator: false,
      isDebugging: kDebugMode,
      isAutomation: false,
      deviceModel: info.browserName.name,
      osVersion: info.appVersion,
      manufacturer: info.vendor,
      platform: 'web',
    );
  }
}
