import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/app_routes.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';

class ListingAnalyticsScreen extends StatefulWidget {
  const ListingAnalyticsScreen({super.key, required this.listingId});

  final String listingId;

  @override
  State<ListingAnalyticsScreen> createState() => _ListingAnalyticsScreenState();
}

class _ListingAnalyticsScreenState extends State<ListingAnalyticsScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  String? _errorCode;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final result = await ServiceLocator.instance.listingsRepository.analytics(widget.listingId);
    if (!mounted) return;
    result.when(
      success: (data) => setState(() {
        _loading = false;
        _data = data;
        _error = null;
        _errorCode = null;
      }),
      failure: (m, code) => setState(() {
        _loading = false;
        _error = m;
        _errorCode = code;
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final locked = _data?['advancedLocked'] == true;
    return AppScaffold(
      title: 'Listing analytics',
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(_error!, textAlign: TextAlign.center),
                        if (_errorCode == 'FEATURE_NOT_IN_PLAN') ...[
                          const SizedBox(height: 16),
                          FilledButton(
                            onPressed: () => context.push(AppRoutes.subscription),
                            child: Text(l10n.upgradePlan),
                          ),
                        ],
                      ],
                    ),
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text(
                      'Counters are aggregated asynchronously. Opening this screen does not increment views.',
                      style: Theme.of(context).textTheme.bodyMedium,
                    ),
                    if (locked) ...[
                      const SizedBox(height: 12),
                      Text(l10n.analyticsUpgradeHint),
                      TextButton(
                        onPressed: () => context.push(AppRoutes.subscription),
                        child: Text(l10n.upgradePlan),
                      ),
                    ],
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 12,
                      runSpacing: 12,
                      children: [
                        _metric('Views', _data?['views']),
                        _metric('Favorites', _data?['favorites']),
                        _metric('Messages', _data?['messages']),
                        _metric('Calls', _data?['calls']),
                        if (!locked) ...[
                          _metric('Unique viewers', _data?['uniqueViewers']),
                          _metric('Search impressions', _data?['searchImpressions']),
                          _metric('Shares', _data?['shares']),
                          _metric('Offers', _data?['offers']),
                        ],
                      ],
                    ),
                  ],
                ),
    );
  }

  Widget _metric(String label, Object? value) {
    return SizedBox(
      width: 150,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: Theme.of(context).textTheme.labelMedium),
              const SizedBox(height: 4),
              Text('${value ?? 0}', style: Theme.of(context).textTheme.headlineSmall),
            ],
          ),
        ),
      ),
    );
  }
}
