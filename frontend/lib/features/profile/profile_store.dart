import 'package:signals/signals.dart' hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/listing_model.dart';
import '../../data/models/profile_models.dart';
import '../../data/models/user_model.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/repositories/profile_repository.dart';

class ProfileStore {
  ProfileStore({
    required ProfileRepository repository,
    required this._auth,
  })  : _repo = repository;

  final ProfileRepository _repo;
  final AuthRepository _auth;

  final me = signal<AsyncState<Map<String, dynamic>>>(const AsyncIdle());
  final businesses = signal<AsyncState<List<BusinessSummary>>>(const AsyncIdle());
  final verification = signal<AsyncState<VerificationSnapshot>>(const AsyncIdle());
  final privacy = signal<AsyncState<PrivacySettings>>(const AsyncIdle());
  final publicProfile = signal<AsyncState<PublicProfile>>(const AsyncIdle());
  final publicListings = signal<AsyncState<ListingsPage>>(const AsyncIdle());
  final publicReviews = signal<AsyncState<List<Map<String, dynamic>>>>(const AsyncIdle());
  final saving = signal(false);
  final error = signal<String?>(null);

  UserModel? get currentUser => _auth.currentUser;
  bool get isGuest => _auth.isGuest;

  /// SignalBuilder tracks reads during rebuild. Writing the same signals from
  /// initState in that frame throws SignalEffectException and leaves the UI
  /// stuck on a loading spinner.
  Future<void> _yieldBuild() => Future<void>.delayed(Duration.zero);

  Future<void> loadMine() async {
    if (_auth.isGuest) return;
    await _yieldBuild();
    me.value = AsyncLoading(previous: me.value.dataOrNull);
    final result = await _repo.me();
    switch (result) {
      case Success(:final data):
        me.value = AsyncData(data);
        final user = _repo.userFromMe(data);
        if (user != null) {
          // Keep the session user in sync with the latest profile fields.
        }
      case Failure(:final message):
        me.value = AsyncError(message, previous: me.value.dataOrNull);
    }
  }

  Future<void> loadBusinesses() async {
    if (_auth.isGuest) return;
    await _yieldBuild();
    businesses.value = AsyncLoading(previous: businesses.value.dataOrNull);
    final result = await _repo.myBusinesses();
    switch (result) {
      case Success(:final data):
        businesses.value = AsyncData(data);
      case Failure(:final message):
        businesses.value = AsyncError(message, previous: businesses.value.dataOrNull);
    }
  }

  Future<void> loadVerification() async {
    if (_auth.isGuest) return;
    await _yieldBuild();
    verification.value = AsyncLoading(previous: verification.value.dataOrNull);
    final result = await _repo.verification();
    switch (result) {
      case Success(:final data):
        verification.value = AsyncData(data);
      case Failure(:final message):
        verification.value = AsyncError(message, previous: verification.value.dataOrNull);
    }
  }

  Future<void> loadPrivacy() async {
    if (_auth.isGuest) return;
    await _yieldBuild();
    privacy.value = AsyncLoading(previous: privacy.value.dataOrNull);
    final result = await _repo.privacy();
    switch (result) {
      case Success(:final data):
        privacy.value = AsyncData(data);
      case Failure(:final message):
        privacy.value = AsyncError(message, previous: privacy.value.dataOrNull);
    }
  }

  Future<void> loadPublic(String username) async {
    await _yieldBuild();
    publicProfile.value = AsyncLoading(previous: publicProfile.value.dataOrNull);
    publicListings.value = const AsyncIdle();
    publicReviews.value = const AsyncIdle();
    final result = await _repo.publicProfile(username);
    switch (result) {
      case Success(:final data):
        publicProfile.value = AsyncData(data);
        if (data.showListings) {
          final listings = await _repo.publicListings(username);
          if (listings case Success(:final data)) {
            publicListings.value = AsyncData(data);
          }
        }
        if (data.showReviews) {
          final reviews = await _repo.publicReviews(username);
          if (reviews case Success(:final data)) {
            publicReviews.value = AsyncData(data);
          }
        }
      case Failure(:final message):
        publicProfile.value = AsyncError(message);
    }
  }

  Future<Result<Map<String, dynamic>>> saveProfile(Map<String, dynamic> body) async {
    saving.value = true;
    error.value = null;
    final result = await _repo.updateMe(body);
    saving.value = false;
    if (result case Success(:final data)) {
      me.value = AsyncData(data);
    } else if (result case Failure(:final message)) {
      error.value = message;
    }
    return result;
  }

  Future<Result<Map<String, dynamic>>> saveUsername(String username) async {
    saving.value = true;
    error.value = null;
    final result = await _repo.changeUsername(username);
    saving.value = false;
    if (result case Failure(:final message)) error.value = message;
    return result;
  }

  Future<Result<PrivacySettings>> savePrivacy(PrivacySettings settings) async {
    saving.value = true;
    final result = await _repo.updatePrivacy(settings);
    saving.value = false;
    if (result case Success(:final data)) privacy.value = AsyncData(data);
    return result;
  }
}
