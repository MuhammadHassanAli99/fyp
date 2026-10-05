import '../../core/network/api_client.dart';
import '../models/locale_models.dart';

class LocaleApi {
  LocaleApi(this._client);
  final ApiClient _client;

  Future<List<CountryModel>> countries({String? search}) => _client.get(
        '/locale/countries',
        queryParameters: {
          if (search != null && search.isNotEmpty) 'search': search,
        },
        parser: (d) => (d as List)
            .map((e) => CountryModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<CountryDetailModel> countryDetail(String iso2) => _client.get(
        '/locale/countries/${iso2.toUpperCase()}',
        parser: (d) =>
            CountryDetailModel.fromJson(d as Map<String, dynamic>),
      );

  Future<List<LanguageModel>> languages() => _client.get(
        '/locale/languages',
        parser: (d) => (d as List)
            .map((e) => LanguageModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<List<CurrencyModel>> currencies() => _client.get(
        '/locale/currencies',
        parser: (d) => (d as List)
            .map((e) => CurrencyModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Future<ConvertedAmount> convert({
    required double amount,
    required String from,
    required String to,
  }) =>
      _client.post(
        '/locale/convert',
        data: {
          'amount': amount,
          'from': from.toUpperCase(),
          'to': to.toUpperCase(),
        },
        parser: (d) {
          final map = d as Map<String, dynamic>;
          final converted = map['converted'];
          if (converted is Map) {
            return ConvertedAmount.fromJson(
              Map<String, dynamic>.from(converted),
            );
          }
          return ConvertedAmount(
            amount: (map['amount'] as num?)?.toDouble() ?? amount,
            currency: (map['currency'] ?? to).toString(),
            rate: (map['rate'] as num?)?.toDouble(),
            fetchedAt: DateTime.tryParse((map['asOf'] ?? map['fetchedAt'] ?? '').toString()),
            stale: map['stale'] == true,
          );
        },
      );

  Future<double?> exchangeRate({
    required String base,
    required String quote,
  }) =>
      _client.get(
        '/locale/exchange-rates',
        queryParameters: {
          'base': base.toUpperCase(),
          'quote': quote.toUpperCase(),
        },
        parser: (d) {
          if (d is Map) {
            final rate = d['rate'] ?? d['value'];
            if (rate is num) return rate.toDouble();
            final rows = d['rates'] ?? d['items'];
            if (rows is List && rows.isNotEmpty && rows.first is Map) {
              final r = (rows.first as Map)['rate'];
              if (r is num) return r.toDouble();
            }
          }
          if (d is List && d.isNotEmpty && d.first is Map) {
            final r = (d.first as Map)['rate'];
            if (r is num) return r.toDouble();
          }
          return null;
        },
      );

  Future<Map<String, dynamic>> session({bool full = false}) => _client.get(
        '/locale/session',
        queryParameters: {if (full) 'full': 'true'},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<List<Map<String, dynamic>>> legalDocuments() => _client.get(
        '/locale/legal',
        parser: (d) => (d as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList(),
      );

  Future<Map<String, dynamic>> legalDocument(String kind, {String? language}) =>
      _client.get(
        '/locale/legal/$kind',
        queryParameters: {'language': ?language},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> acceptLegal(String kind) => _client.post(
        '/locale/legal/$kind/accept',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> regulations({String? marketplace}) => _client.get(
        '/locale/regulations',
        queryParameters: {'marketplace': ?marketplace},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<List<Map<String, dynamic>>> holidays({int? year}) => _client.get(
        '/locale/holidays',
        queryParameters: {'year': ?year},
        parser: (d) => (d as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList(),
      );

  Future<Map<String, dynamic>> quoteTax({
    required double amount,
    String? appliesTo,
    String? marketplace,
    String? currency,
  }) =>
      _client.post(
        '/locale/tax/quote',
        data: {
          'amount': amount,
          'appliesTo': ?appliesTo,
          'marketplace': ?marketplace,
          'currency': ?currency,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );
}
