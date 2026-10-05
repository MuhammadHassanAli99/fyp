import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'analytics_store.dart';
import 'data/analytics_models.dart';

const _sections = <(String, String)>[
  ('overview', 'Overview'),
  ('sales', 'Sales'),
  ('rentals', 'Rentals'),
  ('revenue', 'Revenue'),
  ('traffic', 'Traffic'),
  ('conversion', 'Conversion'),
  ('retention', 'Retention'),
  ('user-growth', 'Growth'),
  ('country', 'Country'),
  ('city', 'City'),
  ('device', 'Device'),
  ('os', 'OS'),
  ('heatmaps', 'Heatmaps'),
  ('ai-insights', 'Insights'),
];

class AnalyticsDashboard extends StatefulWidget {
  const AnalyticsDashboard({
    super.key,
    this.embedded = false,
    this.showFilters,
    this.marketplace,
    this.period,
    this.companyId,
  });

  final bool embedded;
  final bool? showFilters;
  final String? marketplace;
  final String? period;
  final int? companyId;

  @override
  State<AnalyticsDashboard> createState() => _AnalyticsDashboardState();
}

class _AnalyticsDashboardState extends State<AnalyticsDashboard> {
  late final AnalyticsStore _store;

  @override
  void initState() {
    super.initState();
    _store = AnalyticsStore(ServiceLocator.instance.analyticsApi);
    _store.apply(
      marketplace: widget.marketplace,
      period: widget.period,
      companyId: widget.companyId,
      clearMarketplace: widget.marketplace == null,
      clearCompany: widget.companyId == null,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _store.load();
      final session = ServiceLocator.instance.prefs.deviceId;
      if (session != null && session.length >= 8) {
        _store.pingSession(session);
      }
    });
  }

  @override
  void didUpdateWidget(covariant AnalyticsDashboard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.marketplace != widget.marketplace ||
        oldWidget.period != widget.period ||
        oldWidget.companyId != widget.companyId) {
      _store.apply(
        marketplace: widget.marketplace,
        period: widget.period,
        companyId: widget.companyId,
        clearMarketplace: widget.marketplace == null,
        clearCompany: widget.companyId == null,
      );
      _store.load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final compact = context.isCompact;
    final body = SignalBuilder(
      builder: (context) {
        return Column(
          children: [
            if (widget.showFilters ?? !widget.embedded) _FilterBar(store: _store, compact: compact),
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  for (final item in _sections)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(item.$2),
                        selected: _store.section.value == item.$1,
                        onSelected: (_) => _store.loadSection(item.$1),
                        selectedColor: AppColors.gold.withValues(alpha: 0.25),
                      ),
                    ),
                ],
              ),
            ),
            Expanded(child: _Body(store: _store, compact: compact)),
          ],
        );
      },
    );

    if (widget.embedded) return body;
    return AppScaffold(
      title: compact ? 'Analytics' : 'Platform analytics',
      actions: [
        IconButton(
          tooltip: 'Export CSV',
          icon: const Icon(Icons.download_outlined),
          onPressed: () async {
            final csv = await _store.exportCurrent();
            if (!context.mounted) return;
            if (csv == null) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Export needs analytics.export permission.')),
              );
              return;
            }
            await Clipboard.setData(ClipboardData(text: csv.csv));
            if (!context.mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Copied ${csv.filename}')),
            );
          },
        ),
      ],
      body: body,
    );
  }
}

class _FilterBar extends StatelessWidget {
  const _FilterBar({required this.store, required this.compact});
  final AnalyticsStore store;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final allowed = store.filtersOrNull?.marketplaces ?? const ['gold', 'property', 'vehicles'];
    final markets = <(String?, String)>[
      (null, 'All markets'),
      if (allowed.contains('gold')) ('gold', 'Gold'),
      if (allowed.contains('property')) ('property', 'Property'),
      if (allowed.contains('vehicles')) ('vehicles', 'Vehicles'),
    ];
    return Padding(
      padding: EdgeInsets.fromLTRB(compact ? 12 : 16, 8, compact ? 12 : 16, 4),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          for (final op in markets)
            ChoiceChip(
              label: Text(op.$2),
              selected: store.query.value.marketplace == op.$1,
              onSelected: (_) => store.setMarketplace(op.$1),
              selectedColor: AppColors.gold.withValues(alpha: 0.25),
            ),
          for (final op in ['today', '7d', '30d', '90d', '1y'])
            FilterChip(
              label: Text(op.toUpperCase()),
              selected: store.query.value.period == op,
              onSelected: (on) {
                if (on) store.setPeriod(op);
              },
            ),
        ],
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.store, required this.compact});
  final AnalyticsStore store;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final overviewState = store.overview.value;
    if (overviewState.isLoading && overviewState.dataOrNull == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (overviewState case AsyncError(:final message)) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(message),
              const SizedBox(height: 12),
              FilledButton(onPressed: store.load, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    if (store.section.value == 'overview') {
      final data = store.overviewOrNull;
      if (data == null) return const SizedBox.shrink();
      return RefreshIndicator(
        onRefresh: store.load,
        child: ListView(
          padding: EdgeInsets.fromLTRB(compact ? 12 : 20, 8, compact ? 12 : 20, 96),
          children: [
            if (data.mode != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  '${data.persona ?? ''} · ${data.mode}'.trim(),
                  style: Theme.of(context).textTheme.labelMedium,
                ),
              ),
            _KpiGrid(cards: data.cards, compact: compact),
            const SizedBox(height: 16),
            Text('Sales', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            _Line(series: data.salesSeries, compact: compact),
          ],
        ),
      );
    }

    final detail = store.detail.value;
    if (detail.isLoading && detail.dataOrNull == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (detail case AsyncError(:final message)) {
      return Center(child: Text(message));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [_SectionView(id: store.section.value, data: detail.dataOrNull ?? const {}, compact: compact)],
    );
  }
}

class _KpiGrid extends StatelessWidget {
  const _KpiGrid({required this.cards, required this.compact});
  final Map<String, dynamic> cards;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final items = [
      ('Sales', _money(cards['sales'])),
      ('Transactions', _count(cards['transactions'])),
      ('Users', _count(cards['users'])),
      ('Leads', _count(cards['leads'])),
      ('Views', _count(cards['views'])),
      ('DAU / MAU', '${(asDouble(cards['dauMau']) * 100).toStringAsFixed(1)}%'),
    ];
    final width = MediaQuery.sizeOf(context).width;
    final cross = compact ? 2 : width >= 1100 ? 3 : 2;
    return GridView.count(
      crossAxisCount: cross,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: compact ? 1.7 : 2.3,
      children: [
        for (final item in items)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.$2, style: Theme.of(context).textTheme.headlineSmall),
                  Text(item.$1, style: Theme.of(context).textTheme.labelMedium),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.series, required this.compact});
  final List<({String date, double value})> series;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    if (series.length < 2) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Text('No series yet. Totals fill after the hourly analytics rollup.'),
      );
    }
    final spots = <FlSpot>[
      for (var i = 0; i < series.length; i++) FlSpot(i.toDouble(), series[i].value),
    ];
    return SizedBox(
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
              belowBarData: BarAreaData(show: true, color: AppColors.gold.withValues(alpha: 0.18)),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionView extends StatelessWidget {
  const _SectionView({required this.id, required this.data, required this.compact});
  final String id;
  final Map<String, dynamic> data;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return switch (id) {
      'sales' => _Sales(data: data, compact: compact),
      'rentals' => _SimpleCards(compact: compact, items: [
          ('Rental revenue', _money(data['rentalRevenue'])),
          ('Bookings', _count(data['bookings'])),
          ('Average', _money(data['averageRentalPrice'])),
        ], series: _seriesFrom(data['series'])),
      'revenue' => _Revenue(data: data, compact: compact),
      'traffic' => _Traffic(data: data, compact: compact),
      'conversion' => _Funnel(data: data),
      'retention' => _Retention(data: data),
      'user-growth' => _Growth(data: data, compact: compact),
      'country' || 'city' => _Geo(data: data),
      'device' => _NamedList(data: data, labelKey: 'device', valueKey: 'users'),
      'os' => _NamedList(data: data, labelKey: 'os', valueKey: 'users'),
      'heatmaps' => _Heatmap(data: data),
      'ai-insights' => _Insights(data: data),
      _ => Text(data.toString()),
    };
  }
}

class _SimpleCards extends StatelessWidget {
  const _SimpleCards({required this.compact, required this.items, required this.series});
  final bool compact;
  final List<(String, String)> items;
  final List<({String date, double value})> series;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final item in items) Chip(label: Text('${item.$1}: ${item.$2}')),
          ],
        ),
        const SizedBox(height: 16),
        _Line(series: series, compact: compact),
      ],
    );
  }
}

class _Sales extends StatelessWidget {
  const _Sales({required this.data, required this.compact});
  final Map<String, dynamic> data;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final series = [
      for (final row in asMaps(data['series']))
        (date: row['date']?.toString() ?? '', value: asDouble(row['gross'])),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            Chip(label: Text('Gross ${_money(data['grossSales'])}')),
            Chip(label: Text('Net ${_money(data['netSales'])}')),
            Chip(label: Text('Tx ${_count(data['transactions'])}')),
            Chip(label: Text('Refunds ${_money(data['refunds'])}')),
          ],
        ),
        const SizedBox(height: 16),
        _Line(series: series, compact: compact),
        const SizedBox(height: 12),
        for (final row in asMaps(data['byKind']))
          ListTile(
            title: Text(row['label']?.toString() ?? 'kind'),
            trailing: Text(_money(row['sum'])),
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
    final bySource = Map<String, dynamic>.from(data['bySource'] as Map? ?? const {});
    final series = [
      for (final row in asMaps(data['series']))
        (date: row['date']?.toString() ?? '', value: asDouble(row['net'])),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Platform take (subscriptions, ads, promotions). Not GMV.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          children: [
            Chip(label: Text('Gross ${_money(data['grossRevenue'])}')),
            Chip(label: Text('Net ${_money(data['netRevenue'])}')),
            Chip(label: Text('Tax ${_money(data['taxes'])}')),
          ],
        ),
        const SizedBox(height: 8),
        for (final entry in bySource.entries)
          ListTile(title: Text(entry.key), trailing: Text(_money(entry.value))),
        _Line(series: series, compact: compact),
      ],
    );
  }
}

class _Traffic extends StatelessWidget {
  const _Traffic({required this.data, required this.compact});
  final Map<String, dynamic> data;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final totals = Map<String, dynamic>.from(data['totals'] as Map? ?? const {});
    final series = [
      for (final row in asMaps(data['series']))
        (date: row['date']?.toString() ?? '', value: asDouble(row['sessions'])),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          children: [
            Chip(label: Text('Sessions ${_count(totals['sessions'])}')),
            Chip(label: Text('Users ${_count(totals['users'])}')),
            Chip(label: Text('Page views ${_count(totals['pageViews'])}')),
          ],
        ),
        const SizedBox(height: 12),
        _Line(series: series, compact: compact),
        for (final row in asMaps(data['series']))
          ListTile(
            title: Text('${row['date']} · ${row['source']}'),
            trailing: Text(_count(row['sessions'])),
          ),
      ],
    );
  }
}

class _Funnel extends StatelessWidget {
  const _Funnel({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final steps = asMaps(data['steps']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(data['funnel']?.toString() ?? 'Funnel', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final step in steps)
          ListTile(
            leading: CircleAvatar(child: Text('${step['index'] ?? ''}')),
            title: Text(step['name']?.toString() ?? ''),
            subtitle: Text(
              '${_count(step['users'])} · from previous ${asDouble(step['conversionFromPrevious']).toStringAsFixed(1)}% · from start ${asDouble(step['conversionFromStart']).toStringAsFixed(1)}%',
            ),
          ),
        if (steps.isEmpty) const Text('Funnel fills after the hourly rollup.'),
      ],
    );
  }
}

class _Retention extends StatelessWidget {
  const _Retention({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final points = asMaps(data['points']);
    return Column(
      children: [
        for (final point in points)
          ListTile(
            title: Text('Day ${point['day']}'),
            subtitle: Text('${_count(point['retained'])} of ${_count(point['cohortSize'])}'),
            trailing: Text('${asDouble(point['retentionPct']).toStringAsFixed(1)}%'),
          ),
        if (points.isEmpty) const Text('Retention cohorts fill after signups appear in rollups.'),
      ],
    );
  }
}

class _Growth extends StatelessWidget {
  const _Growth({required this.data, required this.compact});
  final Map<String, dynamic> data;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final totals = Map<String, dynamic>.from(data['totals'] as Map? ?? const {});
    final series = [
      for (final row in asMaps(data['series']))
        (date: row['date']?.toString() ?? '', value: asDouble(row['newUsers'])),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          children: [
            Chip(label: Text('New ${_count(totals['newUsers'])}')),
            Chip(label: Text('DAU ${_count(totals['dau'])}')),
            Chip(label: Text('WAU ${_count(totals['wau'])}')),
            Chip(label: Text('MAU ${_count(totals['mau'])}')),
            Chip(label: Text('DAU/MAU ${(asDouble(totals['dauMau']) * 100).toStringAsFixed(1)}%')),
          ],
        ),
        const SizedBox(height: 12),
        _Line(series: series, compact: compact),
      ],
    );
  }
}

class _Geo extends StatelessWidget {
  const _Geo({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final items = asMaps(data['items']);
    return Column(
      children: [
        const ListTile(
          subtitle: Text('City and country aggregates only. Precise GPS is not stored.'),
        ),
        for (final row in items)
          ListTile(
            title: Text(row['name']?.toString() ?? ''),
            subtitle: Text(
              'Sales ${_money(row['sales'])} · Leads ${_count(row['leads'])} · Listings ${_count(row['listings'])}',
            ),
          ),
        if (items.isEmpty) const Text('No geo rollups for this period yet.'),
      ],
    );
  }
}

class _NamedList extends StatelessWidget {
  const _NamedList({required this.data, required this.labelKey, required this.valueKey});
  final Map<String, dynamic> data;
  final String labelKey;
  final String valueKey;

  @override
  Widget build(BuildContext context) {
    final items = asMaps(data['items']);
    return Column(
      children: [
        for (final row in items)
          ListTile(
            title: Text(row[labelKey]?.toString() ?? 'unknown'),
            trailing: Text(_count(row[valueKey])),
          ),
        if (items.isEmpty) const Text('No device/OS events rolled up yet.'),
      ],
    );
  }
}

class _Heatmap extends StatelessWidget {
  const _Heatmap({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final points = asMaps(data['points']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(data['privacy']?.toString() ?? 'Aggregates only.', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 8),
        for (final point in points)
          ListTile(
            title: Text(point['name']?.toString() ?? ''),
            trailing: Text(_count(point['weight'])),
          ),
        if (points.isEmpty) const Text('No heatmap weight yet.'),
      ],
    );
  }
}

class _Insights extends StatelessWidget {
  const _Insights({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final items = asMaps(data['items']);
    return Column(
      children: [
        const ListTile(
          subtitle: Text('Rule-based from daily_metrics. Anomaly is not a fraud decision.'),
        ),
        for (final row in items)
          Card(
            child: ListTile(
              title: Text(row['insight']?.toString() ?? ''),
              subtitle: Text('${row['kind']} · ${row['severity']}\n${row['body'] ?? ''}'),
              isThreeLine: true,
            ),
          ),
        if (items.isEmpty) const Text('No insights for this window.'),
      ],
    );
  }
}

List<({String date, double value})> _seriesFrom(dynamic raw) {
  if (raw is! List) return const [];
  return [
    for (final row in raw)
      if (row is Map)
        (
          date: (row['date'] ?? '').toString(),
          value: asDouble(row['value'] ?? row['gross'] ?? row['revenue'] ?? row['net']),
        ),
  ];
}

String _money(dynamic value) => asDouble(value).toStringAsFixed(2);
String _count(dynamic value) => asDouble(value).toStringAsFixed(0);
