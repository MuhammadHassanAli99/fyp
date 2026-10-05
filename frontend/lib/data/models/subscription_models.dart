import 'package:collection/collection.dart';

class SubscriptionPlan {
  const SubscriptionPlan({
    required this.id,
    required this.code,
    required this.name,
    required this.tier,
    required this.audience,
    required this.trialDays,
    required this.features,
    required this.prices,
    this.description,
    this.badgeCode,
    this.price,
  });

  factory SubscriptionPlan.fromJson(Map<String, dynamic> json) {
    final prices = (json['prices'] as List? ?? [])
        .whereType<Map>()
        .map((e) => PlanPrice.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    return SubscriptionPlan(
      id: (json['id'] as num?)?.toInt() ?? 0,
      code: (json['code'] ?? '').toString(),
      name: (json['name'] ?? '').toString(),
      description: json['description']?.toString(),
      tier: (json['tier'] as num?)?.toInt() ?? 0,
      audience: (json['audience'] ?? 'both').toString(),
      trialDays: (json['trialDays'] as num?)?.toInt() ?? 0,
      badgeCode: json['badgeCode']?.toString(),
      prices: prices,
      price: json['price'] is Map
          ? PlanPrice.fromJson(Map<String, dynamic>.from(json['price'] as Map))
          : prices.where((p) => p.interval == 'monthly').firstOrNull ??
              (prices.isEmpty ? null : prices.first),
      features: (json['features'] as List? ?? [])
          .whereType<Map>()
          .map((e) => PlanFeature.fromJson(Map<String, dynamic>.from(e)))
          .toList(),
    );
  }

  final int id;
  final String code;
  final String name;
  final String? description;
  final int tier;
  final String audience;
  final int trialDays;
  final String? badgeCode;
  final PlanPrice? price;
  final List<PlanPrice> prices;
  final List<PlanFeature> features;

  PlanPrice? priceFor(String interval) =>
      prices.where((p) => p.interval == interval).firstOrNull ?? price;
}

class PlanPrice {
  const PlanPrice({
    required this.amount,
    required this.currency,
    required this.interval,
    this.originalAmount,
  });

  factory PlanPrice.fromJson(Map<String, dynamic> json) => PlanPrice(
        amount: (json['amount'] as num?)?.toDouble() ?? 0,
        originalAmount: (json['originalAmount'] as num?)?.toDouble(),
        currency: (json['currency'] ?? 'USD').toString(),
        interval: (json['interval'] ?? 'monthly').toString(),
      );

  final double amount;
  final double? originalAmount;
  final String currency;
  final String interval;
}

class PlanFeature {
  const PlanFeature({
    required this.code,
    required this.name,
    required this.enabled,
    required this.unlimited,
    this.unit,
    this.limit,
  });

  factory PlanFeature.fromJson(Map<String, dynamic> json) => PlanFeature(
        code: (json['code'] ?? '').toString(),
        name: (json['name'] ?? json['code'] ?? '').toString(),
        unit: json['unit']?.toString(),
        enabled: json['enabled'] == true,
        unlimited: json['unlimited'] == true,
        limit: (json['limit'] as num?)?.toInt(),
      );

  final String code;
  final String name;
  final String? unit;
  final bool enabled;
  final bool unlimited;
  final int? limit;
}

class CurrentSubscription {
  const CurrentSubscription({
    required this.id,
    required this.uuid,
    required this.status,
    required this.planCode,
    required this.planName,
    required this.tier,
    required this.quantity,
    required this.autoRenew,
    this.currentPeriodStart,
    this.currentPeriodEnd,
    this.trialEnd,
    this.gateway,
    this.cancelAt,
    this.cancelledAt,
    this.gracePeriodEndsAt,
    this.pendingPlanCode,
    this.pendingPlanName,
  });

  factory CurrentSubscription.fromJson(Map<String, dynamic> json) =>
      CurrentSubscription(
        id: (json['id'] as num?)?.toInt() ?? 0,
        uuid: (json['uuid'] ?? '').toString(),
        status: (json['status'] ?? '').toString(),
        planCode: (json['planCode'] ?? '').toString(),
        planName: (json['planName'] ?? '').toString(),
        tier: (json['tier'] as num?)?.toInt() ?? 0,
        quantity: (json['quantity'] as num?)?.toInt() ?? 1,
        currentPeriodStart: json['currentPeriodStart']?.toString(),
        currentPeriodEnd: json['currentPeriodEnd']?.toString(),
        trialEnd: json['trialEnd']?.toString(),
        autoRenew: json['autoRenew'] == true,
        gateway: json['gateway']?.toString(),
        cancelAt: json['cancelAt']?.toString(),
        cancelledAt: json['cancelledAt']?.toString(),
        gracePeriodEndsAt: json['gracePeriodEndsAt']?.toString(),
        pendingPlanCode: json['pendingPlanCode']?.toString(),
        pendingPlanName: json['pendingPlanName']?.toString(),
      );

  final int id;
  final String uuid;
  final String status;
  final String planCode;
  final String planName;
  final int tier;
  final int quantity;
  final String? currentPeriodStart;
  final String? currentPeriodEnd;
  final String? trialEnd;
  final bool autoRenew;
  final String? gateway;
  final String? cancelAt;
  final String? cancelledAt;
  final String? gracePeriodEndsAt;
  final String? pendingPlanCode;
  final String? pendingPlanName;

  bool get cancelAtPeriodEnd => cancelAt != null && cancelAt!.isNotEmpty;
}

class EntitlementsSnapshot {
  const EntitlementsSnapshot({
    required this.planCode,
    required this.planTier,
    required this.status,
    required this.overLimit,
    required this.features,
    this.subscriptionId,
  });

  factory EntitlementsSnapshot.fromJson(Map<String, dynamic> json) {
    final raw = json['features'];
    final features = <String, FeatureEntitlement>{};
    if (raw is Map) {
      for (final entry in raw.entries) {
        if (entry.value is Map) {
          features[entry.key.toString()] = FeatureEntitlement.fromJson(
            Map<String, dynamic>.from(entry.value as Map),
          );
        }
      }
    }
    return EntitlementsSnapshot(
      planCode: (json['planCode'] ?? 'free').toString(),
      planTier: (json['planTier'] as num?)?.toInt() ?? 0,
      subscriptionId: (json['subscriptionId'] as num?)?.toInt(),
      status: (json['status'] ?? 'active').toString(),
      overLimit: json['overLimit'] == true,
      features: features,
    );
  }

  final String planCode;
  final int planTier;
  final int? subscriptionId;
  final String status;
  final bool overLimit;
  final Map<String, FeatureEntitlement> features;

  bool has(String code) => features[code]?.enabled == true;
}

class FeatureEntitlement {
  const FeatureEntitlement({
    required this.enabled,
    required this.unlimited,
    this.limit,
  });

  factory FeatureEntitlement.fromJson(Map<String, dynamic> json) =>
      FeatureEntitlement(
        enabled: json['enabled'] == true,
        unlimited: json['unlimited'] == true,
        limit: (json['limit'] as num?)?.toInt(),
      );

  final bool enabled;
  final bool unlimited;
  final int? limit;
}

class UsageMeter {
  const UsageMeter({
    required this.featureCode,
    required this.used,
    required this.unlimited,
    required this.currentPlan,
    required this.upgradeAvailable,
    this.limit,
    this.remaining,
  });

  factory UsageMeter.fromJson(Map<String, dynamic> json) => UsageMeter(
        featureCode: (json['featureCode'] ?? '').toString(),
        used: (json['used'] as num?)?.toInt() ?? 0,
        limit: (json['limit'] as num?)?.toInt(),
        unlimited: json['unlimited'] == true,
        remaining: (json['remaining'] as num?)?.toInt(),
        currentPlan: (json['currentPlan'] ?? '').toString(),
        upgradeAvailable: json['upgradeAvailable'] == true,
      );

  final String featureCode;
  final int used;
  final int? limit;
  final bool unlimited;
  final int? remaining;
  final String currentPlan;
  final bool upgradeAvailable;

  double get fraction {
    if (unlimited || limit == null || limit == 0) return 0;
    return (used / limit!).clamp(0, 1);
  }
}

class SubscriptionSnapshot {
  const SubscriptionSnapshot({
    required this.entitlements,
    required this.usage,
    required this.overLimit,
    this.subscription,
    this.overLimitMessage,
  });

  factory SubscriptionSnapshot.fromJson(Map<String, dynamic> json) =>
      SubscriptionSnapshot(
        subscription: json['subscription'] is Map
            ? CurrentSubscription.fromJson(
                Map<String, dynamic>.from(json['subscription'] as Map),
              )
            : null,
        entitlements: EntitlementsSnapshot.fromJson(
          json['entitlements'] is Map
              ? Map<String, dynamic>.from(json['entitlements'] as Map)
              : <String, dynamic>{},
        ),
        usage: (json['usage'] as List? ?? [])
            .whereType<Map>()
            .map((e) => UsageMeter.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
        overLimit: json['overLimit'] == true,
        overLimitMessage: json['overLimitMessage']?.toString(),
      );

  final CurrentSubscription? subscription;
  final EntitlementsSnapshot entitlements;
  final List<UsageMeter> usage;
  final bool overLimit;
  final String? overLimitMessage;
}

class CheckoutResult {
  const CheckoutResult({
    required this.requiresPayment,
    this.scheduled = false,
    this.planCode,
    this.status,
    this.currentPeriodEnd,
    this.effectiveAt,
    this.overLimitMessage,
    this.orderUuid,
    this.orderNumber,
    this.amount,
    this.currency,
    this.instructions,
    this.redirectUrl,
    this.clientSecret,
  });

  factory CheckoutResult.fromJson(Map<String, dynamic> json) {
    final order = json['order'] is Map
        ? Map<String, dynamic>.from(json['order'] as Map)
        : const <String, dynamic>{};
    return CheckoutResult(
      requiresPayment: json['requiresPayment'] == true,
      scheduled: json['scheduled'] == true,
      planCode: json['planCode']?.toString(),
      status: json['status']?.toString(),
      currentPeriodEnd: json['currentPeriodEnd']?.toString(),
      effectiveAt: json['effectiveAt']?.toString(),
      overLimitMessage: json['overLimitMessage']?.toString(),
      orderUuid: order['uuid']?.toString(),
      orderNumber: order['orderNumber']?.toString(),
      amount: (order['amount'] as num?)?.toDouble(),
      currency: order['currency']?.toString(),
      instructions: json['instructions']?.toString(),
      redirectUrl: json['redirectUrl']?.toString(),
      clientSecret: json['clientSecret']?.toString(),
    );
  }

  final bool requiresPayment;
  final bool scheduled;
  final String? planCode;
  final String? status;
  final String? currentPeriodEnd;
  final String? effectiveAt;
  final String? overLimitMessage;
  final String? orderUuid;
  final String? orderNumber;
  final double? amount;
  final String? currency;
  final String? instructions;
  final String? redirectUrl;
  final String? clientSecret;
}

class SubscriptionInvoice {
  const SubscriptionInvoice({
    required this.uuid,
    required this.invoiceNumber,
    required this.totalAmount,
    required this.currency,
    required this.status,
    this.taxAmount,
    this.issuedAt,
    this.paidAt,
    this.pdfUrl,
  });

  factory SubscriptionInvoice.fromJson(Map<String, dynamic> json) =>
      SubscriptionInvoice(
        uuid: (json['uuid'] ?? '').toString(),
        invoiceNumber: (json['invoiceNumber'] ?? '').toString(),
        totalAmount: (json['totalAmount'] as num?)?.toDouble() ?? 0,
        taxAmount: (json['taxAmount'] as num?)?.toDouble(),
        currency: (json['currency'] ?? '').toString(),
        status: (json['status'] ?? '').toString(),
        issuedAt: json['issuedAt']?.toString(),
        paidAt: json['paidAt']?.toString(),
        pdfUrl: json['pdfUrl']?.toString(),
      );

  final String uuid;
  final String invoiceNumber;
  final double totalAmount;
  final double? taxAmount;
  final String currency;
  final String status;
  final String? issuedAt;
  final String? paidAt;
  final String? pdfUrl;
}
