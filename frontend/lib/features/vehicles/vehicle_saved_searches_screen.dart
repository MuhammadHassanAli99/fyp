import 'package:flutter/material.dart';

import '../../core/di/service_locator.dart';
import '../../data/models/property_models.dart';
import '../../shared/widgets/app_scaffold.dart';

class VehicleSavedSearchesScreen extends StatefulWidget {
  const VehicleSavedSearchesScreen({super.key});

  @override
  State<VehicleSavedSearchesScreen> createState() =>
      _VehicleSavedSearchesScreenState();
}

class _VehicleSavedSearchesScreenState
    extends State<VehicleSavedSearchesScreen> {
  List<SavedSearchItem> _items = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final result =
        await ServiceLocator.instance.vehicleRepository.savedSearches();
    if (!mounted) return;
    result.when(
      success: (items) => setState(() {
        _items = items;
        _loading = false;
      }),
      failure: (m, _) => setState(() {
        _error = m;
        _loading = false;
      }),
    );
  }

  Future<void> _delete(SavedSearchItem item) async {
    await ServiceLocator.instance.vehicleRepository.deleteSavedSearch(item.id);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Saved vehicle searches',
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : _items.isEmpty
                  ? const Center(
                      child: Text(
                        'Save a vehicle search from the home feed to get alerts when matching listings are published.',
                        textAlign: TextAlign.center,
                      ),
                    )
                  : ListView.separated(
                      itemCount: _items.length,
                      separatorBuilder: (_, _) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final item = _items[index];
                        return ListTile(
                          title: Text(item.name),
                          subtitle: Text(
                            [
                              item.alertFrequency ?? 'instant',
                              if ((item.newResultCount ?? 0) > 0)
                                '${item.newResultCount} new',
                            ].join(' · '),
                          ),
                          trailing: IconButton(
                            icon: const Icon(Icons.delete_outline),
                            onPressed: () => _delete(item),
                          ),
                        );
                      },
                    ),
    );
  }
}
