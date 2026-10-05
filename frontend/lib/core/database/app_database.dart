import 'package:drift/drift.dart';

import 'connection.dart';
import 'tables.dart';

part 'app_database.g.dart';

@DriftDatabase(tables: [
  CachedListings,
  DraftListings,
  OutboxEntries,
  SettingsMirror,
  CompareSets,
])
class AppDatabase extends _$AppDatabase {
  AppDatabase([QueryExecutor? executor]) : super(executor ?? openConnection());

  @override
  int get schemaVersion => 1;

  Future<void> upsertListing(CachedListingsCompanion entry) =>
      into(cachedListings).insertOnConflictUpdate(entry);

  Future<List<CachedListing>> listingsForMarketplace(String marketplace, {int? limit}) {
    final query = select(cachedListings)
      ..where((t) => t.marketplace.equals(marketplace))
      ..orderBy([(t) => OrderingTerm.desc(t.cachedAt)]);
    if (limit != null) query.limit(limit);
    return query.get();
  }

  Future<void> evictCachedListings({
    required String marketplace,
    int keep = 60,
    Duration ttl = const Duration(hours: 24),
  }) async {
    final cutoff = DateTime.now().subtract(ttl);
    await (delete(cachedListings)
          ..where((t) => t.marketplace.equals(marketplace) & t.cachedAt.isSmallerThanValue(cutoff)))
        .go();
    final rows = await listingsForMarketplace(marketplace);
    if (rows.length <= keep) return;
    final extraIds = rows.skip(keep).map((row) => row.id).toList();
    await (delete(cachedListings)..where((t) => t.id.isIn(extraIds))).go();
  }

  Stream<List<CachedListing>> watchListings(String marketplace) =>
      (select(cachedListings)
            ..where((t) => t.marketplace.equals(marketplace))
            ..orderBy([(t) => OrderingTerm.desc(t.cachedAt)]))
          .watch();

  Future<void> setSetting(String key, String value) =>
      into(settingsMirror).insertOnConflictUpdate(
        SettingsMirrorCompanion.insert(key: key, value: value),
      );

  Future<String?> getSetting(String key) async {
    final row = await (select(settingsMirror)
          ..where((t) => t.key.equals(key)))
        .getSingleOrNull();
    return row?.value;
  }

  Future<void> saveCompareSet(CompareSetsCompanion set) =>
      into(compareSets).insertOnConflictUpdate(set);

  Future<CompareSet?> getCompareSet(String id) => (select(compareSets)
        ..where((t) => t.id.equals(id)))
      .getSingleOrNull();

  Future<void> upsertMarketplaceDraft({
    required String marketplace,
    required String title,
    required String payloadJson,
  }) async {
    final existing = await (select(draftListings)
          ..where((t) => t.marketplace.equals(marketplace)))
        .getSingleOrNull();
    if (existing != null) {
      await (update(draftListings)..where((t) => t.id.equals(existing.id))).write(
        DraftListingsCompanion(
          title: Value(title),
          payloadJson: Value(payloadJson),
          updatedAt: Value(DateTime.now()),
        ),
      );
      return;
    }
    await into(draftListings).insert(
      DraftListingsCompanion.insert(
        marketplace: marketplace,
        title: Value(title),
        payloadJson: Value(payloadJson),
        updatedAt: DateTime.now(),
      ),
    );
  }

  Future<DraftListing?> latestDraftFor(String marketplace) =>
      (select(draftListings)
            ..where((t) => t.marketplace.equals(marketplace))
            ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)])
            ..limit(1))
          .getSingleOrNull();

  Future<void> enqueueOutbox({
    required String method,
    required String path,
    String? bodyJson,
  }) =>
      into(outboxEntries).insert(
        OutboxEntriesCompanion.insert(
          method: method,
          path: path,
          bodyJson: Value(bodyJson),
          createdAt: DateTime.now(),
        ),
      );

  Future<List<OutboxEntry>> pendingOutbox() => (select(outboxEntries)
        ..where((t) => t.status.equals('pending'))
        ..orderBy([(t) => OrderingTerm.asc(t.createdAt)]))
      .get();

  Future<void> markOutboxDone(int id) => (update(outboxEntries)..where((t) => t.id.equals(id))).write(
        const OutboxEntriesCompanion(status: Value('done')),
      );

  Future<void> incrementOutboxRetry(int id) async {
    final row = await (select(outboxEntries)..where((t) => t.id.equals(id))).getSingleOrNull();
    if (row == null) return;
    await (update(outboxEntries)..where((t) => t.id.equals(id))).write(
      OutboxEntriesCompanion(retryCount: Value(row.retryCount + 1)),
    );
  }
  Future<void> clearSensitiveData() async {
    await delete(draftListings).go();
    await delete(outboxEntries).go();
    await delete(compareSets).go();
  }
}
