import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/subscription_models.dart';
import '../remote/subscriptions_api.dart';

class SubscriptionsRepository {
  SubscriptionsRepository(this._api);
  final SubscriptionsApi _api;

  Future<Result<List<SubscriptionPlan>>> listPlans() =>
      _wrap(() => _api.listPlans());

  Future<Result<SubscriptionSnapshot>> current() => _wrap(() => _api.current());

  Future<Result<List<SubscriptionInvoice>>> invoices() =>
      _wrap(() => _api.invoices());

  Future<Result<CheckoutResult>> checkout({
    required String planCode,
    String billingInterval = 'monthly',
    String gatewayCode = 'manual',
  }) =>
      _wrap(
        () => _api.checkout(
          planCode: planCode,
          billingInterval: billingInterval,
          gatewayCode: gatewayCode,
        ),
      );

  Future<Result<CheckoutResult>> change({
    required String planCode,
    String billingInterval = 'monthly',
    String gatewayCode = 'manual',
  }) =>
      _wrap(
        () => _api.change(
          planCode: planCode,
          billingInterval: billingInterval,
          gatewayCode: gatewayCode,
        ),
      );

  Future<Result<void>> cancel({String when = 'period_end', String? reason}) =>
      _wrap(() => _api.cancel(when: when, reason: reason));

  Future<Result<void>> resume() => _wrap(() => _api.resume());

  Future<Result<void>> simulatePayment(String orderUuid) =>
      _wrap(() => _api.simulatePayment(orderUuid));

  Future<Result<T>> _wrap<T>(Future<T> Function() run) async {
    try {
      return Success(await run());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
