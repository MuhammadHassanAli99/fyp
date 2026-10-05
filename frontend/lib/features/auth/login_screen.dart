import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:url_launcher/url_launcher.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/auth_status.dart';
import '../../core/di/service_locator.dart';
import '../../core/platform/platform_info.dart';
import '../../core/result/result.dart';
import '../../data/models/user_model.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'auth_store.dart';

void navigateAfterAuth(BuildContext context) {
  final sl = ServiceLocator.instance;
  final auth = sl.authRepository;
  if (auth.status == AuthStatus.mfaRequired) {
    context.go(AppRoutes.mfa);
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
  sl.settingsRepository.mergeAfterLogin();
  sl.settingsStore.reloadFromRepo();
  sl.appInitStore.markReady();
  sl.routerRefresh.refresh();
  unawaited(sl.favoritesStore.consumePendingAction());
  final pending = sl.settingsRepository.takePendingRoute();
  if (pending != null && pending.isNotEmpty && pending != AppRoutes.login) {
    context.go(pending);
    return;
  }
  final prefs = sl.prefs;
  context.go(
    prefs.marketplaceCode != null
        ? AppRoutes.home
        : AppRoutes.marketplaceSelect,
  );
}

void showAuthError(BuildContext context, String message) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key, required this.store});

  final AuthStore store;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      showBack: false,
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
                  Text(
                    l10n.appName,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.displaySmall?.copyWith(
                          color: AppColors.gold,
                          letterSpacing: 4,
                        ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    l10n.login,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Enter your email or phone and password, then send a one-time code to sign in.',
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  SegmentedButton<bool>(
                    segments: const [
                      ButtonSegment(value: false, label: Text('Email'), icon: Icon(Icons.email_outlined)),
                      ButtonSegment(value: true, label: Text('Phone'), icon: Icon(Icons.phone_outlined)),
                    ],
                    selected: {store.usePhone.value},
                    onSelectionChanged: (value) => store.usePhone.value = value.first,
                  ),
                  const SizedBox(height: 20),
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
                      helperText: 'At least 8 characters',
                    ),
                    obscureText: true,
                    onChanged: (v) => store.password.value = v,
                  ),
                  if (store.usePhone.value) ...[
                    const SizedBox(height: 16),
                    const Text('Send the code by'),
                    const SizedBox(height: 8),
                    SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(value: 'sms', label: Text('SMS'), icon: Icon(Icons.sms_outlined)),
                        ButtonSegment(value: 'whatsapp', label: Text('WhatsApp'), icon: Icon(Icons.chat_outlined)),
                      ],
                      selected: {store.otpChannel.value},
                      onSelectionChanged: (value) => store.otpChannel.value = value.first,
                    ),
                  ],
                  if (error != null) ...[
                    const SizedBox(height: 12),
                    Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: loading || !store.canSubmitLogin.value
                        ? null
                        : () async {
                            final r = await store.sendOtpAndContinue();
                            if (!context.mounted) return;
                            r.when(
                              success: (outcome) {
                                ServiceLocator.instance.routerRefresh.refresh();
                                if (outcome is LoginOtpNeeded) {
                                  context.go(AppRoutes.otp);
                                } else {
                                  navigateAfterAuth(context);
                                }
                              },
                              failure: (m, _) => showAuthError(context, m),
                            );
                          },
                    child: loading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Send OTP'),
                  ),
                  const SizedBox(height: 12),
                  OutlinedButton(
                    onPressed: loading
                        ? null
                        : () async {
                            final r = await store.guest();
                            if (!context.mounted) return;
                            if (r.isSuccess) {
                              ServiceLocator.instance.routerRefresh.refresh();
                              navigateAfterAuth(context);
                            } else if (r is Failure<UserModel>) {
                              showAuthError(context, r.message);
                            }
                          },
                    child: Text(l10n.continueAsGuest),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () => context.push(AppRoutes.register),
                    child: Text(l10n.register),
                  ),
                  const SizedBox(height: 16),
                  const Divider(),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    alignment: WrapAlignment.center,
                    children: [
                      for (final provider in const ['google', 'apple', 'facebook', 'microsoft'])
                        OutlinedButton(
                          onPressed: loading
                              ? null
                              : () async {
                                  final r = await store.startOauth(provider);
                                  if (!context.mounted) return;
                                  r.when(
                                    success: (url) async {
                                      if (url.isEmpty) {
                                        showAuthError(context, '$provider is not configured on the server');
                                        return;
                                      }
                                      final uri = Uri.parse(url);
                                      if (await canLaunchUrl(uri)) {
                                        await launchUrl(uri, mode: LaunchMode.externalApplication);
                                      }
                                    },
                                    failure: (m, _) => showAuthError(context, m),
                                  );
                                },
                          child: Text(provider[0].toUpperCase() + provider.substring(1)),
                        ),
                      if (PlatformInfo.supportsPasskeys)
                        OutlinedButton(
                          onPressed: () {
                            showAuthError(
                              context,
                              'Passkeys are available on this platform. Register one from Security after you sign in.',
                            );
                          },
                          child: const Text('Passkey'),
                        ),
                    ],
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
