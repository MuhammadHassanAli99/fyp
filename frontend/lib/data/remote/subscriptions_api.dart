import '../../core/network/api_client.dart';
import '../models/subscription_models.dart';

class SubscriptionsApi {
  SubscriptionsApi(this._client);
  final ApiClient _client;

  Future<List<SubscriptionPlan>> listPlans() => _client.get(
        '/subscriptions/plans',
        parser: (data) {
          final list = data is List ? data : const [];
          return list
              .whereType<Map>()
              .map((e) => SubscriptionPlan.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<SubscriptionSnapshot> current() => _client.get(
        '/subscriptions/current',
        parser: (data) => SubscriptionSnapshot.fromJson(
          Map<String, dynamic>.from(data as Map),
        ),
      );

  Future<List<SubscriptionInvoice>> invoices() => _client.get(
        '/subscriptions/invoices',
        parser: (data) {
          final list = data is List ? data : const [];
          return list
              .whereType<Map>()
              .map((e) => SubscriptionInvoice.fromJson(Map<String, dynamic>.from(e)))
              .toList();
        },
      );

  Future<CheckoutResult> checkout({
    required String planCode,
    String billingInterval = 'monthly',
    String gatewayCode = 'manual',
  }) =>
      _client.post(
        '/subscriptions/checkout',
        data: {
          'planCode': planCode,
          'billingInterval': billingInterval,
          'gatewayCode': gatewayCode,
        },
        parser: (data) => CheckoutResult.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<CheckoutResult> change({
    required String planCode,
    String billingInterval = 'monthly',
    String gatewayCode = 'manual',
  }) =>
      _client.post(
        '/subscriptions/change',
        data: {
          'planCode': planCode,
          'billingInterval': billingInterval,
          'gatewayCode': gatewayCode,
        },
        parser: (data) => CheckoutResult.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<void> cancel({String when = 'period_end', String? reason}) => _client.post(
        '/subscriptions/cancel',
        data: {
          'when': when,
          if (reason != null && reason.isNotEmpty) 'reason': reason,
        },
        parser: (_) {},
      );

  Future<void> resume() => _client.post('/subscriptions/resume', parser: (_) {});

  Future<void> simulatePayment(String orderUuid) => _client.post(
        '/payments/orders/$orderUuid/simulate',
        parser: (_) {},
      );
}
