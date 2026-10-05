import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/vehicle_models.dart';
import '../../features/payment/checkout_nav.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../filters/filter_panel.dart';
import '../filters/filter_state.dart';

class VehiclePartsScreen extends StatefulWidget {
  const VehiclePartsScreen({super.key});

  @override
  State<VehiclePartsScreen> createState() => _VehiclePartsScreenState();
}

class _VehiclePartsScreenState extends State<VehiclePartsScreen> {
  final _query = TextEditingController();
  final _oem = TextEditingController();
  List<VehiclePart> _parts = const [];
  List<VehicleNamedCode> _categories = const [];
  String? _category;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  @override
  void dispose() {
    _query.dispose();
    _oem.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    final catalog = await ServiceLocator.instance.vehicleRepository.catalog();
    catalog.when(
      success: (c) => _categories = c.partCategories,
      failure: (_, _) {},
    );
    await _search();
  }

  Future<void> _search() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result = await ServiceLocator.instance.vehicleRepository.searchParts(
      q: _query.text.trim().isEmpty ? null : _query.text.trim(),
      oem: _oem.text.trim().isEmpty ? null : _oem.text.trim(),
      categoryCode: _category,
    );
    if (!mounted) return;
    result.when(
      success: (items) => setState(() {
        _parts = items;
        _loading = false;
      }),
      failure: (m, _) => setState(() {
        _error = m;
        _loading = false;
      }),
    );
  }

  Future<void> _openFilters() async {
    final initial = FilterState(marketplace: 'parts');
    if (_category != null) initial.setValue('partCategory', _category);
    if (_oem.text.trim().isNotEmpty) initial.setValue('oemPartNumber', _oem.text.trim());
    final next = await showFilterPanel(
      context,
      initial: initial,
      marketplace: 'parts',
    );
    if (next == null) return;
    setState(() {
      _category = next.valueOf('partCategory')?.toString();
      final oem = next.valueOf('oemPartNumber') ?? next.valueOf('oem');
      if (oem != null) _oem.text = oem.toString();
    });
    await _search();
  }

  Future<void> _buy(VehiclePart part) async {
    if (ServiceLocator.instance.authRepository.isGuest) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Sign in to buy parts')),
      );
      return;
    }
    final result =
        await ServiceLocator.instance.vehicleRepository.buyPart(part.id);
    if (!mounted) return;
    result.when(
      success: (data) {
        pushCheckout(context, data);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Checkout started. Stock is reserved.')),
        );
      },
      failure: (m, _) =>
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Vehicle parts',
      actions: [
        IconButton(
          tooltip: 'Filters',
          icon: const Icon(Icons.tune),
          onPressed: _openFilters,
        ),
      ],
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                TextField(
                  controller: _query,
                  decoration: const InputDecoration(
                    labelText: 'Part name, SKU or keyword',
                  ),
                  onSubmitted: (_) => _search(),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _oem,
                  decoration: const InputDecoration(
                    labelText: 'OEM / manufacturer number',
                  ),
                  onSubmitted: (_) => _search(),
                ),
                if (_categories.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: _category,
                    decoration: const InputDecoration(labelText: 'Category'),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('All')),
                      for (final c in _categories)
                        DropdownMenuItem(value: c.code, child: Text(c.name)),
                    ],
                    onChanged: (v) {
                      setState(() => _category = v);
                      _search();
                    },
                  ),
                ],
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: FilledButton(
                    onPressed: _search,
                    child: const Text('Search'),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                    ? Center(child: Text(_error!))
                    : _parts.isEmpty
                        ? const Center(child: Text('No parts matched'))
                        : ListView.separated(
                            itemCount: _parts.length,
                            separatorBuilder: (_, _) => const Divider(height: 1),
                            itemBuilder: (context, index) {
                              final part = _parts[index];
                              return ListTile(
                                title: Text(part.name),
                                subtitle: Text(
                                  [
                                    if (part.brand != null) part.brand!,
                                    if (part.oemPartNumber != null)
                                      'OEM ${part.oemPartNumber}',
                                    if (part.sku != null) 'SKU ${part.sku}',
                                    '${part.price.toStringAsFixed(0)} ${part.currency}',
                                  ].join(' · '),
                                ),
                                trailing: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      IconButton(
                                        tooltip: context.l10n.saveFavorite,
                                        icon: const Icon(Icons.favorite_border),
                                        onPressed: () async {
                                          final sl = ServiceLocator.instance;
                                          if (sl.authRepository.isGuest ||
                                              !sl.authRepository.hasActiveSession) {
                                            sl.settingsRepository.setPendingRoute(
                                              AppRoutes.vehicleParts,
                                            );
                                            await sl.favoritesStore.rememberGuestSave(
                                              entityId: part.id,
                                              entityType: 'vehicle_part',
                                              marketplaceCode: 'vehicles',
                                              route: AppRoutes.vehicleParts,
                                            );
                                            if (context.mounted) {
                                              context.push(AppRoutes.login);
                                            }
                                            return;
                                          }
                                          await sl.favoritesStore.togglePart(partId: part.id);
                                        },
                                      ),
                                      TextButton(
                                        onPressed: () => _buy(part),
                                        child: const Text('Buy'),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
          ),
        ],
      ),
    );
  }
}
