class SupportContext {
  const SupportContext({
    this.marketplace,
    this.categoryCode,
    this.entityType,
    this.entityId,
    this.listingId,
    this.listingUuid,
    this.orderUuid,
    this.paymentUuid,
    this.conversationUuid,
    this.subjectHint,
  });

  final String? marketplace;
  final String? categoryCode;
  final String? entityType;
  final int? entityId;
  final int? listingId;
  final String? listingUuid;
  final String? orderUuid;
  final String? paymentUuid;
  final String? conversationUuid;
  final String? subjectHint;

  Map<String, dynamic> toJson() => {
        if (marketplace != null) 'marketplaceCode': marketplace,
        if (categoryCode != null) 'categoryCode': categoryCode,
        if (entityType != null) 'relatedEntityType': entityType,
        if (entityId != null) 'relatedEntityId': entityId,
        if (listingId != null) 'listingId': listingId,
        if (listingUuid != null) 'listingUuid': listingUuid,
        if (orderUuid != null) 'orderUuid': orderUuid,
        if (paymentUuid != null) 'paymentUuid': paymentUuid,
        if (conversationUuid != null) 'conversationUuid': conversationUuid,
      };

  String get query => Uri(
        queryParameters: {
          'marketplace': ?marketplace,
          'category': ?categoryCode,
          'entityType': ?entityType,
          if (entityId != null) 'entityId': '$entityId',
          if (listingId != null) 'listingId': '$listingId',
          'listingUuid': ?listingUuid,
          'orderUuid': ?orderUuid,
          'paymentUuid': ?paymentUuid,
          'conversationUuid': ?conversationUuid,
        },
      ).query;
}

class SupportTicketSummary {
  const SupportTicketSummary({
    required this.uuid,
    required this.ticketNumber,
    required this.subject,
    required this.status,
    required this.priority,
    this.department,
    this.updatedAt,
  });

  factory SupportTicketSummary.fromJson(Map<String, dynamic> json) => SupportTicketSummary(
        uuid: json['uuid']?.toString() ?? '',
        ticketNumber: json['ticketNumber']?.toString() ?? json['number']?.toString() ?? '',
        subject: json['subject']?.toString() ?? '',
        status: json['status']?.toString() ?? '',
        priority: json['priority']?.toString() ?? 'NORMAL',
        department: json['department']?.toString(),
        updatedAt: json['updatedAt']?.toString(),
      );

  final String uuid;
  final String ticketNumber;
  final String subject;
  final String status;
  final String priority;
  final String? department;
  final String? updatedAt;
}

class KbArticleSummary {
  const KbArticleSummary({
    required this.uuid,
    required this.slug,
    required this.title,
    this.excerpt,
    this.categoryName,
  });

  factory KbArticleSummary.fromJson(Map<String, dynamic> json) => KbArticleSummary(
        uuid: json['uuid']?.toString() ?? '',
        slug: json['slug']?.toString() ?? '',
        title: json['title']?.toString() ?? '',
        excerpt: json['excerpt']?.toString(),
        categoryName: json['categoryName']?.toString(),
      );

  final String uuid;
  final String slug;
  final String title;
  final String? excerpt;
  final String? categoryName;
}

class ForumTopicSummary {
  const ForumTopicSummary({
    required this.uuid,
    required this.slug,
    required this.title,
    this.replyCount = 0,
    this.categoryName,
  });

  factory ForumTopicSummary.fromJson(Map<String, dynamic> json) => ForumTopicSummary(
        uuid: json['uuid']?.toString() ?? '',
        slug: json['slug']?.toString() ?? '',
        title: json['title']?.toString() ?? '',
        replyCount: (json['replyCount'] as num?)?.toInt() ?? 0,
        categoryName: json['categoryName']?.toString(),
      );

  final String uuid;
  final String slug;
  final String title;
  final int replyCount;
  final String? categoryName;
}
