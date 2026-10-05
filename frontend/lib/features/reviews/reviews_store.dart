import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../core/network/api_exception.dart';
import 'data/review_models.dart';
import 'data/reviews_api.dart';

class ReviewsStore {
  ReviewsStore(this._api);

  final ReviewsApi _api;

  final summary = signal<AsyncState<ReviewSummary>>(const AsyncIdle());
  final items = signal<AsyncState<List<ReviewItem>>>(const AsyncIdle());
  final eligibility = signal<ReviewEligibility?>(null);
  final busy = signal(false);
  final errorMessage = signal<String?>(null);

  Future<void> loadForListing(int listingId) async {
    summary.value = AsyncLoading(previous: summary.value.dataOrNull);
    items.value = AsyncLoading(previous: items.value.dataOrNull);
    try {
      final sum = await _api.summary(subjectKind: 'listing', subjectId: listingId);
      final list = await _api.list(subjectKind: 'listing', subjectId: listingId);
      summary.value = AsyncData(sum);
      items.value = AsyncData(list);
    } on ApiException catch (e) {
      summary.value = AsyncError(e.message, code: e.code);
      items.value = AsyncError(e.message, code: e.code);
    }
    try {
      eligibility.value = await _api.eligibility(listingId: listingId);
    } catch (_) {
      eligibility.value = null;
    }
  }

  Future<void> loadForSeller(int userId) async {
    summary.value = AsyncLoading(previous: summary.value.dataOrNull);
    items.value = AsyncLoading(previous: items.value.dataOrNull);
    try {
      final sum = await _api.summary(subjectKind: 'user', subjectId: userId);
      final list = await _api.list(subjectKind: 'user', subjectId: userId);
      summary.value = AsyncData(sum);
      items.value = AsyncData(list);
    } on ApiException catch (e) {
      summary.value = AsyncError(e.message, code: e.code);
      items.value = AsyncError(e.message, code: e.code);
    }
  }

  Future<void> helpful(String uuid, {required bool helpful}) async {
    await _api.helpful(uuid, helpful: helpful);
    final current = items.value.dataOrNull;
    if (current == null) return;
    items.value = AsyncData([
      for (final review in current)
        review.uuid == uuid
            ? review.copyWith(helpfulCount: review.helpfulCount + (helpful ? 1 : 0))
            : review,
    ]);
  }

  Future<void> report(String uuid, {required String reason}) => _api.report(uuid, reason: reason);

  Future<void> reply(String uuid, String body) => _api.reply(uuid, body);

  Future<List<ReviewCriterion>> criteria({String? appliesTo, int? marketplaceId}) =>
      _api.criteria(appliesTo: appliesTo, marketplaceId: marketplaceId);

  Future<Result<ReviewItem>> submit({
    required int listingId,
    required double rating,
    String? title,
    String? body,
    List<Map<String, dynamic>> criteria = const [],
    List<Map<String, dynamic>> media = const [],
  }) async {
    busy.value = true;
    errorMessage.value = null;
    try {
      final created = await _api.create(
        listingId: listingId,
        rating: rating,
        title: title,
        body: body,
        criteria: criteria,
        media: media,
      );
      return Success(created);
    } on ApiException catch (e) {
      errorMessage.value = e.message;
      return Failure(e.message, code: e.code);
    } finally {
      busy.value = false;
    }
  }
}
