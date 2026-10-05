import '../../core/auth/preference_merge.dart';
import '../../core/network/api_client.dart';
import '../models/listing_model.dart';
import '../models/profile_models.dart';

class UsersApi {
  UsersApi(this._client);
  final ApiClient _client;

  Future<Map<String, dynamic>> me() => _client.get(
        '/users/me',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> updateMe(Map<String, dynamic> body) =>
      _client.patch(
        '/users/me',
        data: body,
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> changeUsername(String username) =>
      _client.patch(
        '/users/me/username',
        data: {'username': username},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<UsernameCheck> usernameAvailable(String username) => _client.get(
        '/users/username/available',
        queryParameters: {'username': username},
        parser: (d) => UsernameCheck.fromJson(Map<String, dynamic>.from(d as Map)),
      );

  Future<Map<String, dynamic>> confirmAvatar(String storagePath) =>
      _client.post(
        '/users/me/avatar',
        data: {'storagePath': storagePath},
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> deleteAvatar() => _client.delete(
        '/users/me/avatar',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<PrivacySettings> privacy() => _client.get(
        '/users/me/privacy',
        parser: (d) => PrivacySettings.fromJson(Map<String, dynamic>.from(d as Map)),
      );

  Future<PrivacySettings> updatePrivacy(PrivacySettings settings) =>
      _client.patch(
        '/users/me/privacy',
        data: settings.toJson(),
        parser: (d) => PrivacySettings.fromJson(Map<String, dynamic>.from(d as Map)),
      );

  Future<PublicProfile> publicProfile(String username) => _client.get(
        '/users/u/$username',
        parser: (d) => PublicProfile.fromJson(Map<String, dynamic>.from(d as Map)),
      );

  Future<ListingsPage> publicListings(String username, {int page = 1}) =>
      _client.get(
        '/users/u/$username/listings',
        queryParameters: {'page': page, 'perPage': 12, 'sort': 'newest'},
        parserWithMeta: (data, meta) {
          final items = (data as List)
              .map((e) => ListingModel.fromJson(e as Map<String, dynamic>))
              .toList();
          return ListingsPage(
            items: items,
            page: (meta?['page'] as num?)?.toInt() ?? page,
            total: (meta?['total'] as num?)?.toInt() ?? items.length,
            hasMore: meta?['hasMore'] as bool? ?? false,
          );
        },
      );

  Future<List<Map<String, dynamic>>> publicReviews(String username) =>
      _client.get(
        '/users/u/$username/reviews',
        parser: (d) => (d as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList(),
      );

  Future<Map<String, dynamic>> preferences() => _client.get(
        '/users/me/preferences',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> mergePreferences(PreferenceSnapshot local) =>
      _client.post(
        '/users/me/preferences/merge',
        data: local.toJson(),
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> savedLocation() => _client.get(
        '/users/me/location',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> putLocation(Map<String, dynamic> body) =>
      _client.put(
        '/users/me/location',
        data: body,
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<List<BusinessSummary>> myBusinesses() => _client.get(
        '/businesses',
        parser: (d) => (d as List)
            .whereType<Map>()
            .map((e) => BusinessSummary.fromJson(Map<String, dynamic>.from(e)))
            .toList(),
      );

  Future<Map<String, dynamic>> createBusiness(Map<String, dynamic> body) =>
      _client.post(
        '/businesses',
        data: body,
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> getBusiness(int id) => _client.get(
        '/businesses/$id',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<VerificationSnapshot> verification() => _client.get(
        '/verification',
        parser: (d) =>
            VerificationSnapshot.fromJson(Map<String, dynamic>.from(d as Map)),
      );

  Future<Map<String, dynamic>> startVerification(Map<String, dynamic> body) =>
      _client.post(
        '/verification',
        data: body,
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> attachVerificationDocument(
    String uuid, {
    required String storagePath,
    String side = 'front',
    String? mimeType,
  }) =>
      _client.post(
        '/verification/$uuid/documents',
        data: {
          'storagePath': storagePath,
          'side': side,
          'mimeType': ?mimeType,
        },
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> submitVerification(String uuid) => _client.post(
        '/verification/$uuid/submit',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );

  Future<Map<String, dynamic>> trust() => _client.get(
        '/users/me/trust',
        parser: (d) => Map<String, dynamic>.from(d as Map),
      );
}
