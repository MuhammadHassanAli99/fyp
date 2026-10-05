import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';

class ShareTargetScreen extends StatefulWidget {
  const ShareTargetScreen({super.key, required this.token});

  final String token;

  @override
  State<ShareTargetScreen> createState() => _ShareTargetScreenState();
}

class _ShareTargetScreenState extends State<ShareTargetScreen> {
  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _payload;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final result = await ServiceLocator.instance.favoritesRepository.resolveShare(widget.token);
    if (!mounted) return;
    result.when(
      success: (data) => setState(() {
        _payload = data;
        _loading = false;
      }),
      failure: (m, _) => setState(() {
        _error = m;
        _loading = false;
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.shareListing,
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? EmptyState(title: _error!, action: FilledButton(onPressed: _load, child: Text(l10n.retry)))
              : _content(l10n),
    );
  }

  Widget _content(dynamic l10n) {
    final type = _payload?['targetType']?.toString() ?? '';
    final target = _payload?['target'];
    if (type == 'listing' && target is Map) {
      final id = target['uuid'] ?? target['id'];
      return EmptyState(
        title: target['title']?.toString() ?? l10n.listingDetails as String,
        action: FilledButton(
          onPressed: () => context.go('/listing/$id'),
          child: Text(l10n.openNotification as String),
        ),
      );
    }
    if (type == 'collection') {
      return EmptyState(
        title: l10n.collections as String,
        action: FilledButton(
          onPressed: () => context.go(AppRoutes.favorites),
          child: Text(l10n.favorites as String),
        ),
      );
    }
    if (type == 'comparison') {
      return EmptyState(
        title: l10n.compare as String,
        action: FilledButton(
          onPressed: () => context.go(AppRoutes.compare),
          child: Text(l10n.compare as String),
        ),
      );
    }
    return EmptyState(title: l10n.favorites as String);
  }
}
