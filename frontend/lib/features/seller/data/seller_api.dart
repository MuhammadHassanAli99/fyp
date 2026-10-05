import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/result/result.dart';
import 'seller_models.dart';

class SellerApi {
  SellerApi(this._client);
  final ApiClient _client;

  Future<Result<SellerSummary>> summary(SellerQuery query) async {
    try {
      final data = await _client.get(
        '/seller/dashboard/summary',
        queryParameters: query.toQuery(),
        parser: (d) => SellerSummary.fromJson(Map<String, dynamic>.from(d as Map)),
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> module(String path, SellerQuery query) async {
    try {
      final data = await _client.get(
        '/seller/dashboard/$path',
        queryParameters: query.toQuery(),
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{'value': d},
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
