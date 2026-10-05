import 'package:flutter/material.dart';

import '../../shared/widgets/app_scaffold.dart';
import '../../core/di/service_locator.dart';

class UpdateRequiredScreen extends StatelessWidget {
  const UpdateRequiredScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final info = ServiceLocator.instance.authRepository.compatibility;
    return AppScaffold(
      showBack: false,
      showSellFab: false,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 480),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.system_update, size: 56, color: Theme.of(context).colorScheme.primary),
                const SizedBox(height: 16),
                Text('Update required', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 12),
                Text(
                  info?.schemaCompatible == false
                      ? 'This app is not compatible with the current server. Please update, then try again.'
                      : 'Please update the app to continue signing in.',
                  textAlign: TextAlign.center,
                ),
                if (info?.minSupportedAppVersion != null) ...[
                  const SizedBox(height: 8),
                  Text('Minimum version: ${info!.minSupportedAppVersion}'),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
