import '../../core/network/api_client.dart';
import '../../core/platform/platform_info.dart';
import '../models/user_model.dart';

class AuthApi {
  AuthApi(this._client);
  final ApiClient _client;


  Future<LoginOutcome> login({
    required String identifier,
    required String password,
    String? channel,
    String? captchaToken,
  }) =>
      _client.post(
        '/auth/login',
        data: {
          'identifier': identifier,
          'password': password,
          'channel': ?channel,
          'captchaToken': ?captchaToken,
        },
        parser: (d) {
          final map = d as Map<String, dynamic>;
          if (map['otpRequired'] == true) {
            return LoginOtpNeeded(LoginChallenge.fromJson(map));
          }
          return LoginSession(AuthTokens.fromJson(map));
        },
      );

  Future<RegisterResult> register({
    required String password,
    required String name,
    required bool acceptedTerms,
    String? email,
    String? phone,
    String? countryCode,
    String? language,
    String? currency,
  }) =>
      _client.post(
        '/auth/register',
        data: {
          if (email != null && email.isNotEmpty) 'email': email,
          if (phone != null && phone.isNotEmpty) 'phone': phone,
          'password': password,
          'displayName': name,
          'acceptedTerms': acceptedTerms,
          'countryCode': ?countryCode,
          'language': ?language,
          'currency': ?currency,
        },
        parser: (d) => RegisterResult.fromJson(d as Map<String, dynamic>),
      );

  Future<LoginChallenge> resendLoginOtp({
    required String ticket,
    String? channel,
  }) =>
      _client.post(
        '/auth/login/otp',
        data: {
          'ticket': ticket,
          'channel': ?channel,
        },
        parser: (d) => LoginChallenge.fromJson(d as Map<String, dynamic>),
      );

  Future<AuthTokens> completeLogin({
    required String ticket,
    required String code,
  }) =>
      _client.post(
        '/auth/login/complete',
        data: {
          'ticket': ticket,
          'code': code,
        },
        parser: (d) => AuthTokens.fromJson(d as Map<String, dynamic>),
      );

  Future<GuestSession> guest({
    String? countryCode,
    String? language,
    String? currency,
    String? theme,
    String? measurementSystem,
  }) =>
      _client.post(
        '/auth/guest',
        data: {
          'countryCode': ?countryCode,
          'language': ?language,
          'currency': ?currency,
          'theme': ?theme,
          'measurementSystem': ?measurementSystem,
        },
        parser: (d) => GuestSession.fromJson(d as Map<String, dynamic>),
      );

  Future<UserModel> me() => _client.get(
        '/auth/me',
        parser: (d) {
          final map = d as Map<String, dynamic>;
          return UserModel.fromJson(
            map['user'] is Map<String, dynamic> ? map : {'user': map},
          );
        },
      );

  Future<void> logout({String? refreshToken, bool allDevices = false}) =>
      _client.post(
        '/auth/logout',
        data: {
          'refreshToken': ?refreshToken,
          'allDevices': allDevices,
        },
        parser: (_) {},
      );

  Future<Map<String, dynamic>> requestOtp({
    required String destination,
    String channel = 'sms',
    String purpose = 'login',
  }) =>
      _client.post(
        '/auth/otp/request',
        data: {
          'destination': destination,
          'channel': channel,
          'purpose': purpose,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<AuthTokens> verifyOtp({
    required String destination,
    required String code,
    String purpose = 'login',
  }) =>
      _client.post(
        '/auth/otp/verify',
        data: {
          'destination': destination,
          'code': code,
          'purpose': purpose,
        },
        parser: (d) => AuthTokens.fromJson(d as Map<String, dynamic>),
      );

  Future<Map<String, dynamic>> startOauth(String provider) => _client.post(
        '/auth/oauth/start',
        data: {'provider': provider, 'platform': PlatformInfo.code},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<AuthTokens> completeOauth(String ticket) => _client.post(
        '/auth/oauth/complete',
        data: {'ticket': ticket},
        parser: (d) => AuthTokens.fromJson(d as Map<String, dynamic>),
      );

  Future<AuthTokens> oauthToken({
    required String provider,
    required String token,
    String? nonce,
  }) =>
      _client.post(
        '/auth/oauth',
        data: {
          'provider': provider,
          'token': token,
          'nonce': ?nonce,
        },
        parser: (d) => AuthTokens.fromJson(d as Map<String, dynamic>),
      );

  Future<UserModel> verifyMfa(String code, {String? challengeId}) =>
      _client.post(
        '/auth/mfa/verify',
        data: {
          'code': code,
          'challengeId': ?challengeId,
        },
        parser: (d) => UserModel.fromJson(d as Map<String, dynamic>),
      );

  Future<Map<String, dynamic>> beginMfaChallenge() => _client.post(
        '/auth/mfa/challenge',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<List<AuthSessionInfo>> sessions() => _client.get(
        '/auth/sessions',
        parser: (d) => (d as List)
            .map((e) => AuthSessionInfo.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<void> revokeSession(String uuid) =>
      _client.delete('/auth/sessions/$uuid', parser: (_) {});

  Future<List<AuthDeviceInfo>> devices() => _client.get(
        '/auth/devices',
        parser: (d) => (d as List)
            .map((e) => AuthDeviceInfo.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<void> revokeDevice(String uuid) =>
      _client.delete('/auth/devices/$uuid', parser: (_) {});

  Future<CompatibilityInfo> systemVersion() => _client.get(
        '/system/version',
        parser: (d) => CompatibilityInfo.fromJson(d as Map<String, dynamic>),
      );

  Future<Map<String, dynamic>> requestCaptcha() => _client.post(
        '/auth/captcha/challenge',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<void> solveCaptcha(String token) => _client.post(
        '/auth/captcha/solve',
        data: {'token': token},
        parser: (_) {},
      );

  Future<Map<String, dynamic>> beginPasskeyAuth() => _client.post(
        '/auth/passkeys/authenticate/begin',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );
}
