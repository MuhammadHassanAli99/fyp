import 'package:dio/dio.dart';

import '../../storage/secure_storage.dart';

class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor({
    required this._secureStorage,
    required this._refreshDio,
  });

  final SecureStorage _secureStorage;
  final Dio _refreshDio;

  Future<String?>? _refreshFuture;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _secureStorage.accessToken;
    if (token != null && token.isNotEmpty) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    if (err.response?.statusCode != 401) {
      handler.next(err);
      return;
    }

    final path = err.requestOptions.path;
    if (path.contains('/auth/refresh') || path.contains('/auth/login')) {
      handler.next(err);
      return;
    }

    // Guest sessions have no JWT — do not attempt refresh or clear tokens.
    final refresh = await _secureStorage.refreshToken;
    if (refresh == null || refresh.isEmpty) {
      handler.next(err);
      return;
    }

    try {
      final newToken = await _refreshToken();
      if (newToken == null) {
        await _secureStorage.clearTokens();
        handler.next(err);
        return;
      }

      final opts = err.requestOptions;
      opts.headers['Authorization'] = 'Bearer $newToken';
      final response = await _refreshDio.fetch(opts);
      handler.resolve(response);
    } catch (_) {
      await _secureStorage.clearTokens();
      handler.next(err);
    }
  }

  Future<String?> _refreshToken() async {
    _refreshFuture ??= _doRefresh();
    try {
      return await _refreshFuture;
    } finally {
      _refreshFuture = null;
    }
  }

  Future<String?> _doRefresh() async {
    final refresh = await _secureStorage.refreshToken;
    if (refresh == null || refresh.isEmpty) return null;

    final response = await _refreshDio.post<Map<String, dynamic>>(
      '/auth/refresh',
      data: {'refreshToken': refresh},
    );

    final envelope = response.data;
    if (envelope == null || envelope['success'] != true) return null;

    final data = envelope['data'] as Map<String, dynamic>?;
    if (data == null) return null;

    final tokensMap = data['tokens'] is Map<String, dynamic>
        ? data['tokens'] as Map<String, dynamic>
        : data;
    final access = tokensMap['accessToken'] as String?;
    final newRefresh = tokensMap['refreshToken'] as String? ?? refresh;
    if (access == null) return null;

    await _secureStorage.saveTokens(
      accessToken: access,
      refreshToken: newRefresh,
    );
    return access;
  }
}
