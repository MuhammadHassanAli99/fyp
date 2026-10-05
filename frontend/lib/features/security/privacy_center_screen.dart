import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/result.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'security_store.dart';

class PrivacyCenterScreen extends StatefulWidget {
  const PrivacyCenterScreen({super.key});

  @override
  State<PrivacyCenterScreen> createState() => _PrivacyCenterScreenState();
}

class _PrivacyCenterScreenState extends State<PrivacyCenterScreen> {
  late final SecurityStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.securityStore;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _store.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Privacy & data rights',
      showSellFab: false,
      body: SignalBuilder(
        builder: (context) {
          final applicable = _store.applicability.value.dataOrNull ?? const {};
          final consents = _store.consents.value.dataOrNull ?? const [];
          final requests = _store.requests.value.dataOrNull ?? const [];
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                'Rights depend on where you live. GDPR and CCPA/CPRA are evaluated on the server.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 8),
              Text(
                'GDPR: ${applicable['gdpr'] == true ? 'may apply' : 'not indicated'} · '
                'CCPA/CPRA: ${applicable['ccpa'] == true ? 'may apply' : 'not indicated'}',
              ),
              const Divider(height: 32),
              Text('Consent', style: Theme.of(context).textTheme.titleMedium),
              for (final row in consents)
                SwitchListTile(
                  title: Text(_label(row['type']?.toString())),
                  value: row['granted'] == true,
                  onChanged: _store.busy.value
                      ? null
                      : (value) => _store.setConsent(row['type'].toString(), value),
                ),
              if (consents.isEmpty)
                const ListTile(title: Text('No consent records yet. Accepting terms creates the first ones.')),
              const Divider(height: 32),
              Text('Privacy requests', style: Theme.of(context).textTheme.titleMedium),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    onPressed: () => _store.submit('export'),
                    child: const Text('Download my data'),
                  ),
                  OutlinedButton(
                    onPressed: () => _store.submit('rectification'),
                    child: const Text('Correct my data'),
                  ),
                  OutlinedButton(
                    onPressed: () => _store.submit('restriction'),
                    child: const Text('Opt out of marketing'),
                  ),
                  TextButton(
                    onPressed: () => _confirmDelete(context),
                    child: const Text('Delete my account'),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              for (final row in requests)
                ListTile(
                  title: Text('${row['kind']} · ${row['status']}'),
                  subtitle: Text('${row['regulation']} · ${row['requestedAt'] ?? ''}'),
                ),
              if (_store.lastError != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(_store.lastError!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                ),
            ],
          );
        },
      ),
    );
  }

  String _label(String? type) => switch (type) {
        'marketing_email' => 'Marketing email',
        'marketing_sms' => 'Marketing SMS',
        'marketing_push' => 'Marketing push',
        'cookies_analytics' => 'Analytics cookies',
        'cookies_ads' => 'Advertising cookies',
        'location' => 'Location processing',
        'data_processing' => 'Data processing',
        'privacy' => 'Privacy policy',
        'terms' => 'Terms of use',
        _ => type ?? 'Consent',
      };

  Future<void> _confirmDelete(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete account?'),
        content: const Text(
          'This submits a verified deletion request. Sessions are revoked when the request completes.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Request deletion')),
        ],
      ),
    );
    if (ok == true) {
      final result = await _store.submit('erasure');
      if (result is Success && context.mounted) {
        await ServiceLocator.instance.authRepository.logout(remote: false);
        ServiceLocator.instance.routerRefresh.refresh();
        if (context.mounted) context.go(AppRoutes.login);
      }
    }
  }
}
