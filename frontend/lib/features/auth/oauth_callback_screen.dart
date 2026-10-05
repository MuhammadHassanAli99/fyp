import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/auth/auth_status.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';

class OauthCallbackScreen extends StatefulWidget {
  const OauthCallbackScreen({super.key, this.ticket});

  final String? ticket;

  @override
  State<OauthCallbackScreen> createState() => _OauthCallbackScreenState();
}

class _OauthCallbackScreenState extends State<OauthCallbackScreen> {
  String? _error;

  @override
  void initState() {
    super.initState();
    _complete();
  }

  Future<void> _complete() async {
    final ticket = widget.ticket;
    if (ticket == null || ticket.isEmpty) {
      setState(() => _error = 'Missing sign-in ticket');
      return;
    }
    final result = await ServiceLocator.instance.authRepository.completeOauth(ticket);
    if (!mounted) return;
    result.when(
      success: (_) {
        ServiceLocator.instance.routerRefresh.refresh();
        final auth = ServiceLocator.instance.authRepository;
        if (auth.status == AuthStatus.mfaRequired) {
          context.go(AppRoutes.mfa);
          return;
        }
        final prefs = ServiceLocator.instance.prefs;
        context.go(prefs.marketplaceCode == null ? AppRoutes.marketplaceSelect : AppRoutes.home);
      },
      failure: (m, _) => setState(() => _error = m),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      showBack: false,
      showSellFab: false,
      body: Center(
        child: _error == null
            ? const CircularProgressIndicator()
            : Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(_error!),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: () => context.go(AppRoutes.login),
                      child: const Text('Back to login'),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}
