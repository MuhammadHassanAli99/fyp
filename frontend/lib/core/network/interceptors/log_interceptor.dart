import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

class AppLogInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (kDebugMode) {
      debugPrint('→ ${options.method} ${options.uri}');
    }
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if (kDebugMode) {
      debugPrint(
        '← ${response.statusCode} ${response.requestOptions.uri} '
        '(${response.extra['duration_ms'] ?? '?'}ms)',
      );
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (kDebugMode) {
      debugPrint('✕ ${err.requestOptions.uri}: ${err.message}');
      final data = err.response?.data;
      if (data is Map && data['error'] is Map) {
        debugPrint('  ${(data['error'] as Map)['message']} (${(data['error'] as Map)['code']})');
      }
    }
    handler.next(err);
  }
}

class TimingInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.extra['start_ms'] = DateTime.now().millisecondsSinceEpoch;
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    final start = response.requestOptions.extra['start_ms'] as int?;
    if (start != null) {
      response.extra['duration_ms'] =
          DateTime.now().millisecondsSinceEpoch - start;
    }
    handler.next(response);
  }
}
