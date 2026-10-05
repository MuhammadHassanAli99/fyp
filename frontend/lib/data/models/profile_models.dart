class PublicProfile {
  const PublicProfile({
    required this.id,
    required this.uuid,
    required this.username,
    required this.displayName,
    this.bio,
    this.avatarUrl,
    this.avatarThumbUrl,
    this.website,
    this.visibility = 'public',
    this.isOwner = false,
    this.identityVerified = false,
    this.businessVerified = false,
    this.trustLevel = 'new',
    this.trustBand = 'new',
    this.ratingAverage = 0,
    this.ratingCount = 0,
    this.city,
    this.country,
    this.email,
    this.phone,
    this.businesses = const [],
    this.showListings = true,
    this.showReviews = true,
    this.createdAt,
  });

  factory PublicProfile.fromJson(Map<String, dynamic> json) {
    final verification = json['verification'] is Map<String, dynamic>
        ? json['verification'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final trust = json['trust'] is Map<String, dynamic>
        ? json['trust'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final rating = json['rating'] is Map<String, dynamic>
        ? json['rating'] as Map<String, dynamic>
        : (trust['rating'] is Map<String, dynamic>
            ? trust['rating'] as Map<String, dynamic>
            : const <String, dynamic>{});
    final location = json['location'] is Map<String, dynamic>
        ? json['location'] as Map<String, dynamic>
        : null;
    final contact = json['contact'] is Map<String, dynamic>
        ? json['contact'] as Map<String, dynamic>
        : const <String, dynamic>{};
    final flags = json['flags'] is Map<String, dynamic>
        ? json['flags'] as Map<String, dynamic>
        : const <String, dynamic>{};

    return PublicProfile(
      id: (json['id'] as num?)?.toInt() ?? 0,
      uuid: json['uuid'] as String? ?? '',
      username: json['username'] as String? ?? '',
      displayName: json['displayName'] as String? ?? json['username'] as String? ?? 'User',
      bio: json['bio'] as String?,
      avatarUrl: json['avatarUrl'] as String?,
      avatarThumbUrl: json['avatarThumbUrl'] as String?,
      website: json['website'] as String?,
      visibility: json['visibility'] as String? ?? 'public',
      isOwner: json['isOwner'] as bool? ?? false,
      identityVerified: verification['identityVerified'] as bool? ?? false,
      businessVerified: verification['businessVerified'] as bool? ?? false,
      trustLevel: trust['level'] as String? ?? 'new',
      trustBand: trust['band'] as String? ?? 'new',
      ratingAverage: (rating['average'] as num?)?.toDouble() ?? 0,
      ratingCount: (rating['count'] as num?)?.toInt() ?? 0,
      city: location?['city'] as String?,
      country: location?['country'] as String?,
      email: contact['email'] as String?,
      phone: contact['phone'] as String?,
      businesses: (json['businesses'] as List? ?? const [])
          .whereType<Map>()
          .map((e) => BusinessSummary.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
      showListings: flags['showListings'] as bool? ?? true,
      showReviews: flags['showReviews'] as bool? ?? true,
      createdAt: json['createdAt'] as String?,
    );
  }

  final int id;
  final String uuid;
  final String username;
  final String displayName;
  final String? bio;
  final String? avatarUrl;
  final String? avatarThumbUrl;
  final String? website;
  final String visibility;
  final bool isOwner;
  final bool identityVerified;
  final bool businessVerified;
  final String trustLevel;
  final String trustBand;
  final double ratingAverage;
  final int ratingCount;
  final String? city;
  final String? country;
  final String? email;
  final String? phone;
  final List<BusinessSummary> businesses;
  final bool showListings;
  final bool showReviews;
  final String? createdAt;

  String? get verificationLabel {
    if (identityVerified && businessVerified) return 'Verified';
    if (identityVerified) return 'Identity verified';
    if (businessVerified) return 'Business verified';
    return null;
  }
}

class BusinessSummary {
  const BusinessSummary({
    required this.id,
    required this.kind,
    required this.name,
    required this.slug,
    this.logoUrl,
    this.verified = false,
    this.status,
    this.role,
    this.description,
  });

  factory BusinessSummary.fromJson(Map<String, dynamic> json) => BusinessSummary(
        id: (json['id'] as num?)?.toInt() ?? 0,
        kind: json['kind'] as String? ?? 'company',
        name: json['name'] as String? ??
            json['tradeName'] as String? ??
            json['legalName'] as String? ??
            'Business',
        slug: json['slug'] as String? ?? '',
        logoUrl: json['logoUrl'] as String?,
        verified: json['verified'] as bool? ?? json['verifiedAt'] != null,
        status: json['status'] as String?,
        role: json['role'] as String?,
        description: json['description'] as String?,
      );

  final int id;
  final String kind;
  final String name;
  final String slug;
  final String? logoUrl;
  final bool verified;
  final String? status;
  final String? role;
  final String? description;

  String get kindLabel => switch (kind) {
        'dealer' => 'Dealer',
        'agency' => 'Agency',
        'builder' => 'Builder',
        'gold_shop' => 'Gold shop',
        _ => 'Company',
      };
}

class PrivacySettings {
  const PrivacySettings({
    this.visibility = 'public',
    this.showPhone = true,
    this.showEmail = false,
    this.showWhatsapp = true,
    this.showLocation = true,
    this.showListings = true,
    this.showBusinesses = true,
    this.showReviews = true,
    this.showLastActive = false,
  });

  factory PrivacySettings.fromJson(Map<String, dynamic> json) => PrivacySettings(
        visibility: json['visibility'] as String? ?? 'public',
        showPhone: json['showPhone'] as bool? ?? true,
        showEmail: json['showEmail'] as bool? ?? false,
        showWhatsapp: json['showWhatsapp'] as bool? ?? true,
        showLocation: json['showLocation'] as bool? ?? true,
        showListings: json['showListings'] as bool? ?? true,
        showBusinesses: json['showBusinesses'] as bool? ?? true,
        showReviews: json['showReviews'] as bool? ?? true,
        showLastActive: json['showLastActive'] as bool? ?? false,
      );

  final String visibility;
  final bool showPhone;
  final bool showEmail;
  final bool showWhatsapp;
  final bool showLocation;
  final bool showListings;
  final bool showBusinesses;
  final bool showReviews;
  final bool showLastActive;

  Map<String, dynamic> toJson() => {
        'visibility': visibility,
        'showPhone': showPhone,
        'showEmail': showEmail,
        'showWhatsapp': showWhatsapp,
        'showLocation': showLocation,
        'showListings': showListings,
        'showBusinesses': showBusinesses,
        'showReviews': showReviews,
        'showLastActive': showLastActive,
      };

  PrivacySettings copyWith({
    String? visibility,
    bool? showPhone,
    bool? showEmail,
    bool? showWhatsapp,
    bool? showLocation,
    bool? showListings,
    bool? showBusinesses,
    bool? showReviews,
    bool? showLastActive,
  }) =>
      PrivacySettings(
        visibility: visibility ?? this.visibility,
        showPhone: showPhone ?? this.showPhone,
        showEmail: showEmail ?? this.showEmail,
        showWhatsapp: showWhatsapp ?? this.showWhatsapp,
        showLocation: showLocation ?? this.showLocation,
        showListings: showListings ?? this.showListings,
        showBusinesses: showBusinesses ?? this.showBusinesses,
        showReviews: showReviews ?? this.showReviews,
        showLastActive: showLastActive ?? this.showLastActive,
      );
}

class VerificationSnapshot {
  const VerificationSnapshot({
    required this.overallStatus,
    this.identityVerified = false,
    this.businessVerified = false,
    this.requests = const [],
  });

  factory VerificationSnapshot.fromJson(Map<String, dynamic> json) =>
      VerificationSnapshot(
        overallStatus: json['overallStatus'] as String? ?? 'NOT_STARTED',
        identityVerified: json['identityVerified'] as bool? ?? false,
        businessVerified: json['businessVerified'] as bool? ?? false,
        requests: (json['requests'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList(),
      );

  final String overallStatus;
  final bool identityVerified;
  final bool businessVerified;
  final List<Map<String, dynamic>> requests;
}

class UsernameCheck {
  const UsernameCheck({required this.available, required this.issues});

  factory UsernameCheck.fromJson(Map<String, dynamic> json) => UsernameCheck(
        available: json['available'] as bool? ?? json['ok'] as bool? ?? false,
        issues: (json['issues'] as List? ?? const [])
            .whereType<Map>()
            .map((e) => (e['message'] ?? e['code']).toString())
            .toList(),
      );

  final bool available;
  final List<String> issues;
}
