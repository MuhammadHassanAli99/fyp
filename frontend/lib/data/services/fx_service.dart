import 'dart:convert';

import '../../core/storage/prefs_storage.dart';
import '../models/locale_models.dart';
import '../remote/locale_api.dart';

/// Client-side FX helper with in-memory + prefs cache (live rates via API).
class FxService {
  FxService(this._api, {this._prefs});

  final LocaleApi _api;
  final PrefsStorage? _prefs;
  final Map<String, double> _rateCache = {};
  DateTime? _lastFetch;
  bool _stale = false;

  static const staleAfter = Duration(hours: 24);

  DateTime? get lastFetch => _lastFetch;
  bool get isStale {
    if (_stale) return true;
    final fetched = _lastFetch;
    if (fetched == null) return _rateCache.isNotEmpty;
    return DateTime.now().difference(fetched) > staleAfter;
  }

  void hydrate() {
    final raw = _prefs?.getString(PrefsKeys.fxRatesCache);
    if (raw == null || raw.isEmpty) return;
    try {
      final map = jsonDecode(raw);
      if (map is Map) {
        for (final entry in map.entries) {
          final value = entry.value;
          if (value is num) _rateCache[entry.key.toString()] = value.toDouble();
        }
      }
    } catch (_) {}
    final fetchedAt = _prefs?.getString(PrefsKeys.fxRatesFetchedAt);
    _lastFetch = fetchedAt == null ? null : DateTime.tryParse(fetchedAt);
  }

  Future<void> _persist() async {
    final prefs = _prefs;
    if (prefs == null) return;
    await prefs.setString(PrefsKeys.fxRatesCache, jsonEncode(_rateCache));
    if (_lastFetch != null) {
      await prefs.setString(PrefsKeys.fxRatesFetchedAt, _lastFetch!.toIso8601String());
    }
  }

  Future<ConvertedAmount?> convert({
    required double amount,
    required String from,
    required String to,
  }) async {
    final source = from.toUpperCase();
    final target = to.toUpperCase();
    if (source == target) {
      return ConvertedAmount(amount: amount, currency: target, rate: 1);
    }
    try {
      final result = await _api.convert(
        amount: amount,
        from: source,
        to: target,
      );
      if (result.rate != null) {
        _rateCache['$source:$target'] = result.rate!;
        _lastFetch = result.fetchedAt ?? DateTime.now();
        _stale = result.stale;
        await _persist();
      }
      return result;
    } catch (_) {
      final cached = _rateCache['$source:$target'];
      if (cached != null) {
        return ConvertedAmount(
          amount: amount * cached,
          currency: target,
          rate: cached,
          fetchedAt: _lastFetch,
          stale: true,
        );
      }
      return null;
    }
  }

  Future<double?> rate(String from, String to) async {
    final source = from.toUpperCase();
    final target = to.toUpperCase();
    if (source == target) return 1;
    final key = '$source:$target';
    if (_rateCache.containsKey(key)) return _rateCache[key];
    try {
      final r = await _api.exchangeRate(base: source, quote: target);
      if (r != null) {
        _rateCache[key] = r;
        _lastFetch = DateTime.now();
        await _persist();
      }
      return r;
    } catch (_) {
      return _rateCache[key];
    }
  }

  void clearCache() {
    _rateCache.clear();
    _lastFetch = null;
    _stale = false;
  }
}
