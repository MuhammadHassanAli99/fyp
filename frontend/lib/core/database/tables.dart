import 'package:drift/drift.dart';

class CachedListings extends Table {
  TextColumn get id => text()();
  TextColumn get marketplace => text()();
  TextColumn get title => text()();
  RealColumn get price => real()();
  TextColumn get currency => text()();
  TextColumn get location => text().nullable()();
  TextColumn get imageUrl => text().nullable()();
  TextColumn get payloadJson => text()();
  DateTimeColumn get cachedAt => dateTime()();
  TextColumn get sortKey => text().nullable()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}

class DraftListings extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get marketplace => text()();
  TextColumn get title => text().withDefault(const Constant(''))();
  TextColumn get payloadJson => text().withDefault(const Constant('{}'))();
  DateTimeColumn get updatedAt => dateTime()();
}

class OutboxEntries extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get method => text()();
  TextColumn get path => text()();
  TextColumn get bodyJson => text().nullable()();
  IntColumn get retryCount => integer().withDefault(const Constant(0))();
  DateTimeColumn get createdAt => dateTime()();
  TextColumn get status => text().withDefault(const Constant('pending'))();
}

class SettingsMirror extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column<Object>> get primaryKey => {key};
}

class CompareSets extends Table {
  TextColumn get id => text()();
  TextColumn get marketplace => text()();
  TextColumn get listingIdsJson => text()();
  TextColumn get aiResultJson => text().nullable()();
  DateTimeColumn get updatedAt => dateTime()();

  @override
  Set<Column<Object>> get primaryKey => {id};
}
