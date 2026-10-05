import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import 'breakpoints.dart';

class AdaptiveDestination {
  const AdaptiveDestination({
    required this.icon,
    required this.selectedIcon,
    required this.label,
    required this.route,
  });

  final IconData icon;
  final IconData selectedIcon;
  final String label;
  final String route;
}

/// Mobile: bottom NavigationBar. Tablet: NavigationRail. Desktop: extended rail.
class AdaptiveAppShell extends StatelessWidget {
  const AdaptiveAppShell({
    super.key,
    required this.child,
    this.selectedRoute = AppRoutes.home,
  });

  final Widget child;
  final String selectedRoute;

  List<AdaptiveDestination> _destinations(BuildContext context) {
    final l10n = context.l10n;
    return [
      AdaptiveDestination(
        icon: Icons.home_outlined,
        selectedIcon: Icons.home,
        label: l10n.appName,
        route: AppRoutes.home,
      ),
      AdaptiveDestination(
        icon: Icons.favorite_border,
        selectedIcon: Icons.favorite,
        label: l10n.favorites,
        route: AppRoutes.favorites,
      ),
      AdaptiveDestination(
        icon: Icons.chat_bubble_outline,
        selectedIcon: Icons.chat_bubble,
        label: l10n.chat,
        route: AppRoutes.chat,
      ),
      AdaptiveDestination(
        icon: Icons.person_outline,
        selectedIcon: Icons.person,
        label: l10n.profile,
        route: AppRoutes.profile,
      ),
    ];
  }

  int _indexFor(List<AdaptiveDestination> items) {
    final i = items.indexWhere((d) => selectedRoute == d.route || selectedRoute.startsWith('${d.route}/'));
    return i < 0 ? 0 : i;
  }

  @override
  Widget build(BuildContext context) {
    final items = _destinations(context);
    final index = _indexFor(items);
    final compact = context.isMobileLayout;

    void go(int i) {
      final dest = items[i];
      if (dest.route == AppRoutes.home) {
        context.go(dest.route);
      } else {
        context.push(dest.route);
      }
    }

    if (compact) {
      return Scaffold(
        body: child,
        bottomNavigationBar: NavigationBar(
          selectedIndex: index,
          destinations: [
            for (final item in items)
              NavigationDestination(
                icon: Icon(item.icon),
                selectedIcon: Icon(item.selectedIcon),
                label: item.label,
              ),
          ],
          onDestinationSelected: go,
        ),
      );
    }

    final extended = context.isDesktopLayout;
    return Scaffold(
      body: Row(
        children: [
          NavigationRail(
            extended: extended,
            minExtendedWidth: 200,
            selectedIndex: index,
            onDestinationSelected: go,
            labelType: extended
                ? NavigationRailLabelType.none
                : NavigationRailLabelType.all,
            leading: Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Icon(Icons.diamond_outlined, color: AppColors.gold),
            ),
            destinations: [
              for (final item in items)
                NavigationRailDestination(
                  icon: Icon(item.icon),
                  selectedIcon: Icon(item.selectedIcon),
                  label: Text(item.label),
                ),
            ],
          ),
          const VerticalDivider(width: 1),
          Expanded(child: child),
        ],
      ),
    );
  }
}
