import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'login_screen.dart';

class BiometricLockScreen extends StatefulWidget {
  const BiometricLockScreen({super.key});

  @override
  State<BiometricLockScreen> createState() => _BiometricLockScreenState();
}

class _BiometricLockScreenState extends State<BiometricLockScreen> {
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _unlock());
  }

  Future<void> _unlock() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await ServiceLocator.instance.authRepository.unlockWithBiometric();
    if (!mounted) return;
    setState(() => _busy = false);
    result.when(
      success: (_) {
        ServiceLocator.instance.routerRefresh.refresh();
        navigateAfterAuth(context);
      },
      failure: (m, code) {
        if (code == 'BIOMETRIC_REQUIRED') {
          setState(() => _error = 'Unlock to continue');
        } else {
          setState(() => _error = m);
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      showBack: false,
      showSellFab: false,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.fingerprint, size: 72, color: AppColors.gold),
                const SizedBox(height: 16),
                Text(
                  'Unlock',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
                const SizedBox(height: 8),
                const Text(
                  'Use Windows Hello, fingerprint, or your device lock to open your account.',
                  textAlign: TextAlign.center,
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _busy ? null : _unlock,
                  child: _busy
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Unlock'),
                ),
                TextButton(
                  onPressed: () async {
                    await ServiceLocator.instance.authRepository.logout(remote: false);
                    ServiceLocator.instance.routerRefresh.refresh();
                    if (context.mounted) context.go(AppRoutes.login);
                  },
                  child: const Text('Sign in with password instead'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
