import 'package:flutter/widgets.dart';

/// Screen-size buckets. Layouts key off width, not OS name.
enum AppBreakpoint { mobile, tablet, desktop, largeDesktop }

abstract final class Breakpoints {
  static const double mobile = 600;
  static const double tablet = 1024;
  static const double desktop = 1440;

  static AppBreakpoint ofWidth(double width) {
    if (width < mobile) return AppBreakpoint.mobile;
    if (width < tablet) return AppBreakpoint.tablet;
    if (width < desktop) return AppBreakpoint.desktop;
    return AppBreakpoint.largeDesktop;
  }
}

extension BreakpointX on BuildContext {
  Size get _size => MediaQuery.sizeOf(this);

  AppBreakpoint get breakpoint => Breakpoints.ofWidth(_size.width);

  bool get isMobileLayout => breakpoint == AppBreakpoint.mobile;
  bool get isTabletLayout => breakpoint == AppBreakpoint.tablet;
  bool get isDesktopLayout =>
      breakpoint == AppBreakpoint.desktop ||
      breakpoint == AppBreakpoint.largeDesktop;
  bool get isLargeDesktopLayout => breakpoint == AppBreakpoint.largeDesktop;

  EdgeInsets get pagePadding {
    final w = _size.width;
    if (w < 600) return const EdgeInsets.symmetric(horizontal: 12, vertical: 8);
    if (w < 1024) return const EdgeInsets.symmetric(horizontal: 20, vertical: 12);
    return const EdgeInsets.symmetric(horizontal: 28, vertical: 16);
  }

  double get contentMaxWidth => switch (breakpoint) {
        AppBreakpoint.mobile => _size.width,
        AppBreakpoint.tablet => 840,
        AppBreakpoint.desktop => 1100,
        AppBreakpoint.largeDesktop => 1320,
      };

  int feedColumnCount({String? marketplace}) {
    return switch (breakpoint) {
      AppBreakpoint.mobile => _size.width < 520 ? 1 : 2,
      AppBreakpoint.tablet => 2,
      AppBreakpoint.desktop => 3,
      AppBreakpoint.largeDesktop => marketplace == 'property' ? 4 : 4,
    };
  }

  double get minTouchTarget => isMobileLayout ? 48 : 40;
}
