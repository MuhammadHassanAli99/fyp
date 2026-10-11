import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:uuid/uuid.dart';

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/gold_models.dart';
import '../../data/models/listing_model.dart';
import '../../data/repositories/gold_repository.dart';
import '../../data/repositories/listings_repository.dart';

class ListingDetailStore {
  ListingDetailStore(
    this._repo,
    this.listingId, {
    this._gold,
  });

  final ListingsRepository _repo;
  final GoldRepository? _gold;
  final String listingId;

  final listing = signal<AsyncState<ListingModel>>(const AsyncIdle());
  final risk = signal<GoldRiskAssessment?>(null);
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
}
