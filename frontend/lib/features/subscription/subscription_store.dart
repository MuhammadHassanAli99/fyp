import 'dart:async';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/subscription_models.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/repositories/subscriptions_repository.dart';
import '../../data/services/realtime_client.dart';

class SubscriptionStore {
  SubscriptionStore(this._repo, this._auth, [this._realtime]);

  final SubscriptionsRepository _repo;
  final AuthRepository _auth;
  final RealtimeClient? _realtime;

  final snapshot = signal<AsyncState<SubscriptionSnapshot>>(const AsyncIdle());
  final plans = signal<AsyncState<List<SubscriptionPlan>>>(const AsyncIdle());
  final invoices = signal<AsyncState<List<SubscriptionInvoice>>>(const AsyncIdle());
  final busy = signal(false);
  final errorMessage = signal<String?>(null);
  final interval = signal('monthly');

  StreamSubscription<RealtimeEvent>? _sub;

  bool get isGuest => _auth.isGuest || !_auth.hasActiveSession;

  void listen() {
    _sub?.cancel();
    _sub = _realtime?.events.listen((event) {
      if (event.name == 'subscription:updated' || event.name == 'connected') {
        unawaited(load());
      }
    });
  }

  void dispose() {
    _sub?.cancel();
  }

  Future<void> load() async {
    if (isGuest) {
      snapshot.value = const AsyncError('Sign in to manage your plan');
      plans.value = const AsyncData([]);
      invoices.value = const AsyncData([]);
      return;
    }
    snapshot.value = AsyncLoading(previous: snapshot.value.dataOrNull);
    plans.value = AsyncLoading(previous: plans.value.dataOrNull);
    invoices.value = AsyncLoading(previous: invoices.value.dataOrNull);

    final current = await _repo.current();
    final catalog = await _repo.listPlans();
    final bills = await _repo.invoices();

    current.when(
      success: (data) => snapshot.value = AsyncData(data),
      failure: (m, code) => snapshot.value = AsyncError(m, code: code),
    );
    catalog.when(
      success: (data) => plans.value = AsyncData(data),
      failure: (m, code) => plans.value = AsyncError(m, code: code),
    );
    bills.when(
      success: (data) => invoices.value = AsyncData(data),
      failure: (m, code) => invoices.value = AsyncError(m, code: code),
    );
  }

  Future<Result<CheckoutResult>> selectPlan(SubscriptionPlan plan) async {
    errorMessage.value = null;
    busy.value = true;
    final currentCode = snapshot.value.dataOrNull?.entitlements.planCode;
    final result = currentCode == null || currentCode == 'free'
        ? await _repo.checkout(planCode: plan.code, billingInterval: interval.value)
        : await _repo.change(planCode: plan.code, billingInterval: interval.value);

    if (result case Success(:final data)) {
      if (data.requiresPayment && data.orderUuid != null) {
        busy.value = false;
        return result;
      }
      await load();
    } else if (result case Failure(:final message)) {
      errorMessage.value = message;
    }
    busy.value = false;
    return result;
  }

  Future<Result<void>> cancelAtPeriodEnd() async {
    busy.value = true;
    final result = await _repo.cancel(when: 'period_end');
    busy.value = false;
    result.when(
      success: (_) => unawaited(load()),
      failure: (m, _) => errorMessage.value = m,
    );
    return result;
  }

  Future<Result<void>> resume() async {
    busy.value = true;
    final result = await _repo.resume();
    busy.value = false;
    result.when(
      success: (_) => unawaited(load()),
      failure: (m, _) => errorMessage.value = m,
    );
    return result;
  }
}
