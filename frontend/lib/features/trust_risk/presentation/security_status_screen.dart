import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../../app/router.dart';
import '../../../core/di/service_locator.dart';
import '../../../core/result/async_state.dart';
import '../../../shared/widgets/app_scaffold.dart';
import '../data/trust_risk_api.dart';
import 'trust_risk_store.dart';

class SecurityStatusScreen extends StatefulWidget {
  const SecurityStatusScreen({super.key});

  @override
  State<SecurityStatusScreen> createState() => _SecurityStatusScreenState();
}

class _SecurityStatusScreenState extends State<SecurityStatusScreen> {
  late final TrustRiskStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.trustRiskStore;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _store.load();
    });
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Account security',
      showSellFab: false,
      body: SignalBuilder(
        builder: (context) {
        final state = _store.status.value;
        if (state is AsyncLoading<TrustRiskStatus> && state.dataOrNull == null) {
          return const Center(child: CircularProgressIndicator());
        }
        if (state.errorMessage != null && state.dataOrNull == null) {
          return Center(child: Text(state.errorMessage!));
        }
        final data = state.dataOrNull ??
            const TrustRiskStatus(
              state: 'ok',
              kycStatus: 'not_started',
              identityVerified: false,
              amlClear: true,
              recentSecurityAlert: false,
            );
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _StatusCard(status: data),
            const SizedBox(height: 12),
            ListTile(
              leading: const Icon(Icons.verified_user_outlined),
              title: const Text('Identity verification'),
              subtitle: Text(_kycLabel(data.kycStatus)),
              onTap: () => context.push(AppRoutes.verification),
            ),
            ListTile(
              leading: const Icon(Icons.devices_outlined),
              title: const Text('Devices & sessions'),
              onTap: () => context.push(AppRoutes.devices),
            ),
            if (data.recentSecurityAlert)
              const ListTile(
                leading: Icon(Icons.shield_outlined),
                title: Text('A recent sign-in needs your attention'),
                subtitle: Text('Check your devices and change your password if you do not recognise it.'),
              ),
          ],
        );
        },
      ),
    );
  }

  String _kycLabel(String status) {
    return switch (status) {
      'verified' => 'Verified',
      'pending' || 'in_review' => 'Under review',
      'requires_update' => 'Update required',
      'rejected' => 'Needs a new submission',
      _ => 'Not started',
    };
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.status});
  final TrustRiskStatus status;

  @override
  Widget build(BuildContext context) {
    final (title, body, color) = switch (status.state) {
      'restricted' => (
          'Account restricted',
          'Some actions are paused while we review this account. Identity verification may be required.',
          Colors.orange,
        ),
      'verify' => (
          'Verification needed',
          'Confirm it is you before continuing. This is not a fraud verdict.',
          Colors.blue,
        ),
      _ => (
          'Account in good standing',
          'You can buy, sell and message as usual.',
          Colors.green,
        ),
    };
    return Card(
      child: ListTile(
        leading: Icon(Icons.security, color: color),
        title: Text(title),
        subtitle: Text(body),
      ),
    );
  }
}
