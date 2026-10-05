import '../../core/auth/auth_status.dart';
import '../../core/auth/biometric_service.dart';
import '../../core/database/app_database.dart';
import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../../core/storage/prefs_storage.dart';
import '../../core/storage/secure_storage.dart';
import '../models/user_model.dart';
import '../remote/auth_api.dart';

class AuthRepository {
  AuthRepository({
    required this._api,
    required this._secureStorage,
    required this._prefs,
    this._database,
    this._biometric,
  });

  final AuthApi _api;
  final SecureStorage _secureStorage;
  final PrefsStorage _prefs;
  final AppDatabase? _database;
  final BiometricService? _biometric;

  void Function()? onAuthenticated;
  void Function()? onSignedOut;

  UserModel? _cachedUser;
  UserModel? get currentUser => _cachedUser;
  bool hasActiveSession = false;
  AuthStatus status = AuthStatus.initializing;
  CompatibilityInfo? compatibility;
  List<Map<String, dynamic>> mfaFactors = const [];
  String? lastError;

  Future<bool> hasSession() async {
    if (_cachedUser != null || hasActiveSession) return true;
    final token = await _secureStorage.accessToken;
    if (token != null && token.isNotEmpty) {
      hasActiveSession = true;
      return true;
    }
    final guestId = _prefs.guestId;
    if (guestId != null && guestId.isNotEmpty) {
      hasActiveSession = true;
      return true;
    }
    hasActiveSession = false;
    return false;
  }

  LoginChallenge? pendingOtp;
  String? pendingIdentifier;

  Future<Result<CompatibilityInfo>> checkCompatibility() async {
    try {
      compatibility = await _api.systemVersion();
      if (!compatibility!.isCompatible) {
        status = AuthStatus.updateRequired;
        return Success(compatibility!);
      }
      return Success(compatibility!);
    } on ApiException catch (e) {
      if (e.code == 'SCHEMA_INCOMPATIBLE' || e.code == 'APP_VERSION_UNSUPPORTED') {
        status = AuthStatus.updateRequired;
      }
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<LoginOutcome>> login({
    required String identifier,
    required String password,
    String? channel,
    String? captchaToken,
  }) async {
    status = AuthStatus.loggingIn;
    try {
      final outcome = await _api.login(
        identifier: identifier,
        password: password,
        channel: channel,
        captchaToken: captchaToken,
      );
      pendingIdentifier = identifier;
      if (outcome is LoginOtpNeeded) {
        pendingOtp = outcome.challenge;
        status = AuthStatus.otpRequired;
        return Success(outcome);
      }
      final session = outcome as LoginSession;
      await _afterTokens(session.tokens);
      return Success(session);
    } on ApiException catch (e) {
      return _mapAuthFailure(e);
    } catch (e) {
      status = AuthStatus.error;
      return Failure(e.toString());
    }
  }

  Future<Result<RegisterResult>> register({
    required String password,
    required String name,
    required bool acceptedTerms,
    String? email,
    String? phone,
  }) async {
    status = AuthStatus.loggingIn;
    try {
      final result = await _api.register(
        email: email,
        phone: phone,
        password: password,
        name: name,
        acceptedTerms: acceptedTerms,
        countryCode: _prefs.countryCode,
        language: _prefs.languageCode,
        currency: _prefs.currencyCode,
      );
      pendingIdentifier = result.identifier;
      pendingOtp = null;
      hasActiveSession = false;
      status = AuthStatus.loggedOut;
      return Success(result);
    } on ApiException catch (e) {
      status = AuthStatus.loggedOut;
      return Failure(e.message, code: e.code);
    } catch (e) {
      status = AuthStatus.error;
      return Failure(e.toString());
    }
  }

  Future<Result<LoginChallenge>> resendLoginOtp({String? channel}) async {
    final ticket = pendingOtp?.loginTicket;
    if (ticket == null) {
      return const Failure('Start sign-in again', code: 'OTP_EXPIRED');
    }
    try {
      pendingOtp = await _api.resendLoginOtp(
        ticket: ticket,
        channel: channel ?? pendingOtp?.channel,
      );
      status = AuthStatus.otpRequired;
      return Success(pendingOtp!);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<UserModel>> completeLogin({required String code}) async {
    final ticket = pendingOtp?.loginTicket;
    if (ticket == null) {
      status = AuthStatus.loggedOut;
      return const Failure('Start sign-in again', code: 'OTP_EXPIRED');
    }
    status = AuthStatus.loggingIn;
    try {
      final tokens = await _api.completeLogin(ticket: ticket, code: code);
      pendingOtp = null;
      return await _afterTokens(tokens);
    } on ApiException catch (e) {
      return _mapAuthFailure(e);
    } catch (e) {
      status = AuthStatus.error;
      return Failure(e.toString());
    }
  }

  Future<Result<void>> requestOtp({
    required String destination,
    String channel = 'sms',
    String purpose = 'login',
  }) async {
    try {
      await _api.requestOtp(
        destination: destination,
        channel: channel,
        purpose: purpose,
      );
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<UserModel>> verifyOtp({
    required String destination,
    required String code,
    String purpose = 'login',
  }) async {
    status = AuthStatus.loggingIn;
    try {
      final tokens = await _api.verifyOtp(
        destination: destination,
        code: code,
        purpose: purpose,
      );
      return await _afterTokens(tokens);
    } on ApiException catch (e) {
      return _mapAuthFailure(e);
    } catch (e) {
      status = AuthStatus.error;
      return Failure(e.toString());
    }
  }

  Future<Result<String>> startOauth(String provider) async {
    try {
      final data = await _api.startOauth(provider);
      return Success(data['authorizationUrl'] as String? ?? '');
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<UserModel>> completeOauth(String ticket) async {
    status = AuthStatus.loggingIn;
    try {
      return await _afterTokens(await _api.completeOauth(ticket));
    } on ApiException catch (e) {
      return _mapAuthFailure(e);
    } catch (e) {
      status = AuthStatus.error;
      return Failure(e.toString());
    }
  }

  Future<Result<UserModel>> verifyMfa(String code) async {
    try {
      await _api.beginMfaChallenge();
      final user = await _api.verifyMfa(code);
      _cachedUser = user;
      status = AuthStatus.authenticated;
      hasActiveSession = true;
      onAuthenticated?.call();
      return Success(user);
    } on ApiException catch (e) {
      return _mapAuthFailure(e);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<UserModel>> unlockWithBiometric() async {
    if (_biometric == null) {
      return restoreSession();
    }
    final ok = await _biometric.authenticate();
    if (!ok) {
      status = AuthStatus.biometricRequired;
      return const Failure('Unlock cancelled', code: 'BIOMETRIC_REQUIRED');
    }
    final token = await _secureStorage.accessToken;
    if (token == null || token.isEmpty) {
      status = AuthStatus.loggedOut;
      hasActiveSession = false;
      return const Failure('No session');
    }
    try {
      _cachedUser = await _api.me();
      hasActiveSession = true;
      status = _statusForUser(_cachedUser!);
      if (status == AuthStatus.authenticated) onAuthenticated?.call();
      return Success(_cachedUser!);
    } on ApiException catch (e) {
      return _mapAuthFailure(e);
    } catch (e) {
      status = AuthStatus.error;
      return Failure(e.toString());
    }
  }

  Future<Result<UserModel>> continueAsGuest() async {
    try {
      final session = await _api.guest(
        countryCode: _prefs.countryCode,
        language: _prefs.languageCode,
        currency: _prefs.currencyCode,
        theme: _prefs.themeMode,
        measurementSystem: _prefs.measurement,
      );
      await _secureStorage.clearTokens();
      await _prefs.setString(PrefsKeys.guestId, session.guestId);
      await _prefs.setBool(PrefsKeys.isGuest, true);
      hasActiveSession = true;
      status = AuthStatus.authenticated;
      _cachedUser = UserModel(
        id: session.guestId,
        email: '',
        name: 'Guest',
        isGuest: true,
      );
      return Success(_cachedUser!);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<UserModel>> restoreSession() async {
    status = AuthStatus.initializing;
    final compat = await checkCompatibility();
    if (compat is Failure<CompatibilityInfo> && status == AuthStatus.updateRequired) {
      return Failure(compat.message, code: compat.code);
    }
    if (compatibility != null && !compatibility!.isCompatible) {
      status = AuthStatus.updateRequired;
      return const Failure('Please update the app to continue', code: 'APP_VERSION_UNSUPPORTED');
    }

    final token = await _secureStorage.accessToken;
    if (token != null && token.isNotEmpty) {
      if (_biometric != null && await _biometric.shouldGate) {
        hasActiveSession = true;
        status = AuthStatus.biometricRequired;
        return const Failure('Unlock required', code: 'BIOMETRIC_REQUIRED');
      }
      hasActiveSession = true;
      try {
        _cachedUser = await _api.me();
        await _prefs.remove(PrefsKeys.guestId);
        await _prefs.setBool(PrefsKeys.isGuest, false);
        status = _statusForUser(_cachedUser!);
        return Success(_cachedUser!);
      } on ApiException catch (e) {
        if (e is UnauthorizedException || e.code == 'SESSION_REVOKED' || e.code == 'TOKEN_EXPIRED') {
          await logout(remote: false);
          status = AuthStatus.sessionExpired;
        } else {
          status = _statusFromCode(e.code);
        }
        return Failure(e.message, code: e.code);
      } catch (e) {
        status = AuthStatus.error;
        lastError = e.toString();
        return Failure(e.toString());
      }
    }

    final guestId = _prefs.guestId;
    if (guestId != null && guestId.isNotEmpty) {
      hasActiveSession = true;
      status = AuthStatus.authenticated;
      _cachedUser = UserModel(
        id: guestId,
        email: '',
        name: 'Guest',
        isGuest: true,
      );
      return Success(_cachedUser!);
    }

    hasActiveSession = false;
    status = AuthStatus.loggedOut;
    return const Failure('No session');
  }

  Future<void> logout({bool allDevices = false, bool remote = true}) async {
    if (remote && !_prefs.isGuest) {
      try {
        final refresh = await _secureStorage.refreshToken;
        await _api.logout(refreshToken: refresh, allDevices: allDevices);
      } catch (_) {
        // Uninstall / offline: server session expires on its own.
      }
    }
    await _secureStorage.clearTokens();
    await _prefs.remove(PrefsKeys.guestId);
    await _prefs.setBool(PrefsKeys.isGuest, false);
    await _database?.clearSensitiveData();
    _cachedUser = null;
    hasActiveSession = false;
    mfaFactors = const [];
    pendingOtp = null;
    status = AuthStatus.loggedOut;
    onSignedOut?.call();
  }

  Future<Result<List<AuthSessionInfo>>> sessions() async {
    try {
      return Success(await _api.sessions());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<void>> revokeSession(String uuid) async {
    try {
      await _api.revokeSession(uuid);
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<List<AuthDeviceInfo>>> devices() async {
    try {
      return Success(await _api.devices());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<void>> revokeDevice(String uuid) async {
    try {
      await _api.revokeDevice(uuid);
      return const Success(null);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<UserModel>> _afterTokens(AuthTokens tokens) async {
    await _persistAuth(tokens, isGuest: false);
    if (tokens.mfaRequired) {
      status = AuthStatus.mfaRequired;
      mfaFactors = tokens.mfaFactors;
      return Success(_cachedUser!);
    }
    try {
      _cachedUser = await _api.me();
    } catch (_) {
      // Keep the token-payload user if /me is briefly unavailable.
    }
    status = _statusForUser(_cachedUser!);
    if (status == AuthStatus.authenticated) {
      onAuthenticated?.call();
    }
    return Success(_cachedUser!);
  }

  Result<T> _mapAuthFailure<T>(ApiException e) {
    lastError = e.message;
    status = _statusFromCode(e.code);
    return Failure(e.message, code: e.code);
  }

  AuthStatus _statusFromCode(String? code) => switch (code) {
        'MFA_REQUIRED' => AuthStatus.mfaRequired,
        'OTP_REQUIRED' => AuthStatus.otpRequired,
        'BIOMETRIC_REQUIRED' => AuthStatus.biometricRequired,
        'CAPTCHA_REQUIRED' => AuthStatus.securityChallengeRequired,
        'ACCOUNT_LOCKED' => AuthStatus.accountLocked,
        'ACCOUNT_SUSPENDED' || 'ACCOUNT_BANNED' => AuthStatus.accountSuspended,
        'EMAIL_NOT_VERIFIED' || 'PHONE_NOT_VERIFIED' => AuthStatus.verificationRequired,
        'DEVICE_NOT_TRUSTED' => AuthStatus.deviceVerificationRequired,
        'APP_VERSION_UNSUPPORTED' || 'SCHEMA_INCOMPATIBLE' => AuthStatus.updateRequired,
        'SESSION_REVOKED' || 'TOKEN_EXPIRED' || 'UNAUTHENTICATED' => AuthStatus.sessionExpired,
        _ => AuthStatus.error,
      };

  AuthStatus _statusForUser(UserModel user) {
    if (user.status == 'suspended' || user.status == 'banned') {
      return AuthStatus.accountSuspended;
    }
    return AuthStatus.authenticated;
  }

  Future<void> _persistAuth(AuthTokens tokens, {required bool isGuest}) async {
    await _secureStorage.saveTokens(
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    );
    await _prefs.remove(PrefsKeys.guestId);
    await _prefs.setBool(PrefsKeys.isGuest, isGuest);
    hasActiveSession = true;
    _cachedUser = tokens.user ??
        UserModel(
          id: 'user',
          email: '',
          isGuest: isGuest,
        );
  }

  bool get isGuest => _prefs.isGuest || (_cachedUser?.isGuest ?? false);
}
