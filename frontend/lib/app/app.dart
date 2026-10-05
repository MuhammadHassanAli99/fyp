import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart';

import '../core/di/service_locator.dart';
import '../features/chat/call_screen.dart';
import '../features/settings/settings_store.dart';
import 'localization/app_localizations_wrapper.dart';
import 'router.dart';
import 'theme/app_theme.dart';
import '../core/shortcuts/app_shortcuts.dart';

class AureliaApp extends StatefulWidget {
  const AureliaApp({super.key});

  @override
  State<AureliaApp> createState() => _AureliaAppState();
}

class _AureliaAppState extends State<AureliaApp> {
  late final SettingsStore _settingsStore;
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _settingsStore = sl.settingsStore;
    _router = createRouter(refresh: sl.routerRefresh);
  }

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(
      builder: (context) {
        final themeModeStr = _settingsStore.themeMode.value;
        final themeMode = switch (themeModeStr) {
          'light' => ThemeMode.light,
          'dark' => ThemeMode.dark,
          _ => ThemeMode.system,
        };
        final lang = _settingsStore.languageCode.value;
        final locale = Locale(lang);
        final rtl = _settingsStore.isRtl;

        return MaterialApp.router(
          title: 'AURELIA',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light(),
          darkTheme: AppTheme.dark(),
          themeMode: themeMode,
          locale: locale,
          supportedLocales: AppLocalizationsWrapper.supportedLocales,
          localeResolutionCallback: (device, supported) {
            if (device == null) return locale;
            for (final s in supported) {
              if (s.languageCode == lang) return s;
            }
            for (final s in supported) {
              if (s.languageCode == device.languageCode) return s;
            }
            return supported.isNotEmpty ? supported.first : locale;
          },
          localizationsDelegates: const [
            AppLocalizationsWrapper.delegate,
            GlobalMaterialLocalizations.delegate,
            GlobalWidgetsLocalizations.delegate,
            GlobalCupertinoLocalizations.delegate,
          ],
          builder: (context, child) {
            return Directionality(
              textDirection: rtl ? TextDirection.rtl : TextDirection.ltr,
              child: AppShortcutScope(
                child: IncomingCallHost(child: child ?? const SizedBox.shrink()),
              ),
            );
          },
          routerConfig: _router,
        );
      },
    );
  }
}
