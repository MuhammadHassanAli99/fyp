import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/auth_status.dart';
import '../core/di/service_locator.dart';
import '../features/auth/biometric_lock_screen.dart';
import '../features/auth/devices_screen.dart';
import '../features/trust_risk/presentation/security_status_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/auth/mfa_screen.dart';
import '../features/auth/oauth_callback_screen.dart';
import '../features/auth/otp_screen.dart';
import '../features/auth/register_screen.dart';
import '../features/auth/update_required_screen.dart';
import '../features/chat/chat_screen.dart';
import '../features/chat/conversation_screen.dart';
import '../features/chat/call_screen.dart';
import '../features/compare/compare_screen.dart';
import '../features/favorites/favorites_screen.dart';
import '../features/favorites/share_target_screen.dart';
import '../features/home/home_screen.dart';
import '../features/listings/listing_detail_screen.dart';
import '../features/listings/listing_manage_screen.dart';
import '../features/listings/listing_promotions_screen.dart';
import '../features/marketplace_select/marketplace_select_screen.dart';
import '../features/notifications/notification_center_screen.dart';
import '../features/notifications/notification_settings_screen.dart';
import '../features/onboarding_locale/locale_onboarding_screen.dart';
import '../features/post/post_listing_screen.dart';
import '../features/property/property_saved_searches_screen.dart';
import '../features/vehicles/vehicle_parts_screen.dart';
import '../features/vehicles/vehicle_saved_searches_screen.dart';
import '../features/profile/profile_screen.dart';
import '../features/profile/edit_profile_screen.dart';
import '../features/profile/public_profile_screen.dart';
import '../features/profile/business_screens.dart';
import '../features/profile/verification_screen.dart';
import '../features/subscription/subscription_screen.dart';
import '../features/reviews/write_review_screen.dart';
import '../features/search/search_saved_screen.dart';
import '../features/search/search_screen.dart';
import '../features/security/privacy_center_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/legal/legal_documents_screen.dart';
import '../features/splash/splash_screen.dart';
import '../features/admin/admin_shell.dart' deferred as admin_ui;
import '../features/seller/seller_shell.dart' deferred as seller_ui;
import '../features/analytics/analytics_dashboard.dart' deferred as analytics_ui;
import '../features/maps/discovery_map_screen.dart' deferred as maps_ui;
import '../features/ai/ai_support_screen.dart' deferred as ai_ui;
import '../features/advertisements/campaigns_screen.dart' deferred as ads_ui;
import '../features/listings/listing_analytics_screen.dart' deferred as listing_analytics_ui;
import '../features/payment/checkout_screen.dart' deferred as checkout_ui;
import '../features/support/support_shell.dart' deferred as support_ui;
import 'app_routes.dart';
import 'deferred_page.dart';
import 'router_refresh.dart';

export 'app_routes.dart';


GoRouter createRouter({required GoRouterRefresh refresh}) {
  final sl = ServiceLocator.instance;

  return GoRouter(
    initialLocation: AppRoutes.splash,
    refreshListenable: refresh,
    redirect: (context, state) {
      final loc = state.matchedLocation;
      final prefs = sl.prefs;
      final auth = sl.authRepository;
      final hasSession = auth.hasActiveSession;
      final status = auth.status;

      if (loc == AppRoutes.splash) return null;

      if (status == AuthStatus.updateRequired && loc != AppRoutes.updateRequired) {
        return AppRoutes.updateRequired;
      }

      if (!prefs.onboardingComplete && loc != AppRoutes.onboarding) {
        return AppRoutes.onboarding;
      }

      final publicRoutes = {
        AppRoutes.onboarding,
        AppRoutes.login,
        AppRoutes.register,
        AppRoutes.otp,
        AppRoutes.unlock,
        AppRoutes.splash,
        AppRoutes.oauthCallback,
        AppRoutes.updateRequired,
      };

      if (status == AuthStatus.biometricRequired && loc != AppRoutes.unlock) {
        return AppRoutes.unlock;
      }

      if (status == AuthStatus.otpRequired && loc != AppRoutes.otp) {
        return AppRoutes.otp;
      }

      if (status == AuthStatus.mfaRequired && loc != AppRoutes.mfa) {
        return AppRoutes.mfa;
      }

      final isOpenProfile = loc.startsWith('/u/') || loc.startsWith('/business/');
      final isLegal = loc == AppRoutes.legal || loc.startsWith('/legal/');

      if (!hasSession &&
          !publicRoutes.contains(loc) &&
          loc != AppRoutes.mfa &&
          !isOpenProfile &&
          !isLegal) {
        return AppRoutes.login;
      }

      if (hasSession &&
          status == AuthStatus.authenticated &&
          (loc == AppRoutes.login ||
              loc == AppRoutes.register ||
              loc == AppRoutes.mfa ||
              loc == AppRoutes.otp ||
              loc == AppRoutes.unlock)) {
        return prefs.marketplaceCode == null
            ? AppRoutes.marketplaceSelect
            : AppRoutes.home;
      }

      if (hasSession &&
          prefs.marketplaceCode == null &&
          loc != AppRoutes.marketplaceSelect &&
          !publicRoutes.contains(loc) &&
          !loc.startsWith('/u/') &&
          !loc.startsWith('/business/') &&
          !isLegal) {
        return AppRoutes.marketplaceSelect;
      }

      return null;
    },
    routes: [
      GoRoute(
        path: AppRoutes.splash,
        builder: (_, _) => const SplashScreen(),
      ),
      GoRoute(
        path: AppRoutes.onboarding,
        builder: (_, _) => const LocaleOnboardingScreen(),
      ),
      GoRoute(
        path: AppRoutes.login,
        builder: (_, _) => LoginScreen(store: sl.authStore),
      ),
      GoRoute(
        path: AppRoutes.register,
        builder: (_, _) => RegisterScreen(store: sl.authStore),
      ),
      GoRoute(
        path: AppRoutes.otp,
        builder: (_, _) => OtpScreen(store: sl.authStore),
      ),
      GoRoute(
        path: AppRoutes.unlock,
        builder: (_, _) => const BiometricLockScreen(),
      ),
      GoRoute(
        path: AppRoutes.mfa,
        builder: (_, _) => const MfaScreen(),
      ),
      GoRoute(
        path: AppRoutes.devices,
        builder: (_, _) => const DevicesScreen(),
      ),
      GoRoute(
        path: AppRoutes.securityStatus,
        builder: (_, _) => const SecurityStatusScreen(),
      ),
      GoRoute(
        path: AppRoutes.privacyCenter,
        builder: (_, _) => const PrivacyCenterScreen(),
      ),
      GoRoute(
        path: AppRoutes.updateRequired,
        builder: (_, _) => const UpdateRequiredScreen(),
      ),
      GoRoute(
        path: AppRoutes.oauthCallback,
        builder: (_, state) => OauthCallbackScreen(
          ticket: state.uri.queryParameters['ticket'],
        ),
      ),
      GoRoute(
        path: AppRoutes.marketplaceSelect,
        builder: (_, _) => const MarketplaceSelectScreen(),
      ),
      GoRoute(
        path: AppRoutes.home,
        builder: (_, _) {
          final code = sl.settingsRepository.marketplaceCode ?? 'gold';
          return HomeScreen(key: ValueKey(code));
        },
      ),
      GoRoute(
        path: AppRoutes.searchSaved,
        builder: (_, _) => const SearchSavedScreen(),
      ),
      GoRoute(
        path: AppRoutes.searchNearby,
        builder: (_, state) => SearchScreen(
          initialQuery: state.uri.queryParameters['q'],
          startNearby: true,
          initialParams: state.uri.queryParameters,
        ),
      ),
      GoRoute(
        path: AppRoutes.search,
        builder: (_, state) => SearchScreen(
          initialQuery: state.uri.queryParameters['q'],
          startNearby: state.uri.queryParameters['nearby'] == '1',
          initialParams: state.uri.queryParameters,
        ),
      ),
      GoRoute(
        path: AppRoutes.map,
        builder: (_, state) => DeferredPage(
          loader: maps_ui.loadLibrary,
          builder: () => maps_ui.DiscoveryMapScreen(
            marketplace: state.uri.queryParameters['marketplace'],
            queryParameters: state.uri.queryParameters,
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.listingManage,
        builder: (_, state) => ListingManageScreen(
          listingId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: AppRoutes.listingPromotions,
        builder: (_, state) => ListingPromotionsScreen(
          listingId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: AppRoutes.listingAnalytics,
        builder: (_, state) => DeferredPage(
          loader: listing_analytics_ui.loadLibrary,
          builder: () => listing_analytics_ui.ListingAnalyticsScreen(
            listingId: state.pathParameters['id']!,
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.listingReview,
        builder: (_, state) => WriteReviewScreen(
          listingId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: AppRoutes.listing,
        builder: (_, state) => ListingDetailScreen(
          listingId: state.pathParameters['id']!,
          justPosted: state.uri.queryParameters['posted'] == '1',
        ),
      ),
      GoRoute(
        path: AppRoutes.compare,
        builder: (_, _) => const CompareScreen(),
      ),
      GoRoute(
        path: AppRoutes.favorites,
        builder: (_, _) => const FavoritesScreen(),
      ),
      GoRoute(
        path: AppRoutes.share,
        builder: (_, state) => ShareTargetScreen(token: state.pathParameters['token']!),
      ),
      GoRoute(
        path: AppRoutes.chat,
        builder: (_, _) => const ChatScreen(),
      ),
      GoRoute(
        path: AppRoutes.notificationSettings,
        builder: (_, _) => const NotificationSettingsScreen(),
      ),
      GoRoute(
        path: AppRoutes.notifications,
        builder: (_, _) => const NotificationCenterScreen(),
      ),
      GoRoute(
        path: AppRoutes.notificationDetail,
        builder: (_, state) => NotificationDetailScreen(
          uuid: state.pathParameters['uuid']!,
        ),
      ),
      GoRoute(
        path: AppRoutes.conversation,
        builder: (_, state) => ConversationScreen(
          conversationUuid: state.pathParameters['uuid']!,
        ),
      ),
      GoRoute(
        path: AppRoutes.callHistory,
        builder: (_, _) => const CallHistoryScreen(),
      ),
      GoRoute(
        path: AppRoutes.settings,
        builder: (_, _) => const SettingsScreen(),
      ),
      GoRoute(
        path: AppRoutes.legalKind,
        builder: (_, state) => LegalDocumentsScreen(kind: state.pathParameters['kind']),
      ),
      GoRoute(
        path: AppRoutes.legal,
        builder: (_, _) => const LegalDocumentsScreen(),
      ),
      GoRoute(
        path: AppRoutes.seller,
        builder: (_, _) => DeferredPage(
          loader: seller_ui.loadLibrary,
          builder: () => seller_ui.SellerShell(),
        ),
      ),
      GoRoute(
        path: AppRoutes.analytics,
        builder: (_, _) => DeferredPage(
          loader: analytics_ui.loadLibrary,
          builder: () => analytics_ui.AnalyticsDashboard(),
        ),
      ),
      GoRoute(
        path: AppRoutes.profile,
        builder: (_, _) => const ProfileScreen(),
      ),
      GoRoute(
        path: AppRoutes.subscription,
        builder: (_, _) => const SubscriptionScreen(),
      ),
      GoRoute(
        path: AppRoutes.aiSupport,
        builder: (_, _) => DeferredPage(
          loader: ai_ui.loadLibrary,
          builder: () => ai_ui.AiSupportScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.supportTicket,
        builder: (_, state) => DeferredPage(
          loader: support_ui.loadLibrary,
          builder: () => support_ui.SupportTicketScreen(uuid: state.pathParameters['uuid'] ?? ''),
        ),
      ),
      GoRoute(
        path: AppRoutes.supportArticle,
        builder: (_, state) => DeferredPage(
          loader: support_ui.loadLibrary,
          builder: () => support_ui.SupportArticleScreen(slug: state.pathParameters['slug'] ?? ''),
        ),
      ),
      GoRoute(
        path: AppRoutes.supportForumTopic,
        builder: (_, state) => DeferredPage(
          loader: support_ui.loadLibrary,
          builder: () => support_ui.SupportForumTopicScreen(slug: state.pathParameters['slug'] ?? ''),
        ),
      ),
      GoRoute(
        path: AppRoutes.support,
        builder: (_, state) => DeferredPage(
          loader: support_ui.loadLibrary,
          builder: () => support_ui.SupportShell(
            contextData: support_ui.SupportContext(
              marketplace: state.uri.queryParameters['marketplace'],
              categoryCode: state.uri.queryParameters['category'],
              entityType: state.uri.queryParameters['entityType'],
              entityId: int.tryParse(state.uri.queryParameters['entityId'] ?? ''),
              listingId: int.tryParse(state.uri.queryParameters['listingId'] ?? ''),
              listingUuid: state.uri.queryParameters['listingUuid'],
              orderUuid: state.uri.queryParameters['orderUuid'],
              paymentUuid: state.uri.queryParameters['paymentUuid'],
              conversationUuid: state.uri.queryParameters['conversationUuid'],
            ),
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.advertise,
        builder: (_, _) => DeferredPage(
          loader: ads_ui.loadLibrary,
          builder: () => ads_ui.CampaignsScreen(),
        ),
      ),
      GoRoute(
        path: AppRoutes.adminModule,
        builder: (_, state) => DeferredPage(
          loader: admin_ui.loadLibrary,
          builder: () => admin_ui.AdminShell(initialModule: state.pathParameters['module']),
        ),
      ),
      GoRoute(
        path: AppRoutes.admin,
        builder: (_, _) => DeferredPage(
          loader: admin_ui.loadLibrary,
          builder: () => admin_ui.AdminShell(),
        ),
      ),
      GoRoute(
        path: AppRoutes.checkout,
        builder: (_, state) => DeferredPage(
          loader: checkout_ui.loadLibrary,
          builder: () => checkout_ui.CheckoutScreen(
            orderUuid: state.pathParameters['orderUuid'] ?? '',
          ),
        ),
      ),
      GoRoute(
        path: AppRoutes.profileEdit,
        builder: (_, _) => const EditProfileScreen(),
      ),
      GoRoute(
        path: AppRoutes.profilePrivacy,
        builder: (_, _) => const PrivacyScreen(),
      ),
      GoRoute(
        path: AppRoutes.verification,
        builder: (_, _) => const VerificationScreen(),
      ),
      GoRoute(
        path: AppRoutes.businesses,
        builder: (_, _) => const BusinessListScreen(),
      ),
      GoRoute(
        path: AppRoutes.businessCreate,
        builder: (_, _) => const BusinessEditScreen(),
      ),
      GoRoute(
        path: AppRoutes.businessDetail,
        builder: (_, state) => BusinessDetailScreen(
          businessId: int.tryParse(state.pathParameters['id'] ?? '') ?? 0,
        ),
      ),
      GoRoute(
        path: AppRoutes.publicProfile,
        builder: (_, state) => PublicProfileScreen(
          username: state.pathParameters['username'] ?? '',
        ),
      ),
      GoRoute(
        path: AppRoutes.draft,
        builder: (_, _) => const PostListingScreen(),
      ),
      GoRoute(
        path: AppRoutes.post,
        builder: (_, _) => const PostListingScreen(),
      ),
      GoRoute(
        path: AppRoutes.propertyMap,
        builder: (_, _) => DeferredPage(
          loader: maps_ui.loadLibrary,
          builder: () => maps_ui.DiscoveryMapScreen(marketplace: 'property'),
        ),
      ),
      GoRoute(
        path: AppRoutes.propertySavedSearches,
        builder: (_, _) => const PropertySavedSearchesScreen(),
      ),
      GoRoute(
        path: AppRoutes.vehicleMap,
        builder: (_, _) => DeferredPage(
          loader: maps_ui.loadLibrary,
          builder: () => maps_ui.DiscoveryMapScreen(marketplace: 'vehicles'),
        ),
      ),
      GoRoute(
        path: AppRoutes.vehicleSavedSearches,
        builder: (_, _) => const VehicleSavedSearchesScreen(),
      ),
      GoRoute(
        path: AppRoutes.vehicleParts,
        builder: (_, _) => const VehiclePartsScreen(),
      ),
    ],
  );
}
