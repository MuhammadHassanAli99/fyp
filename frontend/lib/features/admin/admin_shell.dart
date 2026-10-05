import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../features/analytics/analytics_dashboard.dart';
import 'admin_store.dart';

class AdminShell extends StatefulWidget {
  const AdminShell({super.key, this.initialModule});

  final String? initialModule;

  @override
  State<AdminShell> createState() => _AdminShellState();
}

class _AdminShellState extends State<AdminShell> {
  late final AdminStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.adminStore;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (widget.initialModule != null) _store.module.value = widget.initialModule!;
      _store.bootstrap();
    });
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final compact = width < 720;
    final extended = width >= 1100;

    return SignalBuilder(
      builder: (context) {
        final sessionState = _store.session.value;
        if (sessionState.hasError && sessionState.dataOrNull == null) {
          return Scaffold(
            appBar: AppBar(title: const Text('Control Plane')),
            body: Center(child: Text(sessionState.errorMessage ?? 'Access denied')),
          );
        }

        final modules = _store.modulesFor(compact: compact);
        final current = _store.module.value;
        var index = modules.indexWhere((item) => item.id == current);
        if (index < 0) index = 0;

        return Scaffold(
          appBar: AppBar(
            title: Text(compact ? 'Control Plane' : 'Admin Control Plane'),
            actions: [
              if (!compact)
                SizedBox(
                  width: 240,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 8),
                    child: TextField(
                      decoration: const InputDecoration(
                        hintText: 'Search',
                        isDense: true,
                        prefixIcon: Icon(Icons.search, size: 18),
                      ),
                      onSubmitted: (value) {
                        _store.query.value = value;
                        _store.loadModule(_store.module.value);
                      },
                    ),
                  ),
                ),
            ],
          ),
          body: Row(
            children: [
              if (!compact)
                NavigationRail(
                  extended: extended,
                  selectedIndex: index,
                  onDestinationSelected: (i) => _store.loadModule(modules[i].id),
                  labelType: extended ? NavigationRailLabelType.none : NavigationRailLabelType.all,
                  destinations: [
                    for (final item in modules)
                      NavigationRailDestination(
                        icon: Icon(_icon(item.iconName)),
                        label: Text(item.label),
                      ),
                  ],
                ),
              if (!compact) const VerticalDivider(width: 1),
              Expanded(child: _AdminBody(store: _store, compact: compact)),
            ],
          ),
          bottomNavigationBar: compact && modules.isNotEmpty
              ? NavigationBar(
                  selectedIndex: index.clamp(0, modules.length - 1),
                  onDestinationSelected: (i) => _store.loadModule(modules[i].id),
                  destinations: [
                    for (final item in modules)
                      NavigationDestination(
                        icon: Icon(_icon(item.iconName)),
                        label: item.label,
                      ),
                  ],
                )
              : null,
        );
      },
    );
  }
}

class _AdminBody extends StatelessWidget {
  const _AdminBody({required this.store, required this.compact});
  final AdminStore store;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(
      builder: (context) {
        final id = store.module.value;
        if (id == 'dashboard') return _Dashboard(store: store);
        if (id == 'analytics') return const AnalyticsDashboard(embedded: true, showFilters: true);
        if (id == 'system_health' || id == 'fraud' || id == 'moderation' || id == 'kyc' || id == 'security') {
          return _DetailPane(store: store, title: id);
        }
        return _ListPane(store: store, compact: compact);
      },
    );
  }
}

class _Dashboard extends StatelessWidget {
  const _Dashboard({required this.store});
  final AdminStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(
      builder: (context) {
        final state = store.summary.value;
        if (state.isLoading && state.dataOrNull == null) {
          return const Center(child: CircularProgressIndicator());
        }
        if (state.hasError && state.dataOrNull == null) {
          return Center(child: Text(state.errorMessage ?? 'Unable to load dashboard'));
        }
        final data = state.dataOrNull ?? const <String, dynamic>{};
        final tiles = <_Tile>[
          if (data['users'] is Map)
            _Tile('Users', '${(data['users'] as Map)['total']}', 'Last 24h ${(data['users'] as Map)['last24h']}'),
          if (data['listings'] is Map)
            _Tile('Listings', '${(data['listings'] as Map)['total']}', 'Pending ${(data['listings'] as Map)['pendingReview']}'),
          if (data['moderation'] is Map)
            _Tile('Moderation', '${(data['moderation'] as Map)['pending']}', 'Open queue'),
          if (data['support'] is Map)
            _Tile('Support', '${(data['support'] as Map)['openTickets']}', 'Open tickets'),
          if (data['fraud'] is Map)
            _Tile('Fraud', '${(data['fraud'] as Map)['openCases']}', 'Open cases'),
          if (data['kyc'] is Map)
            _Tile('KYC', '${(data['kyc'] as Map)['pending']}', 'Pending reviews'),
          if (data['sales'] is Map)
            _Tile('Sales', '${(data['sales'] as Map)['openLeads']}', 'Open leads'),
          if (data['health'] is Map)
            _Tile('Health', '${(data['health'] as Map)['status']}', '${(data['health'] as Map)['environment']}'),
        ];
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text('Marketplace control plane', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 6),
            Text(
              'Gold, Property and Vehicles share this plane. Access is permission- and scope-based.',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.goldMuted),
            ),
            const SizedBox(height: 20),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                for (final tile in tiles)
                  SizedBox(
                    width: 240,
                    child: Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(tile.label, style: Theme.of(context).textTheme.labelLarge),
                            const SizedBox(height: 8),
                            Text(tile.value, style: Theme.of(context).textTheme.headlineMedium),
                            const SizedBox(height: 4),
                            Text(tile.hint, style: Theme.of(context).textTheme.bodySmall),
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _Tile {
  const _Tile(this.label, this.value, this.hint);
  final String label;
  final String value;
  final String hint;
}

class _DetailPane extends StatelessWidget {
  const _DetailPane({required this.store, required this.title});
  final AdminStore store;
  final String title;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(
      builder: (context) {
        final state = store.detail.value;
        if (state.isLoading && state.dataOrNull == null) {
          return const Center(child: CircularProgressIndicator());
        }
        if (state.hasError && state.dataOrNull == null) {
          return Center(child: Text(state.errorMessage ?? 'Unable to load'));
        }
        return ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Text(title.replaceAll('_', ' '), style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: SelectableText(
                  _pretty(state.dataOrNull ?? const {}),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _ListPane extends StatelessWidget {
  const _ListPane({required this.store, required this.compact});
  final AdminStore store;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(
      builder: (context) {
        final state = store.page.value;
        if (state.isLoading && state.dataOrNull == null) {
          return const Center(child: CircularProgressIndicator());
        }
        if (state.hasError && state.dataOrNull == null) {
          return Center(child: Text(state.errorMessage ?? 'Unable to load'));
        }
        final page = state.dataOrNull;
        final items = page?.items ?? const [];
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Row(
                children: [
                  Text(
                    '${store.module.value} · ${page?.total ?? items.length}',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const Spacer(),
                  if (store.module.value == 'listings')
                    TextButton(
                      onPressed: () {},
                      child: const Text('Staff actions require a selected row'),
                    ),
                ],
              ),
            ),
            Expanded(
              child: ListView.separated(
                itemCount: items.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final item = items[index];
                  final title = (item['title'] ??
                          item['displayName'] ??
                          item['legalName'] ??
                          item['email'] ??
                          item['name'] ??
                          item['subject'] ??
                          item['code'] ??
                          item['uuid'] ??
                          item['id'])
                      .toString();
                  final subtitle = [
                    if (item['status'] != null) item['status'],
                    if (item['email'] != null && item['email'] != title) item['email'],
                    if (item['kind'] != null) item['kind'],
                    if (item['number'] != null) item['number'],
                  ].join(' · ');
                  return ListTile(
                    title: Text(title),
                    subtitle: subtitle.isEmpty ? null : Text(subtitle),
                    trailing: _rowActions(context, store, item),
                    onTap: compact ? null : () => _openDetail(context, store, item),
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }
}

Widget? _rowActions(BuildContext context, AdminStore store, Map<String, dynamic> item) {
  final id = item['id'];
  final uuid = item['uuid']?.toString();
  if (store.module.value == 'listings' && id != null) {
    return PopupMenuButton<String>(
      onSelected: (action) async {
        final reason = await _askReason(context, action);
        if (reason == null) return;
        await store.act('/admin/listings/$id/$action', {'reason': reason, 'confirm': true});
      },
      itemBuilder: (_) => const [
        PopupMenuItem(value: 'approve', child: Text('Approve')),
        PopupMenuItem(value: 'reject', child: Text('Reject')),
        PopupMenuItem(value: 'suspend', child: Text('Suspend')),
        PopupMenuItem(value: 'feature', child: Text('Feature')),
        PopupMenuItem(value: 'restore', child: Text('Restore')),
      ],
    );
  }
  if (store.module.value == 'users' && id != null) {
    return PopupMenuButton<String>(
      onSelected: (status) async {
        final reason = await _askReason(context, status);
        if (reason == null) return;
        await store.act('/admin/users/$id/status', {
          'status': status,
          'reason': reason,
          'confirm': true,
        });
      },
      itemBuilder: (_) => const [
        PopupMenuItem(value: 'suspended', child: Text('Suspend')),
        PopupMenuItem(value: 'banned', child: Text('Ban')),
        PopupMenuItem(value: 'active', child: Text('Restore')),
      ],
    );
  }
  if (store.module.value == 'approvals' && uuid != null) {
    return TextButton(
      onPressed: () async {
        await store.act('/admin/approvals/$uuid', {'decision': 'approved', 'reason': 'Approved from Control Plane'});
      },
      child: const Text('Approve'),
    );
  }
  if (store.module.value == 'support' && uuid != null) {
    return const Icon(Icons.chevron_right);
  }
  return null;
}

Future<void> _openDetail(BuildContext context, AdminStore store, Map<String, dynamic> item) async {
  await showDialog<void>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Record'),
      content: SizedBox(
        width: 520,
        child: SelectableText(_pretty(item)),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Close')),
      ],
    ),
  );
}

Future<String?> _askReason(BuildContext context, String action) async {
  final controller = TextEditingController(text: action);
  final result = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(action),
      content: TextField(
        controller: controller,
        decoration: const InputDecoration(labelText: 'Reason'),
        minLines: 2,
        maxLines: 4,
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(
          onPressed: () => Navigator.pop(context, controller.text.trim()),
          child: const Text('Confirm'),
        ),
      ],
    ),
  );
  if (result == null || result.length < 3) return null;
  return result;
}

String _pretty(Object value) {
  try {
    return const JsonEncoder.withIndent('  ').convert(value);
  } catch (_) {
    return value.toString();
  }
}

IconData _icon(String name) => switch (name) {
      'dashboard' => Icons.space_dashboard_outlined,
      'verified' => Icons.verified_outlined,
      'monitor_heart' => Icons.monitor_heart_outlined,
      'support_agent' => Icons.support_agent_outlined,
      'security' => Icons.security_outlined,
      'badge' => Icons.badge_outlined,
      'people' => Icons.people_outlined,
      'apartment' => Icons.apartment_outlined,
      'admin_panel_settings' => Icons.admin_panel_settings_outlined,
      'inventory_2' => Icons.inventory_2_outlined,
      'category' => Icons.category_outlined,
      'public' => Icons.public_outlined,
      'translate' => Icons.translate_outlined,
      'payments' => Icons.payments_outlined,
      'card_membership' => Icons.card_membership_outlined,
      'account_balance' => Icons.account_balance_outlined,
      'gavel' => Icons.gavel_outlined,
      'reviews' => Icons.reviews_outlined,
      'campaign' => Icons.campaign_outlined,
      'insights' => Icons.insights_outlined,
      'summarize' => Icons.summarize_outlined,
      'article' => Icons.article_outlined,
      'notifications' => Icons.notifications_outlined,
      'point_of_sale' => Icons.point_of_sale_outlined,
      'history' => Icons.history_outlined,
      'policy' => Icons.policy_outlined,
      _ => Icons.circle_outlined,
    };
