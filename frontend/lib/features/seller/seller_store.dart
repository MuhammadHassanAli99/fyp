import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import 'data/seller_api.dart';
import 'data/seller_models.dart';

class SellerStore {
  SellerStore(this._api);

  final SellerApi _api;

  final summary = signal<AsyncState<SellerSummary>>(const AsyncIdle());
  final detail = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final module = signal('overview');
  final marketplace = signal<String?>(null);
  final period = signal('30d');
  final companyId = signal<int?>(null);

  SellerQuery get query => SellerQuery(
        marketplace: marketplace.value,
        companyId: companyId.value,
        period: period.value,
      );

  SellerSummary? get summaryOrNull => summary.value.dataOrNull;

  Future<void> bootstrap() async {
    await refresh();
  }

  Future<void> refresh() async {
    await Future.wait([
      _loadSummary(),
      loadModule(module.value),
    ]);
  }

  Future<void> _loadSummary() async {
    summary.value = AsyncLoading(previous: summary.value.dataOrNull);
    final result = await _api.summary(query);
    result.when(
      success: (data) {
        summary.value = AsyncData(data);
        final companies = data.header.companies;
        final selected = companyId.value;
        if (selected != null && companies.every((c) => c.id != selected)) {
          companyId.value = null;
        }
      },
      failure: (message, code) => summary.value = AsyncError(message, code: code),
    );
  }

  Future<void> loadModule(String id) async {
    module.value = id;
    if (id == 'overview' || id == 'listings' || id == 'analytics') {
      detail.value = const AsyncIdle();
      return;
    }
    final path = switch (id) {
      'plan' || 'subscription' => 'subscription',
      _ => id,
    };
    detail.value = AsyncLoading(previous: detail.value.dataOrNull);
    final result = await _api.module(path, query);
    result.when(
      success: (data) => detail.value = AsyncData(data),
      failure: (message, code) => detail.value = AsyncError(message, code: code),
    );
  }

  Future<void> setMarketplace(String? code) async {
    marketplace.value = code;
    await refresh();
  }

  Future<void> setPeriod(String value) async {
    period.value = value;
    await refresh();
  }

  Future<void> setCompany(int? id) async {
    companyId.value = id;
    await refresh();
  }
}
