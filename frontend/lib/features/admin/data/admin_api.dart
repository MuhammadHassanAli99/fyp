import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/result/result.dart';
import 'admin_models.dart';

class AdminApi {
  AdminApi(this._client);
  final ApiClient _client;

  Future<Result<AdminSession>> session() async {
    try {
      final data = await _client.get(
        '/admin/me',
        parser: (d) => AdminSession.fromJson(Map<String, dynamic>.from(d as Map)),
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> summary() => _mapGet('/admin/summary');
  Future<Result<Map<String, dynamic>>> health() => _mapGet('/admin/health');
  Future<Result<Map<String, dynamic>>> fraud() => _mapGet('/admin/fraud');
  Future<Result<Map<String, dynamic>>> security() => _mapGet('/admin/security');
  Future<Result<Map<String, dynamic>>> kyc() => _mapGet('/admin/kyc');
  Future<Result<Map<String, dynamic>>> moderation({String? status}) =>
      _mapGet('/admin/moderation', query: {'status': ?status});
  Future<Result<Map<String, dynamic>>> analytics() => _mapGet('/admin/analytics');
  Future<Result<dynamic>> approvals() => _get('/admin/approvals');
  Future<Result<dynamic>> roles() => _get('/admin/roles');
  Future<Result<dynamic>> countries() => _get('/admin/countries');
  Future<Result<dynamic>> languages() => _get('/admin/languages');
  Future<Result<dynamic>> currencies() => _get('/admin/currencies');
  Future<Result<dynamic>> categories({int? marketplaceId}) => _get(
        '/admin/categories',
        query: {'marketplaceId': ?marketplaceId},
      );

  Future<Result<AdminPage>> list(String path, {int page = 1, String? q, String? status}) async {
    try {
      final result = await _client.get(
        path,
        queryParameters: {
          'page': page,
          'perPage': 30,
          if (q != null && q.isNotEmpty) 'q': q,
          if (status != null && status.isNotEmpty) 'status': status,
        },
        parserWithMeta: (data, meta) {
          final items = (data as List? ?? [])
              .map((e) => Map<String, dynamic>.from(e as Map))
              .toList();
          return AdminPage(
            items: items,
            page: (meta?['page'] as num?)?.toInt() ?? page,
            perPage: (meta?['perPage'] as num?)?.toInt() ?? 30,
            total: (meta?['total'] as num?)?.toInt() ?? items.length,
            hasMore: meta?['hasMore'] as bool? ?? false,
          );
        },
      );
      return Success(result);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> getById(String path) => _mapGet(path);

  Future<Result<Map<String, dynamic>>> post(
    String path, {
    Map<String, dynamic>? data,
  }) async {
    try {
      final result = await _client.post(
        path,
        data: data ?? const {},
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{'data': d},
      );
      return Success(result);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<Map<String, dynamic>>> _mapGet(String path, {Map<String, dynamic>? query}) async {
    try {
      final data = await _client.get(
        path,
        queryParameters: query,
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{'value': d},
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<dynamic>> _get(String path, {Map<String, dynamic>? query}) async {
    try {
      final data = await _client.get(path, queryParameters: query, parser: (d) => d);
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
