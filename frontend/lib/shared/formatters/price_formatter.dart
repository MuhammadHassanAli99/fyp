import 'package:intl/intl.dart';

class PriceFormatter {
  static String format(double amount, String currencyCode) {
    final symbol = _symbolFor(currencyCode);
    final formatted = NumberFormat('#,##0.##').format(amount);
    return '$symbol$formatted';
  }

  static String _symbolFor(String code) => switch (code.toUpperCase()) {
        'USD' => '\$',
        'EUR' => '€',
        'GBP' => '£',
        'PKR' => 'Rs ',
        'INR' => '₹',
        'SAR' => 'SR ',
        'AED' => 'AED ',
        'CAD' => 'C\$',
        'AUD' => 'A\$',
        'TRY' => '₺',
        'JPY' => '¥',
        _ => '$code ',
      };
}
