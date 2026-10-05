import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../features/payment/checkout_nav.dart';
import '../../shared/widgets/app_scaffold.dart';

class ListingPromotionsScreen extends StatefulWidget {
  const ListingPromotionsScreen({super.key, required this.listingId});

  final String listingId;

  @override
  State<ListingPromotionsScreen> createState() => _ListingPromotionsScreenState();
}

class _ListingPromotionsScreenState extends State<ListingPromotionsScreen> {
  List<Map<String, dynamic>> _packages = const [];
  List<Map<String, dynamic>> _active = const [];
  bool _loading = true;
  String? _busyCode;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final repo = ServiceLocator.instance.listingsRepository;
    final packages = await repo.promotionPackages();
    final current = await repo.promotions(widget.listingId);
    if (!mounted) return;
    setState(() {
      _loading = false;
      packages.when(success: (items) => _packages = items, failure: (_, _) {});
      current.when(success: (items) => _active = items, failure: (_, _) {});
    });
  }

  Future<void> _buy(Map<String, dynamic> pkg, {required bool useQuota}) async {
    setState(() => _busyCode = pkg['code']?.toString());
    final result = await ServiceLocator.instance.listingsRepository.promote(
      widget.listingId,
      packageCode: pkg['code']?.toString(),
      useQuota: useQuota,
    );
    if (!mounted) return;
    setState(() => _busyCode = null);
    result.when(
      success: (data) {
        final activated = data['activated'] == true;
        if (!activated) {
          pushCheckout(context, data);
        }
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              activated
                  ? 'Promotion activated until ${data['endsAt'] ?? ''}'
                  : 'Pay the order to activate. The client success screen is not enough.',
            ),
          ),
        );
        _load();
      },
      failure: (m, code) {
        if (useQuota && (code == 'QUOTA_EXCEEDED' || m.toLowerCase().contains('quota'))) {
          _buy(pkg, useQuota: false);
          return;
        }
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Promote listing',
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  'Promotions never change listing status. Featured and boosted can stack when the package allows it.',
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 16),
                Text('Active', style: Theme.of(context).textTheme.titleMedium),
                if (_active.isEmpty)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: 8),
                    child: Text('No active promotions'),
                  ),
                for (final row in _active)
                  ListTile(
                    title: Text(row['packageName']?.toString() ?? row['kind']?.toString() ?? 'Promotion'),
                    subtitle: Text('${row['status']} · ends ${row['endsAt'] ?? ''}'),
                  ),
                const SizedBox(height: 12),
                Text('Packages', style: Theme.of(context).textTheme.titleMedium),
                for (final pkg in _packages)
                  Card(
                    child: ListTile(
                      title: Text(pkg['name']?.toString() ?? pkg['code']?.toString() ?? 'Package'),
                      subtitle: Text(
                        '${pkg['promotionType']} · ${pkg['durationDays']} days · ${pkg['price']} ${pkg['currency']}',
                      ),
                      trailing: _busyCode == pkg['code']
                          ? const SizedBox(
                              width: 24,
                              height: 24,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : FilledButton(
                              onPressed: () => _buy(pkg, useQuota: true),
                              child: const Text('Activate'),
                            ),
                    ),
                  ),
                const SizedBox(height: 8),
                Text(
                  'If quota is exhausted the API creates a payment order and activates only after server-side verification.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(color: AppColors.goldMuted),
                ),
              ],
            ),
    );
  }
}
