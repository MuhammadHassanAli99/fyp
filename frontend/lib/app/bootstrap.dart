import 'package:flutter/material.dart';

import '../core/di/service_locator.dart';
import '../core/storage/prefs_storage.dart';

/// Cold start: binding, DI, device locale defaults, optional GPS country seed.
Future<void> bootstrap() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ServiceLocator.instance.init();

  final prefs = ServiceLocator.instance.prefs;
  final settings = ServiceLocator.instance.settingsRepository;

  // Theme / measurement safe defaults.
  if (prefs.themeMode == null) {
    await prefs.setString(PrefsKeys.themeMode, 'system');
  }
  if (prefs.measurement == null) {
    await prefs.setString(PrefsKeys.measurement, 'metric');
  }
  if (prefs.getBool(PrefsKeys.showOriginalPrice) == null) {
    await prefs.setBool(PrefsKeys.showOriginalPrice, true);
  }

  // Auto-detect device language + country (GPS when available) when unset.
  // Remembered prefs are never overwritten here.
  try {
    await settings.detectAndSeedIfNeeded();
  } catch (_) {
    if (prefs.countryCode == null) {
      await prefs.setString(PrefsKeys.countryCode, 'US');
    }
    if (prefs.languageCode == null) {
      await prefs.setString(
        PrefsKeys.languageCode,
        settings.detect.detectDeviceLanguage(),
      );
    }
    if (prefs.currencyCode == null) {
      await prefs.setString(PrefsKeys.currencyCode, 'USD');
    }
  }

  // Refresh settings store after seed.
  ServiceLocator.instance.settingsStore.reloadFromRepo();
}
