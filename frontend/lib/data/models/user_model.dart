class UserModel {
  const UserModel({
    required this.id,
    required this.email,
    this.intId,
    this.name,
    this.username,
    this.isGuest = false,
    this.avatarUrl,
    this.phone,
    this.status,
    this.mfaEnabled = false,
    this.emailVerified = false,
    this.phoneVerified = false,
    this.roles = const [],
    this.permissions = const [],
    this.isStaff = false,
  });

  factory UserModel.fromJson(Map<String, dynamic> json) {
    final root = json['user'] is Map<String, dynamic>
        ? json['user'] as Map<String, dynamic>
        : json;
    final profile = root['profile'] is Map<String, dynamic>
        ? root['profile'] as Map<String, dynamic>
        : null;

    return UserModel(
      id: (root['uuid'] ?? root['id'] ?? '').toString(),
      intId: (root['id'] as num?)?.toInt(),
      email: root['email'] as String? ?? '',
      phone: root['phone'] as String?,
      name: root['displayName'] as String? ??
          profile?['displayName'] as String? ??
          root['name'] as String?,
      username: root['username'] as String?,
      isGuest: root['isGuest'] as bool? ?? false,
      avatarUrl: root['avatarUrl'] as String? ??
          profile?['avatarUrl'] as String?,
      status: root['status'] as String?,
      mfaEnabled: root['mfaEnabled'] as bool? ?? false,
      emailVerified: root['emailVerified'] as bool? ?? false,
      phoneVerified: root['phoneVerified'] as bool? ?? false,
      roles: ((json['roles'] as List?) ?? (root['roles'] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
      permissions: ((json['permissions'] as List?) ??
              (root['permissions'] as List?) ??
              const [])
          .map((e) => e.toString())
          .toList(),
      isStaff: json['isStaff'] as bool? ?? root['isStaff'] as bool? ?? false,
    );
  }

  final String id;
  final int? intId;
  final String email;
  final String? phone;
  final String? name;
  final String? username;
  final bool isGuest;
  final String? avatarUrl;
  final String? status;
  final bool mfaEnabled;
  final bool emailVerified;
  final bool phoneVerified;
  final List<String> roles;
  final List<String> permissions;
  final bool isStaff;

  bool get hasAdminAccess =>
      isStaff ||
      permissions.contains('*') ||
      permissions.contains('admin.access');

  bool get hasSupportAccess =>
      hasAdminAccess ||
      permissions.contains('ticket.view_any') ||
      permissions.contains('ticket.manage') ||
      roles.contains('support_agent') ||
      roles.contains('support_manager') ||
      roles.contains('support_admin');

  Map<String, dynamic> toJson() => {
        'id': id,
        if (intId != null) 'intId': intId,
        'email': email,
        'name': name,
        'isGuest': isGuest,
        'avatarUrl': avatarUrl,
        'status': status,
        'mfaEnabled': mfaEnabled,
      };
}

class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    this.user,
    this.mfaRequired = false,
    this.mfaFactors = const [],
    this.captchaRequired = false,
  });

  factory AuthTokens.fromJson(Map<String, dynamic> json) {
    final tokensMap = json['tokens'] is Map<String, dynamic>
        ? json['tokens'] as Map<String, dynamic>
        : json;
    final userMap = json['user'] is Map<String, dynamic>
        ? json['user'] as Map<String, dynamic>
        : null;

    final access = tokensMap['accessToken'] as String?;
    final refresh = tokensMap['refreshToken'] as String?;
    if (access == null || refresh == null) {
      throw FormatException('Missing tokens in auth response');
    }

    return AuthTokens(
      accessToken: access,
      refreshToken: refresh,
      user: userMap != null ? UserModel.fromJson(userMap) : null,
      mfaRequired: json['mfaRequired'] as bool? ?? false,
      mfaFactors: (json['mfaFactors'] as List? ?? [])
          .whereType<Map<String, dynamic>>()
          .toList(),
    );
  }

  final String accessToken;
  final String refreshToken;
  final UserModel? user;
  final bool mfaRequired;
  final List<Map<String, dynamic>> mfaFactors;
  final bool captchaRequired;
}

class GuestSession {
  const GuestSession({
    required this.guestId,
    required this.expiresAt,
  });

  factory GuestSession.fromJson(Map<String, dynamic> json) => GuestSession(
        guestId: json['guestId'] as String,
        expiresAt: json['expiresAt'] as String? ?? '',
      );

  final String guestId;
  final String expiresAt;
}

class AuthSessionInfo {
  const AuthSessionInfo({
    required this.uuid,
    required this.isCurrent,
    this.deviceName,
    this.platform,
    this.loginMethod,
    this.lastUsedAt,
  });

  factory AuthSessionInfo.fromJson(Map<String, dynamic> json) => AuthSessionInfo(
        uuid: json['uuid'] as String,
        isCurrent: json['isCurrent'] as bool? ?? false,
        deviceName: json['deviceName'] as String?,
        platform: json['platform'] as String?,
        loginMethod: json['loginMethod'] as String?,
        lastUsedAt: json['lastUsedAt'] as String?,
      );

  final String uuid;
  final bool isCurrent;
  final String? deviceName;
  final String? platform;
  final String? loginMethod;
  final String? lastUsedAt;
}

class AuthDeviceInfo {
  const AuthDeviceInfo({
    required this.uuid,
    required this.name,
    required this.isCurrent,
    this.platform,
    this.status,
    this.lastSeenAt,
  });

  factory AuthDeviceInfo.fromJson(Map<String, dynamic> json) => AuthDeviceInfo(
        uuid: json['uuid'] as String,
        name: json['name'] as String? ?? 'Device',
        isCurrent: json['isCurrent'] as bool? ?? false,
        platform: json['platform'] as String?,
        status: json['status'] as String?,
        lastSeenAt: json['lastSeenAt'] as String?,
      );

  final String uuid;
  final String name;
  final bool isCurrent;
  final String? platform;
  final String? status;
  final String? lastSeenAt;
}

class RegisterResult {
  const RegisterResult({
    required this.identifier,
    this.email,
    this.phone,
  });

  factory RegisterResult.fromJson(Map<String, dynamic> json) {
    final user = json['user'] is Map<String, dynamic>
        ? json['user'] as Map<String, dynamic>
        : json;
    return RegisterResult(
      identifier: json['identifier'] as String? ??
          user['email'] as String? ??
          user['phone'] as String? ??
          '',
      email: user['email'] as String?,
      phone: user['phone'] as String?,
    );
  }

  final String identifier;
  final String? email;
  final String? phone;
}

class LoginChallenge {
  const LoginChallenge({
    required this.loginTicket,
    required this.destinationHint,
    required this.channel,
    required this.channels,
    this.expiresInSeconds = 600,
    this.devOtp,
  });

  factory LoginChallenge.fromJson(Map<String, dynamic> json) {
    final channels = (json['channels'] as List? ?? const [])
        .map((e) => e.toString())
        .where((e) => e.isNotEmpty)
        .toList();
    return LoginChallenge(
      loginTicket: json['loginTicket'] as String,
      destinationHint: json['destinationHint'] as String? ?? '',
      channel: json['channel'] as String? ?? 'email',
      channels: channels.isNotEmpty ? channels : const ['email'],
      expiresInSeconds: (json['expiresInSeconds'] as num?)?.toInt() ?? 600,
      devOtp: json['devOtp'] as String?,
    );
  }

  final String loginTicket;
  final String destinationHint;
  final String channel;
  final List<String> channels;
  final int expiresInSeconds;
  /// Development-only code from the log email/SMS driver. Null in production.
  final String? devOtp;

  bool get isPhoneChannel => channel == 'sms' || channel == 'whatsapp';
}

sealed class LoginOutcome {
  const LoginOutcome();
}

class LoginSession extends LoginOutcome {
  const LoginSession(this.tokens);
  final AuthTokens tokens;
}

class LoginOtpNeeded extends LoginOutcome {
  const LoginOtpNeeded(this.challenge);
  final LoginChallenge challenge;
}

class CompatibilityInfo {
  const CompatibilityInfo({
    this.apiVersion,
    this.minSupportedAppVersion,
    this.schemaCompatible = true,
    this.appCompatible = true,
  });

  factory CompatibilityInfo.fromJson(Map<String, dynamic> json) {
    final app = json['app'] is Map<String, dynamic>
        ? json['app'] as Map<String, dynamic>
        : json;
    return CompatibilityInfo(
      apiVersion: app['apiVersion'] as String?,
      minSupportedAppVersion: app['minAppVersion'] as String? ??
          app['minSupportedAppVersion'] as String?,
      schemaCompatible: app['schemaCompatible'] as bool? ?? true,
      appCompatible: json['appCompatible'] as bool? ?? true,
    );
  }

  final String? apiVersion;
  final String? minSupportedAppVersion;
  final bool schemaCompatible;
  final bool appCompatible;

  bool get isCompatible => schemaCompatible && appCompatible;
}
