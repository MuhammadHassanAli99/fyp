import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/user_model.dart';
import '../../shared/widgets/app_scaffold.dart';

class DevicesScreen extends StatefulWidget {
  const DevicesScreen({super.key});

  @override
  State<DevicesScreen> createState() => _DevicesScreenState();
}

class _DevicesScreenState extends State<DevicesScreen> {
  List<AuthDeviceInfo> _devices = const [];
  List<AuthSessionInfo> _sessions = const [];
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final repo = ServiceLocator.instance.authRepository;
    final devices = await repo.devices();
    final sessions = await repo.sessions();
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = null;
      devices.when(
        success: (list) => _devices = list,
        failure: (m, _) => _error = m,
      );
      sessions.when(
        success: (list) => _sessions = list,
        failure: (m, _) => _error ??= m,
      );
    });
  }

  Future<void> _revokeDevice(AuthDeviceInfo device) async {
    final repo = ServiceLocator.instance.authRepository;
    await repo.revokeDevice(device.uuid);
    if (device.isCurrent) {
      await repo.logout(remote: false);
      ServiceLocator.instance.routerRefresh.refresh();
      if (mounted) context.go(AppRoutes.login);
      return;
    }
    await _load();
  }

  Future<void> _revokeSession(AuthSessionInfo session) async {
    await ServiceLocator.instance.authRepository.revokeSession(session.uuid);
    if (session.isCurrent) {
      await ServiceLocator.instance.authRepository.logout(remote: false);
      ServiceLocator.instance.routerRefresh.refresh();
      if (mounted) context.go(AppRoutes.login);
      return;
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Devices & sessions',
      showSellFab: false,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (_error != null) Text(_error!),
                Text('Devices', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 8),
                for (final device in _devices)
                  ListTile(
                    title: Text(device.name),
                    subtitle: Text(
                      [
                        if (device.isCurrent) 'This device',
                        device.platform,
                        device.status,
                        device.lastSeenAt,
                      ].whereType<String>().join(' · '),
                    ),
                    trailing: TextButton(
                      onPressed: () => _revokeDevice(device),
                      child: const Text('Sign out'),
                    ),
                  ),
                const Divider(),
                Text('Sessions', style: Theme.of(context).textTheme.titleMedium),
                for (final session in _sessions)
                  ListTile(
                    title: Text(session.deviceName ?? session.platform ?? 'Session'),
                    subtitle: Text(
                      [
                        if (session.isCurrent) 'Current',
                        session.loginMethod,
                        session.lastUsedAt,
                      ].whereType<String>().join(' · '),
                    ),
                    trailing: TextButton(
                      onPressed: () => _revokeSession(session),
                      child: const Text('Revoke'),
                    ),
                  ),
                const SizedBox(height: 24),
                OutlinedButton(
                  onPressed: () async {
                    await ServiceLocator.instance.securityStore.revokeOthers();
                    await _load();
                  },
                  child: const Text('Sign out other devices'),
                ),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () async {
                    await ServiceLocator.instance.authRepository.logout(allDevices: true);
                    ServiceLocator.instance.routerRefresh.refresh();
                    if (context.mounted) context.go(AppRoutes.login);
                  },
                  child: const Text('Sign out of all devices'),
                ),
              ],
            ),
    );
  }
}
