import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/auth/guest_feature.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/search_models.dart';
import '../../shared/widgets/app_scaffold.dart';

class SearchSavedScreen extends StatefulWidget {
  const SearchSavedScreen({super.key});

  @override
  State<SearchSavedScreen> createState() => _SearchSavedScreenState();
}

class _SearchSavedScreenState extends State<SearchSavedScreen> {
  List<SavedSearchRecord> _items = const [];
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
    final result = await ServiceLocator.instance.searchRepository.saved();
    if (!mounted) return;
    result.when(
      success: (items) => setState(() {
        _items = items;
        _loading = false;
      }),
      failure: (message, _) => setState(() {
        _error = message;
        _loading = false;
      }),
    );
  }

  Future<void> _setFrequency(SavedSearchRecord item, String frequency) async {
    await ServiceLocator.instance.searchRepository.updateSaved(
      item.id,
      alertFrequency: frequency,
    );
    await _load();
  }

  Future<void> _toggle(SavedSearchRecord item) async {
    await ServiceLocator.instance.searchRepository.updateSaved(
      item.id,
      isActive: !item.isActive,
    );
    await _load();
  }

  Future<void> _delete(SavedSearchRecord item) async {
    await ServiceLocator.instance.searchRepository.deleteSaved(item.id);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final allowed = ServiceLocator.instance.guestFeatureGuard.allows(GuestFeature.saveSearch);
    return AppScaffold(
      title: 'Saved searches & alerts',
      body: !allowed
          ? EmptyState(
              title: 'Sign in to save searches',
              subtitle: 'Saved searches store the normalised query and can alert you when matching listings are published.',
              action: FilledButton(
                onPressed: () => context.push(AppRoutes.login),
                child: const Text('Sign in'),
              ),
            )
          : _loading
              ? const LoadingView()
              : _error != null
                  ? EmptyState(
                      title: 'Could not load saved searches',
                      subtitle: _error,
                      action: FilledButton(onPressed: _load, child: const Text('Retry')),
                    )
                  : _items.isEmpty
                      ? const EmptyState(
                          title: 'No saved searches yet',
                          subtitle:
                              'Save a search from the search screen. Both the original text and the normalised filters are stored.',
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
                                  item.originalQuery ?? '',
                                  item.alertFrequency ?? 'instant',
                                  if ((item.newResultCount ?? 0) > 0)
                                    '${item.newResultCount} new',
                                  if (!item.isActive) 'paused',
                                ].where((e) => e.isNotEmpty).join(' · '),
                              ),
                              onTap: () {
                                final q = item.originalQuery ?? item.name;
                                context.push('${AppRoutes.search}?q=${Uri.encodeQueryComponent(q)}');
                              },
                              trailing: PopupMenuButton<String>(
                                onSelected: (value) {
                                  switch (value) {
                                    case 'instant':
                                    case 'daily':
                                    case 'weekly':
                                    case 'never':
                                      _setFrequency(item, value);
                                    case 'toggle':
                                      _toggle(item);
                                    case 'delete':
                                      _delete(item);
                                  }
                                },
                                itemBuilder: (_) => [
                                  const PopupMenuItem(value: 'instant', child: Text('Alert: instant')),
                                  const PopupMenuItem(value: 'daily', child: Text('Alert: daily')),
                                  const PopupMenuItem(value: 'weekly', child: Text('Alert: weekly')),
                                  const PopupMenuItem(value: 'never', child: Text('Alerts off')),
                                  PopupMenuItem(
                                    value: 'toggle',
                                    child: Text(item.isActive ? 'Pause' : 'Resume'),
                                  ),
                                  const PopupMenuItem(value: 'delete', child: Text('Delete')),
                                ],
                              ),
                            );
                          },
                        ),
    );
  }
}
