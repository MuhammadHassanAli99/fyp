import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_ar.dart';
import 'app_localizations_de.dart';
import 'app_localizations_en.dart';
import 'app_localizations_es.dart';
import 'app_localizations_fr.dart';
import 'app_localizations_hi.dart';
import 'app_localizations_ja.dart';
import 'app_localizations_ru.dart';
import 'app_localizations_tr.dart';
import 'app_localizations_ur.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('ar'),
    Locale('de'),
    Locale('en'),
    Locale('es'),
    Locale('fr'),
    Locale('hi'),
    Locale('ja'),
    Locale('ru'),
    Locale('tr'),
    Locale('ur'),
    Locale('zh'),
  ];

  /// No description provided for @appName.
  ///
  /// In en, this message translates to:
  /// **'AURELIA'**
  String get appName;

  /// No description provided for @appTagline.
  ///
  /// In en, this message translates to:
  /// **'Gold · Property · Vehicles'**
  String get appTagline;

  /// No description provided for @splashHeadline.
  ///
  /// In en, this message translates to:
  /// **'Discover premium listings worldwide'**
  String get splashHeadline;

  /// No description provided for @splashSubtitle.
  ///
  /// In en, this message translates to:
  /// **'One account. Three marketplaces. Refined for global trade.'**
  String get splashSubtitle;

  /// No description provided for @getStarted.
  ///
  /// In en, this message translates to:
  /// **'Get Started'**
  String get getStarted;

  /// No description provided for @continueAsGuest.
  ///
  /// In en, this message translates to:
  /// **'Continue as Guest'**
  String get continueAsGuest;

  /// No description provided for @login.
  ///
  /// In en, this message translates to:
  /// **'Sign In'**
  String get login;

  /// No description provided for @register.
  ///
  /// In en, this message translates to:
  /// **'Create Account'**
  String get register;

  /// No description provided for @email.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @name.
  ///
  /// In en, this message translates to:
  /// **'Full Name'**
  String get name;

  /// No description provided for @selectCountry.
  ///
  /// In en, this message translates to:
  /// **'Select Country'**
  String get selectCountry;

  /// No description provided for @selectLanguage.
  ///
  /// In en, this message translates to:
  /// **'Select Language'**
  String get selectLanguage;

  /// No description provided for @selectCurrency.
  ///
  /// In en, this message translates to:
  /// **'Select Currency'**
  String get selectCurrency;

  /// No description provided for @continueLabel.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueLabel;

  /// No description provided for @chooseMarketplace.
  ///
  /// In en, this message translates to:
  /// **'Choose Your Marketplace'**
  String get chooseMarketplace;

  /// No description provided for @marketplaceSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Select where you want to browse and trade today.'**
  String get marketplaceSubtitle;

  /// No description provided for @goldMarketplace.
  ///
  /// In en, this message translates to:
  /// **'Gold'**
  String get goldMarketplace;

  /// No description provided for @goldDescription.
  ///
  /// In en, this message translates to:
  /// **'Bars, coins, jewelry & investment gold'**
  String get goldDescription;

  /// No description provided for @propertyMarketplace.
  ///
  /// In en, this message translates to:
  /// **'Property'**
  String get propertyMarketplace;

  /// No description provided for @propertyDescription.
  ///
  /// In en, this message translates to:
  /// **'Homes, land, offices & rentals'**
  String get propertyDescription;

  /// No description provided for @vehiclesMarketplace.
  ///
  /// In en, this message translates to:
  /// **'Vehicles'**
  String get vehiclesMarketplace;

  /// No description provided for @vehiclesDescription.
  ///
  /// In en, this message translates to:
  /// **'Cars, bikes, trucks & import/export'**
  String get vehiclesDescription;

  /// No description provided for @searchHint.
  ///
  /// In en, this message translates to:
  /// **'Search listings…'**
  String get searchHint;

  /// No description provided for @sort.
  ///
  /// In en, this message translates to:
  /// **'Sort'**
  String get sort;

  /// No description provided for @filter.
  ///
  /// In en, this message translates to:
  /// **'Filter'**
  String get filter;

  /// No description provided for @settings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settings;

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @currency.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get currency;

  /// No description provided for @country.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get country;

  /// No description provided for @theme.
  ///
  /// In en, this message translates to:
  /// **'Theme'**
  String get theme;

  /// No description provided for @themeLight.
  ///
  /// In en, this message translates to:
  /// **'Light'**
  String get themeLight;

  /// No description provided for @themeDark.
  ///
  /// In en, this message translates to:
  /// **'Dark'**
  String get themeDark;

  /// No description provided for @themeSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get themeSystem;

  /// No description provided for @measurement.
  ///
  /// In en, this message translates to:
  /// **'Measurement'**
  String get measurement;

  /// No description provided for @measurementMetric.
  ///
  /// In en, this message translates to:
  /// **'Metric'**
  String get measurementMetric;

  /// No description provided for @measurementImperial.
  ///
  /// In en, this message translates to:
  /// **'Imperial'**
  String get measurementImperial;

  /// No description provided for @compare.
  ///
  /// In en, this message translates to:
  /// **'Compare'**
  String get compare;

  /// No description provided for @addToCompare.
  ///
  /// In en, this message translates to:
  /// **'Add to Compare'**
  String get addToCompare;

  /// No description provided for @favorites.
  ///
  /// In en, this message translates to:
  /// **'Favorites'**
  String get favorites;

  /// No description provided for @chat.
  ///
  /// In en, this message translates to:
  /// **'Chat'**
  String get chat;

  /// No description provided for @profile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profile;

  /// No description provided for @seller.
  ///
  /// In en, this message translates to:
  /// **'Seller'**
  String get seller;

  /// No description provided for @myAds.
  ///
  /// In en, this message translates to:
  /// **'My ads'**
  String get myAds;

  /// No description provided for @guestRestrictionTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in required'**
  String get guestRestrictionTitle;

  /// No description provided for @guestRestrictionMessage.
  ///
  /// In en, this message translates to:
  /// **'Create an account or sign in to contact sellers, save favorites, or post listings.'**
  String get guestRestrictionMessage;

  /// No description provided for @signInToContinue.
  ///
  /// In en, this message translates to:
  /// **'Sign In to Continue'**
  String get signInToContinue;

  /// No description provided for @noListings.
  ///
  /// In en, this message translates to:
  /// **'No listings found'**
  String get noListings;

  /// No description provided for @noListingsHint.
  ///
  /// In en, this message translates to:
  /// **'Try adjusting your search or filters.'**
  String get noListingsHint;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// No description provided for @logout.
  ///
  /// In en, this message translates to:
  /// **'Sign Out'**
  String get logout;

  /// No description provided for @sortNewest.
  ///
  /// In en, this message translates to:
  /// **'Newest'**
  String get sortNewest;

  /// No description provided for @sortPriceAsc.
  ///
  /// In en, this message translates to:
  /// **'Price: Low to High'**
  String get sortPriceAsc;

  /// No description provided for @sortPriceDesc.
  ///
  /// In en, this message translates to:
  /// **'Price: High to Low'**
  String get sortPriceDesc;

  /// No description provided for @sortRelevance.
  ///
  /// In en, this message translates to:
  /// **'Relevance'**
  String get sortRelevance;

  /// No description provided for @aiCompareTitle.
  ///
  /// In en, this message translates to:
  /// **'AI Comparison'**
  String get aiCompareTitle;

  /// No description provided for @aiCompareHint.
  ///
  /// In en, this message translates to:
  /// **'Compare 2–4 items to unlock an AI report after the specs table.'**
  String get aiCompareHint;

  /// No description provided for @manualCompare.
  ///
  /// In en, this message translates to:
  /// **'Manual Compare'**
  String get manualCompare;

  /// No description provided for @listingDetails.
  ///
  /// In en, this message translates to:
  /// **'Listing Details'**
  String get listingDetails;

  /// No description provided for @contactSeller.
  ///
  /// In en, this message translates to:
  /// **'Contact Seller'**
  String get contactSeller;

  /// No description provided for @saveFavorite.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get saveFavorite;

  /// No description provided for @postListing.
  ///
  /// In en, this message translates to:
  /// **'Post Listing'**
  String get postListing;

  /// No description provided for @switchMarketplace.
  ///
  /// In en, this message translates to:
  /// **'Switch Marketplace'**
  String get switchMarketplace;

  /// No description provided for @searchCountry.
  ///
  /// In en, this message translates to:
  /// **'Search country'**
  String get searchCountry;

  /// No description provided for @yesThisIsMyCountry.
  ///
  /// In en, this message translates to:
  /// **'Yes, this is my country'**
  String get yesThisIsMyCountry;

  /// No description provided for @changeCountry.
  ///
  /// In en, this message translates to:
  /// **'Change country'**
  String get changeCountry;

  /// No description provided for @countryConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'Is this your country: {country}?'**
  String countryConfirmMessage(String country);

  /// No description provided for @chooseLocation.
  ///
  /// In en, this message translates to:
  /// **'Choose your location'**
  String get chooseLocation;

  /// No description provided for @locationOptionalHint.
  ///
  /// In en, this message translates to:
  /// **'GPS is optional. You can select a city manually or skip.'**
  String get locationOptionalHint;

  /// No description provided for @useCurrentLocation.
  ///
  /// In en, this message translates to:
  /// **'Use my current location'**
  String get useCurrentLocation;

  /// No description provided for @selectManually.
  ///
  /// In en, this message translates to:
  /// **'Select manually'**
  String get selectManually;

  /// No description provided for @skipLocation.
  ///
  /// In en, this message translates to:
  /// **'Skip'**
  String get skipLocation;

  /// No description provided for @selectRegion.
  ///
  /// In en, this message translates to:
  /// **'Province / State'**
  String get selectRegion;

  /// No description provided for @selectCity.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get selectCity;

  /// No description provided for @selectArea.
  ///
  /// In en, this message translates to:
  /// **'Area'**
  String get selectArea;

  /// No description provided for @detectingCountryLanguage.
  ///
  /// In en, this message translates to:
  /// **'Detecting country and language…'**
  String get detectingCountryLanguage;

  /// No description provided for @priceApproximate.
  ///
  /// In en, this message translates to:
  /// **'approximately'**
  String get priceApproximate;

  /// No description provided for @rateMayBeOutdated.
  ///
  /// In en, this message translates to:
  /// **'Exchange rate may be outdated'**
  String get rateMayBeOutdated;

  /// No description provided for @originalPriceLabel.
  ///
  /// In en, this message translates to:
  /// **'Original'**
  String get originalPriceLabel;

  /// No description provided for @offlineReadyHint.
  ///
  /// In en, this message translates to:
  /// **'Starting with saved settings. Some data may be out of date.'**
  String get offlineReadyHint;

  /// No description provided for @editProfile.
  ///
  /// In en, this message translates to:
  /// **'Edit profile'**
  String get editProfile;

  /// No description provided for @verification.
  ///
  /// In en, this message translates to:
  /// **'Verification'**
  String get verification;

  /// No description provided for @businessProfiles.
  ///
  /// In en, this message translates to:
  /// **'Business profiles'**
  String get businessProfiles;

  /// No description provided for @privacy.
  ///
  /// In en, this message translates to:
  /// **'Privacy'**
  String get privacy;

  /// No description provided for @displayName.
  ///
  /// In en, this message translates to:
  /// **'Display name'**
  String get displayName;

  /// No description provided for @username.
  ///
  /// In en, this message translates to:
  /// **'Username'**
  String get username;

  /// No description provided for @bio.
  ///
  /// In en, this message translates to:
  /// **'Bio'**
  String get bio;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @createBusiness.
  ///
  /// In en, this message translates to:
  /// **'Create business'**
  String get createBusiness;

  /// No description provided for @sellerIdentity.
  ///
  /// In en, this message translates to:
  /// **'Sell as'**
  String get sellerIdentity;

  /// No description provided for @notifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notifications;

  /// No description provided for @notificationsAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get notificationsAll;

  /// No description provided for @notificationsUnread.
  ///
  /// In en, this message translates to:
  /// **'Unread'**
  String get notificationsUnread;

  /// No description provided for @notificationsMessages.
  ///
  /// In en, this message translates to:
  /// **'Messages'**
  String get notificationsMessages;

  /// No description provided for @notificationsSecurity.
  ///
  /// In en, this message translates to:
  /// **'Security'**
  String get notificationsSecurity;

  /// No description provided for @notificationsPayments.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get notificationsPayments;

  /// No description provided for @notificationsSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get notificationsSystem;

  /// No description provided for @notificationsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No notifications yet'**
  String get notificationsEmpty;

  /// No description provided for @notificationsEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Account, marketplace and message alerts will appear here.'**
  String get notificationsEmptyHint;

  /// No description provided for @notificationsLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading notifications…'**
  String get notificationsLoading;

  /// No description provided for @notificationsLoadError.
  ///
  /// In en, this message translates to:
  /// **'Could not load notifications'**
  String get notificationsLoadError;

  /// No description provided for @markAllRead.
  ///
  /// In en, this message translates to:
  /// **'Mark all read'**
  String get markAllRead;

  /// No description provided for @notificationSettings.
  ///
  /// In en, this message translates to:
  /// **'Notification settings'**
  String get notificationSettings;

  /// No description provided for @openNotification.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get openNotification;

  /// No description provided for @quietHours.
  ///
  /// In en, this message translates to:
  /// **'Quiet hours'**
  String get quietHours;

  /// No description provided for @quietHoursAllowUrgent.
  ///
  /// In en, this message translates to:
  /// **'Allow security alerts during quiet hours'**
  String get quietHoursAllowUrgent;

  /// No description provided for @channelPreferences.
  ///
  /// In en, this message translates to:
  /// **'Channels'**
  String get channelPreferences;

  /// No description provided for @channelPush.
  ///
  /// In en, this message translates to:
  /// **'Push'**
  String get channelPush;

  /// No description provided for @channelInApp.
  ///
  /// In en, this message translates to:
  /// **'In-app'**
  String get channelInApp;

  /// No description provided for @channelEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get channelEmail;

  /// No description provided for @channelSms.
  ///
  /// In en, this message translates to:
  /// **'SMS'**
  String get channelSms;

  /// No description provided for @securityNotificationsLocked.
  ///
  /// In en, this message translates to:
  /// **'Security and transactional alerts stay on.'**
  String get securityNotificationsLocked;

  /// No description provided for @favoritesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No saved listings yet'**
  String get favoritesEmpty;

  /// No description provided for @favoritesEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Tap the heart on a listing to save it here.'**
  String get favoritesEmptyHint;

  /// No description provided for @favoritesLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading favorites…'**
  String get favoritesLoading;

  /// No description provided for @favoritesLoadError.
  ///
  /// In en, this message translates to:
  /// **'Could not load favorites'**
  String get favoritesLoadError;

  /// No description provided for @collections.
  ///
  /// In en, this message translates to:
  /// **'Collections'**
  String get collections;

  /// No description provided for @newCollection.
  ///
  /// In en, this message translates to:
  /// **'New collection'**
  String get newCollection;

  /// No description provided for @renameCollection.
  ///
  /// In en, this message translates to:
  /// **'Rename collection'**
  String get renameCollection;

  /// No description provided for @deleteCollection.
  ///
  /// In en, this message translates to:
  /// **'Delete collection'**
  String get deleteCollection;

  /// No description provided for @collectionName.
  ///
  /// In en, this message translates to:
  /// **'Collection name'**
  String get collectionName;

  /// No description provided for @newFolder.
  ///
  /// In en, this message translates to:
  /// **'New folder'**
  String get newFolder;

  /// No description provided for @shareCollection.
  ///
  /// In en, this message translates to:
  /// **'Share collection'**
  String get shareCollection;

  /// No description provided for @shareListing.
  ///
  /// In en, this message translates to:
  /// **'Share listing'**
  String get shareListing;

  /// No description provided for @shareComparison.
  ///
  /// In en, this message translates to:
  /// **'Share comparison'**
  String get shareComparison;

  /// No description provided for @favoritesSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search saved listings…'**
  String get favoritesSearchHint;

  /// No description provided for @sortOldest.
  ///
  /// In en, this message translates to:
  /// **'Oldest'**
  String get sortOldest;

  /// No description provided for @unavailableListing.
  ///
  /// In en, this message translates to:
  /// **'Unavailable'**
  String get unavailableListing;

  /// No description provided for @expiredListing.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get expiredListing;

  /// No description provided for @soldListing.
  ///
  /// In en, this message translates to:
  /// **'Sold'**
  String get soldListing;

  /// No description provided for @rentedListing.
  ///
  /// In en, this message translates to:
  /// **'Rented'**
  String get rentedListing;

  /// No description provided for @archivedListing.
  ///
  /// In en, this message translates to:
  /// **'Archived'**
  String get archivedListing;

  /// No description provided for @allMarketplaces.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get allMarketplaces;

  /// No description provided for @unfiled.
  ///
  /// In en, this message translates to:
  /// **'All saved'**
  String get unfiled;

  /// No description provided for @subscription.
  ///
  /// In en, this message translates to:
  /// **'Subscription'**
  String get subscription;

  /// No description provided for @subscriptionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Plans, usage, invoices and upgrades'**
  String get subscriptionSubtitle;

  /// No description provided for @subscriptionLoadError.
  ///
  /// In en, this message translates to:
  /// **'Could not load your subscription'**
  String get subscriptionLoadError;

  /// No description provided for @subscriptionOverLimit.
  ///
  /// In en, this message translates to:
  /// **'You are over a plan limit'**
  String get subscriptionOverLimit;

  /// No description provided for @subscriptionOverLimitHint.
  ///
  /// In en, this message translates to:
  /// **'Existing listings stay live. New creation is blocked until you upgrade or reduce usage.'**
  String get subscriptionOverLimitHint;

  /// No description provided for @choosePlan.
  ///
  /// In en, this message translates to:
  /// **'Choose a plan'**
  String get choosePlan;

  /// No description provided for @billingMonthly.
  ///
  /// In en, this message translates to:
  /// **'Monthly'**
  String get billingMonthly;

  /// No description provided for @billingYearly.
  ///
  /// In en, this message translates to:
  /// **'Yearly'**
  String get billingYearly;

  /// No description provided for @currentPlan.
  ///
  /// In en, this message translates to:
  /// **'Current plan'**
  String get currentPlan;

  /// No description provided for @status.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get status;

  /// No description provided for @renewsOn.
  ///
  /// In en, this message translates to:
  /// **'Renews on'**
  String get renewsOn;

  /// No description provided for @pendingChange.
  ///
  /// In en, this message translates to:
  /// **'Scheduled change'**
  String get pendingChange;

  /// No description provided for @cancelsAtPeriodEnd.
  ///
  /// In en, this message translates to:
  /// **'Cancels at the end of this period'**
  String get cancelsAtPeriodEnd;

  /// No description provided for @resumePlan.
  ///
  /// In en, this message translates to:
  /// **'Keep my plan'**
  String get resumePlan;

  /// No description provided for @cancelPlan.
  ///
  /// In en, this message translates to:
  /// **'Cancel at period end'**
  String get cancelPlan;

  /// No description provided for @cancelPlanHint.
  ///
  /// In en, this message translates to:
  /// **'You keep access until the current period ends. Existing listings are not deleted.'**
  String get cancelPlanHint;

  /// No description provided for @upgradePlan.
  ///
  /// In en, this message translates to:
  /// **'Upgrade'**
  String get upgradePlan;

  /// No description provided for @downgradePlan.
  ///
  /// In en, this message translates to:
  /// **'Switch at period end'**
  String get downgradePlan;

  /// No description provided for @selectPlan.
  ///
  /// In en, this message translates to:
  /// **'Select'**
  String get selectPlan;

  /// No description provided for @freePlan.
  ///
  /// In en, this message translates to:
  /// **'Free'**
  String get freePlan;

  /// No description provided for @planChangeScheduled.
  ///
  /// In en, this message translates to:
  /// **'The new plan takes effect at the end of this period.'**
  String get planChangeScheduled;

  /// No description provided for @planUpdated.
  ///
  /// In en, this message translates to:
  /// **'Your plan is updated.'**
  String get planUpdated;

  /// No description provided for @subscriptionUsage.
  ///
  /// In en, this message translates to:
  /// **'Usage'**
  String get subscriptionUsage;

  /// No description provided for @subscriptionInvoices.
  ///
  /// In en, this message translates to:
  /// **'Invoices'**
  String get subscriptionInvoices;

  /// No description provided for @analyticsUpgradeHint.
  ///
  /// In en, this message translates to:
  /// **'Upgrade to unlock unique viewers, conversion and daily series.'**
  String get analyticsUpgradeHint;

  /// No description provided for @checkoutTitle.
  ///
  /// In en, this message translates to:
  /// **'Checkout'**
  String get checkoutTitle;

  /// No description provided for @checkoutLoadError.
  ///
  /// In en, this message translates to:
  /// **'Could not load this payment'**
  String get checkoutLoadError;

  /// No description provided for @checkoutAuthoritativeHint.
  ///
  /// In en, this message translates to:
  /// **'Only the server payment status is authoritative. This screen is not proof of payment.'**
  String get checkoutAuthoritativeHint;

  /// No description provided for @checkoutContinueProvider.
  ///
  /// In en, this message translates to:
  /// **'Continue with provider'**
  String get checkoutContinueProvider;

  /// No description provided for @checkoutUploadProof.
  ///
  /// In en, this message translates to:
  /// **'Upload transfer proof'**
  String get checkoutUploadProof;

  /// No description provided for @checkoutCompleteTest.
  ///
  /// In en, this message translates to:
  /// **'Complete test payment'**
  String get checkoutCompleteTest;

  /// No description provided for @checkoutPaidContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get checkoutPaidContinue;

  /// No description provided for @checkoutPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get checkoutPaid;

  /// No description provided for @checkoutFailed.
  ///
  /// In en, this message translates to:
  /// **'Payment failed'**
  String get checkoutFailed;

  /// No description provided for @checkoutPending.
  ///
  /// In en, this message translates to:
  /// **'Waiting for confirmation'**
  String get checkoutPending;

  /// No description provided for @checkoutChargedAs.
  ///
  /// In en, this message translates to:
  /// **'Charged as {amount} {currency}'**
  String checkoutChargedAs(String amount, String currency);

  /// No description provided for @checkoutTax.
  ///
  /// In en, this message translates to:
  /// **'Tax'**
  String get checkoutTax;

  /// No description provided for @checkoutMethod.
  ///
  /// In en, this message translates to:
  /// **'Method'**
  String get checkoutMethod;

  /// No description provided for @checkoutProvider.
  ///
  /// In en, this message translates to:
  /// **'Provider'**
  String get checkoutProvider;

  /// No description provided for @checkoutBankTransfer.
  ///
  /// In en, this message translates to:
  /// **'Bank transfer'**
  String get checkoutBankTransfer;

  /// No description provided for @checkoutBankReference.
  ///
  /// In en, this message translates to:
  /// **'Reference'**
  String get checkoutBankReference;

  /// No description provided for @checkoutProofNotPaid.
  ///
  /// In en, this message translates to:
  /// **'A screenshot is evidence only. Staff confirm the bank credit before this order is marked paid.'**
  String get checkoutProofNotPaid;

  /// No description provided for @checkoutInvoice.
  ///
  /// In en, this message translates to:
  /// **'Invoice'**
  String get checkoutInvoice;

  /// No description provided for @legalDocuments.
  ///
  /// In en, this message translates to:
  /// **'Legal documents'**
  String get legalDocuments;

  /// No description provided for @acceptLegal.
  ///
  /// In en, this message translates to:
  /// **'I accept this document'**
  String get acceptLegal;

  /// No description provided for @legalAccepted.
  ///
  /// In en, this message translates to:
  /// **'Acceptance recorded'**
  String get legalAccepted;

  /// No description provided for @dropFilesHint.
  ///
  /// In en, this message translates to:
  /// **'Drop files here or browse. Invalid files are not uploaded.'**
  String get dropFilesHint;

  /// No description provided for @browseFiles.
  ///
  /// In en, this message translates to:
  /// **'Browse files'**
  String get browseFiles;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) => <String>[
    'ar',
    'de',
    'en',
    'es',
    'fr',
    'hi',
    'ja',
    'ru',
    'tr',
    'ur',
    'zh',
  ].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'ar':
      return AppLocalizationsAr();
    case 'de':
      return AppLocalizationsDe();
    case 'en':
      return AppLocalizationsEn();
    case 'es':
      return AppLocalizationsEs();
    case 'fr':
      return AppLocalizationsFr();
    case 'hi':
      return AppLocalizationsHi();
    case 'ja':
      return AppLocalizationsJa();
    case 'ru':
      return AppLocalizationsRu();
    case 'tr':
      return AppLocalizationsTr();
    case 'ur':
      return AppLocalizationsUr();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
