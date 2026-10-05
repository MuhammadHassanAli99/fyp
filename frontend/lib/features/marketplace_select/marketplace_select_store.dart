import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../data/models/marketplace_model.dart';
import '../../data/repositories/catalog_repository.dart';
import '../../data/repositories/settings_repository.dart';

class MarketplaceSelectStore {
  MarketplaceSelectStore(this._catalog, this._settings);

  final CatalogRepository _catalog;
  final SettingsRepository _settings;

  final marketplaces = signal<AsyncState<List<MarketplaceModel>>>(const AsyncIdle());
  final selected = signal<String?>(null);

  Future<void> load() async {
    marketplaces.value = const AsyncLoading();
    final result = await _catalog.marketplaces();
    result.when(
      success: (list) {
        marketplaces.value = AsyncData(list);
        if (list.isEmpty) {
          selected.value = _settings.marketplaceCode;
          return;
        }
        selected.value = _settings.marketplaceCode ?? list.first.code;
      },
      failure: (m, code) => marketplaces.value = AsyncError(m, code: code),
    );
  }

  Future<void> select(String code) async {
    selected.value = code;
    await _settings.setMarketplace(code);
  }
}
