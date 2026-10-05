import 'package:flutter/material.dart';

import 'breakpoints.dart';

/// Width-driven layout: mobile column, tablet two-pane, desktop multi-column.
class ResponsiveLayout extends StatelessWidget {
  const ResponsiveLayout({
    super.key,
    required this.mobile,
    this.tablet,
    this.desktop,
    this.largeDesktop,
  });

  final Widget mobile;
  final Widget? tablet;
  final Widget? desktop;
  final Widget? largeDesktop;

  @override
  Widget build(BuildContext context) {
    return switch (context.breakpoint) {
      AppBreakpoint.mobile => mobile,
      AppBreakpoint.tablet => tablet ?? mobile,
      AppBreakpoint.desktop => desktop ?? tablet ?? mobile,
      AppBreakpoint.largeDesktop => largeDesktop ?? desktop ?? tablet ?? mobile,
    };
  }
}

class ContentConstraint extends StatelessWidget {
  const ContentConstraint({super.key, required this.child, this.maxWidth});

  final Widget child;
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: AlignmentDirectional.topCenter,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth ?? context.contentMaxWidth),
        child: child,
      ),
    );
  }
}

class MasterDetailLayout extends StatelessWidget {
  const MasterDetailLayout({
    super.key,
    required this.master,
    required this.detail,
    this.masterFlex = 2,
    this.detailFlex = 3,
    this.showDetail = true,
  });

  final Widget master;
  final Widget detail;
  final int masterFlex;
  final int detailFlex;
  final bool showDetail;

  @override
  Widget build(BuildContext context) {
    if (context.isMobileLayout || !showDetail) return master;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(flex: masterFlex, child: master),
        const VerticalDivider(width: 1),
        Expanded(flex: detailFlex, child: detail),
      ],
    );
  }
}
