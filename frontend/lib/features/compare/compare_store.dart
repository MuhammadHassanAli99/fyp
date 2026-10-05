import 'package:signals/signals.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/comparison_model.dart';
import '../../data/models/listing_feed_query.dart';
import '../../data/models/listing_model.dart';
import '../../data/remote/marketplace_apis.dart';
import '../../data/repositories/comparison_repository.dart';
import '../../data/repositories/listings_repository.dart';
import '../../data/repositories/settings_repository.dart';

enum VehicleCompareKind { used, brandNew }

class CompareCarSlot {
  const CompareCarSlot({
    this.listingId,
    this.label,
    this.makeId,
    this.makeName,
    this.modelId,
    this.modelName,
    this.variantId,
    this.variantName,
    this.imageUrl,
    this.price,
    this.currency,
  });

  final String? listingId;
  final String? label;
  final int? makeId;
  final String? makeName;
  final int? modelId;
  final String? modelName;
  final int? variantId;
  final String? variantName;
  final String? imageUrl;
  final double? price;
  final String? currency;

  bool get isFilled =>
      (listingId != null && listingId!.isNotEmpty) ||
      (label != null && label!.trim().isNotEmpty);

  String get displayLabel {
    if (label != null && label!.trim().isNotEmpty) return label!.trim();
    final parts = [
      makeName,
      modelName,
      variantName,
    ].whereType<String>().where((e) => e.isNotEmpty);
    return parts.join(' ');
  }

  String get searchName => displayLabel;

  CompareCarSlot copyWith({
    String? listingId,
    String? label,
    int? makeId,
    String? makeName,
    int? modelId,
    String? modelName,
    int? variantId,
    String? variantName,
    String? imageUrl,
    double? price,
    String? currency,
  }) {
    return CompareCarSlot(
      listingId: listingId ?? this.listingId,
      label: label ?? this.label,
      makeId: makeId ?? this.makeId,
      makeName: makeName ?? this.makeName,
      modelId: modelId ?? this.modelId,
      modelName: modelName ?? this.modelName,
      variantId: variantId ?? this.variantId,
      variantName: variantName ?? this.variantName,
      imageUrl: imageUrl ?? this.imageUrl,
      price: price ?? this.price,
      currency: currency ?? this.currency,
    );
  }
}

class CompareStore {
  CompareStore(
    this._repo,
    this._settings,
    this._listings,
    this._vehicles,
  );

  final ComparisonRepository _repo;
  final SettingsRepository _settings;
  final ListingsRepository _listings;
  final VehiclesApi _vehicles;

  /// Gold / property / generic listing IDs from feed & detail.
  final listingIds = signal<List<String>>([]);

  /// Separate vehicle picker slots for used vs new cars.
  final usedSlots = signal<List<CompareCarSlot?>>(List.filled(3, null));
  final newSlots = signal<List<CompareCarSlot?>>(List.filled(3, null));
  final vehicleKind = signal(VehicleCompareKind.used);

  final comparison = signal<AsyncState<ComparisonModel>>(const AsyncIdle());
  final suggestions = signal<List<CompareSuggestionPair>>([]);
  final hideCommonSpecs = signal(false);
  final aiTriggered = signal(false);

  String get marketplace => _settings.marketplaceCode ?? 'gold';
  bool get isVehicles => marketplace == 'vehicles';

  List<CompareCarSlot?> get activeSlots =>
      vehicleKind.value == VehicleCompareKind.used
          ? usedSlots.value
          : newSlots.value;

  int get filledSlotCount =>
      activeSlots.where((s) => s?.isFilled == true).length;

  List<String> get activeListingIds {
    if (!isVehicles) return listingIds.value;
    return activeSlots
        .whereType<CompareCarSlot>()
        .map((s) => s.listingId)
        .whereType<String>()
        .where((id) => id.isNotEmpty)
        .toList();
  }

  late final shouldAutoAi = computed(() {
    final count = isVehicles ? filledSlotCount : listingIds.value.length;
    return count >= 2 && count <= 4;
  });

  VehiclesApi get vehiclesApi => _vehicles;

  void setVehicleKind(VehicleCompareKind kind) {
    if (vehicleKind.value == kind) return;
    vehicleKind.value = kind;
    comparison.value = const AsyncIdle();
    suggestions.value = [];
    aiTriggered.value = false;
  }

  void setHideCommonSpecs(bool value) => hideCommonSpecs.value = value;

  void addListing(String id, {ListingModel? listing}) {
    if (isVehicles) {
      _addVehicleFromListing(id, listing: listing);
      return;
    }
    if (listingIds.value.contains(id)) return;
    if (listingIds.value.length >= 6) return;
    listingIds.value = [...listingIds.value, id];
    comparison.value = const AsyncIdle();
    suggestions.value = [];
    aiTriggered.value = false;
  }

  void _addVehicleFromListing(String id, {ListingModel? listing}) {
    final condition = listing?.conditionCode?.toLowerCase();
    if (condition == 'new') {
      vehicleKind.value = VehicleCompareKind.brandNew;
    } else if (condition == 'used' ||
        condition == 'like_new' ||
        condition == 'excellent' ||
        condition == 'good' ||
        condition == 'fair' ||
        condition == 'refurbished') {
      vehicleKind.value = VehicleCompareKind.used;
    }

    final slots = List<CompareCarSlot?>.from(activeSlots);
    if (slots.any((s) => s?.listingId == id)) return;
    final empty = slots.indexWhere((s) => s == null || !s.isFilled);
    if (empty < 0) return;

    final make = listing?.details['makeName']?.toString() ??
        listing?.attributes['makeName']?.toString();
    final model = listing?.details['modelName']?.toString() ??
        listing?.attributes['modelName']?.toString();
    final variant = listing?.details['variantName']?.toString() ??
        listing?.attributes['variantName']?.toString();

    slots[empty] = CompareCarSlot(
      listingId: id,
      label: listing?.title ?? '#$id',
      makeName: make,
      modelName: model,
      variantName: variant,
      imageUrl: listing?.imageUrl,
      price: listing?.price,
      currency: listing?.currency,
    );
    _writeActiveSlots(slots);
    comparison.value = const AsyncIdle();
    suggestions.value = [];
    aiTriggered.value = false;
  }

  void setSlot(int index, CompareCarSlot? slot) {
    if (index < 0 || index > 2) return;
    final slots = List<CompareCarSlot?>.from(activeSlots);
    slots[index] = slot;
    _writeActiveSlots(slots);
    comparison.value = const AsyncIdle();
    suggestions.value = [];
    aiTriggered.value = false;
  }

  void clearSlot(int index) => setSlot(index, null);

  void removeListing(String id) {
    if (isVehicles) {
      final slots =
          activeSlots.map((s) => s?.listingId == id ? null : s).toList();
      _writeActiveSlots(slots);
    } else {
      listingIds.value = listingIds.value.where((e) => e != id).toList();
    }
    comparison.value = const AsyncIdle();
    suggestions.value = [];
    aiTriggered.value = false;
  }

  void _writeActiveSlots(List<CompareCarSlot?> slots) {
    if (vehicleKind.value == VehicleCompareKind.used) {
      usedSlots.value = slots;
    } else {
      newSlots.value = slots;
    }
  }

  Future<void> runManualCompare() async {
    if (isVehicles) {
      await _runVehicleCompare();
    } else {
      await _runListingCompare();
    }
  }

  Future<void> _runListingCompare() async {
    if (listingIds.value.length < 2) return;
    comparison.value = AsyncLoading(previous: comparison.value.dataOrNull);
    suggestions.value = [];
    final result = await _repo.compare(listingIds: listingIds.value);
    await result.when(
      success: (c) async {
        comparison.value = AsyncData(c);
        await _maybeAttachAi(c);
        await _loadSuggestions(c);
      },
      failure: (m, code) async {
        comparison.value = AsyncError(m, code: code);
      },
    );
  }

  Future<void> _runVehicleCompare() async {
    final filled =
        activeSlots.whereType<CompareCarSlot>().where((s) => s.isFilled).toList();
    if (filled.length < 2) return;

    comparison.value = AsyncLoading(previous: comparison.value.dataOrNull);
    suggestions.value = [];

    final resolved = <CompareCarSlot>[];
    for (final slot in filled) {
      if (slot.listingId != null && slot.listingId!.isNotEmpty) {
        resolved.add(slot);
        continue;
      }
      final match = await _resolveListingForSlot(slot);
      resolved.add(match ?? slot);
    }

    final slots = List<CompareCarSlot?>.from(activeSlots);
    var ri = 0;
    for (var i = 0; i < slots.length; i++) {
      final s = slots[i];
      if (s == null || !s.isFilled) continue;
      if (ri < resolved.length) {
        slots[i] = resolved[ri];
        ri++;
      }
    }
    _writeActiveSlots(slots);

    final ids = resolved
        .map((s) => s.listingId)
        .whereType<String>()
        .where((id) => id.isNotEmpty)
        .toList();

    final Result<ComparisonModel> result;
    if (ids.length >= 2) {
      result = await _repo.compare(
        listingIds: ids,
        name: resolved.map((s) => s.displayLabel).join(' vs '),
      );
    } else {
      final names = resolved.map((s) {
        final base = [s.makeName, s.modelName]
            .whereType<String>()
            .where((e) => e.isNotEmpty)
            .join(' ');
        return base.isNotEmpty ? base : s.searchName;
      }).where((n) => n.length >= 2).toList();
      result = await _repo.compareByNames(names: names);
    }

    await result.when(
      success: (c) async {
        comparison.value = AsyncData(c);
        await _maybeAttachAi(c);
        await _loadSuggestions(c);
      },
      failure: (m, code) async {
        comparison.value = AsyncError(m, code: code);
      },
    );
  }

  Future<CompareCarSlot?> _resolveListingForSlot(CompareCarSlot slot) async {
    final condition = vehicleKind.value == VehicleCompareKind.brandNew
        ? 'new'
        : 'used';
    final nameQuery = [
      slot.makeName,
      slot.modelName,
    ].whereType<String>().where((e) => e.isNotEmpty).join(' ');

    // Try progressively broader queries so picker cars still resolve to ads.
    final attempts = <ListingFeedQuery>[
      ListingFeedQuery(
        marketplace: 'vehicles',
        sort: 'newest',
        perPage: 8,
        condition: condition,
        makeId: slot.makeId,
        modelId: slot.modelId,
        q: slot.variantName ?? nameQuery,
      ),
      if (nameQuery.isNotEmpty)
        ListingFeedQuery(
          marketplace: 'vehicles',
          sort: 'newest',
          perPage: 8,
          condition: condition,
          q: nameQuery,
        ),
      if (nameQuery.isNotEmpty)
        ListingFeedQuery(
          marketplace: 'vehicles',
          sort: 'newest',
          perPage: 8,
          q: nameQuery,
        ),
      if (slot.makeName != null && slot.makeName!.isNotEmpty)
        ListingFeedQuery(
          marketplace: 'vehicles',
          sort: 'newest',
          perPage: 8,
          q: slot.makeName,
        ),
    ];

    for (final query in attempts) {
      final page = await _listings.fetch(query);
      final match = page.when(
        success: (data) {
          if (data.items.isEmpty) return null;
          ListingModel? best;
          final modelNeedle = (slot.modelName ?? '').toLowerCase();
          final makeNeedle = (slot.makeName ?? '').toLowerCase();
          for (final item in data.items) {
            final title = item.title.toLowerCase();
            final modelOk =
                modelNeedle.isEmpty || title.contains(modelNeedle);
            final makeOk = makeNeedle.isEmpty || title.contains(makeNeedle);
            if (modelOk && makeOk) {
              best = item;
              break;
            }
          }
          best ??= data.items.first;
          return slot.copyWith(
            listingId: best.id,
            label: best.title,
            imageUrl: best.imageUrl ?? slot.imageUrl,
            price: best.price,
            currency: best.currency,
          );
        },
        failure: (message, code) => null,
      );
      if (match != null) return match;
    }
    return null;
  }

  Future<void> _maybeAttachAi(ComparisonModel set) async {
    if (set.listingIds.length < 2 || set.id.isEmpty) return;
    if (set.aiSummary != null && set.aiSummary!.isNotEmpty) return;
    aiTriggered.value = true;
    final ai = await _repo.runAiOnSet(set.id);
    ai.when(
      success: (c) {
        comparison.value = AsyncData(c);
      },
      failure: (message, code) {},
    );
  }

  Future<void> _loadSuggestions(ComparisonModel set) async {
    if (!isVehicles || set.items.isEmpty) {
      suggestions.value = [];
      return;
    }
    final anchor = set.items.first;
    final makeName =
        anchor.detail('makeName') ?? _firstWord(anchor.title);
    final exclude = set.listingIds.toSet();
    final condition = vehicleKind.value == VehicleCompareKind.brandNew
        ? 'new'
        : 'used';

    final page = await _listings.fetch(
      ListingFeedQuery(
        marketplace: 'vehicles',
        sort: 'newest',
        perPage: 12,
        condition: condition,
        q: makeName,
      ),
    );

    page.when(
      success: (data) {
        final pool = data.items
            .where((e) => !exclude.contains(e.id))
            .take(8)
            .toList();
        if (pool.isEmpty) {
          suggestions.value = [];
          return;
        }
        final pairs = <CompareSuggestionPair>[];
        final anchorItem = CompareItem(
          id: anchor.id,
          title: anchor.title,
          price: anchor.price,
          currency: anchor.currency,
          imageUrl: anchor.imageUrl,
        );
        for (final other in pool) {
          if (pairs.length >= 6) break;
          pairs.add(
            CompareSuggestionPair(
              left: CompareItem(
                id: other.id,
                title: other.title,
                price: other.price,
                currency: other.currency,
                imageUrl: other.imageUrl,
              ),
              right: anchorItem,
              anchorTitle: (makeName != null && makeName.isNotEmpty)
                  ? makeName
                  : 'Similar',
            ),
          );
        }
        for (var i = 0; i < pairs.length; i += 2) {
          if (i + 1 < pairs.length) {
            final p = pairs[i + 1];
            pairs[i + 1] = CompareSuggestionPair(
              left: p.right,
              right: p.left,
              anchorTitle: p.anchorTitle,
            );
          }
        }
        suggestions.value = pairs;
      },
      failure: (message, code) {
        suggestions.value = [];
      },
    );
  }

  Future<void> applySuggestion(CompareSuggestionPair pair) async {
    final leftId = pair.left.id;
    final rightId = pair.right.id;
    if (leftId.isEmpty || rightId.isEmpty) return;
    final slots = <CompareCarSlot?>[
      CompareCarSlot(
        listingId: leftId,
        label: pair.left.title,
        imageUrl: pair.left.imageUrl,
        price: pair.left.price,
        currency: pair.left.currency,
      ),
      CompareCarSlot(
        listingId: rightId,
        label: pair.right.title,
        imageUrl: pair.right.imageUrl,
        price: pair.right.price,
        currency: pair.right.currency,
      ),
      null,
    ];
    _writeActiveSlots(slots);
    await runManualCompare();
  }

  void clear() {
    listingIds.value = [];
    usedSlots.value = List.filled(3, null);
    newSlots.value = List.filled(3, null);
    comparison.value = const AsyncIdle();
    suggestions.value = [];
    aiTriggered.value = false;
    hideCommonSpecs.value = false;
  }

  void clearActiveSelection() {
    if (isVehicles) {
      _writeActiveSlots(List.filled(3, null));
    } else {
      listingIds.value = [];
    }
    comparison.value = const AsyncIdle();
    suggestions.value = [];
    aiTriggered.value = false;
  }

  String? _firstWord(String title) {
    final parts = title.trim().split(RegExp(r'\s+'));
    return parts.isEmpty ? null : parts.first;
  }
}
