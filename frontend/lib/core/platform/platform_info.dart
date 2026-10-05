import 'package:flutter/foundation.dart';

/// Platform / capability detection. Never assumes IMEI, biometrics, or WebAuthn.
class PlatformInfo {
  const PlatformInfo._();

  static bool get isWeb => kIsWeb;

  static TargetPlatform get target => defaultTargetPlatform;

  static String get code {
    if (kIsWeb) return 'web';
    return switch (defaultTargetPlatform) {
      TargetPlatform.android => 'android',
      TargetPlatform.iOS => 'ios',
      TargetPlatform.windows => 'windows',
      TargetPlatform.macOS => 'macos',
      TargetPlatform.linux => 'linux',
      TargetPlatform.fuchsia => 'unknown',
    };
  }

  static bool get hasSecureHardware {
    if (kIsWeb) return false;
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.macOS ||
        defaultTargetPlatform == TargetPlatform.windows;
  }

  static bool get supportsPasskeys {
    if (kIsWeb) return true;
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.macOS ||
        defaultTargetPlatform == TargetPlatform.windows;
  }

  static bool get supportsBiometrics => hasSecureHardware && !kIsWeb;

  static bool get usesBrowserSession => kIsWeb;

  static String get browser {
    if (!kIsWeb) return '';
    return 'web';
  }
}
