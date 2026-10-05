import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import 'data/analytics_api.dart';
import 'data/analytics_models.dart';

class AnalyticsStore {
  AnalyticsStore(this._api);

  final AnalyticsApi _api;

  final query = signal(const AnalyticsQuery());
  final section = signal('overview');
  final filters = signal<AsyncState<AnalyticsFilters>>(const AsyncIdle());
  final overview = signal<AsyncState<AnalyticsOverview>>(const AsyncIdle());
  final detail = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());

  AnalyticsFilters? get filtersOrNull => filters.value.dataOrNull;
  AnalyticsOverview? get overviewOrNull => overview.value.dataOrNull;

  void apply({
    String? marketplace,
    int? companyId,
    String? period,
    bool clearMarketplace = false,
    bool clearCompany = false,
  }) {
    query.value = query.value.copyWith(
      marketplace: marketplace,
      companyId: companyId,
      period: period,
      clearMarketplace: clearMarketplace,
      clearCompany: clearCompany,
    );
  }

  Future<void> load() async {
    final q = query.value;
    overview.value = AsyncLoading(previous: overview.value.dataOrNull);
    filters.value = AsyncLoading(previous: filters.value.dataOrNull);
    final results = await Future.wait([
      _api.report('overview', q),
      _api.report('filters', q),
    ]);
    results[0].when(
      success: (data) => overview.value = AsyncData(AnalyticsOverview.fromJson(data)),
      failure: (message, code) => overview.value = AsyncError(message, code: code),
    );
    results[1].when(
      success: (data) => filters.value = AsyncData(AnalyticsFilters.fromJson(data)),
      failure: (message, code) => filters.value = AsyncError(message, code: code),
    );
    await loadSection(section.value);
  }

  Future<void> loadSection(String id) async {
    section.value = id;
    if (id == 'overview') {
      detail.value = const AsyncIdle();
      return;
    }
    final path = switch (id) {
      'user-growth' => 'user-growth',
      'ai-insights' => 'ai-insights',
      _ => id,
    };
    detail.value = AsyncLoading(previous: detail.value.dataOrNull);
    final result = await _api.report(path, query.value);
    result.when(
      success: (data) => detail.value = AsyncData(data),
      failure: (message, code) => detail.value = AsyncError(message, code: code),
    );
  }

  Future<void> setMarketplace(String? code) async {
    apply(marketplace: code, clearMarketplace: code == null);
    await load();
  }

  Future<void> setPeriod(String period) async {
    apply(period: period);
    await load();
  }

  Future<ResultCsv?> exportCurrent() async {
    final path = section.value == 'overview' ? 'overview' : section.value;
    final result = await _api.report(path, AnalyticsQuery(
      marketplace: query.value.marketplace,
      companyId: query.value.companyId,
      sellerId: query.value.sellerId,
      period: query.value.period,
      from: query.value.from,
      to: query.value.to,
      funnel: query.value.funnel,
      heatmap: query.value.heatmap,
      exportCsv: true,
    ));
    return result.when(
      success: (data) {
        final exported = data['export'];
        if (exported is Map && exported['csv'] != null) {
          return ResultCsv(
            csv: exported['csv'].toString(),
            filename: exported['filename']?.toString() ?? 'analytics.csv',
          );
        }
        return null;
      },
      failure: (_, _) => null,
    );
  }

  Future<void> pingSession(String sessionId) async {
    unawaited(_api.ingest(eventName: 'session.started', sessionId: sessionId));
  }
}

class ResultCsv {
  const ResultCsv({required this.csv, required this.filename});
  final String csv;
  final String filename;
}
