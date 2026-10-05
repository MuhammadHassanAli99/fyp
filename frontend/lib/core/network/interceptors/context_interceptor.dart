import 'package:dio/dio.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../platform/platform_info.dart';
import '../../storage/prefs_storage.dart';
import '../../../features/trust_risk/data/device_security_service.dart';

class ContextInterceptor extends Interceptor {
  ContextInterceptor({required this.prefs, this.security});

  final PrefsStorage prefs;
  final DeviceSecurityService? security;
  PackageInfo? _packageInfo;

  Future<void> ensurePackageInfo() async {
    _packageInfo ??= await PackageInfo.fromPlatform();
  }

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    await ensurePackageInfo();

    options.headers['X-Country'] = prefs.countryCode ?? 'US';
    options.headers['X-Language'] = (prefs.languageCode ?? 'en').length <= 10
        ? (prefs.languageCode ?? 'en')
        : (prefs.languageCode ?? 'en').substring(0, 10);
    options.headers['X-Currency'] = (prefs.currencyCode ?? 'USD').length <= 3
        ? (prefs.currencyCode ?? 'USD')
        : (prefs.currencyCode ?? 'USD').substring(0, 3);
    final timezone = prefs.timezone ?? DateTime.now().timeZoneName;
    final appVersion = _packageInfo?.version ?? '1.0.0';
    options.headers['X-Timezone'] =
        timezone.length <= 64 ? timezone : timezone.substring(0, 64);
    options.headers['X-Platform'] = PlatformInfo.code;
    options.headers['X-App-Version'] =
        appVersion.length <= 24 ? appVersion : appVersion.substring(0, 24);
    options.headers['X-Device-Id'] = prefs.deviceId ?? 'unknown';
    options.headers['X-Marketplace'] = prefs.marketplaceCode ?? '';
    if (PlatformInfo.browser.isNotEmpty) {
      options.headers['X-Device-Name'] = PlatformInfo.browser;
    }

    try {
      final snap = await security?.snapshot();
      if (snap != null) {
        options.headers.addAll(snap.toHeaders());
      }
    } catch (_) {
      /* Integrity headers are best-effort; never block the request. */
    }

    final guestId = prefs.guestId;
    if (guestId != null && guestId.isNotEmpty) {
      options.headers['X-Guest-Id'] = guestId;
    }

    handler.next(options);
  }
}
