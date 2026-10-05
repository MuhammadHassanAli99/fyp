import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/result/result.dart';

class TrustRiskStatus {
  const TrustRiskStatus({
    required this.state,
    required this.kycStatus,
    required this.identityVerified,
    required this.amlClear,
    required this.recentSecurityAlert,
  });

  factory TrustRiskStatus.fromJson(Map<String, dynamic> json) => TrustRiskStatus(
        state: json['state'] as String? ?? 'ok',
        kycStatus: json['kycStatus'] as String? ?? 'not_started',
        identityVerified: json['identityVerified'] == true,
        amlClear: json['amlClear'] != false,
        recentSecurityAlert: json['recentSecurityAlert'] == true,
      );

  final String state;
  final String kycStatus;
  final bool identityVerified;
  final bool amlClear;
  final bool recentSecurityAlert;

  bool get isRestricted => state == 'restricted';
  bool get needsVerification => state == 'verify';
}

class TrustRiskApi {
  TrustRiskApi(this._client);
  final ApiClient _client;

  Future<Result<TrustRiskStatus>> me() async {
    try {
      final data = await _client.get(
        '/risk/me',
        parser: (d) => TrustRiskStatus.fromJson(Map<String, dynamic>.from(d as Map)),
      );
      return Success(data);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
