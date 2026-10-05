import '../../core/network/api_client.dart';
import '../models/payment_models.dart';

class PaymentsApi {
  PaymentsApi(this._client);
  final ApiClient _client;

  Future<PaymentCheckout> getOrder(String orderUuid) => _client.get(
        '/payments/orders/$orderUuid',
        parser: (data) => PaymentCheckout.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<PaymentMethodOffer> methods() => _client.get(
        '/payments/methods',
        parser: (data) => PaymentMethodOffer.fromJson(Map<String, dynamic>.from(data as Map)),
      );

  Future<void> simulate(String orderUuid) => _client.post(
        '/payments/orders/$orderUuid/simulate',
        parser: (_) {},
      );

  Future<Map<String, dynamic>> submitProof({
    required String orderUuid,
    required String storagePath,
    required String mimeType,
  }) =>
      _client.post(
        '/payments/orders/$orderUuid/proof',
        data: {'storagePath': storagePath, 'mimeType': mimeType},
        parser: (data) => Map<String, dynamic>.from(data as Map),
      );
}
