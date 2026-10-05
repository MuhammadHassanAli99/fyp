import 'package:drift/drift.dart';

import '../../core/database/app_database.dart';
import '../models/listing_model.dart';
import 'dart:convert';

class SettingsLocal {
  SettingsLocal(this._db);

  final AppDatabase _db;

  Future<void> mirrorToDb(String key, String value) =>
      _db.setSetting(key, value);

  Future<String?> fromDb(String key) => _db.getSetting(key);
}

class ListingCacheLocal {
  ListingCacheLocal(this._db);
  final AppDatabase _db;

  Future<void> cacheListings(String marketplace, List<ListingModel> items) async {
    final now = DateTime.now();
    for (final item in items) {
      await _db.upsertListing(
        CachedListingsCompanion.insert(
          id: item.id,
          marketplace: marketplace,
          title: item.title,
          price: item.price,
          currency: item.currency,
          location: Value(item.location),
          imageUrl: Value(item.imageUrl),
          payloadJson: jsonEncode(item.toJson()),
          cachedAt: now,
        ),
      );
    }
    await _db.evictCachedListings(marketplace: marketplace);
  }

  Future<List<ListingModel>> getCached(String marketplace) async {
    final rows = await _db.listingsForMarketplace(marketplace, limit: 60);
    final cutoff = DateTime.now().subtract(const Duration(hours: 24));
    return rows
        .where((r) => r.cachedAt.isAfter(cutoff))
        .map((r) => ListingModel.fromJson(
              jsonDecode(r.payloadJson) as Map<String, dynamic>,
            ))
        .toList();
  }
}
