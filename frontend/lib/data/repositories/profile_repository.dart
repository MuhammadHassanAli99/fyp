import 'dart:typed_data';

import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../models/listing_model.dart';
import '../models/profile_models.dart';
import '../models/user_model.dart';
import '../remote/users_api.dart';
import '../services/media_upload_service.dart';

class ProfileRepository {
  ProfileRepository({
    required this._api,
    required this._uploads,
  });

  final UsersApi _api;
  final MediaUploadService _uploads;

  Future<Result<Map<String, dynamic>>> me() async {
    try {
      return Success(await _api.me());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> updateMe(Map<String, dynamic> body) async {
    try {
      return Success(await _api.updateMe(body));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> changeUsername(String username) async {
    try {
      return Success(await _api.changeUsername(username));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<UsernameCheck>> usernameAvailable(String username) async {
    try {
      return Success(await _api.usernameAvailable(username));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> uploadAvatar({
    required List<int> bytes,
    required String mimeType,
    String? filename,
  }) async {
    try {
      final signed = await _uploads.uploadBytes(
        bytes: Uint8List.fromList(bytes),
        purpose: 'avatar',
        mimeType: mimeType,
        filename: filename ?? 'avatar.jpg',
      );
      return Success(await _api.confirmAvatar(signed.storagePath));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<PrivacySettings>> privacy() async {
    try {
      return Success(await _api.privacy());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<PrivacySettings>> updatePrivacy(PrivacySettings settings) async {
    try {
      return Success(await _api.updatePrivacy(settings));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<PublicProfile>> publicProfile(String username) async {
    try {
      return Success(await _api.publicProfile(username));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<ListingsPage>> publicListings(String username) async {
    try {
      return Success(await _api.publicListings(username));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<List<Map<String, dynamic>>>> publicReviews(String username) async {
    try {
      return Success(await _api.publicReviews(username));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<List<BusinessSummary>>> myBusinesses() async {
    try {
      return Success(await _api.myBusinesses());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> createBusiness(Map<String, dynamic> body) async {
    try {
      return Success(await _api.createBusiness(body));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> getBusiness(int id) async {
    try {
      return Success(await _api.getBusiness(id));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<VerificationSnapshot>> verification() async {
    try {
      return Success(await _api.verification());
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> startVerification({
    required String docType,
    int? businessId,
  }) async {
    try {
      return Success(await _api.startVerification({
        'docType': docType,
        'businessId': ?businessId,
      }));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> uploadVerificationDocument({
    required String requestUuid,
    required List<int> bytes,
    required String mimeType,
    String side = 'front',
    String? filename,
  }) async {
    try {
      final signed = await _uploads.uploadBytes(
        bytes: Uint8List.fromList(bytes),
        purpose: 'verification',
        mimeType: mimeType,
        filename: filename ?? 'document.jpg',
      );
      return Success(
        await _api.attachVerificationDocument(
          requestUuid,
          storagePath: signed.storagePath,
          side: side,
          mimeType: mimeType,
        ),
      );
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  Future<Result<Map<String, dynamic>>> submitVerification(String uuid) async {
    try {
      return Success(await _api.submitVerification(uuid));
    } on ApiException catch (e) {
      return Failure(e.message, code: e.code);
    }
  }

  UserModel? userFromMe(Map<String, dynamic> json) {
    try {
      return UserModel.fromJson(json);
    } catch (_) {
      return null;
    }
  }
}
