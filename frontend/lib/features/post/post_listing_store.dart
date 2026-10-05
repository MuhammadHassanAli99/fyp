import 'dart:async';
import 'dart:convert';

import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:uuid/uuid.dart';

import '../../core/database/app_database.dart';
import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../core/storage/prefs_storage.dart';
import '../../data/models/create_listing_input.dart';
import '../../data/models/gold_models.dart';
import '../../data/models/listing_completeness.dart';
import '../../data/models/marketplace_model.dart';
import '../../data/models/property_models.dart';
import '../../data/models/vehicle_models.dart';
import '../../data/remote/marketplace_apis.dart';
import '../../data/repositories/catalog_repository.dart';
import '../../data/repositories/gold_repository.dart';
import '../../data/repositories/listings_repository.dart';
import '../../data/repositories/profile_repository.dart';
import '../../data/repositories/property_repository.dart';
import '../../data/repositories/settings_repository.dart';
import '../../data/repositories/ai_repository.dart';

enum PostStep {
  basics,
  category,
  details,
  pricing,
  contact,
  media,
  review,
}

class PostListingStore {
  PostListingStore({
    required this.catalog,
    required this.listings,
    required this.settings,
    required this.prefs,
    required this.vehiclesApi,
    this.profile,
    this.gold,
    this.property,
    this.database,
    this.ai,
  }) {
    marketplaceCode.value = settings.marketplaceCode ?? 'gold';
    currency.value = settings.currencyCode;
    _watchDraft();
  }

  final CatalogRepository catalog;
  final ListingsRepository listings;
  final SettingsRepository settings;
  final PrefsStorage prefs;
  final VehiclesApi vehiclesApi;
  final ProfileRepository? profile;
  final GoldRepository? gold;
  final PropertyRepository? property;
  final AppDatabase? database;
  final AiRepository? ai;

  Timer? _draftTimer;
  String? _draftUuid;
  bool _hydrating = true;
  void Function()? _draftWatch;

  final step = signal(PostStep.basics);
  final submitting = signal(false);
  final error = signal<String?>(null);
  final success = signal<CreateListingResult?>(null);
  final generatingDescription = signal(false);

  final marketplaceCode = signal('gold');
  final operation = signal('sell');
  final categories = signal<AsyncState<List<CategoryModel>>>(const AsyncIdle());
  final leafOptions =
      signal<List<({CategoryModel category, String label})>>([]);
  final selectedCategoryId = signal<int?>(null);
  final selectedCategoryLabel = signal<String?>(null);

  // Shared
  final title = signal('');
  final description = signal('');
  final conditionCode = signal<String?>('good');
  final price = signal('');
  final currency = signal('PKR');
  final priceNegotiable = signal(false);
  final contactPhone = signal('');
  final contactWhatsapp = signal('');
  final address = signal('');
  final allowChat = signal(true);
  final allowCalls = signal(true);
  /// Uploaded media ready for create payload: {url, kind, isPrimary}.
  final mediaItems = signal<List<Map<String, dynamic>>>([]);
  final sellerBusinessId = signal<int?>(null);
  final businesses = signal<List<({int id, String name})>>([]);

  // Gold
  final karat = signal('22');
  final weightG = signal('');
  final stoneWeightG = signal('');
  final goldForm = signal('jewellery');
  final jewelleryType = signal<String?>('necklace');
  final metalType = signal('gold');
  final isHallmarked = signal(true);
  final hasCertificate = signal(false);
  final isInvestmentGrade = signal(false);
  final makingCharges = signal('');
  final makingChargeType = signal('FIXED');
  final certificateNumber = signal('');
  final hallmarkCode = signal('');
  final serialNumber = signal('');
  final packaging = signal('');
  final brandId = signal<int?>(null);
  final goldPurities = signal<List<GoldPurity>>([]);
  final goldBrands = signal<List<GoldBrand>>([]);
  final goldMakingTypes = signal<List<GoldMakingChargeType>>([]);
  final auctionStartPrice = signal('');
  final auctionIncrement = signal('1');
  final auctionHours = signal('24');

  // Property
  final propertyKind = signal('apartment');
  final areaValue = signal('');
  final areaUnit = signal('sqft');
  final bedrooms = signal('3');
  final bathrooms = signal('2');
  final furnishing = signal<String?>('semi_furnished');
  final societyName = signal('');
  final rentPeriod = signal('monthly');
  final hasSwimmingPool = signal(false);
  final hasGym = signal(false);
  final hasGarden = signal(false);
  final hasElevator = signal(false);
  final isGatedCommunity = signal(false);
  final parkingSpaces = signal('1');
  final propertyCatalog = signal<PropertyCatalog?>(null);

  // Vehicles
  final vehicleType = signal('car');
  final makes = signal<List<NamedOption>>([]);
  final models = signal<List<NamedOption>>([]);
  final makeId = signal<int?>(null);
  final modelId = signal<int?>(null);
  final year = signal('${DateTime.now().year - 2}');
  final mileage = signal('');
  final fuelType = signal('petrol');
  final transmission = signal('automatic');
  final bodyType = signal('sedan');
  final colorExterior = signal('');
  final financeAvailable = signal(false);
  final vehicleCatalog = signal<VehicleCatalog?>(null);

  int get stepIndex => PostStep.values.indexOf(step.value);
  int get totalSteps => PostStep.values.length;

  ListingCompleteness get completeness => scoreListingDraft(
        title: title.value,
        description: description.value,
        price: price.value,
        categoryId: selectedCategoryId.value,
        mediaCount: mediaItems.value.length,
        detailsPresent: _buildDetails().isNotEmpty,
        contactPhone: contactPhone.value,
      );

  void dispose() {
    _draftTimer?.cancel();
    _draftWatch?.call();
  }

  void _watchDraft() {
    _draftWatch = effect(() {
      title.value;
      description.value;
      price.value;
      selectedCategoryId.value;
      mediaItems.value;
      marketplaceCode.value;
      contactPhone.value;
      if (_hydrating) return;
      _scheduleAutosave();
    });
  }

  void _scheduleAutosave() {
    _draftTimer?.cancel();
    _draftTimer = Timer(const Duration(seconds: 2), persistDraft);
  }

  Map<String, dynamic> _draftPayload() => {
        'uuid': _draftUuid,
        'marketplace': marketplaceCode.value,
        'operation': operation.value,
        'categoryId': selectedCategoryId.value,
        'title': title.value,
        'description': description.value,
        'price': price.value,
        'currency': currency.value,
        'contactPhone': contactPhone.value,
        'address': address.value,
        'details': _buildDetails(),
        'media': mediaItems.value,
        'step': stepIndex,
      };

  Future<void> persistDraft() async {
    final payload = jsonEncode(_draftPayload());
    await database?.upsertMarketplaceDraft(
      marketplace: marketplaceCode.value,
      title: title.value.trim().isEmpty ? 'Untitled draft' : title.value.trim(),
      payloadJson: payload,
    );
    final marketplaceId = MarketplaceModel(code: marketplaceCode.value, name: '').resolvedId;
    final result = await listings.saveDraft(
      uuid: _draftUuid,
      marketplaceId: marketplaceId,
      categoryId: selectedCategoryId.value,
      step: stepIndex,
      data: _draftPayload(),
    );
    result.when(
      success: (data) {
        final uuid = data['uuid']?.toString();
        if (uuid != null && uuid.isNotEmpty) _draftUuid = uuid;
      },
      failure: (_, _) {},
    );
  }

  Future<void> _restoreLocalDraft() async {
    final row = await database?.latestDraftFor(marketplaceCode.value);
    if (row == null) return;
    try {
      final data = jsonDecode(row.payloadJson);
      if (data is! Map) return;
      _hydrating = true;
      final map = Map<String, dynamic>.from(data);
      _draftUuid = map['uuid']?.toString();
      if (map['title'] is String) title.value = map['title'] as String;
      if (map['description'] is String) description.value = map['description'] as String;
      if (map['price'] is String) price.value = map['price'] as String;
      if (map['currency'] is String) currency.value = map['currency'] as String;
      if (map['contactPhone'] is String) contactPhone.value = map['contactPhone'] as String;
      if (map['address'] is String) address.value = map['address'] as String;
      if (map['operation'] is String) operation.value = map['operation'] as String;
      if (map['categoryId'] is num) selectedCategoryId.value = (map['categoryId'] as num).toInt();
    } catch (_) {
    }
  }

  Future<void> bootstrap() async {
    await _restoreLocalDraft();
    await Future.wait([loadCategories(), loadBusinesses(), loadGoldCatalog(), loadPropertyCatalog(), loadVehicleCatalog()]);
    if (marketplaceCode.value == 'vehicles') {
      await loadMakes();
    }
    _hydrating = false;
  }

  Future<void> loadBusinesses() async {
    final repo = profile;
    if (repo == null) return;
    final result = await repo.myBusinesses();
    result.when(
      success: (list) {
        businesses.value = [
          for (final item in list)
            if (item.status == 'active' || item.role == 'owner' || item.role == 'admin' || item.role == 'manager')
              (id: item.id, name: item.name),
        ];
      },
      failure: (_, _) {},
    );
  }

  Future<void> setMarketplace(String code) async {
    marketplaceCode.value = code;
    selectedCategoryId.value = null;
    selectedCategoryLabel.value = null;
    if (code == 'property' &&
        !['sell', 'rent', 'buy'].contains(operation.value)) {
      operation.value = 'sell';
    }
    if (code == 'gold' && operation.value == 'rent') {
      operation.value = 'sell';
    }
    if (code == 'vehicles') {
      await loadMakes();
      await loadVehicleCatalog();
    }
    if (code == 'gold') {
      await loadGoldCatalog();
    }
    if (code == 'property') {
      await loadPropertyCatalog();
    }
    await loadCategories();
  }

  Future<void> loadPropertyCatalog() async {
    final repo = property;
    if (repo == null) return;
    final result = await repo.catalog();
    result.when(
      success: (catalog) {
        propertyCatalog.value = catalog;
        final allowed = catalog.typesForOperation(operation.value);
        if (allowed.isNotEmpty &&
            !allowed.any((t) => t.code == propertyKind.value)) {
          propertyKind.value = allowed.first.code;
        }
        if (catalog.areaUnits.isNotEmpty &&
            !catalog.areaUnits.any((u) => u.code == areaUnit.value)) {
          areaUnit.value = catalog.areaUnits.first.code;
        }
        if (catalog.rentalDurations.isNotEmpty &&
            !catalog.rentalDurations.any((d) => d.code == rentPeriod.value)) {
          rentPeriod.value = catalog.rentalDurations.first.code;
        }
      },
      failure: (_, _) {},
    );
  }

  Future<void> loadGoldCatalog() async {
    final repo = gold;
    if (repo == null) return;
    final result = await repo.catalog();
    result.when(
      success: (catalog) {
        goldPurities.value = catalog.displayPurities;
        goldBrands.value = catalog.brands;
        goldMakingTypes.value = catalog.makingChargeTypes;
        if (catalog.makingChargeTypes.isNotEmpty) {
          makingChargeType.value = catalog.makingChargeTypes.first.api;
        }
      },
      failure: (_, _) {},
    );
  }

  Future<void> loadCategories() async {
    categories.value = const AsyncLoading();
    final id = switch (marketplaceCode.value) {
      'property' => 2,
      'vehicles' => 3,
      _ => 1,
    };
    final result = await catalog.categories(id);
    result.when(
      success: (tree) {
        categories.value = AsyncData(tree);
        leafOptions.value = CategoryModel.flattenLeaves(tree);
      },
      failure: (m, code) => categories.value = AsyncError(m, code: code),
    );
  }

  Future<void> loadVehicleCatalog() async {
    try {
      final catalog = await vehiclesApi.catalog();
      vehicleCatalog.value = catalog;
      final allowed = catalog.typesForOperation(operation.value);
      if (allowed.isNotEmpty &&
          !allowed.any((t) => t.code == vehicleType.value)) {
        vehicleType.value = allowed.first.code;
      }
      if (catalog.fuels.isNotEmpty &&
          !catalog.fuels.any((f) => f.code == fuelType.value)) {
        fuelType.value = catalog.fuels.first.code;
      }
      if (catalog.transmissions.isNotEmpty &&
          !catalog.transmissions.any((t) => t.code == transmission.value)) {
        transmission.value = catalog.transmissions.first.code;
      }
      if (catalog.rentalDurations.isNotEmpty &&
          !catalog.rentalDurations.any((d) => d.code == rentPeriod.value)) {
        rentPeriod.value = catalog.rentalDurations.first.code;
      }
    } catch (_) {}
  }

  Future<void> loadMakes() async {
    try {
      makes.value = await vehiclesApi.makes(
        vehicleType: vehicleType.value,
        popular: true,
      );
      if (makes.value.isEmpty) {
        makes.value = await vehiclesApi.makes(vehicleType: vehicleType.value);
      }
    } catch (_) {
      makes.value = [];
    }
  }

  Future<void> loadModels(int make) async {
    makeId.value = make;
    modelId.value = null;
    try {
      models.value = await vehiclesApi.models(
        make,
        vehicleType: vehicleType.value,
      );
    } catch (_) {
      models.value = [];
    }
  }

  String? validateCurrentStep() {
    switch (step.value) {
      case PostStep.basics:
        return null;
      case PostStep.category:
        if (selectedCategoryId.value == null) {
          return 'Choose a category for your listing';
        }
        return null;
      case PostStep.details:
        return _validateDetails();
      case PostStep.pricing:
        if (title.value.trim().length < 6) {
          return 'Title must be at least 6 characters';
        }
        final p = double.tryParse(price.value.trim());
        if (p == null || p < 0) return 'Enter a valid price';
        return null;
      case PostStep.contact:
        if (contactPhone.value.trim().isEmpty) {
          return 'Add a contact phone so buyers can reach you';
        }
        return null;
      case PostStep.media:
        return null;
      case PostStep.review:
        return null;
    }
  }

  String? _validateDetails() {
    switch (marketplaceCode.value) {
      case 'gold':
        if (double.tryParse(weightG.value.trim()) == null) {
          return 'Enter gold weight in grams';
        }
        if (karat.value.isEmpty && !isInvestmentGrade.value) {
          return 'Select karat / purity';
        }
        return null;
      case 'property':
        if (double.tryParse(areaValue.value.trim()) == null) {
          return 'Enter property area';
        }
        if (operation.value == 'rent' && rentPeriod.value.isEmpty) {
          return 'Select rent period';
        }
        return null;
      case 'vehicles':
        final rule = vehicleCatalog.value?.typeFor(vehicleType.value);
        if (rule?.requiresMakeModel ?? true) {
          if (makeId.value == null) return 'Select make';
          if (modelId.value == null) return 'Select model';
          if (int.tryParse(year.value.trim()) == null) return 'Enter model year';
        }
        if (rule?.requiresMileage ?? true) {
          if (int.tryParse(mileage.value.trim()) == null) {
            return rule?.usesEngineHours == true
                ? 'Enter engine hours'
                : 'Enter mileage';
          }
        }
        return null;
      default:
        return null;
    }
  }

  bool next() {
    error.value = null;
    final msg = validateCurrentStep();
    if (msg != null) {
      error.value = msg;
      return false;
    }
    final i = stepIndex;
    if (i < totalSteps - 1) {
      step.value = PostStep.values[i + 1];
    }
    return true;
  }

  void back() {
    error.value = null;
    final i = stepIndex;
    if (i > 0) step.value = PostStep.values[i - 1];
  }

  Future<Result<void>> generateAiDescription() async {
    final repo = ai;
    if (repo == null) return const Failure('AI is not available');
    generatingDescription.value = true;
    error.value = null;
    try {
      final result = await repo.generateDescription(
        categoryName: selectedCategoryLabel.value ?? marketplaceCode.value,
        title: title.value.trim().isEmpty ? selectedCategoryLabel.value ?? 'Listing' : title.value.trim(),
        price: double.tryParse(price.value.trim()),
        details: _buildDetails(),
        attributes: {
          'marketplace': marketplaceCode.value,
          if (conditionCode.value != null) 'condition': conditionCode.value,
        },
      );
      return await result.when(
        success: (copy) {
          description.value = copy.description;
          if (title.value.trim().isEmpty && (copy.title?.isNotEmpty ?? false)) {
            title.value = copy.title!;
          }
          return const Success(null);
        },
        failure: (message, code) {
          error.value = message;
          return Failure(message, code: code);
        },
      );
    } finally {
      generatingDescription.value = false;
    }
  }

  Map<String, dynamic> _buildDetails() {
    switch (marketplaceCode.value) {
      case 'gold':
        return {
          'karat': double.tryParse(karat.value) ?? 22,
          'grossWeightG': double.tryParse(weightG.value.trim()),
          'netWeightG': () {
            final gross = double.tryParse(weightG.value.trim());
            final stone = double.tryParse(stoneWeightG.value.trim()) ?? 0;
            if (gross == null) return null;
            final net = gross - stone;
            return net < 0 ? 0 : net;
          }(),
          if (stoneWeightG.value.trim().isNotEmpty)
            'stoneWeightG': double.tryParse(stoneWeightG.value.trim()),
          'weightUnit': 'gram',
          'form': goldForm.value,
          if (goldForm.value == 'jewellery' && jewelleryType.value != null)
            'jewelleryType': jewelleryType.value,
          'metalType': metalType.value,
          'isHallmarked': isHallmarked.value,
          'hasCertificate': hasCertificate.value,
          if (certificateNumber.value.trim().isNotEmpty)
            'certificateNumber': certificateNumber.value.trim(),
          if (hallmarkCode.value.trim().isNotEmpty)
            'hallmarkCode': hallmarkCode.value.trim(),
          if (serialNumber.value.trim().isNotEmpty)
            'serialNumber': serialNumber.value.trim(),
          if (packaging.value.trim().isNotEmpty)
            'packaging': packaging.value.trim(),
          if (brandId.value != null) 'brandId': brandId.value,
          'isInvestmentGrade':
              isInvestmentGrade.value || goldForm.value == 'bar',
          if (makingCharges.value.trim().isNotEmpty)
            'makingCharges': double.tryParse(makingCharges.value.trim()),
          if (makingCharges.value.trim().isNotEmpty)
            'makingChargeType': makingChargeType.value,
        };
      case 'property':
        return {
          'propertyKind': propertyKind.value,
          'areaValue': double.tryParse(areaValue.value.trim()),
          'areaUnit': areaUnit.value,
          if (bedrooms.value.trim().isNotEmpty)
            'bedrooms': int.tryParse(bedrooms.value.trim()),
          if (bathrooms.value.trim().isNotEmpty)
            'bathrooms': int.tryParse(bathrooms.value.trim()),
          if (furnishing.value != null) 'furnishing': furnishing.value,
          if (societyName.value.trim().isNotEmpty)
            'societyName': societyName.value.trim(),
          if (operation.value == 'rent') 'rentPeriod': rentPeriod.value,
          'hasSwimmingPool': hasSwimmingPool.value,
          'hasGym': hasGym.value,
          'hasGarden': hasGarden.value,
          'hasElevator': hasElevator.value,
          'isGatedCommunity': isGatedCommunity.value,
          if (parkingSpaces.value.trim().isNotEmpty)
            'parkingSpaces': int.tryParse(parkingSpaces.value.trim()),
          'parkingAvailable':
              (int.tryParse(parkingSpaces.value.trim()) ?? 0) > 0,
        };
      case 'vehicles':
        final makeMatch =
            makes.value.where((m) => m.intId == makeId.value).toList();
        final modelMatch =
            models.value.where((m) => m.intId == modelId.value).toList();
        final makeName = makeMatch.isEmpty ? null : makeMatch.first.name;
        final modelName = modelMatch.isEmpty ? null : modelMatch.first.name;
        return {
          'vehicleType': vehicleType.value,
          'makeId': makeId.value,
          'modelId': modelId.value,
          'makeName': ?makeName,
          'modelName': ?modelName,
          'year': int.tryParse(year.value.trim()),
          'mileage': int.tryParse(mileage.value.trim()),
          'mileageUnit': 'km',
          'fuelType': fuelType.value,
          'transmission': transmission.value,
          'bodyType': bodyType.value,
          if (colorExterior.value.trim().isNotEmpty)
            'colorExterior': colorExterior.value.trim(),
          'financeAvailable': financeAvailable.value,
          'ownersCount': 1,
          'accidentHistory': 'none',
        };
      default:
        return {};
    }
  }

  String get _pricePeriod {
    if (marketplaceCode.value == 'property' && operation.value == 'rent') {
      return switch (rentPeriod.value) {
        'weekly' => 'per_week',
        'daily' => 'per_day',
        'yearly' => 'per_year',
        _ => 'per_month',
      };
    }
    return 'total';
  }

  Future<Result<CreateListingResult>> publish() async {
    error.value = null;
    for (final s in PostStep.values) {
      step.value = s;
      final msg = validateCurrentStep();
      if (msg != null) {
        error.value = msg;
        return Failure(msg);
      }
    }
    step.value = PostStep.review;
    submitting.value = true;

    final countryIso = prefs.countryCode ?? settings.countryCode;
    final countryId = switch (countryIso.toUpperCase()) {
      'PK' => 1,
      'AE' => 3,
      'SA' => 4,
      'US' => 5,
      'GB' => 6,
      _ => 1,
    };

    final request = CreateListingRequest(
      marketplace: marketplaceCode.value,
      categoryId: selectedCategoryId.value!,
      operation: operation.value,
      title: title.value.trim(),
      description: description.value.trim().isEmpty
          ? null
          : description.value.trim(),
      conditionCode: conditionCode.value,
      price: double.tryParse(price.value.trim()),
      currency: currency.value,
      priceType: priceNegotiable.value ? 'negotiable' : 'fixed',
      pricePeriod: _pricePeriod,
      priceNegotiable: priceNegotiable.value,
      location: {
        'countryId': countryId,
        if (address.value.trim().isNotEmpty) 'address': address.value.trim(),
      },
      contactPhone: contactPhone.value.trim(),
      contactWhatsapp: contactWhatsapp.value.trim().isEmpty
          ? contactPhone.value.trim()
          : contactWhatsapp.value.trim(),
      allowChat: allowChat.value,
      allowCalls: allowCalls.value,
      details: _buildDetails(),
      media: mediaItems.value,
      publish: true,
      idempotencyKey: const Uuid().v4(),
      businessId: sellerBusinessId.value,
      auction: operation.value == 'auction'
          ? {
              'startPrice': double.tryParse(auctionStartPrice.value.trim()) ??
                  double.tryParse(price.value.trim()) ??
                  0,
              'bidIncrement':
                  double.tryParse(auctionIncrement.value.trim()) ?? 1,
              'startsAt': DateTime.now().toUtc().toIso8601String(),
              'endsAt': DateTime.now()
                  .toUtc()
                  .add(
                    Duration(
                      hours: int.tryParse(auctionHours.value.trim()) ?? 24,
                    ),
                  )
                  .toIso8601String(),
            }
          : null,
    );

    final result = await listings.create(request);
    submitting.value = false;
    result.when(
      success: (r) => success.value = r,
      failure: (m, code) => error.value = m,
    );
    return result;
  }
}
