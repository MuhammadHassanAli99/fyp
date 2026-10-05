import 'package:flutter/material.dart';

import '../../shared/layout/breakpoints.dart';

extension ContextX on BuildContext {
  ThemeData get theme => Theme.of(this);
  ColorScheme get colors => theme.colorScheme;
  TextTheme get textTheme => theme.textTheme;
  Size get screenSize => MediaQuery.sizeOf(this);

  /// Phone-first breakpoint (single-column list friendly).
  bool get isCompact => breakpoint == AppBreakpoint.mobile;

  /// Tablet / small laptop.
  bool get isWide =>
      breakpoint == AppBreakpoint.tablet || isDesktopLayout;

  /// Large desktop.
  bool get isDesktop => isDesktopLayout;

  /// Listing feed columns for the current viewport.
  int listingCrossAxisCount({String? marketplace}) {
    return feedColumnCount(marketplace: marketplace);
  }

  /// Width/height for grid cells. Property cards get a bit more height.
  double listingChildAspectRatio({
    required int crossAxisCount,
    String? marketplace,
  }) {
    final property = marketplace == 'property';
    return switch (crossAxisCount) {
      1 => property ? 1.72 : 1.55,
      2 => property ? 0.68 : 0.64,
      3 => property ? 0.74 : 0.70,
      _ => property ? 0.78 : 0.74,
    };
  }
}

extension StringX on String {
  String get capitalized =>
      isEmpty ? this : '${this[0].toUpperCase()}${substring(1)}';
}
