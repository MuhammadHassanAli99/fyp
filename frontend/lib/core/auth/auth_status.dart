enum AuthStatus {
  initializing,
  loggedOut,
  loggingIn,
  verificationRequired,
  otpRequired,
  mfaRequired,
  deviceVerificationRequired,
  biometricRequired,
  authenticated,
  sessionExpired,
  accountLocked,
  accountSuspended,
  securityChallengeRequired,
  updateRequired,
  error,
}

extension AuthStatusX on AuthStatus {
  bool get isAuthenticated => this == AuthStatus.authenticated;

  bool get blocksApp =>
      this == AuthStatus.loggedOut ||
      this == AuthStatus.sessionExpired ||
      this == AuthStatus.updateRequired ||
      this == AuthStatus.mfaRequired ||
      this == AuthStatus.otpRequired ||
      this == AuthStatus.verificationRequired ||
      this == AuthStatus.securityChallengeRequired ||
      this == AuthStatus.accountLocked ||
      this == AuthStatus.accountSuspended ||
      this == AuthStatus.biometricRequired ||
      this == AuthStatus.initializing;
}
