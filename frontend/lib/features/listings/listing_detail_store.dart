import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:uuid/uuid.dart';

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/gold_models.dart';
import '../../data/models/listing_model.dart';
import '../../data/models/property_models.dart';
import '../../data/models/vehicle_models.dart';
import '../../data/repositories/gold_repository.dart';
import '../../data/repositories/listings_repository.dart';
import '../../data/repositories/property_repository.dart';
import '../../data/repositories/vehicle_repository.dart';

class ListingDetailStore {
  ListingDetailStore(
    this._repo,
    this.listingId, {
    this._gold,
    this._property,
    this._vehicles,
    this._viewerCountryId,
  });

  final ListingsRepository _repo;
  final GoldRepository? _gold;
  final PropertyRepository? _property;
  final VehicleRepository? _vehicles;
  final int? _viewerCountryId;
  final String listingId;

  final listing = signal<AsyncState<ListingModel>>(const AsyncIdle());
  final risk = signal<GoldRiskAssessment?>(null);
  final valuation = signal<PropertyValuation?>(null);
  final vehicleValuation = signal<VehicleValuation?>(null);
  final vehicleLandedCost = signal<VehicleLandedCost?>(null);
  final vehicleFinance = signal<VehicleFinanceQuote?>(null);
  final vehicleInsurance = signal<VehicleInsuranceQuote?>(null);
  final badges = signal<Map<String, dynamic>>({});
  final actionMessage = signal<String?>(null);
  final busy = signal(false);

  Future<void> load() async {
    listing.value = const AsyncLoading();
    final result = await _repo.getById(listingId);
    result.when(
      success: (l) {
        listing.value = AsyncData(l);
        if (l.isGold) {
          _loadRisk(l);
        }
        if (l.isProperty) {
          _loadPropertyExtras(l);
        }
        if (l.isVehicle) {
          _loadVehicleExtras(l);
        }
      },
      failure: (m, code) => listing.value = AsyncError(m, code: code),
    );
  }

  Future<void> _loadRisk(ListingModel item) async {
    final gold = _gold;
    if (gold == null) return;
    final stored = item.authenticityRisk;
    if (stored != null) {
      risk.value = GoldRiskAssessment(
        risk: stored,
        confidence: item.authenticityConfidence ?? 0,
        recommendation: stored == 'low'
            ? 'AI authenticity assessment: Low risk'
            : 'AI could not confidently assess authenticity.',
        disclaimer: item.authenticityDisclaimer ??
            'AI authenticity assessment is a risk-support tool. It cannot prove physical gold is genuine.',
      );
    }
    final result = await gold.assessListing(item.id);
    result.when(
      success: (assessment) => risk.value = assessment,
      failure: (_, _) {},
    );
  }

  Future<Result<GoldBuyResult>> buy() async {
    final gold = _gold;
    if (gold == null) return const Failure('Gold checkout is unavailable');
    busy.value = true;
    final result = await gold.buy(listingId);
    busy.value = false;
    result.when(
      success: (buy) => actionMessage.value =
          'Order started in ${buy.originalCurrency ?? ''} at the seller listing price.',
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> bid(double amount) async {
    final gold = _gold;
    final item = listing.value.dataOrNull;
    final auctionId = item?.auction?.routeId;
    if (gold == null || auctionId == null) {
      return const Failure('This listing is not in auction');
    }
    busy.value = true;
    final result = await gold.placeBid(
      auctionId,
      amount: amount,
      idempotencyKey: const Uuid().v4(),
    );
    busy.value = false;
    result.when(
      success: (_) {
        actionMessage.value = 'Bid submitted. The server is the source of the current bid.';
        load();
      },
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }

  Future<void> _loadPropertyExtras(ListingModel item) async {
    final property = _property;
    if (property == null) return;
    final badgeResult = await property.badges(item.id);
    badgeResult.when(
      success: (map) => badges.value = map,
      failure: (_, _) {},
    );
    final kind = item.propertyKind;
    final cityId = item.cityId;
    final area = item.areaValue;
    final unit = item.areaUnit;
    if (kind == null || cityId == null || area == null || unit == null) return;
    final valued = await property.valuate({
      'listingId': int.tryParse(item.id),
      'propertyKind': kind,
      'operation': item.operation == 'rent' ? 'rent' : 'sell',
      'cityId': cityId,
      'areaValue': area,
      'areaUnit': unit,
      if (item.bedrooms != null) 'bedrooms': item.bedrooms,
      if (item.bathrooms != null) 'bathrooms': item.bathrooms,
    });
    valued.when(
      success: (v) => valuation.value = v,
      failure: (_, _) {},
    );
  }

  Future<Result<Map<String, dynamic>>> makeOffer(double amount) async {
    final property = _property;
    if (property == null) return const Failure('Property offers are unavailable');
    busy.value = true;
    final result = await property.createOffer(listingId, amount: amount);
    busy.value = false;
    result.when(
      success: (_) => actionMessage.value = 'Offer sent. The seller can accept, reject, or counter.',
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> buyProperty() async {
    final property = _property;
    if (property == null) return const Failure('Property checkout is unavailable');
    busy.value = true;
    final result = await property.buy(listingId);
    busy.value = false;
    result.when(
      success: (_) => actionMessage.value =
          'Checkout started. Paying here does not transfer legal title.',
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> applyToRent() async {
    final property = _property;
    if (property == null) return const Failure('Rental applications are unavailable');
    busy.value = true;
    final result = await property.apply(listingId);
    busy.value = false;
    result.when(
      success: (_) => actionMessage.value = 'Application submitted for landlord review.',
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> bookStay({
    required String checkIn,
    required String checkOut,
  }) async {
    final property = _property;
    if (property == null) return const Failure('Booking is unavailable');
    busy.value = true;
    final result = await property.book(listingId, checkIn: checkIn, checkOut: checkOut);
    busy.value = false;
    result.when(
      success: (_) => actionMessage.value = 'Booking payment started.',
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }

  Future<void> _loadVehicleExtras(ListingModel item) async {
    final vehicles = _vehicles;
    if (vehicles == null) return;
    final badgeResult = await vehicles.badges(item.id);
    badgeResult.when(
      success: (map) => badges.value = map,
      failure: (_, _) {},
    );
    final makeId = item.makeId;
    final year = item.year;
    if (makeId != null && year != null) {
      final valued = await vehicles.valuate({
        'listingId': int.tryParse(item.id),
        'makeId': makeId,
        if (item.modelId != null) 'modelId': item.modelId,
        'year': year,
        if (item.mileageKm != null) 'mileageKm': item.mileageKm,
        'askingPrice': item.price,
      });
      valued.when(
        success: (v) => vehicleValuation.value = v,
        failure: (_, _) {},
      );
    }

    final originCountryId = item.countryId;
    final destinationCountryId = _viewerCountryId;
    if (originCountryId != null &&
        destinationCountryId != null &&
        originCountryId != destinationCountryId &&
        item.price > 0) {
      final landed = await vehicles.landedCost({
        'listingId': int.tryParse(item.id),
        'originCountryId': originCountryId,
        'destinationCountryId': destinationCountryId,
        'vehiclePrice': item.price,
        'currency': item.currency,
      });
      landed.when(
        success: (quote) => vehicleLandedCost.value = quote,
        failure: (_, _) {},
      );
    }

    if (item.price > 0) {
      final down = (item.price * 0.2).roundToDouble();
      final finance = await vehicles.financeQuote({
        'listingId': int.tryParse(item.id),
        'vehiclePrice': item.price,
        'downPayment': down,
        'termMonths': 60,
        'annualRatePct': 12,
        'currency': item.currency,
      });
      finance.when(
        success: (quote) => vehicleFinance.value = quote,
        failure: (_, _) {},
      );
      final insurance = await vehicles.insuranceQuote({
        'listingId': int.tryParse(item.id),
        'vehiclePrice': item.price,
        'currency': item.currency,
      });
      insurance.when(
        success: (quote) => vehicleInsurance.value = quote,
        failure: (_, _) {},
      );
    }
  }

  Future<Result<Map<String, dynamic>>> makeVehicleOffer(double amount) async {
    final vehicles = _vehicles;
    if (vehicles == null) return const Failure('Vehicle offers are unavailable');
    busy.value = true;
    final result = await vehicles.createOffer(listingId, amount: amount);
    busy.value = false;
    result.when(
      success: (_) => actionMessage.value = 'Offer sent. The seller can accept, reject, or counter.',
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> buyVehicle() async {
    final vehicles = _vehicles;
    if (vehicles == null) return const Failure('Vehicle checkout is unavailable');
    busy.value = true;
    final result = await vehicles.buy(listingId);
    busy.value = false;
    result.when(
      success: (_) => actionMessage.value =
          'Checkout started. Paying here does not transfer legal ownership or registration.',
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> bookVehicle({
    required String startDate,
    required String endDate,
  }) async {
    final vehicles = _vehicles;
    if (vehicles == null) return const Failure('Vehicle rental is unavailable');
    busy.value = true;
    final result = await vehicles.book(listingId, startDate: startDate, endDate: endDate);
    busy.value = false;
    result.when(
      success: (_) => actionMessage.value = 'Rental payment started.',
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }

  Future<Result<Map<String, dynamic>>> bidVehicle(double amount) async {
    final vehicles = _vehicles;
    final item = listing.value.dataOrNull;
    final auctionId = item?.auction?.routeId;
    if (vehicles == null || auctionId == null) {
      return const Failure('This listing is not in auction');
    }
    busy.value = true;
    final result = await vehicles.placeBid(
      auctionId,
      amount: amount,
      idempotencyKey: const Uuid().v4(),
    );
    busy.value = false;
    result.when(
      success: (_) {
        actionMessage.value = 'Bid submitted. The server is the source of the current bid.';
        load();
      },
      failure: (m, _) => actionMessage.value = m,
    );
    return result;
  }
}
