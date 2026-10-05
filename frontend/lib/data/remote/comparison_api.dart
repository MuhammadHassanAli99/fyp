import '../../core/network/api_client.dart';
import '../models/comparison_model.dart';

class ComparisonApi {
  ComparisonApi(this._client);
  final ApiClient _client;

  /// Creates a compare set. Marketplace is resolved from `X-Marketplace`.
  /// [listingIds] must be numeric listing primary keys.
  Future<ComparisonModel> create({
    required List<int> listingIds,
    String? name,
  }) =>
      _client.post(
        '/comparisons',
        data: {
          'listingIds': listingIds,
          'name': ?name,
        },
        parser: (d) => ComparisonModel.fromJson(d as Map<String, dynamic>),
      );

  /// Resolves car/listing names then builds a set (optional AI on backend).
  Future<ComparisonModel> createByNames({
    required List<String> names,
  }) =>
      _client.post(
        '/comparisons/by-names',
        data: {'names': names},
        parser: (d) {
          final map = d as Map<String, dynamic>;
          final set = map['set'];
          if (set is Map) {
            return ComparisonModel.fromJson(Map<String, dynamic>.from(set));
          }
          return ComparisonModel.fromJson(map);
        },
      );

  Future<ComparisonModel> get(String idOrUuid) => _client.get(
        '/comparisons/$idOrUuid',
        parser: (d) => ComparisonModel.fromJson(d as Map<String, dynamic>),
      );

  Future<ComparisonModel> runAi(String idOrUuid, {bool force = false}) =>
      _client.post(
        '/comparisons/$idOrUuid/ai',
        data: {'force': force},
        parser: (d) {
          final map = d as Map<String, dynamic>;
          final verdict = map['verdict'];
          return ComparisonModel(
            id: idOrUuid,
            marketplace: '',
            listingIds: const [],
            aiSummary: verdict is Map
                ? verdict['summary'] as String?
                : verdict?.toString(),
            aiRecommendation: verdict is Map
                ? verdict['recommendation'] as String?
                : null,
            aiDifferences: verdict is Map
                ? (verdict['differences'] as List? ?? [])
                    .map((e) => e.toString())
                    .toList()
                : const [],
          );
        },
      );

  Future<void> delete(String idOrUuid) =>
      _client.delete('/comparisons/$idOrUuid');
}
