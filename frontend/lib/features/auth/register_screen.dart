import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/result.dart';
import '../../data/models/user_model.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'auth_store.dart';
import 'login_screen.dart';

class RegisterScreen extends StatelessWidget {
  const RegisterScreen({super.key, required this.store});

  final AuthStore store;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.register,
      showSellFab: false,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: SignalBuilder(builder: (context) {
              final loading = store.state.value.isLoading;
              final error = store.state.value.errorMessage;
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Create an account with email or phone. You will sign in with your password and a one-time code next.',
                  ),
                  const SizedBox(height: 20),
                  SegmentedButton<bool>(
                    segments: const [
                      ButtonSegment(value: false, label: Text('Email'), icon: Icon(Icons.email_outlined)),
                      ButtonSegment(value: true, label: Text('Phone'), icon: Icon(Icons.phone_outlined)),
                    ],
                    selected: {store.usePhone.value},
                    onSelectionChanged: (value) => store.usePhone.value = value.first,
                  ),
                  const SizedBox(height: 20),
                  TextField(
                    decoration: InputDecoration(labelText: l10n.name),
                    onChanged: (v) => store.name.value = v,
                  ),
                  const SizedBox(height: 16),
                  if (!store.usePhone.value)
                    TextField(
                      decoration: InputDecoration(labelText: l10n.email),
                      keyboardType: TextInputType.emailAddress,
                      onChanged: (v) => store.email.value = v,
                    )
                  else
                    TextField(
                      decoration: const InputDecoration(
                        labelText: 'Phone number',
                        helperText: 'Include country code, e.g. +92…',
                      ),
                      keyboardType: TextInputType.phone,
                      onChanged: (v) => store.phone.value = v,
                    ),
                  const SizedBox(height: 16),
                  TextField(
                    decoration: InputDecoration(
                      labelText: l10n.password,
                      helperText: 'At least 8 characters, mixed case, a number and a symbol',
                    ),
                    obscureText: true,
                    onChanged: (v) => store.password.value = v,
                  ),
                  const SizedBox(height: 12),
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    value: store.acceptedTerms.value,
                    onChanged: (v) => store.acceptedTerms.value = v ?? false,
                    controlAffinity: ListTileControlAffinity.leading,
                    title: const Text(
                      'I accept the Terms of Service and Privacy Policy',
                    ),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: loading || !store.canSubmitRegister.value
                        ? null
                        : () async {
                            final r = await store.register();
                            if (!context.mounted) return;
                            if (r.isSuccess) {
                              ServiceLocator.instance.routerRefresh.refresh();
                              context.go(AppRoutes.login);
                              showAuthError(
                                context,
                                'Account created. Sign in with your password, then the one-time code.',
                              );
                            } else if (r is Failure<RegisterResult>) {
                              showAuthError(context, r.message);
                            }
                          },
                    child: loading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(l10n.register),
                  ),
                  TextButton(
                    onPressed: () => context.go(AppRoutes.login),
                    child: const Text('Already have an account? Sign in'),
                  ),
                ],
              );
            }),
          ),
        ),
      ),
    );
  }
}
