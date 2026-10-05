import 'package:flutter/foundation.dart';
import 'package:local_auth/local_auth.dart';

import '../platform/platform_info.dart';
import '../storage/secure_storage.dart';

abstract final class BiometricKeys {
  static const enabled = 'biometric_unlock_enabled';
}

/// Platform biometric / Windows Hello. Failures never crash the app.
class BiometricService {
  BiometricService({LocalAuthentication? auth, required this._storage})
      : _auth = auth ?? LocalAuthentication();

  final LocalAuthentication _auth;
  final SecureStorage _storage;

  Future<bool> get isAvailable async {
    if (kIsWeb) return false;
    try {
      final supported = await _auth.isDeviceSupported();
      if (!supported) return false;
      final canCheck = await _auth.canCheckBiometrics;
      return canCheck || supported;
    } catch (_) {
      return false;
    }
  }

  Future<bool> get isEnabled async {
    final value = await _storage.read(BiometricKeys.enabled);
    return value == '1';
  }

  Future<void> setEnabled(bool enabled) async {
    if (enabled) {
      await _storage.write(BiometricKeys.enabled, '1');
    } else {
      await _storage.delete(BiometricKeys.enabled);
    }
  }

  Future<bool> get shouldGate async =>
      PlatformInfo.supportsBiometrics && await isEnabled && await isAvailable;

  Future<bool> authenticate({
    String reason = 'Unlock your marketplace account',
  }) async {
    try {
      return await _auth.authenticate(
        localizedReason: reason,
        options: const AuthenticationOptions(
          biometricOnly: false,
          stickyAuth: true,
        ),
      );
    } catch (error) {
      debugPrint('biometric authenticate failed: $error');
      return false;
    }
  }
}
