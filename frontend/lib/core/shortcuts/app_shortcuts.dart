import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../core/platform/platform_capabilities.dart';
import '../../shared/layout/breakpoints.dart';

typedef ShortcutHandler = void Function(BuildContext context);

class ShortcutBinding {
  const ShortcutBinding({
    required this.id,
    required this.label,
    required this.keySet,
    required this.handler,
    this.whenEditable = false,
    this.requiresAuth = false,
    this.desktopOnly = false,
  });

  final String id;
  final String label;
  final SingleActivator keySet;
  final ShortcutHandler handler;
  final bool whenEditable;
  final bool requiresAuth;
  final bool desktopOnly;
}

/// Central shortcut registry. Screens do not bind Ctrl/Cmd keys themselves.
class AppShortcutManager {
  AppShortcutManager._();
  static final AppShortcutManager instance = AppShortcutManager._();

  final Map<String, ShortcutBinding> _custom = {};

  void register(ShortcutBinding binding) => _custom[binding.id] = binding;
  void unregister(String id) => _custom.remove(id);

  List<ShortcutBinding> defaults() {
    final command = PlatformCapabilities.instance.isApple;
    return [
      ShortcutBinding(
        id: 'search',
        label: 'Search',
        keySet: SingleActivator(LogicalKeyboardKey.keyK, control: !command, meta: command),
        handler: (context) => context.push(AppRoutes.search),
        desktopOnly: true,
      ),
      ShortcutBinding(
        id: 'new_listing',
        label: 'New listing',
        keySet: SingleActivator(LogicalKeyboardKey.keyN, control: !command, meta: command),
        handler: (context) => context.push(AppRoutes.post),
        requiresAuth: true,
        desktopOnly: true,
      ),
      ShortcutBinding(
        id: 'save',
        label: 'Save',
        keySet: SingleActivator(LogicalKeyboardKey.keyS, control: !command, meta: command),
        handler: (_) {},
        whenEditable: true,
        desktopOnly: true,
      ),
      ShortcutBinding(
        id: 'close',
        label: 'Close',
        keySet: const SingleActivator(LogicalKeyboardKey.escape),
        handler: (context) {
          if (context.canPop()) context.pop();
        },
        whenEditable: true,
      ),
      ShortcutBinding(
        id: 'home',
        label: 'Home',
        keySet: SingleActivator(LogicalKeyboardKey.keyH, control: !command, meta: command),
        handler: (context) => context.go(AppRoutes.home),
        desktopOnly: true,
      ),
      ShortcutBinding(
        id: 'settings',
        label: 'Settings',
        keySet: SingleActivator(LogicalKeyboardKey.comma, control: !command, meta: command),
        handler: (context) => context.push(AppRoutes.settings),
        desktopOnly: true,
      ),
    ];
  }

  bool _editableFocused(BuildContext context) {
    final focused = FocusManager.instance.primaryFocus;
    final ctx = focused?.context;
    if (ctx == null) return false;
    return ctx.widget is EditableText || ctx.findAncestorWidgetOfExactType<EditableText>() != null;
  }

  Map<ShortcutActivator, Intent> shortcutsFor(BuildContext context) {
    final map = <ShortcutActivator, Intent>{};
    for (final binding in [...defaults(), ..._custom.values]) {
      map[binding.keySet] = _AppShortcutIntent(binding);
    }
    return map;
  }

  Map<Type, Action<Intent>> actionsFor(BuildContext context) {
    return {
      _AppShortcutIntent: CallbackAction<_AppShortcutIntent>(
        onInvoke: (intent) {
          final binding = intent.binding;
          if (binding.desktopOnly && context.isMobileLayout) return null;
          if (binding.requiresAuth) {
            final auth = ServiceLocator.instance.authRepository;
            if (!auth.hasActiveSession || auth.isGuest) {
              context.push(AppRoutes.login);
              return null;
            }
          }
          final editing = _editableFocused(context);
          if (editing && !binding.whenEditable) return null;
          binding.handler(context);
          return null;
        },
      ),
    };
  }
}

class _AppShortcutIntent extends Intent {
  const _AppShortcutIntent(this.binding);
  final ShortcutBinding binding;
}

class AppShortcutScope extends StatelessWidget {
  const AppShortcutScope({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final manager = AppShortcutManager.instance;
    return Shortcuts(
      shortcuts: manager.shortcutsFor(context),
      child: Actions(
        actions: manager.actionsFor(context),
        child: child,
      ),
    );
  }
}
