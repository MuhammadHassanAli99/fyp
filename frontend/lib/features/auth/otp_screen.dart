import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/result.dart';
import '../../data/models/user_model.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'auth_store.dart';
import 'login_screen.dart';

class OtpScreen extends StatelessWidget {
  const OtpScreen({super.key, required this.store});

  final AuthStore store;

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Enter code',
      showSellFab: false,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SignalBuilder(builder: (context) {
              final loading = store.state.value.isLoading;
              final error = store.state.value.errorMessage;
              final challenge = store.challenge;
              final hint = challenge?.destinationHint ?? store.identifier;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'We sent a one-time code to $hint. Enter it below to finish signing in.',
                  ),
                  if (challenge?.devOtp != null) ...[
                    const SizedBox(height: 16),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Development code',
                              style: Theme.of(context).textTheme.labelMedium,
                            ),
                            const SizedBox(height: 4),
                            SelectableText(
                              challenge!.devOtp!,
                              style: Theme.of(context).textTheme.headlineMedium,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Email/SMS are logged locally in development. This code is not sent in production.',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                  const SizedBox(height: 20),
                  TextFormField(
                    key: ValueKey(
                      '${challenge?.loginTicket}-${challenge?.devOtp ?? ''}',
                    ),
                    initialValue: store.otpCode.value,
                    decoration: InputDecoration(
                      labelText: 'OTP code',
                      helperText: challenge?.devOtp != null
                          ? 'Pre-filled from the development code above'
                          : 'Check your email, SMS, or WhatsApp',
                    ),
                    keyboardType: TextInputType.number,
                    onChanged: (v) => store.otpCode.value = v,
                    onFieldSubmitted: (_) => _submit(context),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 12),
                    Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: loading || !store.canSubmitOtp.value
                        ? null
                        : () => _submit(context),
                    child: loading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Sign in'),
                  ),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: loading
                        ? null
                        : () async {
                            final r = await store.resendOtp();
                            if (!context.mounted) return;
                            r.when(
                              success: (challenge) => showAuthError(
                                context,
                                challenge.devOtp != null
                                    ? 'Development code: ${challenge.devOtp}'
                                    : 'A new code was sent to ${challenge.destinationHint}',
                              ),
                              failure: (m, _) => showAuthError(context, m),
                            );
                          },
                    child: const Text('Resend code'),
                  ),
                  TextButton(
                    onPressed: () => context.go(AppRoutes.login),
                    child: const Text('Back to password'),
                  ),
                ],
              );
            }),
          ),
        ),
      ),
    );
  }

  Future<void> _submit(BuildContext context) async {
    final r = await store.completeOtp();
    if (!context.mounted) return;
    if (r.isSuccess) {
      ServiceLocator.instance.routerRefresh.refresh();
      navigateAfterAuth(context);
    } else if (r is Failure<UserModel>) {
      showAuthError(context, r.message);
    }
  }
}
