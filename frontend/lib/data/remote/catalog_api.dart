import '../../core/network/api_client.dart';
import '../models/marketplace_model.dart';

class CatalogApi {
  CatalogApi(this._client);
  final ApiClient _client;

  Future<List<MarketplaceModel>> marketplaces() => _client.get(
        '/catalog/marketplaces',
        parser: (d) => (d as List)
            .map((e) => MarketplaceModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<List<CategoryModel>> categories({
    required int marketplaceId,
  }) =>
      _client.get(
        '/catalog/$marketplaceId/categories',
        parser: (d) => (d as List)
            .map((e) => CategoryModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}
