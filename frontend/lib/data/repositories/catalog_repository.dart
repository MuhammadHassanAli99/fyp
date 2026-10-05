import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/marketplace_model.dart';
import '../remote/bootstrap_api.dart';
import '../remote/catalog_api.dart';

class CatalogRepository {
  CatalogRepository({
    required this._catalogApi,
    required this._bootstrapApi,
  });

  final CatalogApi _catalogApi;
  final BootstrapApi _bootstrapApi;

  List<MarketplaceModel>? _cached;
  bool get hasCachedMarketplaces => _cached != null && _cached!.isNotEmpty;

  Future<Result<List<MarketplaceModel>>> marketplaces() async {
    if (_cached != null) return Success(_cached!);
    try {
      _cached = await _catalogApi.marketplaces();
      return Success(_cached!);
    } on ApiException catch (e) {
      return _fallbackMarketplaces(e);
    } catch (e) {
      return _fallbackMarketplaces(null);
    }
  }

  Future<Result<BootstrapData>> bootstrap() async {
    try {
      final data = await _bootstrapApi.fetch();
      if (data.marketplaces.isNotEmpty) _cached = data.marketplaces;
      return Success(data);
    } on ApiException catch (e) {
      if (_cached != null) return Success(BootstrapData(marketplaces: _cached!));
      return Failure(e.message, code: e.code);
    } catch (e) {
      if (_cached != null) return Success(BootstrapData(marketplaces: _cached!));
      return Failure(e.toString());
    }
  }

  Future<Result<List<CategoryModel>>> categories(int marketplaceId) async {
    try {
      return Success(await _catalogApi.categories(marketplaceId: marketplaceId));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Result<List<MarketplaceModel>> _fallbackMarketplaces(ApiException? e) {
    _cached = const [
      MarketplaceModel(
        id: 1,
        code: 'gold',
        name: 'Gold',
        description: 'Bars, coins, jewelry & investment gold',
        operations: ['buy', 'sell', 'auction'],
      ),
      MarketplaceModel(
        id: 2,
        code: 'property',
        name: 'Property',
        description: 'Homes, land, offices & rentals',
        operations: ['buy', 'sell', 'rent'],
      ),
      MarketplaceModel(
        id: 3,
        code: 'vehicles',
        name: 'Vehicles',
        description: 'Cars, bikes, trucks & import/export',
        operations: ['buy', 'sell', 'rent'],
      ),
    ];
    return Success(_cached!);
  }
}
