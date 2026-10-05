import '../models/listing_model.dart';

/// Payload for `POST /listings` — aligned with backend createListingSchema.
class CreateListingRequest {
  CreateListingRequest({
    required this.marketplace,
    required this.categoryId,
    required this.title,
    this.operation = 'sell',
    this.description,
    this.conditionCode,
    this.price,
    this.currency,
    this.priceType = 'fixed',
    this.pricePeriod = 'total',
    this.priceNegotiable = false,
    this.location,
    this.contactPhone,
    this.contactWhatsapp,
    this.allowChat = true,
    this.allowCalls = true,
    this.allowOffers = true,
    this.details = const {},
    this.media = const [],
    this.publish = true,
    this.idempotencyKey,
    this.businessId,
    this.auction,
  });

  final String marketplace;
  final int categoryId;
  final String operation;
  final String title;
  final String? description;
  final String? conditionCode;
  final double? price;
  final String? currency;
  final String priceType;
  final String pricePeriod;
  final bool priceNegotiable;
  final Map<String, dynamic>? location;
  final String? contactPhone;
  final String? contactWhatsapp;
  final bool allowChat;
  final bool allowCalls;
  final bool allowOffers;
  final Map<String, dynamic> details;
  final List<Map<String, dynamic>> media;
  final bool publish;
  final String? idempotencyKey;
  final int? businessId;
  final Map<String, dynamic>? auction;

  Map<String, dynamic> toJson() => {
        'marketplace': marketplace,
        'categoryId': categoryId,
        'operation': operation,
        'title': title,
        if (description != null && description!.isNotEmpty)
          'description': description,
        if (conditionCode != null) 'conditionCode': conditionCode,
        if (price != null) 'price': price,
        if (currency != null) 'currency': currency,
        'priceType': priceType,
        'pricePeriod': pricePeriod,
        'priceNegotiable': priceNegotiable,
        if (location != null) 'location': location,
        if (contactPhone != null && contactPhone!.isNotEmpty)
          'contactPhone': contactPhone,
        if (contactWhatsapp != null && contactWhatsapp!.isNotEmpty)
          'contactWhatsapp': contactWhatsapp,
        'allowChat': allowChat,
        'allowCalls': allowCalls,
        'allowOffers': allowOffers,
        if (details.isNotEmpty) 'details': details,
        if (media.isNotEmpty) 'media': media,
        'publish': publish,
        if (idempotencyKey != null) 'idempotencyKey': idempotencyKey,
        if (businessId != null) 'businessId': businessId,
        if (auction != null) 'auction': auction,
      };
}

class CreateListingResult {
  const CreateListingResult({
    required this.listing,
    this.warnings = const [],
  });

  final ListingModel listing;
  final List<String> warnings;
}
