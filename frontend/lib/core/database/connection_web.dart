import 'package:drift/drift.dart';
import 'package:drift/wasm.dart';

/// IndexedDB-backed cache when wasm assets are present; otherwise the
/// connection fails closed and the app continues with network-only data.
QueryExecutor openConnection() {
  return LazyDatabase(() async {
    final result = await WasmDatabase.open(
      databaseName: 'marketplace_cache',
      sqlite3Uri: Uri.parse('sqlite3.wasm'),
      driftWorkerUri: Uri.parse('drift_worker.js'),
    );
    return result.resolvedExecutor;
  });
}
