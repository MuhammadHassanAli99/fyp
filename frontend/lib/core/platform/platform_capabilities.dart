import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import 'platform_info.dart';

/// Shared capability surface. Business logic talks to this, never to
/// `Platform.isAndroid` sprinkled through screens.
class PlatformCapabilities {
  const PlatformCapabilities._();

  static final PlatformCapabilities instance = PlatformCapabilities._();

  String get platformCode => PlatformInfo.code;

  bool get isWeb => PlatformInfo.isWeb;
  bool get isMobile =>
      !isWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);
  bool get isDesktop =>
      !isWeb &&
      (defaultTargetPlatform == TargetPlatform.windows ||
          defaultTargetPlatform == TargetPlatform.macOS ||
          defaultTargetPlatform == TargetPlatform.linux);
  bool get isApple =>
      defaultTargetPlatform == TargetPlatform.iOS ||
          defaultTargetPlatform == TargetPlatform.macOS;

  bool get hasCamera => isMobile || isWeb;
  bool get hasGps => !isWeb || true;
  bool get hasSecureStorage => PlatformInfo.hasSecureHardware || isWeb;
  bool get hasOsNotifications =>
      !isWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);
  bool get hasBiometrics => PlatformInfo.supportsBiometrics;
  bool get hasClipboard => true;
  bool get hasFilePicker => isDesktop || isWeb;
  bool get hasShareSheet => true;
  bool get hasMaps => true;
  bool get hasPhysicalKeyboard => isDesktop || isWeb;
  bool get hasMouse => isDesktop || isWeb;
  bool get hasTouch => isMobile || isWeb;
  bool get hasDragAndDrop => isDesktop || isWeb;
  bool get hasBackgroundExecution => isMobile;
  bool get hasDeepLinks => true;
  bool get usesBottomNavigation => isMobile;
  bool get usesNavigationRail => !isMobile;

  LogicalKeyboardKey get searchModifier =>
      isApple ? LogicalKeyboardKey.meta : LogicalKeyboardKey.control;

  Future<void> copyText(String text) => Clipboard.setData(ClipboardData(text: text));

  Future<String?> pasteText() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    return data?.text;
  }
}

class PickedPlatformFile {
  const PickedPlatformFile({
    required this.name,
    required this.bytes,
    this.mimeType,
    this.path,
  });

  final String name;
  final Uint8List bytes;
  final String? mimeType;
  final String? path;
}
