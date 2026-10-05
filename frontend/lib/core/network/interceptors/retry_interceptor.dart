import 'package:dio/dio.dart';

class RetryInterceptor extends Interceptor {
  RetryInterceptor(this._dio, {this.maxRetries = 3});

  final Dio _dio;
  final int maxRetries;

  static const _retryMethods = {'GET', 'HEAD', 'OPTIONS'};

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final options = err.requestOptions;
    final retryCount = options.extra['retryCount'] as int? ?? 0;

    if (!_shouldRetry(err, options.method, retryCount)) {
      handler.next(err);
      return;
    }

    final delay = Duration(milliseconds: 300 * (1 << retryCount));
    await Future<void>.delayed(delay);

    options.extra['retryCount'] = retryCount + 1;

    try {
      final response = await _dio.fetch(options);
      handler.resolve(response);
    } catch (e) {
      if (e is DioException) {
        handler.next(e);
      } else {
        handler.next(err);
      }
    }
  }

  bool _shouldRetry(DioException err, String method, int retryCount) {
    if (retryCount >= maxRetries) return false;
    if (!_retryMethods.contains(method.toUpperCase())) return false;

    return err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.receiveTimeout ||
        err.type == DioExceptionType.connectionError ||
        (err.response?.statusCode != null && err.response!.statusCode! >= 500);
  }
}
