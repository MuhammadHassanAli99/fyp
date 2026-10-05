import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/filter_models.dart';
import '../remote/filters_api.dart';

class FiltersRepository {
  FiltersRepository(this._api);
  final FiltersApi _api;

  Future<Result<List<FilterDefinition>>> definitions({
    String? marketplace,
    String? category,
  }) async {
    try {
      return Success(await _api.definitions(marketplace: marketplace, category: category));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }

  Future<Result<List<FilterLookupItem>>> lookups({
    required String key,
    String? marketplace,
    String? parentKey,
    String? parentValue,
    String? q,
    int? countryId,
  }) async {
    try {
      return Success(
        await _api.lookups(
          key: key,
          marketplace: marketplace,
          parentKey: parentKey,
          parentValue: parentValue,
          q: q,
          countryId: countryId,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    } catch (e) {
      return Failure(e.toString());
    }
  }
}
