import 'dart:async';

import 'package:uuid/uuid.dart';

import '../../core/auth/guest_feature.dart';
import '../../core/auth/biometric_service.dart';
import '../../core/init/app_init_store.dart';
import '../../app/router_refresh.dart';
import '../database/app_database.dart';
import '../network/api_client.dart';
import '../storage/prefs_storage.dart';
import '../storage/secure_storage.dart';
import '../../data/local/settings_local.dart';
import '../../data/remote/auth_api.dart';
import '../../data/remote/bootstrap_api.dart';
import '../../data/remote/catalog_api.dart';
import '../../data/remote/comparison_api.dart';
import '../../data/remote/configuration_api.dart';
import '../../data/remote/geo_api.dart';
import '../../data/remote/listings_api.dart';
import '../../data/remote/search_api.dart';
import '../../data/remote/filters_api.dart';
import '../../data/remote/maps_api.dart';
import '../../data/repositories/search_repository.dart';
import '../../data/repositories/filters_repository.dart';
import '../../data/repositories/maps_repository.dart';
import '../../data/services/location_service.dart';
import '../../data/remote/locale_api.dart';
import '../../data/remote/users_api.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/repositories/catalog_repository.dart';
import '../../data/remote/favorites_api.dart';
import '../../data/repositories/favorites_repository.dart';
import '../../data/remote/marketplace_apis.dart';
import '../../data/remote/gold_api.dart';
import '../../data/remote/chat_api.dart';
import '../../data/remote/notifications_api.dart';
import '../../data/remote/subscriptions_api.dart';
import '../../data/remote/payments_api.dart';
import '../../data/remote/ai_api.dart';
import '../../data/repositories/listings_repository.dart';
import '../../data/repositories/gold_repository.dart';
import '../../data/repositories/property_repository.dart';
import '../../data/repositories/vehicle_repository.dart';
import '../../data/repositories/settings_repository.dart';
import '../../data/repositories/comparison_repository.dart';
import '../../data/repositories/chat_repository.dart';
import '../../data/repositories/notifications_repository.dart';
import '../../data/services/fx_service.dart';
import '../../data/services/locale_detect_service.dart';
import '../../data/services/media_upload_service.dart';
import '../../data/services/realtime_client.dart';
import '../../data/services/communication_hub.dart';
import '../../data/services/notification_hub.dart';
import '../../data/services/push_adapter.dart';
import '../../data/repositories/profile_repository.dart';
import '../../data/repositories/subscriptions_repository.dart';
import '../../data/repositories/payments_repository.dart';
import '../../data/repositories/ai_repository.dart';
import '../../features/auth/auth_store.dart';
import '../../features/profile/profile_store.dart';
import '../../features/subscription/subscription_store.dart';
import '../../features/compare/compare_store.dart';
import '../../features/favorites/favorites_store.dart';
import '../../features/settings/settings_store.dart';
import '../../features/trust_risk/data/device_security_service.dart';
import '../../features/trust_risk/data/trust_risk_api.dart';
import '../../features/trust_risk/presentation/trust_risk_store.dart';
import '../../features/reviews/data/reviews_api.dart';
import '../../features/advertisements/data/ads_api.dart';
import '../../features/advertisements/ads_store.dart';
import '../../features/admin/data/admin_api.dart';
import '../../features/admin/admin_store.dart';
import '../../features/seller/data/seller_api.dart';
import '../../features/seller/seller_store.dart';
import '../../features/analytics/data/analytics_api.dart';
import '../../features/security/data/security_api.dart';
import '../../features/security/security_store.dart';
import '../../features/support/data/support_api.dart';
import '../../features/support/support_store.dart';

class ServiceLocator {
  ServiceLocator._();
  static final ServiceLocator instance = ServiceLocator._();

  late final SecureStorage secureStorage;
  late final PrefsStorage prefs;
  late final AppDatabase database;
  late final ApiClient apiClient;

  late final AuthRepository authRepository;
  late final AuthStore authStore;
  late final BiometricService biometricService;
  late final SettingsRepository settingsRepository;
  late final CatalogRepository catalogRepository;
  late final ListingsRepository listingsRepository;
  late final SearchRepository searchRepository;
  late final FiltersRepository filtersRepository;
  late final MapsRepository mapsRepository;
  late final LocationService locationService;
  late final ComparisonRepository comparisonRepository;
  late final FavoritesRepository favoritesRepository;
  late final ChatRepository chatRepository;
  late final NotificationsRepository notificationsRepository;
  late final NotificationHub notificationHub;
  late final PushAdapter pushAdapter;
  late final MediaUploadService mediaUploadService;
  late final RealtimeClient realtimeClient;
  late final CommunicationHub communicationHub;
  late final CompareStore compareStore;
  late final FavoritesStore favoritesStore;
  late final SettingsStore settingsStore;
  late final PropertyApi propertyApi;
  late final PropertyRepository propertyRepository;
  late final VehiclesApi vehiclesApi;
  late final VehicleRepository vehicleRepository;
  late final GoldApi goldApi;
  late final GoldRepository goldRepository;
  late final LocaleApi localeApi;
  late final GeoApi geoApi;
  late final FxService fxService;
  late final LocaleDetectService localeDetectService;
  late final AppInitStore appInitStore;
  late final GuestFeatureGuard guestFeatureGuard;
  late final UsersApi usersApi;
  late final ProfileRepository profileRepository;
  late final ProfileStore profileStore;
  late final SubscriptionsRepository subscriptionsRepository;
  late final SubscriptionStore subscriptionStore;
  late final PaymentsRepository paymentsRepository;
  late final AiRepository aiRepository;
  late final DeviceSecurityService deviceSecurity;
  late final TrustRiskStore trustRiskStore;
  late final ReviewsApi reviewsApi;
  late final AdsApi adsApi;
  late final AdsStore adsStore;
  late final AdminApi adminApi;
  late final AdminStore adminStore;
  late final SellerApi sellerApi;
  late final SellerStore sellerStore;
  late final AnalyticsApi analyticsApi;
  late final SecurityApi securityApi;
  late final SecurityStore securityStore;
  late final SupportApi supportApi;
  late final SupportStore supportStore;
  late final ConfigurationApi configurationApi;
  final routerRefresh = GoRouterRefresh();

  bool _initialized = false;
  bool get isInitialized => _initialized;

  Future<void> init() async {
    if (_initialized) return;

    secureStorage = SecureStorage();
    prefs = await PrefsStorage.create();
    database = AppDatabase();
    deviceSecurity = DeviceSecurityService();
    await deviceSecurity.warm();
    apiClient = await ApiClient.init(
      secureStorage: secureStorage,
      prefs: prefs,
      security: deviceSecurity,
    );

    if (prefs.deviceId == null) {
      await prefs.setString(PrefsKeys.deviceId, const Uuid().v4());
    }

    final settingsLocal = SettingsLocal(database);
    final listingCache = ListingCacheLocal(database);

    biometricService = BiometricService(storage: secureStorage);
    authRepository = AuthRepository(
      api: AuthApi(apiClient),
      secureStorage: secureStorage,
      prefs: prefs,
      database: database,
      biometric: biometricService,
    );
    authStore = AuthStore(authRepository);
    await authRepository.hasSession();

    localeApi = LocaleApi(apiClient);
    geoApi = GeoApi(apiClient);
    usersApi = UsersApi(apiClient);
    configurationApi = ConfigurationApi(apiClient);
    fxService = FxService(localeApi, prefs: prefs);
    localeDetectService = LocaleDetectService(localeApi, geoApi);

    settingsRepository = SettingsRepository(
      prefs: prefs,
      local: settingsLocal,
      localeApi: localeApi,
      geoApi: geoApi,
      fxService: fxService,
      detectService: localeDetectService,
      usersApi: usersApi,
    );
    catalogRepository = CatalogRepository(
      catalogApi: CatalogApi(apiClient),
      bootstrapApi: BootstrapApi(apiClient),
    );
    listingsRepository = ListingsRepository(
      api: ListingsApi(apiClient),
      cache: listingCache,
    );
    searchRepository = SearchRepository(SearchApi(apiClient));
    final filtersApi = FiltersApi(apiClient);
    final mapsApi = MapsApi(apiClient);
    filtersRepository = FiltersRepository(filtersApi);
    mapsRepository = MapsRepository(mapsApi);
    locationService = LocationService(geoApi, mapsApi);
    comparisonRepository = ComparisonRepository(ComparisonApi(apiClient));
    favoritesRepository = FavoritesRepository(
      FavoritesApi(apiClient),
      database,
      prefs,
    );
    final chatApi = ChatApi(apiClient);
    final callsApi = CallsApi(apiClient);
    final uploadsApi = UploadsApi(apiClient);
    chatRepository = ChatRepository(chatApi, callsApi);
    notificationsRepository = NotificationsRepository(NotificationsApi(apiClient));
    mediaUploadService = MediaUploadService(uploadsApi);
    realtimeClient = RealtimeClient(secureStorage);
    communicationHub = CommunicationHub(realtimeClient);
    communicationHub.start();
    notificationHub = NotificationHub(realtimeClient, notificationsRepository);
    notificationHub.start();
    pushAdapter = PushAdapter(notificationsRepository);
    authRepository.onSignedOut = () {
      unawaited(realtimeClient.disconnect());
    };
    if (authRepository.hasActiveSession && authRepository.currentUser?.isGuest != true) {
      unawaited(realtimeClient.connect());
      unawaited(notificationHub.refreshUnread());
    }
    profileRepository = ProfileRepository(
      api: usersApi,
      uploads: mediaUploadService,
    );
    profileStore = ProfileStore(
      repository: profileRepository,
      auth: authRepository,
    );
    subscriptionsRepository = SubscriptionsRepository(SubscriptionsApi(apiClient));
    subscriptionStore = SubscriptionStore(
      subscriptionsRepository,
      authRepository,
      realtimeClient,
    );
    subscriptionStore.listen();
    if (authRepository.hasActiveSession && authRepository.currentUser?.isGuest != true) {
      unawaited(subscriptionStore.load());
    }
    paymentsRepository = PaymentsRepository(PaymentsApi(apiClient));
    aiRepository = AiRepository(AiApi(apiClient));
    trustRiskStore = TrustRiskStore(TrustRiskApi(apiClient));
    reviewsApi = ReviewsApi(apiClient);
    adsApi = AdsApi(apiClient);
    adsStore = AdsStore(adsApi);
    adminApi = AdminApi(apiClient);
    adminStore = AdminStore(adminApi);
    sellerApi = SellerApi(apiClient);
    sellerStore = SellerStore(sellerApi);
    analyticsApi = AnalyticsApi(apiClient);
    securityApi = SecurityApi(apiClient);
    securityStore = SecurityStore(securityApi);
    supportApi = SupportApi(apiClient);
    supportStore = SupportStore(supportApi, realtimeClient);
    propertyApi = PropertyApi(apiClient);
    propertyRepository = PropertyRepository(propertyApi);
    vehiclesApi = VehiclesApi(apiClient);
    vehicleRepository = VehicleRepository(vehiclesApi);
    goldApi = GoldApi(apiClient);
    goldRepository = GoldRepository(goldApi);
    compareStore = CompareStore(
      comparisonRepository,
      settingsRepository,
      listingsRepository,
      vehiclesApi,
    );
    favoritesStore = FavoritesStore(favoritesRepository, authRepository, realtimeClient);
    favoritesStore.listen();
    authRepository.onAuthenticated = () {
      unawaited(realtimeClient.connect());
      unawaited(notificationHub.refreshUnread());
      unawaited(favoritesStore.consumePendingAction());
      unawaited(subscriptionStore.load());
    };
    settingsStore = SettingsStore(settingsRepository);
    guestFeatureGuard = GuestFeatureGuard(
      isGuest: () => authRepository.isGuest,
      hasSession: () => authRepository.hasActiveSession,
    );
    appInitStore = AppInitStore(
      prefs: prefs,
      settings: settingsRepository,
      auth: authRepository,
      catalog: catalogRepository,
      configurationApi: configurationApi,
      geoApi: geoApi,
    );

    _initialized = true;
  }
}
