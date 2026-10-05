class ApiException implements Exception {
  ApiException({
    required this.message,
    this.code,
    this.statusCode,
  });

  final String message;
  final String? code;
  final int? statusCode;

  @override
  String toString() => 'ApiException($code): $message';
}

class NetworkException extends ApiException {
  NetworkException({required super.message, super.code});
}

class UnauthorizedException extends ApiException {
  UnauthorizedException({super.message = 'Unauthorized', super.code = 'UNAUTHORIZED'})
      : super(statusCode: 401);
}
