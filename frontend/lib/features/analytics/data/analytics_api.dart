import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/result/result.dart';
import 'analytics_models.dart';

class AnalyticsApi {
  AnalyticsApi(this._client);
  final ApiClient _client;

  Future<Result<Map<String, dynamic>>> report(String path, AnalyticsQuery query) async {
    try {
      final data = await _client.get(
        '/analytics/$path',
        queryParameters: query.toQuery(),
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<void> ingest({
    required String eventName,
    String? sessionId,
    Map<String, dynamic>? properties,
  }) async {
    try {
      await _client.post(
        '/analytics/events',
        data: {
          'eventName': eventName,
          'sessionId': ?sessionId,
          'properties': ?properties,
        },
        parser: (_) {},
      );
    } catch (_) {}
  }
}
