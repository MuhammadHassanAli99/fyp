import 'package:flutter/widgets.dart';

/// Directional helpers. Prefer start/end over left/right so RTL (ar, ur) works.
abstract final class Edge {
  static Alignment start = AlignmentDirectional.centerStart as Alignment;
}

extension DirectionalPad on EdgeInsets {
  static EdgeInsets only({
    double start = 0,
    double end = 0,
    double top = 0,
    double bottom = 0,
  }) =>
      EdgeInsetsDirectional.only(start: start, end: end, top: top, bottom: bottom)
          .resolve(TextDirection.ltr);
}
