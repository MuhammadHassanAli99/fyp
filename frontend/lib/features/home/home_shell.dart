import 'package:flutter/material.dart';

import '../../shared/layout/adaptive_scaffold.dart';
import '../../app/app_routes.dart';

/// Adaptive chrome for the consumer home surface.
class HomeShell extends StatelessWidget {
  const HomeShell({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AdaptiveAppShell(
      selectedRoute: AppRoutes.home,
      child: child,
    );
  }
}
