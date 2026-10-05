import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../platform/platform_info.dart';

abstract final class SecureStorageKeys {
  static const accessToken = 'access_token';
  static const refreshToken = 'refresh_token';
}

/// Native: Android Keystore, iOS/macOS Keychain, Windows Credential Manager,
/// Linux libsecret. Tokens never go to SharedPreferences or Drift.
/// Web: in-memory only so tokens are not persisted in localStorage.
class SecureStorage {
  SecureStorage({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
              mOptions: MacOsOptions(
                accessibility: KeychainAccessibility.first_unlock_this_device,
              ),
              wOptions: WindowsOptions(),
              lOptions: LinuxOptions(),
            );

  final FlutterSecureStorage _storage;
  final Map<String, String> _memory = {};

  Future<String?> read(String key) async {
    if (_memory.containsKey(key)) return _memory[key];
    if (PlatformInfo.usesBrowserSession) return null;
    return _storage.read(key: key);
  }

  Future<void> write(String key, String value) async {
    _memory[key] = value;
    if (PlatformInfo.usesBrowserSession) return;
    await _storage.write(key: key, value: value);
  }

  Future<void> delete(String key) async {
    _memory.remove(key);
    if (PlatformInfo.usesBrowserSession) return;
    await _storage.delete(key: key);
  }

  Future<void> deleteAll() async {
    _memory.clear();
    if (PlatformInfo.usesBrowserSession) return;
    await _storage.deleteAll();
  }

  Future<String?> get accessToken => read(SecureStorageKeys.accessToken);
  Future<String?> get refreshToken => read(SecureStorageKeys.refreshToken);

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await write(SecureStorageKeys.accessToken, accessToken);
    await write(SecureStorageKeys.refreshToken, refreshToken);
  }

  Future<void> clearTokens() async {
    await delete(SecureStorageKeys.accessToken);
    await delete(SecureStorageKeys.refreshToken);
  }
}

@visibleForTesting
Map<String, String> debugSecureMemory(SecureStorage storage) => storage._memory;
