
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../storage/prefs_storage.dart';
import '../storage/secure_storage.dart';
import '../../features/trust_risk/data/device_security_service.dart';
import 'api_exception.dart';
import 'interceptors/auth_interceptor.dart';
import 'interceptors/context_interceptor.dart';
import 'interceptors/log_interceptor.dart';
import 'interceptors/retry_interceptor.dart';

abstract final class ApiConfig {
  /// Compile-time API origin.
  ///
  /// The localhost default exists so `flutter run` works with no extra flags.
  /// A release build must always override it:
  ///
  ///   flutter build appbundle --dart-define=API_BASE_URL=https://api.example.com/api/v1
  static const baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );

  /// Rejects a release build that would ship a non-production API origin.
  ///
  /// The previous version exempted local hosts from the check, which inverted
  /// the intent: the one URL guaranteed to be wrong in a published app — the
  /// localhost default, used whenever `--dart-define` is forgotten — was the
  /// only one allowed through. A store build would install fine and then fail
  /// every request against a server on the user's own device.
  ///
  /// Release builds now require an absolute https origin that is not loopback.
  static void assertSafeBaseUrl() {
    if (!kReleaseMode) return;

    final url = baseUrl.trim();
    final lower = url.toLowerCase();

    final isLoopback = lower.contains('localhost') ||
        lower.contains('127.0.0.1') ||
        lower.contains('0.0.0.0') ||
        lower.contains('[::1]') ||
        // The Android emulator's alias for the host machine.
        lower.contains('10.0.2.2');

    if (isLoopback) {
      throw StateError(
        'Release builds must not target a local API. '
        'Pass --dart-define=API_BASE_URL=https://<your-api-host>/api/v1 '
        '(currently "$url").',
      );
    }

    if (!lower.startsWith('https://')) {
      throw StateError(
        'Release builds require an https API_BASE_URL (currently "$url").',
      );
    }
  }
}

class ApiClient {
  ApiClient._({
    required this.dio,
    required this.refreshDio,
  });

  final Dio dio;
  final Dio refreshDio;

  static ApiClient? _instance;

  static ApiClient get instance {
    final inst = _instance;
    if (inst == null) {
      throw StateError('ApiClient not initialized. Call ApiClient.init first.');
    }
    return inst;
  }

  static Future<ApiClient> init({
    required SecureStorage secureStorage,
    required PrefsStorage prefs,
    DeviceSecurityService? security,
  }) async {
    if (_instance != null) return _instance!;
    ApiConfig.assertSafeBaseUrl();

    final refreshDio = Dio(
      BaseOptions(
        baseUrl: ApiConfig.baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      ),
    );

    final dio = Dio(
      BaseOptions(
        baseUrl: ApiConfig.baseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      ),
    );

    dio.interceptors.addAll([
      TimingInterceptor(),
      ContextInterceptor(prefs: prefs, security: security),
      AuthInterceptor(
        secureStorage: secureStorage,
        refreshDio: refreshDio,
      ),
      RetryInterceptor(dio),
      AppLogInterceptor(),
    ]);

    _instance = ApiClient._(dio: dio, refreshDio: refreshDio);
    return _instance!;
  }

  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
    T Function(dynamic json)? parser,
    T Function(dynamic data, Map<String, dynamic>? meta)? parserWithMeta,
  }) =>
      _request(
        () => dio.get<Map<String, dynamic>>(path, queryParameters: queryParameters),
        parser,
        parserWithMeta: parserWithMeta,
      );

  Future<T> post<T>(
    String path, {
    dynamic data,
    T Function(dynamic json)? parser,
    T Function(dynamic data, Map<String, dynamic>? meta)? parserWithMeta,
  }) =>
      _request(
        () => dio.post<Map<String, dynamic>>(path, data: data),
        parser,
        parserWithMeta: parserWithMeta,
      );

  Future<T> patch<T>(
    String path, {
    dynamic data,
    T Function(dynamic json)? parser,
    T Function(dynamic data, Map<String, dynamic>? meta)? parserWithMeta,
  }) =>
      _request(
        () => dio.patch<Map<String, dynamic>>(path, data: data),
        parser,
        parserWithMeta: parserWithMeta,
      );

  Future<T> put<T>(
    String path, {
    dynamic data,
    T Function(dynamic json)? parser,
    T Function(dynamic data, Map<String, dynamic>? meta)? parserWithMeta,
  }) =>
      _request(
        () => dio.put<Map<String, dynamic>>(path, data: data),
        parser,
        parserWithMeta: parserWithMeta,
      );

  Future<T> delete<T>(
    String path, {
    T Function(dynamic json)? parser,
    T Function(dynamic data, Map<String, dynamic>? meta)? parserWithMeta,
  }) =>
      _request(
        () => dio.delete<Map<String, dynamic>>(path),
        parser,
        parserWithMeta: parserWithMeta,
      );

  /// Binary PUT for signed local/remote upload URLs.
  Future<void> putBytes(
    String uploadUrl, {
    required List<int> bytes,
    required String contentType,
  }) async {
    var path = uploadUrl;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      final uri = Uri.parse(path);
      // Dio baseUrl already includes /api/v1 — strip that prefix from absolute URLs.
      final full = uri.path;
      path = full.startsWith('/api/v1') ? full.substring('/api/v1'.length) : full;
      if (path.isEmpty) path = '/';
    } else if (path.startsWith('/api/v1')) {
      path = path.substring('/api/v1'.length);
    }

    // Tokens contain `.` — keep path segments encoded safely for Express.
    final uri = Uri.parse(path.startsWith('/') ? path : '/$path');
    final encodedPath = uri.pathSegments
        .map(Uri.encodeComponent)
        .join('/');
    path = '/$encodedPath';

    try {
      final payload = bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
      final response = await dio.put<dynamic>(
        path,
        data: payload,
        options: Options(
          contentType: contentType,
          headers: {
            Headers.contentTypeHeader: contentType,
            Headers.contentLengthHeader: payload.length,
            // Avoid JSON default from BaseOptions for binary uploads.
            'Accept': '*/*',
          },
          responseType: ResponseType.json,
          validateStatus: (code) => code != null && code < 500,
        ),
      );
      if ((response.statusCode ?? 500) >= 400) {
        final data = response.data;
        final message = data is Map && data['error'] is Map
            ? (data['error']['message'] as String? ?? 'Upload failed')
            : 'Upload failed';
        throw ApiException(
          message: message,
          statusCode: response.statusCode,
        );
      }
    } on ApiException {
      rethrow;
    } on DioException catch (e) {
      throw NetworkException(
        message: e.message ?? 'Upload failed',
        code: e.type.name,
      );
    }
  }

  Future<T> _request<T>(
    Future<Response<Map<String, dynamic>>> Function() call,
    T Function(dynamic json)? parser, {
    T Function(dynamic data, Map<String, dynamic>? meta)? parserWithMeta,
  }) async {
    try {
      final response = await call();
      final body = response.data;
      if (body == null) {
        if (response.statusCode == 204 || response.statusCode == 205) {
          if (parserWithMeta != null) return parserWithMeta(null, null);
          if (parser != null) return parser(null);
          return null as T;
        }
        throw ApiException(message: 'Empty response', statusCode: response.statusCode);
      }

      if (body['success'] == true) {
        final data = body['data'];
        final meta = body['meta'] is Map
            ? Map<String, dynamic>.from(body['meta'] as Map)
            : null;
        if (parserWithMeta != null) return parserWithMeta(data, meta);
        if (parser != null) return parser(data);
        return data as T;
      }

      final error = body['error'] as Map<String, dynamic>?;
      throw ApiException(
        message: error?['message'] as String? ?? 'Request failed',
        code: error?['code'] as String?,
        statusCode: response.statusCode,
      );
    } on DioException catch (e) {
      if (e.error is ApiException) throw e.error as ApiException;

      if (e.response?.statusCode == 401) {
        throw UnauthorizedException();
      }

      final data = e.response?.data;
      if (data is Map<String, dynamic> && data['error'] is Map) {
        final err = data['error'] as Map<String, dynamic>;
        throw ApiException(
          message: err['message'] as String? ?? e.message ?? 'Network error',
          code: err['code'] as String?,
          statusCode: e.response?.statusCode,
        );
      }

      throw NetworkException(
        message: e.message ?? 'Network error',
        code: e.type.name,
      );
    }
  }
}
