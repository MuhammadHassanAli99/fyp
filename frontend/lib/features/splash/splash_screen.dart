import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/auth_status.dart';
import '../../core/di/service_locator.dart';
import '../../core/init/app_init_state.dart';
import 'splash_store.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  late final SplashStore _store;

  @override
  void initState() {
    super.initState();
    _store = SplashStore();
    _init();
  }

  Future<void> _init() async {
    await _store.bootstrap();
    if (!mounted) return;
    await Future<void>.delayed(const Duration(milliseconds: 1200));
    if (!mounted) return;
    _navigate();
  }

  void _navigate() {
    final sl = ServiceLocator.instance;
    final phase = sl.appInitStore.phase;
    if (phase == AppInitPhase.updateRequired) {
      context.go(AppRoutes.updateRequired);
      return;
    }
    if (phase == AppInitPhase.error) {
      return;
    }
    if (sl.appInitStore.snapshot.value.isSelecting ||
        !sl.prefs.onboardingComplete) {
      context.go(AppRoutes.onboarding);
      return;
    }
    final auth = sl.authRepository;
    if (auth.status == AuthStatus.biometricRequired) {
      context.go(AppRoutes.unlock);
      return;
    }
    if (auth.status == AuthStatus.otpRequired) {
      context.go(AppRoutes.otp);
      return;
    }
    if (auth.status == AuthStatus.updateRequired) {
      context.go(AppRoutes.updateRequired);
      return;
    }
    final hasSession = auth.hasActiveSession;
    if (!hasSession) {
      context.go(AppRoutes.login);
      return;
    }
    if (sl.prefs.marketplaceCode == null) {
      context.go(AppRoutes.marketplaceSelect);
      return;
    }
    context.go(AppRoutes.home);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Scaffold(
      backgroundColor: AppColors.charcoal,
      body: SignalBuilder(builder: (context) {
        final visible = _store.fadeIn.value;
        return AnimatedOpacity(
          opacity: visible ? 1 : 0,
          duration: const Duration(milliseconds: 800),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      l10n.appName,
                      style: Theme.of(context).textTheme.displayMedium?.copyWith(
                            color: AppColors.gold,
                            letterSpacing: 6,
                          ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      l10n.splashHeadline,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                            color: AppColors.stone,
                          ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      l10n.splashSubtitle,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                            color: AppColors.stone.withValues(alpha: 0.75),
                          ),
                    ),
                    const SizedBox(height: 40),
                    if (_store.state.value.hasError) ...[
                      Text(
                        _store.state.value.errorMessage ?? l10n.retry,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: AppColors.stone,
                            ),
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: _init,
                        child: Text(l10n.retry),
                      ),
                    ] else
                      const CircularProgressIndicator(color: AppColors.gold),
                  ],
                ),
              ),
            ),
          ),
        );
      }),
    );
  }
}
