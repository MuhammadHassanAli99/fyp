import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/payment_models.dart';
import '../../data/repositories/payments_repository.dart';
import '../../data/services/realtime_client.dart';

class CheckoutStore {
  CheckoutStore(this._repo, this.orderUuid, [this._realtime]);

  final PaymentsRepository _repo;
  final String orderUuid;
  final RealtimeClient? _realtime;

  final checkout = signal<AsyncState<PaymentCheckout>>(const AsyncIdle());
  final methods = signal<AsyncState<PaymentMethodOffer>>(const AsyncIdle());
  final busy = signal(false);
  final message = signal<String?>(null);

  StreamSubscription<RealtimeEvent>? _sub;
  Timer? _poll;

  void listen() {
    _sub?.cancel();
    _sub = _realtime?.events.listen((event) {
      if (event.name == 'payment:updated' || event.name == 'connected') {
        unawaited(refresh());
      }
    });
  }

  void startPolling() {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 2), (_) {
      final current = checkout.value.dataOrNull;
      if (current != null && !current.isOpen) {
        _poll?.cancel();
        return;
      }
      unawaited(refresh());
    });
  }

  void dispose() {
    _sub?.cancel();
    _poll?.cancel();
  }

  Future<void> load() async {
    checkout.value = AsyncLoading(previous: checkout.value.dataOrNull);
    methods.value = AsyncLoading(previous: methods.value.dataOrNull);
    final order = await _repo.getOrder(orderUuid);
    final offer = await _repo.methods();
    order.when(
      success: (data) => checkout.value = AsyncData(data),
      failure: (m, code) => checkout.value = AsyncError(m, code: code),
    );
    offer.when(
      success: (data) => methods.value = AsyncData(data),
      failure: (_, _) => methods.value = methods.value,
    );
  }

  Future<void> refresh() async {
    final order = await _repo.getOrder(orderUuid);
    order.when(
      success: (data) => checkout.value = AsyncData(data),
      failure: (_, _) {},
    );
  }

  Future<Result<void>> completeTestPayment() async {
    busy.value = true;
    message.value = null;
    final result = await _repo.simulate(orderUuid);
    await refresh();
    busy.value = false;
    result.when(
      success: (_) {},
      failure: (m, _) => message.value = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> submitProof({
    required String storagePath,
    required String mimeType,
  }) async {
    busy.value = true;
    message.value = null;
    final result = await _repo.submitProof(
      orderUuid: orderUuid,
      storagePath: storagePath,
      mimeType: mimeType,
    );
    busy.value = false;
    result.when(
      success: (data) => message.value =
          data['settlesPayment'] == true
              ? null
              : 'Proof uploaded. This does not mark the payment as paid.',
      failure: (m, _) => message.value = m,
    );
    return result;
  }
}
