class ReviewCriterion {
  const ReviewCriterion({required this.code, required this.label, this.rating});

  factory ReviewCriterion.fromJson(Map<String, dynamic> json) => ReviewCriterion(
        code: json['code']?.toString() ?? '',
        label: json['label']?.toString() ?? json['code']?.toString() ?? '',
        rating: (json['rating'] as num?)?.toDouble(),
      );

  final String code;
  final String label;
  final double? rating;
}

class ReviewEligibility {
  const ReviewEligibility({
    required this.state,
    required this.eligible,
    required this.reason,
    this.verificationLabel,
    this.windowEndsAt,
  });

  factory ReviewEligibility.fromJson(Map<String, dynamic> json) => ReviewEligibility(
        state: json['state']?.toString() ?? 'NOT_ELIGIBLE',
        eligible: json['eligible'] == true,
        reason: json['reason']?.toString() ?? '',
        verificationLabel: json['verificationLabel']?.toString(),
        windowEndsAt: json['windowEndsAt']?.toString(),
      );

  final String state;
  final bool eligible;
  final String reason;
  final String? verificationLabel;
  final String? windowEndsAt;
}

class ReviewSummary {
  const ReviewSummary({
    this.average = 0,
    this.count = 0,
    this.verifiedCount = 0,
    this.stars = const {},
  });

  factory ReviewSummary.fromJson(Map<String, dynamic> json) => ReviewSummary(
        average: (json['averageRating'] as num?)?.toDouble() ??
            (json['average'] as num?)?.toDouble() ??
            0,
        count: (json['reviewCount'] as num?)?.toInt() ?? (json['count'] as num?)?.toInt() ?? 0,
        verifiedCount: (json['verifiedReviewCount'] as num?)?.toInt() ??
            (json['verifiedCount'] as num?)?.toInt() ??
            0,
        stars: {
          for (final entry in (json['distribution'] as Map? ?? json['stars'] as Map? ?? {}).entries)
            int.tryParse(entry.key.toString()) ?? 0: (entry.value as num?)?.toInt() ?? 0,
        },
      );

  final double average;
  final int count;
  final int verifiedCount;
  final Map<int, int> stars;
}

class ReviewItem {
  const ReviewItem({
    required this.uuid,
    required this.rating,
    this.title,
    this.body,
    this.reviewerName,
    this.verificationLabel,
    this.status = 'ACTIVE',
    this.helpfulCount = 0,
    this.publishedAt,
    this.criteria = const [],
  });

  factory ReviewItem.fromJson(Map<String, dynamic> json) => ReviewItem(
        uuid: json['uuid']?.toString() ?? '',
        rating: (json['rating'] as num?)?.toDouble() ?? 0,
        title: json['title']?.toString(),
        body: json['body']?.toString(),
        reviewerName: json['reviewerName']?.toString(),
        verificationLabel: json['verificationLabel']?.toString(),
        status: json['status']?.toString() ?? 'ACTIVE',
        helpfulCount: (json['helpfulCount'] as num?)?.toInt() ?? 0,
        publishedAt: json['publishedAt']?.toString(),
        criteria: [
          for (final row in json['criteria'] as List? ?? const [])
            if (row is Map) ReviewCriterion.fromJson(Map<String, dynamic>.from(row)),
        ],
      );

  final String uuid;
  final double rating;
  final String? title;
  final String? body;
  final String? reviewerName;
  final String? verificationLabel;
  final String status;
  final int helpfulCount;
  final String? publishedAt;
  final List<ReviewCriterion> criteria;

  ReviewItem copyWith({int? helpfulCount}) => ReviewItem(
        uuid: uuid,
        rating: rating,
        title: title,
        body: body,
        reviewerName: reviewerName,
        verificationLabel: verificationLabel,
        status: status,
        helpfulCount: helpfulCount ?? this.helpfulCount,
        publishedAt: publishedAt,
        criteria: criteria,
      );
}

class ServedAd {
  const ServedAd({
    required this.uuid,
    required this.impressionToken,
    this.headline,
    this.body,
    this.ctaLabel,
    this.imageUrl,
    this.landingUrl,
    this.deepLink,
    this.format = 'native',
    this.listingId,
    this.label = 'Advertisement',
  });

  factory ServedAd.fromJson(Map<String, dynamic> json) => ServedAd(
        uuid: json['uuid']?.toString() ?? '',
        impressionToken: json['impressionToken']?.toString() ?? '',
        headline: json['headline']?.toString(),
        body: json['body']?.toString(),
        ctaLabel: json['ctaLabel']?.toString(),
        imageUrl: json['imageUrl']?.toString(),
        landingUrl: json['landingUrl']?.toString(),
        deepLink: json['deepLink']?.toString(),
        format: json['format']?.toString() ?? 'native',
        listingId: (json['listingId'] as num?)?.toInt(),
        label: json['label']?.toString() ?? 'Advertisement',
      );

  final String uuid;
  final String impressionToken;
  final String? headline;
  final String? body;
  final String? ctaLabel;
  final String? imageUrl;
  final String? landingUrl;
  final String? deepLink;
  final String format;
  final int? listingId;
  final String label;
}

class AdCampaign {
  const AdCampaign({
    required this.uuid,
    required this.name,
    required this.status,
    this.objective,
    this.spentAmount = 0,
    this.totalBudget,
    this.currency = 'USD',
  });

  factory AdCampaign.fromJson(Map<String, dynamic> json) => AdCampaign(
        uuid: json['uuid']?.toString() ?? '',
        name: json['name']?.toString() ?? '',
        status: json['status']?.toString() ?? 'draft',
        objective: json['objective']?.toString(),
        spentAmount: (json['spentAmount'] as num?)?.toDouble() ?? 0,
        totalBudget: (json['totalBudget'] as num?)?.toDouble(),
        currency: json['currency']?.toString() ?? 'USD',
      );

  final String uuid;
  final String name;
  final String status;
  final String? objective;
  final double spentAmount;
  final double? totalBudget;
  final String currency;
}

List<ServedAd> parseServedAds(dynamic data) {
  if (data is Map && data['ads'] is List) {
    return [
      for (final row in data['ads'] as List)
        if (row is Map) ServedAd.fromJson(Map<String, dynamic>.from(row)),
    ];
  }
  if (data is List) {
    return [
      for (final row in data)
        if (row is Map) ServedAd.fromJson(Map<String, dynamic>.from(row)),
    ];
  }
  return const [];
}
