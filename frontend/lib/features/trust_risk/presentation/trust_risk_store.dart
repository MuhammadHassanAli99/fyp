import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../../core/result/async_state.dart';
import '../data/trust_risk_api.dart';

class TrustRiskStore {
  TrustRiskStore(this._api);

  final TrustRiskApi _api;
  final status = signal<AsyncState<TrustRiskStatus>>(const AsyncIdle());

  Future<void> load() async {
    status.value = AsyncLoading(previous: status.value.dataOrNull);
    final result = await _api.me();
    result.when(
      success: (data) => status.value = AsyncData(data),
      failure: (message, code) => status.value = AsyncError(message, code: code),
    );
  }
}
