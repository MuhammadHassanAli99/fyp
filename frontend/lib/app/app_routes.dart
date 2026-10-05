/// Route path constants. Kept out of `router.dart` so deferred screens can
/// navigate without creating a deferred-import cycle.
abstract final class AppRoutes {
  static const splash = '/';
  static const onboarding = '/onboarding';
  static const login = '/login';
  static const register = '/register';
  static const otp = '/auth/otp';
  static const mfa = '/mfa';
  static const unlock = '/auth/unlock';
  static const devices = '/security/devices';
  static const securityStatus = '/security/status';
  static const privacyCenter = '/security/privacy';
  static const oauthCallback = '/auth/callback';
  static const updateRequired = '/update-required';
  static const marketplaceSelect = '/marketplace';
  static const home = '/home';
  static const listing = '/listing/:id';
  static const listingManage = '/listing/:id/manage';
  static const listingPromotions = '/listing/:id/promotions';
  static const listingAnalytics = '/listing/:id/analytics';
  static const compare = '/compare';
  static const favorites = '/favorites';
  static const share = '/share/:token';
  static const chat = '/chat';
  static const conversation = '/chat/:uuid';
  static const callHistory = '/calls/history';
  static const callActive = '/calls/:uuid';
  static const settings = '/settings';
  static const seller = '/seller';
  static const analytics = '/analytics';
  static const profile = '/profile';
  static const profileEdit = '/profile/edit';
  static const profilePrivacy = '/profile/privacy';
  static const verification = '/profile/verification';
  static const businesses = '/profile/businesses';
  static const businessCreate = '/profile/businesses/new';
  static const businessDetail = '/business/:id';
  static const publicProfile = '/u/:username';
  static const draft = '/draft';
  static const post = '/post';
  static const propertyMap = '/property/map';
  static const propertySavedSearches = '/property/saved-searches';
  static const vehicleMap = '/vehicles/map';
  static const vehicleSavedSearches = '/vehicles/saved-searches';
  static const vehicleParts = '/vehicles/parts';
  static const search = '/search';
  static const searchSaved = '/search/saved';
  static const searchNearby = '/search/nearby';
  static const map = '/map';
  static const notifications = '/notifications';
  static const notificationSettings = '/notifications/settings';
  static const notificationDetail = '/notifications/:uuid';
  static const subscription = '/subscription';
  static const checkout = '/checkout/:orderUuid';
  static const aiSupport = '/ai/support';
  static const support = '/support';
  static const supportTicket = '/support/tickets/:uuid';
  static const supportArticle = '/support/kb/:slug';
  static const supportForumTopic = '/support/forum/:slug';
  static const advertise = '/ads';
  static const admin = '/admin';
  static const adminModule = '/admin/:module';
  static const listingReview = '/listing/:id/review';
  static const legal = '/legal';
  static const legalKind = '/legal/:kind';
  static String checkoutPath(String orderUuid) => '/checkout/$orderUuid';
  static String supportTicketPath(String uuid) => '/support/tickets/$uuid';
  static String supportArticlePath(String slug) => '/support/kb/$slug';
  static String supportForumPath(String slug) => '/support/forum/$slug';
  static String supportWith(SupportContextQuery query) {
    final q = query.toQuery();
    return q.isEmpty ? support : '$support?$q';
  }
}

class SupportContextQuery {
  const SupportContextQuery({
    this.marketplace,
    this.category,
    this.entityType,
    this.entityId,
    this.listingId,
    this.listingUuid,
    this.orderUuid,
    this.conversationUuid,
  });

  final String? marketplace;
  final String? category;
  final String? entityType;
  final String? entityId;
  final String? listingId;
  final String? listingUuid;
  final String? orderUuid;
  final String? conversationUuid;

  String toQuery() => Uri(
        queryParameters: {
          'marketplace': ?marketplace,
          'category': ?category,
          'entityType': ?entityType,
          'entityId': ?entityId,
          'listingId': ?listingId,
          'listingUuid': ?listingUuid,
          'orderUuid': ?orderUuid,
          'conversationUuid': ?conversationUuid,
        },
      ).query;
}
