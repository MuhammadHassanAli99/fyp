import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../../core/result/async_state.dart';
import '../../../core/result/result.dart';
import 'data/security_api.dart';

class SecurityStore {
  SecurityStore(this._api);
  final SecurityApi _api;

  final policy = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final consents = signal<AsyncState<List<Map<String, dynamic>>>>(const AsyncIdle());
  final requests = signal<AsyncState<List<Map<String, dynamic>>>>(const AsyncIdle());
  final applicability = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final busy = signal(false);
  String? lastError;

  Future<void> load() async {
    policy.value = AsyncLoading(previous: policy.value.dataOrNull);
    consents.value = AsyncLoading(previous: consents.value.dataOrNull);
    requests.value = AsyncLoading(previous: requests.value.dataOrNull);
    applicability.value = AsyncLoading(previous: applicability.value.dataOrNull);

    (await _api.policy()).when(
      success: (data) => policy.value = AsyncData(data),
      failure: (m, c) => policy.value = AsyncError(m, code: c),
    );
    (await _api.applicability()).when(
      success: (data) => applicability.value = AsyncData(data),
      failure: (m, c) => applicability.value = AsyncError(m, code: c),
    );
    (await _api.consents()).when(
      success: (data) => consents.value = AsyncData(data),
      failure: (m, c) => consents.value = AsyncError(m, code: c),
    );
    (await _api.requests()).when(
      success: (data) => requests.value = AsyncData(data),
      failure: (m, c) => requests.value = AsyncError(m, code: c),
    );
  }

  Future<Result<Map<String, dynamic>>> setConsent(String type, bool granted) async {
    busy.value = true;
    final result = await _api.updateConsent(consentType: type, granted: granted);
    busy.value = false;
    result.when(
      success: (_) => load(),
      failure: (m, _) => lastError = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> submit(String kind) async {
    busy.value = true;
    final result = await _api.createRequest(kind: kind);
    busy.value = false;
    result.when(
      success: (_) => load(),
      failure: (m, _) => lastError = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> revokeOthers() => _api.revokeOtherSessions();
}
