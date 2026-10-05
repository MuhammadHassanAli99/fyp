import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/app_routes.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/guest_feature.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../../features/analytics/analytics_dashboard.dart';
import 'data/seller_models.dart';
import 'seller_screen.dart';
import 'seller_store.dart';

class SellerShell extends StatefulWidget {
  const SellerShell({super.key});

  @override
  State<SellerShell> createState() => _SellerShellState();
}

class _SellerShellState extends State<SellerShell> {
  late final SellerStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.sellerStore;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (ServiceLocator.instance.authRepository.isGuest) return;
      _store.bootstrap();
    });
  }

  @override
  Widget build(BuildContext context) {
    final compact = context.isCompact;
    final extended = context.isDesktop;

    return AppScaffold(
      title: compact ? 'Dashboard' : 'Seller dashboard',
      actions: [
        IconButton(
          tooltip: 'Advertise',
          icon: const Icon(Icons.campaign_outlined),
          onPressed: () => context.push(AppRoutes.advertise),
        ),
        IconButton(
          tooltip: 'Notifications',
          icon: const Icon(Icons.notifications_outlined),
          onPressed: () => context.push(AppRoutes.notifications),
        ),
      ],
      body: GuestGate(
        feature: GuestFeature.account,
        message: 'Sign in to open your seller dashboard.',
        child: SignalBuilder(
          builder: (context) {
            final current = _store.module.value;
            var index = sellerCatalog.indexWhere((item) => item.id == current);
            if (index < 0) index = 0;

            return Column(
              children: [
                _FilterBar(store: _store, compact: compact),
                if (compact)
                  SizedBox(
                    height: 48,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 12),
                      children: [
                        for (final item in sellerCatalog)
                          Padding(
                            padding: const EdgeInsets.only(right: 8),
                            child: ChoiceChip(
                              label: Text(item.label),
                              selected: item.id == current,
                              onSelected: (_) => _store.loadModule(item.id),
                              selectedColor: AppColors.gold.withValues(alpha: 0.25),
                            ),
                          ),
                      ],
                    ),
                  ),
                Expanded(
                  child: Row(
                    children: [
                      if (!compact)
                        NavigationRail(
                          extended: extended,
                          selectedIndex: index,
                          onDestinationSelected: (i) =>
                              _store.loadModule(sellerCatalog[i].id),
                          labelType: extended
                              ? NavigationRailLabelType.none
                              : NavigationRailLabelType.all,
                          destinations: [
                            for (final item in sellerCatalog)
                              NavigationRailDestination(
                                icon: Icon(_icon(item.iconName)),
                                label: Text(item.label),
                              ),
                          ],
                        ),
                      if (!compact) const VerticalDivider(width: 1),
                      Expanded(
                        child: _SellerBody(store: _store, compact: compact),
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.store, required this.compact});
  final SellerStore store;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final summary = store.summaryOrNull;
    final companies = summary?.header.companies ?? const <SellerCompany>[];
    return Padding(
      padding: EdgeInsets.fromLTRB(compact ? 12 : 16, 8, compact ? 12 : 16, 4),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          for (final op in [
            (null, 'All markets'),
            ('gold', 'Gold'),
            ('property', 'Property'),
            ('vehicles', 'Vehicles'),
          ])
            ChoiceChip(
              label: Text(op.$2),
              selected: store.marketplace.value == op.$1,
              onSelected: (_) => store.setMarketplace(op.$1),
              selectedColor: AppColors.gold.withValues(alpha: 0.25),
            ),
          for (final op in ['today', '7d', '30d', '90d', '1y'])
            FilterChip(
              label: Text(op.toUpperCase()),
              selected: store.period.value == op,
              onSelected: (on) {
                if (on) store.setPeriod(op);
              },
            ),
          if (companies.length > 1)
            DropdownButton<int?>(
              value: store.companyId.value,
              hint: const Text('Company'),
              items: [
                const DropdownMenuItem(value: null, child: Text('All companies')),
                for (final company in companies)
                  DropdownMenuItem(value: company.id, child: Text(company.name)),
              ],
              onChanged: store.setCompany,
            ),
        ],
      ),
    );
  }
}

class _SellerBody extends StatelessWidget {
  const _SellerBody({required this.store, required this.compact});
  final SellerStore store;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final module = store.module.value;
    if (module == 'listings') return const SellerListingsPanel();
    if (module == 'analytics') {
      return AnalyticsDashboard(
        embedded: true,
        marketplace: store.marketplace.value,
        period: store.period.value,
        companyId: store.companyId.value,
      );
    }

    final summaryState = store.summary.value;
    if (summaryState.isLoading && summaryState.dataOrNull == null) {
      return const LoadingView(message: 'Loading dashboard…');
    }
    if (summaryState case AsyncError(:final message)) {
      return EmptyState(
        title: 'Could not load dashboard',
        subtitle: message,
        action: FilledButton(onPressed: store.refresh, child: const Text('Retry')),
      );
    }

    if (module == 'overview') {
      return _Overview(store: store, compact: compact);
    }

    final detail = store.detail.value;
    if (detail.isLoading && detail.dataOrNull == null) {
      return const LoadingView(message: 'Loading…');
    }
    if (detail case AsyncError(:final message)) {
      return EmptyState(
        title: 'Could not load this module',
        subtitle: message,
        action: FilledButton(
          onPressed: () => store.loadModule(module),
          child: const Text('Retry'),
        ),
      );
    }
    final data = detail.dataOrNull ?? const <String, dynamic>{};
    return switch (module) {
      'revenue' => _Revenue(data: data, compact: compact),
      'views' => _Views(data: data, compact: compact),
      'leads' => _Leads(data: data),
      'messages' => _Messages(data: data),
      'followers' => _Followers(data: data),
      'promotions' => _Promotions(data: data),
      'invoices' => _Invoices(data: data),
      'subscription' => _Subscription(data: data),
      _ => _Overview(store: store, compact: compact),
    };
  }
}

class _Overview extends StatelessWidget {
  const _Overview({required this.store, required this.compact});
  final SellerStore store;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final summary = store.summaryOrNull;
    if (summary == null) return const SizedBox.shrink();
    final header = summary.header;
    final listings = summary.listings;
    return RefreshIndicator(
      onRefresh: store.refresh,
      child: ListView(
        padding: EdgeInsets.fromLTRB(compact ? 12 : 20, 8, compact ? 12 : 20, 96),
        children: [
          _Identity(header: header),
          const SizedBox(height: 12),
          _CardGrid(
            compact: compact,
            items: [
              ('Revenue', _money(summary.card('revenue')), Icons.payments_outlined, 'revenue'),
              ('Views', _count(summary.card('views')), Icons.visibility_outlined, 'views'),
              ('Leads', _count(summary.card('leads')), Icons.handshake_outlined, 'leads'),
              ('Messages', _count(summary.card('messages')), Icons.chat_outlined, 'messages'),
              ('Followers', _count(summary.card('followers')), Icons.group_outlined, 'followers'),
              ('Listings', _count(summary.card('listings')), Icons.inventory_2_outlined, 'listings'),
            ],
            onTap: store.loadModule,
          ),
          const SizedBox(height: 16),
          Text('Listings', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final entry in [
                ('Live', listings['published']),
                ('Draft', listings['draft']),
                ('Review', listings['pendingReview']),
                ('Expired', listings['expired']),
                ('Sold', listings['sold']),
                ('Featured', listings['featured']),
              ])
                Chip(label: Text('${entry.$1}: ${_count(entry.$2 as num? ?? 0)}')),
            ],
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            children: [
              ActionChip(
                label: const Text('Verification'),
                avatar: const Icon(Icons.verified_outlined, size: 18),
                onPressed: () => context.push(AppRoutes.verification),
              ),
              ActionChip(
                label: const Text('Promote'),
                avatar: const Icon(Icons.campaign_outlined, size: 18),
                onPressed: () => context.push(AppRoutes.advertise),
              ),
              ActionChip(
                label: const Text('Plan'),
                avatar: const Icon(Icons.card_membership_outlined, size: 18),
                onPressed: () => context.push(AppRoutes.subscription),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _Identity extends StatelessWidget {
  const _Identity({required this.header});
  final SellerHeader header;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundImage:
              header.avatarUrl != null ? NetworkImage(header.avatarUrl!) : null,
          child: header.avatarUrl == null
              ? Text((header.displayName ?? 'S').substring(0, 1).toUpperCase())
              : null,
        ),
        title: Text(header.displayName ?? 'Seller'),
        subtitle: Text(
          [
            header.persona.replaceAll('_', ' '),
            if (header.planName != null) header.planName,
            if (header.trustBand != null) 'Trust ${header.trustBand}',
            if (header.verificationStatus != null) header.verificationStatus,
          ].join(' · '),
        ),
      ),
    );
  }
}

class _CardGrid extends StatelessWidget {
  const _CardGrid({
    required this.items,
    required this.compact,
    required this.onTap,
  });

  final List<(String, String, IconData, String)> items;
  final bool compact;
  final void Function(String id) onTap;

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    final cross = compact ? 2 : width >= 1100 ? 3 : 2;
    return GridView.count(
      crossAxisCount: cross,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: compact ? 1.55 : 2.2,
      children: [
        for (final item in items)
          InkWell(
            onTap: () => onTap(item.$4),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(item.$3, color: AppColors.gold),
                    const Spacer(),
                    Text(item.$2, style: Theme.of(context).textTheme.headlineSmall),
                    Text(item.$1, style: Theme.of(context).textTheme.labelMedium),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _Revenue extends StatelessWidget {
  const _Revenue({required this.data, required this.compact});
  final Map<String, dynamic> data;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _CardGrid(
          compact: compact,
          onTap: (_) {},
          items: [
            ('Gross', _money(data['grossSales']), Icons.payments_outlined, 'revenue'),
            ('Net', _money(data['netRevenue']), Icons.account_balance_outlined, 'revenue'),
            ('Refunds', _money(data['refunds']), Icons.undo_outlined, 'revenue'),
            ('Ad spend', _money(data['advertisingSpend']), Icons.campaign_outlined, 'revenue'),
          ],
        ),
        const SizedBox(height: 12),
        Text('By marketplace', style: Theme.of(context).textTheme.titleMedium),
        for (final row in _maps(data['byMarketplace']))
          ListTile(
            title: Text(row['marketplace']?.toString() ?? ''),
            trailing: Text(_money(row['amount'])),
          ),
      ],
    );
  }
}

class _Views extends StatelessWidget {
  const _Views({required this.data, required this.compact});
  final Map<String, dynamic> data;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final series = _maps(data['series']);
    final spots = <FlSpot>[
      for (var i = 0; i < series.length; i++)
        FlSpot(i.toDouble(), ((series[i]['views'] as num?) ?? 0).toDouble()),
    ];
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _CardGrid(
          compact: compact,
          onTap: (_) {},
          items: [
            ('Views', _count(data['totalViews']), Icons.visibility_outlined, 'views'),
            ('Unique', _count(data['uniqueVisitors']), Icons.person_outline, 'views'),
            ('Search', _count(data['searchImpressions']), Icons.search, 'views'),
            ('Impressions', _count(data['impressions']), Icons.ads_click, 'views'),
          ],
        ),
        const SizedBox(height: 16),
        if (spots.length >= 2)
          SizedBox(
            height: compact ? 180 : 260,
            child: LineChart(
              LineChartData(
                minY: 0,
                gridData: const FlGridData(show: false),
                borderData: FlBorderData(show: false),
                titlesData: const FlTitlesData(show: false),
                lineBarsData: [
                  LineChartBarData(
                    spots: spots,
                    color: AppColors.gold,
                    isCurved: true,
                    barWidth: 3,
                    dotData: const FlDotData(show: false),
                    belowBarData: BarAreaData(
                      show: true,
                      color: AppColors.gold.withValues(alpha: 0.18),
                    ),
                  ),
                ],
              ),
            ),
          )
        else
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Text('No daily view series yet. Totals use listing counters until the rollup fills.'),
          ),
      ],
    );
  }
}

class _Leads extends StatelessWidget {
  const _Leads({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final pipeline = Map<String, dynamic>.from(data['pipeline'] as Map? ?? const {});
    final items = _maps(data['items']);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Wrap(
          spacing: 8,
          children: [
            for (final entry in pipeline.entries)
              Chip(label: Text('${entry.key}: ${entry.value}')),
          ],
        ),
        const SizedBox(height: 8),
        for (final item in items)
          ListTile(
            title: Text(item['title']?.toString() ?? 'Lead'),
            subtitle: Text(
              [
                item['status'],
                item['source'],
                item['marketplace'],
                item['engine'],
              ].where((e) => e != null && e.toString().isNotEmpty).join(' · '),
            ),
          ),
        if (items.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Text('No leads in this period'),
          ),
      ],
    );
  }
}

class _Messages extends StatelessWidget {
  const _Messages({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final items = _maps(data['items']);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Wrap(
          spacing: 8,
          children: [
            Chip(label: Text('Unread ${data['unread'] ?? 0}')),
            Chip(label: Text('Threads ${data['listingThreads'] ?? 0}')),
          ],
        ),
        for (final item in items)
          ListTile(
            title: Text(item['peerName']?.toString() ?? item['subject']?.toString() ?? 'Conversation'),
            subtitle: Text(item['preview']?.toString() ?? ''),
            trailing: Text('${item['unreadCount'] ?? 0}'),
            onTap: () {
              final uuid = item['uuid']?.toString();
              if (uuid != null) context.push('/chat/$uuid');
            },
          ),
        if (items.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Text('No messages in your inbox'),
          ),
      ],
    );
  }
}

class _Followers extends StatelessWidget {
  const _Followers({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ListTile(title: const Text('Followers'), trailing: Text(_count(data['totalFollowers']))),
        ListTile(title: const Text('New this period'), trailing: Text(_count(data['newFollowers']))),
        ListTile(title: const Text('Listing saves'), trailing: Text(_count(data['listingFollowers']))),
        ListTile(title: const Text('Company followers'), trailing: Text(_count(data['companyFollowers']))),
        const SizedBox(height: 8),
        Text(
          'Unfollow history is not stored. Listing “followers” are favorite counts.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

class _Promotions extends StatelessWidget {
  const _Promotions({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final promotions = _maps(data['listingPromotions']);
    final campaigns = _maps(data['campaigns']);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.tonal(
            onPressed: () => context.push(AppRoutes.advertise),
            child: const Text('Open ads'),
          ),
        ),
        const SizedBox(height: 8),
        Text('Listing promotions', style: Theme.of(context).textTheme.titleMedium),
        for (final row in promotions)
          ListTile(
            title: Text(row['title']?.toString() ?? row['kind']?.toString() ?? 'Promotion'),
            subtitle: Text('${row['kind']} · ${row['status']}'),
            trailing: Text(_money(row['amount'])),
          ),
        if (promotions.isEmpty) const ListTile(title: Text('No listing promotions')),
        const SizedBox(height: 8),
        Text('Campaigns', style: Theme.of(context).textTheme.titleMedium),
        for (final row in campaigns)
          ListTile(
            title: Text(row['name']?.toString() ?? 'Campaign'),
            subtitle: Text('${row['status']} · spent ${_money(row['spentAmount'])}'),
          ),
      ],
    );
  }
}

class _Invoices extends StatelessWidget {
  const _Invoices({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final items = _maps(data['items']);
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text(
          'Download uses the existing invoice PDF route. Emailing invoices is not available.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        for (final row in items)
          ListTile(
            title: Text(row['invoiceNumber']?.toString() ?? row['uuid']?.toString() ?? 'Invoice'),
            subtitle: Text('${row['status']} · ${row['currency'] ?? ''}'),
            trailing: Text(_money(row['totalAmount'])),
          ),
        if (items.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24),
            child: Text('No invoices'),
          ),
      ],
    );
  }
}

class _Subscription extends StatelessWidget {
  const _Subscription({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final sub = data['subscription'];
    final map = sub is Map ? Map<String, dynamic>.from(sub) : const <String, dynamic>{};
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ListTile(
          title: Text(map['planName']?.toString() ?? 'Free'),
          subtitle: Text('${map['status'] ?? 'none'} · ${map['planCode'] ?? ''}'),
        ),
        if (data['overLimit'] == true)
          ListTile(
            leading: const Icon(Icons.warning_amber, color: AppColors.gold),
            title: Text(data['overLimitMessage']?.toString() ?? 'Over a plan limit'),
          ),
        FilledButton(
          onPressed: () => context.push(AppRoutes.subscription),
          child: const Text('Manage subscription'),
        ),
      ],
    );
  }
}

List<Map<String, dynamic>> _maps(dynamic value) => (value as List? ?? const [])
    .whereType<Map>()
    .map((e) => Map<String, dynamic>.from(e))
    .toList();

String _count(dynamic value) => ((value as num?) ?? 0).round().toString();

String _money(dynamic value) {
  final amount = (value as num?)?.toDouble() ?? 0;
  return amount.toStringAsFixed(2);
}

IconData _icon(String name) => switch (name) {
      'payments' => Icons.payments_outlined,
      'visibility' => Icons.visibility_outlined,
      'handshake' => Icons.handshake_outlined,
      'chat' => Icons.chat_outlined,
      'group' => Icons.group_outlined,
      'inventory_2' => Icons.inventory_2_outlined,
      'insights' => Icons.insights_outlined,
      'campaign' => Icons.campaign_outlined,
      'receipt' => Icons.receipt_long_outlined,
      'card_membership' => Icons.card_membership_outlined,
      _ => Icons.dashboard_outlined,
    };
