import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/result/result.dart';

class SecurityApi {
  SecurityApi(this._client);
  final ApiClient _client;

  Future<Result<Map<String, dynamic>>> policy() => _mapGet('/security/policy');
  Future<Result<Map<String, dynamic>>> me() => _mapGet('/security/me');
  Future<Result<Map<String, dynamic>>> applicability() =>
      _mapGet('/security/privacy/applicability');
  Future<Result<List<Map<String, dynamic>>>> consents() => _mapList('/security/privacy/consents');
  Future<Result<List<Map<String, dynamic>>>> requests() => _mapList('/security/privacy/requests');

  Future<Result<Map<String, dynamic>>> updateConsent({
    required String consentType,
    required bool granted,
  }) async {
    try {
      final data = await _client.post(
        '/security/privacy/consents',
        data: {'consentType': consentType, 'granted': granted},
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> createRequest({
    required String kind,
    String? notes,
  }) async {
    try {
      final data = await _client.post(
        '/security/privacy/requests',
        data: {'kind': kind, 'notes': ?notes},
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> revokeOtherSessions() async {
    try {
      final data = await _client.post(
        '/security/sessions/revoke-others',
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> _mapGet(String path) async {
    try {
      final data = await _client.get(
        path,
        parser: (d) => d is Map ? Map<String, dynamic>.from(d) : <String, dynamic>{},
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<List<Map<String, dynamic>>>> _mapList(String path) async {
    try {
      final data = await _client.get(
        path,
        parser: (d) {
          if (d is List) {
            return d.map((e) => Map<String, dynamic>.from(e as Map)).toList();
          }
          return const <Map<String, dynamic>>[];
        },
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }
}
