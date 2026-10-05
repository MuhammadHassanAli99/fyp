class AddressRules {
  const AddressRules({
    required this.fields,
    required this.required,
    this.postalCodeRegex,
  });

  factory AddressRules.fromJson(Map<String, dynamic> json) {
    return AddressRules(
      fields: (json['fields'] as List? ?? const [])
          .map((e) => e.toString())
          .toList(),
      required: (json['required'] as List? ?? const [])
          .map((e) => e.toString())
          .toList(),
      postalCodeRegex: json['postalCodeRegex']?.toString(),
    );
  }

  final List<String> fields;
  final List<String> required;
  final String? postalCodeRegex;

  static const fallback = AddressRules(
    fields: ['address_line1', 'address_line2', 'city', 'region', 'postal_code', 'country'],
    required: ['address_line1', 'city', 'country'],
  );
}

class AddressValues {
  AddressValues({
    this.addressLine1,
    this.addressLine2,
    this.building,
    this.unit,
    this.district,
    this.area,
    this.city,
    this.region,
    this.postalCode,
    this.country,
  });

  String? addressLine1;
  String? addressLine2;
  String? building;
  String? unit;
  String? district;
  String? area;
  String? city;
  String? region;
  String? postalCode;
  String? country;

  String? operator [](String field) => switch (field) {
        'street' || 'address_line1' => addressLine1,
        'address_line2' => addressLine2,
        'building' => building,
        'unit' => unit,
        'district' => district,
        'area' => area,
        'city' => city,
        'province' || 'state' || 'region' => region,
        'postal_code' => postalCode,
        'country' => country,
        _ => null,
      };
}

class AddressFormatter {
  static Map<String, String> validate(AddressRules rules, AddressValues values) {
    final errors = <String, String>{};
    for (final field in rules.required) {
      final value = values[field];
      if (value == null || value.trim().isEmpty) {
        errors[field] = 'required';
      }
    }
    final postal = values.postalCode;
    final regex = rules.postalCodeRegex;
    if (regex != null && postal != null && postal.isNotEmpty) {
      try {
        if (!RegExp(regex).hasMatch(postal)) {
          errors['postal_code'] = 'format';
        }
      } catch (_) {}
    }
    return errors;
  }

  static String format(AddressRules rules, AddressValues values) {
    final parts = <String>[];
    for (final field in rules.fields) {
      if (field == 'country') continue;
      final value = values[field];
      if (value != null && value.trim().isNotEmpty) parts.add(value.trim());
    }
    return parts.join(', ');
  }

  static String labelFor(String field) => switch (field) {
        'address_line1' || 'street' => 'Street',
        'address_line2' => 'Building / line 2',
        'building' => 'Building',
        'unit' => 'Unit',
        'district' => 'District',
        'area' => 'Area',
        'city' => 'City',
        'province' || 'state' || 'region' => 'Province / State',
        'postal_code' => 'Postal code',
        'country' => 'Country',
        _ => field,
      };
}
