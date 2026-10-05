String? extractOrderUuid(Object? value) {
  if (value == null) return null;
  if (value is String) {
    return _looksLikeUuid(value) ? value : null;
  }
  if (value is Map) {
    final json = Map<String, dynamic>.from(value);
    final order = json['order'];
    if (order is Map) {
      final nested = order['uuid']?.toString();
      if (_looksLikeUuid(nested)) return nested;
    }
    final direct = json['orderUuid']?.toString() ?? json['uuid']?.toString();
    if (_looksLikeUuid(direct)) return direct;
  }
  try {
    final uuid = (value as dynamic).orderUuid as String?;
    if (_looksLikeUuid(uuid)) return uuid;
  } catch (_) {}
  return null;
}

bool _looksLikeUuid(String? value) {
  if (value == null || value.length < 32) return false;
  return RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  ).hasMatch(value);
}

class PaymentCheckout {
  const PaymentCheckout({
    required this.order,
    this.intent,
    this.payment,
    this.bankTransfer,
    this.invoice,
    this.authoritative = true,
  });

  factory PaymentCheckout.fromJson(Map<String, dynamic> json) {
    return PaymentCheckout(
      order: PaymentOrder.fromJson(
        json['order'] is Map
            ? Map<String, dynamic>.from(json['order'] as Map)
            : json,
      ),
      intent: json['intent'] is Map
          ? PaymentIntentInfo.fromJson(Map<String, dynamic>.from(json['intent'] as Map))
          : null,
      payment: json['payment'] is Map
          ? PaymentAttempt.fromJson(Map<String, dynamic>.from(json['payment'] as Map))
          : null,
      bankTransfer: json['bankTransfer'] is Map
          ? BankTransferInfo.fromJson(
              Map<String, dynamic>.from(json['bankTransfer'] as Map),
            )
          : null,
      invoice: json['invoice'] is Map
          ? PaymentInvoice.fromJson(Map<String, dynamic>.from(json['invoice'] as Map))
          : null,
      authoritative: json['authoritative'] != false,
    );
  }

  final PaymentOrder order;
  final PaymentIntentInfo? intent;
  final PaymentAttempt? payment;
  final BankTransferInfo? bankTransfer;
  final PaymentInvoice? invoice;
  final bool authoritative;

  bool get isPaid =>
      order.status == 'paid' ||
      payment?.status == 'succeeded' ||
      payment?.status == 'captured';

  bool get isFailed =>
      order.status == 'failed' ||
      order.status == 'expired' ||
      order.status == 'cancelled' ||
      payment?.status == 'failed' ||
      payment?.status == 'expired';

  bool get isOpen => !isPaid && !isFailed;
}

class PaymentOrder {
  const PaymentOrder({
    required this.uuid,
    required this.orderNumber,
    required this.kind,
    required this.totalAmount,
    required this.currency,
    required this.status,
    this.subtotal,
    this.discountAmount,
    this.taxAmount,
    this.paidAt,
    this.expiresAt,
  });

  factory PaymentOrder.fromJson(Map<String, dynamic> json) => PaymentOrder(
        uuid: (json['uuid'] ?? '').toString(),
        orderNumber: (json['orderNumber'] ?? '').toString(),
        kind: (json['kind'] ?? '').toString(),
        subtotal: (json['subtotal'] as num?)?.toDouble(),
        discountAmount: (json['discountAmount'] as num?)?.toDouble(),
        taxAmount: (json['taxAmount'] as num?)?.toDouble(),
        totalAmount: (json['totalAmount'] as num?)?.toDouble() ??
            (json['amount'] as num?)?.toDouble() ??
            0,
        currency: (json['currency'] ?? '').toString(),
        status: (json['status'] ?? '').toString(),
        paidAt: json['paidAt']?.toString(),
        expiresAt: json['expiresAt']?.toString(),
      );

  final String uuid;
  final String orderNumber;
  final String kind;
  final double? subtotal;
  final double? discountAmount;
  final double? taxAmount;
  final double totalAmount;
  final String currency;
  final String status;
  final String? paidAt;
  final String? expiresAt;
}

class PaymentIntentInfo {
  const PaymentIntentInfo({
    required this.uuid,
    required this.status,
    required this.method,
    required this.provider,
    required this.chargeAmount,
    required this.chargeCurrency,
    this.displayAmount,
    this.displayCurrency,
    this.clientSecret,
    this.redirectUrl,
    this.instructions,
  });

  factory PaymentIntentInfo.fromJson(Map<String, dynamic> json) => PaymentIntentInfo(
        uuid: (json['uuid'] ?? '').toString(),
        status: (json['status'] ?? '').toString(),
        method: (json['method'] ?? '').toString(),
        provider: (json['provider'] ?? '').toString(),
        chargeAmount: (json['chargeAmount'] as num?)?.toDouble() ?? 0,
        chargeCurrency: (json['chargeCurrency'] ?? '').toString(),
        displayAmount: (json['displayAmount'] as num?)?.toDouble(),
        displayCurrency: json['displayCurrency']?.toString(),
        clientSecret: json['clientSecret']?.toString(),
        redirectUrl: json['redirectUrl']?.toString(),
        instructions: json['instructions']?.toString(),
      );

  final String uuid;
  final String status;
  final String method;
  final String provider;
  final double chargeAmount;
  final String chargeCurrency;
  final double? displayAmount;
  final String? displayCurrency;
  final String? clientSecret;
  final String? redirectUrl;
  final String? instructions;
}

class PaymentAttempt {
  const PaymentAttempt({
    required this.uuid,
    required this.status,
    required this.amount,
    required this.currency,
    required this.provider,
    this.method,
    this.failureMessage,
  });

  factory PaymentAttempt.fromJson(Map<String, dynamic> json) => PaymentAttempt(
        uuid: (json['uuid'] ?? '').toString(),
        status: (json['status'] ?? '').toString(),
        amount: (json['amount'] as num?)?.toDouble() ?? 0,
        currency: (json['currency'] ?? '').toString(),
        provider: (json['provider'] ?? '').toString(),
        method: json['method']?.toString(),
        failureMessage: json['failureMessage']?.toString(),
      );

  final String uuid;
  final String status;
  final double amount;
  final String currency;
  final String provider;
  final String? method;
  final String? failureMessage;
}

class BankTransferInfo {
  const BankTransferInfo({
    required this.uuid,
    required this.referenceCode,
    required this.bankName,
    required this.accountName,
    required this.accountNumberMasked,
    required this.amount,
    required this.currency,
    required this.status,
    this.ibanMasked,
  });

  factory BankTransferInfo.fromJson(Map<String, dynamic> json) => BankTransferInfo(
        uuid: (json['uuid'] ?? '').toString(),
        referenceCode: (json['referenceCode'] ?? '').toString(),
        bankName: (json['bankName'] ?? '').toString(),
        accountName: (json['accountName'] ?? '').toString(),
        accountNumberMasked: (json['accountNumberMasked'] ?? '').toString(),
        ibanMasked: json['ibanMasked']?.toString(),
        amount: (json['amount'] as num?)?.toDouble() ?? 0,
        currency: (json['currency'] ?? '').toString(),
        status: (json['status'] ?? '').toString(),
      );

  final String uuid;
  final String referenceCode;
  final String bankName;
  final String accountName;
  final String accountNumberMasked;
  final String? ibanMasked;
  final double amount;
  final String currency;
  final String status;
}

class PaymentInvoice {
  const PaymentInvoice({
    required this.uuid,
    required this.invoiceNumber,
    required this.totalAmount,
    required this.currency,
    required this.status,
    this.pdfUrl,
  });

  factory PaymentInvoice.fromJson(Map<String, dynamic> json) => PaymentInvoice(
        uuid: (json['uuid'] ?? '').toString(),
        invoiceNumber: (json['invoiceNumber'] ?? '').toString(),
        totalAmount: (json['totalAmount'] as num?)?.toDouble() ?? 0,
        currency: (json['currency'] ?? '').toString(),
        status: (json['status'] ?? '').toString(),
        pdfUrl: json['pdfUrl']?.toString(),
      );

  final String uuid;
  final String invoiceNumber;
  final double totalAmount;
  final String currency;
  final String status;
  final String? pdfUrl;
}

class PaymentMethodOffer {
  const PaymentMethodOffer({required this.methods, required this.providers});

  factory PaymentMethodOffer.fromJson(Map<String, dynamic> json) {
    final methods = (json['methods'] as List? ?? [])
        .map((e) => e.toString())
        .toList();
    final providers = (json['providers'] as List? ?? [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();
    return PaymentMethodOffer(methods: methods, providers: providers);
  }

  final List<String> methods;
  final List<Map<String, dynamic>> providers;
}
