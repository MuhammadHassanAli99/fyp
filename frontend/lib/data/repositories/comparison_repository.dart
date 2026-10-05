import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/comparison_model.dart';
import '../remote/comparison_api.dart';

class ComparisonRepository {
  ComparisonRepository(this._api);
  final ComparisonApi _api;

  Future<Result<ComparisonModel>> compare({
    required List<String> listingIds,
    String? name,
  }) async {
    final numericIds = _toNumericIds(listingIds);
    if (numericIds.length < 2) {
      return const Failure('Add at least two listings to compare');
    }
    try {
      final result = await _api.create(listingIds: numericIds, name: name);
      return Success(result);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ComparisonModel>> compareByNames({
    required List<String> names,
  }) async {
    final cleaned =
        names.map((e) => e.trim()).where((e) => e.length >= 2).toList();
    if (cleaned.length < 2) {
      return const Failure('Select at least two cars to compare');
    }
    try {
      final result = await _api.createByNames(names: cleaned);
      return Success(result);
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ComparisonModel>> aiCompare({
    required List<String> listingIds,
  }) async {
    if (listingIds.length < 2) {
      return const Failure('AI compare requires at least 2 items');
    }
    final numericIds = _toNumericIds(listingIds);
    if (numericIds.length < 2) {
      return const Failure('AI compare requires valid listing ids');
    }
    try {
      final set = await _api.create(listingIds: numericIds);
      final ai = await _api.runAi(set.id, force: true);
      return Success(
        set.copyWith(
          aiSummary: ai.aiSummary ?? set.aiSummary,
          aiRecommendation: ai.aiRecommendation ?? set.aiRecommendation,
          aiDifferences:
              ai.aiDifferences.isNotEmpty ? ai.aiDifferences : set.aiDifferences,
          aiProsCons: ai.aiProsCons.isNotEmpty ? ai.aiProsCons : set.aiProsCons,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<ComparisonModel>> runAiOnSet(String setId) async {
    try {
      final ai = await _api.runAi(setId, force: true);
      final full = await _api.get(setId);
      return Success(
        full.copyWith(
          aiSummary: ai.aiSummary ?? full.aiSummary,
          aiRecommendation: ai.aiRecommendation ?? full.aiRecommendation,
          aiDifferences: ai.aiDifferences.isNotEmpty
              ? ai.aiDifferences
              : full.aiDifferences,
          aiProsCons:
              ai.aiProsCons.isNotEmpty ? ai.aiProsCons : full.aiProsCons,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  List<int> _toNumericIds(List<String> listingIds) => listingIds
      .map(int.tryParse)
      .whereType<int>()
      .where((id) => id > 0)
      .toList();
}
