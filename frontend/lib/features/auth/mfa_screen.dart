import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'auth_store.dart';

class MfaScreen extends StatefulWidget {
  const MfaScreen({super.key});

  @override
  State<MfaScreen> createState() => _MfaScreenState();
}

class _MfaScreenState extends State<MfaScreen> {
  final _code = TextEditingController();
  late final AuthStore _store;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _store = AuthStore(ServiceLocator.instance.authRepository);
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await _store.verifyMfa(_code.text.trim());
    if (!mounted) return;
    setState(() => _busy = false);
    result.when(
      success: (_) {
        ServiceLocator.instance.routerRefresh.refresh();
        final prefs = ServiceLocator.instance.prefs;
        context.go(prefs.marketplaceCode == null ? AppRoutes.marketplaceSelect : AppRoutes.home);
      },
      failure: (m, _) => setState(() => _error = m),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Two-step verification',
      showSellFab: false,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text('Enter the code from your authenticator app, SMS, email, or a recovery code.'),
                const SizedBox(height: 16),
                TextField(
                  controller: _code,
                  decoration: const InputDecoration(labelText: 'Verification code'),
                  keyboardType: TextInputType.visiblePassword,
                  onSubmitted: (_) => _submit(),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: _busy
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Verify'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
