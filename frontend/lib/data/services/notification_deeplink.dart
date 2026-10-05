import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';

String? sanitizeDeepLink(String? input) => _sanitize(input);

/// Validated internal routes only. Untrusted URLs never navigate.
String? safeNotificationRoute(String? deepLink, {String? actionType, String? actionTarget}) {
  final fromLink = _sanitize(deepLink);
  if (fromLink != null) return fromLink;

  final target = actionTarget;
  return switch (actionType) {
    'listing' || 'auction' || 'offer' || 'favorite' when target != null =>
      AppRoutes.listing.replaceFirst(':id', target),
    'chat' when target != null => '/chat/$target',
    'call' => target == null || target == 'history' ? AppRoutes.callHistory : '/calls/$target',
    'security' => AppRoutes.devices,
    'search' => AppRoutes.searchSaved,
    'subscription' => AppRoutes.subscription,
    'payment' when target != null => AppRoutes.checkoutPath(target),
    'verification' => AppRoutes.profile,
    'system' when target != null && target.startsWith('/ai/') => AppRoutes.aiSupport,
    _ => AppRoutes.home,
  };
}

void openNotificationRoute(BuildContext context, String? route) {
  final safe = _sanitize(route) ?? AppRoutes.home;
  context.push(safe);
}

String? _sanitize(String? input) {
  if (input == null || input.isEmpty) return null;
  final raw = input.trim();
  if (raw.contains('://') || raw.startsWith('//') || raw.contains('..')) return null;
  if (!raw.startsWith('/')) return null;
  final path = raw.split('?').first.split('#').first;
  const allowed = [
    '/listing/',
    '/chat/',
    '/calls/',
    '/security/devices',
    '/profile',
    '/marketplace',
    '/search',
    '/home',
    '/favorites',
    '/vehicles/parts',
    '/notifications',
    '/subscription',
    '/checkout/',
    '/ai/',
  ];
  for (final prefix in allowed) {
    if (path == prefix || path.startsWith(prefix) || (prefix.endsWith('/') && path.startsWith(prefix))) {
      return path;
    }
    if (!prefix.endsWith('/') && path == prefix) return path;
  }
  if (path == '/home' || path == AppRoutes.home) return AppRoutes.home;
  return null;
}
