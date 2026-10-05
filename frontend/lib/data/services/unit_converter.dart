enum UnitDimension { area, weight, distance, volume }

class UnitDefinition {
  const UnitDefinition({
    required this.code,
    required this.dimension,
    required this.symbol,
    required this.toBase,
  });

  final String code;
  final UnitDimension dimension;
  final String symbol;
  final double toBase;
}

/// Canonical units: sqm, gram, metre, litre. Display conversion only.
class UnitConverter {
  UnitConverter({List<UnitDefinition>? catalog}) : _catalog = {
      for (final unit in catalog ?? _defaults) unit.code: unit,
    };

  final Map<String, UnitDefinition> _catalog;

  static const _aliases = {
    'g': 'gram',
    'grams': 'gram',
    'kilogram': 'kg',
    'oz': 'ounce',
    'ozt': 'troy_ounce',
    'sq_ft': 'sqft',
    'sq_m': 'sqm',
    'mile': 'mi',
    'miles': 'mi',
    'km': 'km',
    'liter': 'l',
    'litre': 'l',
    'gallon': 'gal',
  };

  static const _defaults = <UnitDefinition>[
    UnitDefinition(code: 'sqm', dimension: UnitDimension.area, symbol: 'm²', toBase: 1),
    UnitDefinition(code: 'sqft', dimension: UnitDimension.area, symbol: 'ft²', toBase: 0.092903),
    UnitDefinition(code: 'marla', dimension: UnitDimension.area, symbol: 'marla', toBase: 25.2929),
    UnitDefinition(code: 'kanal', dimension: UnitDimension.area, symbol: 'kanal', toBase: 505.857),
    UnitDefinition(code: 'acre', dimension: UnitDimension.area, symbol: 'ac', toBase: 4046.86),
    UnitDefinition(code: 'hectare', dimension: UnitDimension.area, symbol: 'ha', toBase: 10000),
    UnitDefinition(code: 'gram', dimension: UnitDimension.weight, symbol: 'g', toBase: 1),
    UnitDefinition(code: 'kg', dimension: UnitDimension.weight, symbol: 'kg', toBase: 1000),
    UnitDefinition(code: 'tola', dimension: UnitDimension.weight, symbol: 'tola', toBase: 11.6638),
    UnitDefinition(code: 'ounce', dimension: UnitDimension.weight, symbol: 'oz', toBase: 28.3495),
    UnitDefinition(code: 'troy_ounce', dimension: UnitDimension.weight, symbol: 'ozt', toBase: 31.1035),
    UnitDefinition(code: 'm', dimension: UnitDimension.distance, symbol: 'm', toBase: 1),
    UnitDefinition(code: 'km', dimension: UnitDimension.distance, symbol: 'km', toBase: 1000),
    UnitDefinition(code: 'mi', dimension: UnitDimension.distance, symbol: 'mi', toBase: 1609.34),
    UnitDefinition(code: 'l', dimension: UnitDimension.volume, symbol: 'L', toBase: 1),
    UnitDefinition(code: 'gal', dimension: UnitDimension.volume, symbol: 'gal', toBase: 3.78541),
  ];

  String normalize(String code) {
    final raw = code.trim().toLowerCase().replaceAll(' ', '_');
    return _aliases[raw] ?? raw;
  }

  double toCanonical(double value, String from) {
    final unit = _catalog[normalize(from)];
    if (unit == null) return value;
    return value * unit.toBase;
  }

  double fromCanonical(double canonical, String to) {
    final unit = _catalog[normalize(to)];
    if (unit == null || unit.toBase == 0) return canonical;
    return canonical / unit.toBase;
  }

  double convert(double value, String from, String to) {
    if (normalize(from) == normalize(to)) return value;
    return fromCanonical(toCanonical(value, from), to);
  }

  String format(double canonical, String displayUnit, {int digits = 2}) {
    final shown = fromCanonical(canonical, displayUnit);
    final unit = _catalog[normalize(displayUnit)];
    final text = shown == shown.roundToDouble()
        ? shown.toInt().toString()
        : shown.toStringAsFixed(digits);
    return '$text ${unit?.symbol ?? displayUnit}';
  }
}
