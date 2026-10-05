import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/payment_models.dart';
import '../remote/payments_api.dart';

class PaymentsRepository {
  PaymentsRepository(this._api);
  final PaymentsApi _api;

  Future<Result<PaymentCheckout>> getOrder(String orderUuid) =>
      _wrap(() => _api.getOrder(orderUuid));

  Future<Result<PaymentMethodOffer>> methods() => _wrap(() => _api.methods());

  Future<Result<void>> simulate(String orderUuid) => _wrap(() => _api.simulate(orderUuid));

  Future<Result<Map<String, dynamic>>> submitProof({
    required String orderUuid,
    required String storagePath,
    required String mimeType,
  }) =>
      _wrap(
        () => _api.submitProof(
          orderUuid: orderUuid,
          storagePath: storagePath,
          mimeType: mimeType,
        ),
      );

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
