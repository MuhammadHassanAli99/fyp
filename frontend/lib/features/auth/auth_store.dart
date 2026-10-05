import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/auth/auth_status.dart';
import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/user_model.dart';
import '../../data/repositories/auth_repository.dart';

class AuthStore {
  AuthStore(this._repo) {
    final pending = _repo.pendingIdentifier;
    if (pending != null && pending.isNotEmpty) {
      if (pending.contains('@')) {
        email.value = pending;
        usePhone.value = false;
      } else {
        phone.value = pending;
        usePhone.value = true;
      }
    }
  }

  final AuthRepository _repo;

  final state = signal<AsyncState<UserModel>>(const AsyncIdle());
  final email = signal('');
  final password = signal('');
  final name = signal('');
  final phone = signal('');
  final otpCode = signal('');
  final acceptedTerms = signal(false);
  final usePhone = signal(false);
  final otpChannel = signal('sms');

  AuthStatus get status => _repo.status;
  LoginChallenge? get challenge => _repo.pendingOtp;

  String get identifier =>
      usePhone.value ? phone.value.trim() : email.value.trim();

  late final canSubmitLogin = computed(
    () => password.value.length >= 8 &&
        (usePhone.value
            ? phone.value.trim().length >= 8
            : email.value.contains('@')),
  );

  late final canSubmitRegister = computed(() {
    final identifierOk = usePhone.value
        ? phone.value.trim().length >= 8
        : email.value.contains('@');
    return identifierOk &&
        password.value.length >= 8 &&
        name.value.trim().length >= 2 &&
        acceptedTerms.value;
  });

  late final canSubmitOtp = computed(() => otpCode.value.trim().length >= 4);

  Future<Result<LoginOutcome>> sendOtpAndContinue() async {
    state.value = const AsyncLoading();
    final result = await _repo.login(
      identifier: identifier,
      password: password.value,
      channel: usePhone.value ? otpChannel.value : 'email',
    );
    result.when(
      success: (outcome) {
        state.value = const AsyncIdle();
        if (outcome is LoginOtpNeeded) {
          final code = outcome.challenge.devOtp;
          if (code != null && code.isNotEmpty) otpCode.value = code;
        }
      },
      failure: (m, code) => state.value = AsyncError(m, code: code),
    );
    return result;
  }

  Future<Result<UserModel>> completeOtp() async {
    state.value = const AsyncLoading();
    final result = await _repo.completeLogin(code: otpCode.value.trim());
    result.when(
      success: (u) => state.value = AsyncData(u),
      failure: (m, code) => state.value = AsyncError(m, code: code),
    );
    return result;
  }

  Future<Result<LoginChallenge>> resendOtp() async {
    state.value = const AsyncLoading();
    final result = await _repo.resendLoginOtp(
      channel: usePhone.value ? otpChannel.value : 'email',
    );
    result.when(
      success: (challenge) {
        state.value = const AsyncIdle();
        final code = challenge.devOtp;
        if (code != null && code.isNotEmpty) otpCode.value = code;
      },
      failure: (m, code) => state.value = AsyncError(m, code: code),
    );
    return result;
  }

  Future<Result<RegisterResult>> register() async {
    state.value = const AsyncLoading();
    final result = await _repo.register(
      email: usePhone.value ? null : email.value.trim(),
      phone: usePhone.value ? phone.value.trim() : null,
      password: password.value,
      name: name.value.trim(),
      acceptedTerms: acceptedTerms.value,
    );
    result.when(
      success: (_) => state.value = const AsyncIdle(),
      failure: (m, code) => state.value = AsyncError(m, code: code),
    );
    return result;
  }

  Future<Result<UserModel>> guest() async {
    state.value = const AsyncLoading();
    final result = await _repo.continueAsGuest();
    result.when(
      success: (u) => state.value = AsyncData(u),
      failure: (m, code) => state.value = AsyncError(m, code: code),
    );
    return result;
  }

  Future<Result<String>> startOauth(String provider) => _repo.startOauth(provider);

  Future<Result<UserModel>> verifyMfa(String code) async {
    state.value = const AsyncLoading();
    final result = await _repo.verifyMfa(code);
    result.when(
      success: (u) => state.value = AsyncData(u),
      failure: (m, c) => state.value = AsyncError(m, code: c),
    );
    return result;
  }
}
