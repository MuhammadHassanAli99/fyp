/// Client-asserted device integrity. Never an authoritative fraud verdict.
class DeviceSecuritySnapshot {
  const DeviceSecuritySnapshot({
    required this.isRooted,
    required this.isJailbroken,
    required this.isEmulator,
    required this.isDebugging,
    required this.isAutomation,
    this.deviceModel,
    this.osVersion,
    this.manufacturer,
    this.platform,
  });

  final bool isRooted;
  final bool isJailbroken;
  final bool isEmulator;
  final bool isDebugging;
  final bool isAutomation;
  final String? deviceModel;
  final String? osVersion;
  final String? manufacturer;
  final String? platform;

  Map<String, String> toHeaders() => {
        'X-Device-Rooted': isRooted ? '1' : '0',
        'X-Device-Jailbroken': isJailbroken ? '1' : '0',
        'X-Device-Emulator': isEmulator ? '1' : '0',
        'X-Device-Debugging': isDebugging ? '1' : '0',
        'X-Device-Automation': isAutomation ? '1' : '0',
        if (deviceModel != null && deviceModel!.isNotEmpty)
          'X-Device-Model': _clip(deviceModel!, 128),
        if (osVersion != null && osVersion!.isNotEmpty)
          'X-OS-Version': _clip(osVersion!, 48),
        if (manufacturer != null && manufacturer!.isNotEmpty)
          'X-Device-Manufacturer': _clip(manufacturer!, 96),
      };

  static String _clip(String value, int max) =>
      value.length <= max ? value : value.substring(0, max);
}

abstract class DeviceSecurityProvider {
  Future<DeviceSecuritySnapshot> collect();
}
