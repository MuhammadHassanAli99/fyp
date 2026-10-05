import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/foundation.dart';

import '../domain/device_security_snapshot.dart';

class DesktopSecurityProvider implements DeviceSecurityProvider {
  DesktopSecurityProvider({DeviceInfoPlugin? plugin})
      : _plugin = plugin ?? DeviceInfoPlugin();

  final DeviceInfoPlugin _plugin;

  @override
  Future<DeviceSecuritySnapshot> collect() async {
    switch (defaultTargetPlatform) {
      case TargetPlatform.windows:
        final info = await _plugin.windowsInfo;
        return DeviceSecuritySnapshot(
          isRooted: false,
          isJailbroken: false,
          isEmulator: false,
          isDebugging: kDebugMode,
          isAutomation: false,
          deviceModel: info.productName,
          osVersion: info.displayVersion,
          manufacturer: 'Microsoft',
          platform: 'windows',
        );
      case TargetPlatform.macOS:
        final info = await _plugin.macOsInfo;
        return DeviceSecuritySnapshot(
          isRooted: false,
          isJailbroken: false,
          isEmulator: false,
          isDebugging: kDebugMode,
          isAutomation: false,
          deviceModel: info.model,
          osVersion: info.osRelease,
          manufacturer: 'Apple',
          platform: 'macos',
        );
      case TargetPlatform.linux:
        final info = await _plugin.linuxInfo;
        return DeviceSecuritySnapshot(
          isRooted: false,
          isJailbroken: false,
          isEmulator: false,
          isDebugging: kDebugMode,
          isAutomation: false,
          deviceModel: info.prettyName,
          osVersion: info.versionId,
          manufacturer: info.id,
          platform: 'linux',
        );
      default:
        return DeviceSecuritySnapshot(
          isRooted: false,
          isJailbroken: false,
          isEmulator: false,
          isDebugging: kDebugMode,
          isAutomation: false,
          platform: defaultTargetPlatform.name,
        );
    }
  }
}
