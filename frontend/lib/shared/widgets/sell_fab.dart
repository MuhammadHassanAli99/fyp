import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/auth/guest_feature.dart';

/// Shared “Sell / Post listing” FAB — bottom-right on main screens.
class SellFab extends StatelessWidget {
  const SellFab({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return FloatingActionButton.extended(
      heroTag: 'sell-fab',
      tooltip: l10n.postListing,
      backgroundColor: AppColors.gold,
      foregroundColor: AppColors.charcoal,
      icon: const Icon(Icons.add),
      label: const Text('Sell'),
      onPressed: () {
        final sl = ServiceLocator.instance;
        if (!sl.guestFeatureGuard.allows(GuestFeature.postListing)) {
          sl.settingsRepository.setPendingRoute(AppRoutes.post);
          context.push(AppRoutes.login);
          return;
        }
        context.push(AppRoutes.post);
      },
    );
  }
}
