class PhoneParts {
  const PhoneParts({
    required this.dialCode,
    required this.nationalNumber,
    required this.e164,
    required this.valid,
  });

  final String dialCode;
  final String nationalNumber;
  final String e164;
  final bool valid;
}

/// Client-side E.164 helper. Server remains authoritative for storage.
class PhoneFormatter {
  static PhoneParts normalize({
    required String number,
    required String dialCode,
  }) {
    final dialDigits = dialCode.replaceAll(RegExp(r'\D'), '');
    var national = number.replaceAll(RegExp(r'[^\d+]'), '');
    if (national.startsWith('+')) {
      national = national.replaceAll(RegExp(r'\D'), '');
      if (national.startsWith(dialDigits)) {
        national = national.substring(dialDigits.length);
      }
    } else {
      national = national.replaceAll(RegExp(r'\D'), '');
      if (national.startsWith('0')) {
        national = national.replaceFirst(RegExp(r'^0+'), '');
      }
    }
    final e164 = '+$dialDigits$national';
    final valid = national.length >= 4 &&
        national.length <= 15 &&
        RegExp(r'^\+[1-9]\d{4,14}$').hasMatch(e164);
    return PhoneParts(
      dialCode: '+$dialDigits',
      nationalNumber: national,
      e164: e164,
      valid: valid,
    );
  }

  static String formatNational(String national, String? mask) {
    if (mask == null || mask.isEmpty) return national;
    var i = 0;
    final out = StringBuffer();
    for (final char in mask.split('')) {
      if (char == '#') {
        if (i >= national.length) break;
        out.write(national[i]);
        i += 1;
      } else {
        out.write(char);
      }
    }
    if (i < national.length) out.write(national.substring(i));
    return out.toString();
  }
}
