import 'package:signals/signals.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../data/models/comparison_model.dart';
import '../../data/models/listing_model.dart';
import '../../data/repositories/comparison_repository.dart';
import '../../data/repositories/listings_repository.dart';
import '../../data/repositories/settings_repository.dart';

class CompareStore {
  CompareStore(
    this._repo,
    this._settings,
    this._listings,
  );

  final ComparisonRepository _repo;
  final SettingsRepository _settings;
  // Reserved for future listing lookups (e.g. resolving suggested matches).
  // ignore: unused_field
  final ListingsRepository _listings;

  /// Gold listing IDs selected from the feed & detail screens.
  final listingIds = signal<List<String>>([]);

  final comparison = signal<AsyncState<ComparisonModel>>(const AsyncIdle());
  final hideCommonSpecs = signal(false);
  final aiTriggered = signal(false);

  String get marketplace => _settings.marketplaceCode ?? 'gold';

  late final shouldAutoAi = computed(() {
    final count = listingIds.value.length;
    return count >= 2 && count <= 4;
  });

  void setHideCommonSpecs(bool value) => hideCommonSpecs.value = value;

  void addListing(String id, {ListingModel? listing}) {
    if (listingIds.value.contains(id)) return;
    if (listingIds.value.length >= 6) return;
    listingIds.value = [...listingIds.value, id];
    comparison.value = const AsyncIdle();
    aiTriggered.value = false;
  }

  void removeListing(String id) {
    listingIds.value = listingIds.value.where((e) => e != id).toList();
    comparison.value = const AsyncIdle();
    aiTriggered.value = false;
  }

  Future<void> runManualCompare() async {
    if (listingIds.value.length < 2) return;
    comparison.value = AsyncLoading(previous: comparison.value.dataOrNull);
    final result = await _repo.compare(listingIds: listingIds.value);
    await result.when(
      success: (c) async {
        comparison.value = AsyncData(c);
        await _maybeAttachAi(c);
      },
      failure: (m, code) async {
        comparison.value = AsyncError(m, code: code);
      },
    );
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

  void clear() {
    listingIds.value = [];
    comparison.value = const AsyncIdle();
    aiTriggered.value = false;
    hideCommonSpecs.value = false;
  }

  void clearActiveSelection() {
    listingIds.value = [];
    comparison.value = const AsyncIdle();
    aiTriggered.value = false;
  }
}
