import 'package:flutter/material.dart';

/// Notifies [GoRouter] when auth or marketplace context changes.
class GoRouterRefresh extends ChangeNotifier {
  void refresh() => notifyListeners();
}
