import 'package:intl/intl.dart';

/// UTC server timestamps → user timezone + regional pattern.
class DateTimeFormatter {
  static DateTime toLocal(DateTime utc, String timezone) {
    // Dart DateTime is local/UTC; named IANA zones are applied via offset
    // when the backend session supplies utcOffsetMinutes. Fallback: device local.
    if (utc.isUtc) return utc.toLocal();
    return utc;
  }

  static String format({
    required DateTime utc,
    required String datePattern,
    required String timePattern,
    String? timezone,
  }) {
    final local = utc.isUtc ? utc.toLocal() : utc;
    final date = DateFormat(_normalizeDate(datePattern)).format(local);
    final time = DateFormat(_normalizeTime(timePattern)).format(local);
    return '$date $time';
  }

  static String _normalizeDate(String pattern) {
    return pattern
        .replaceAll('yyyy', 'yyyy')
        .replaceAll('dd', 'dd')
        .replaceAll('MM', 'MM');
  }

  static String _normalizeTime(String pattern) {
    if (pattern.contains('HH')) return 'HH:mm';
    if (pattern.toLowerCase().contains('a')) return 'hh:mm a';
    return 'HH:mm';
  }
}
