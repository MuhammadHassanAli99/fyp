enum GuestFeature {
  browse,
  search,
  filter,
  viewListing,
  viewPublicSeller,
  viewMaps,
  changeCountry,
  changeLanguage,
  changeCurrency,
  changeLocation,
  changeTheme,
  sharePublicListing,
  compare,
  postListing,
  contactSeller,
  sendMessage,
  favorite,
  saveSearch,
  reviewSeller,
  subscribe,
  purchase,
  rent,
  makeOffer,
  account,
}

/// Capabilities a guest (or signed-out browser) may use without an account.
const Set<GuestFeature> kGuestAllowedFeatures = {
  GuestFeature.browse,
  GuestFeature.search,
  GuestFeature.filter,
  GuestFeature.viewListing,
  GuestFeature.viewPublicSeller,
  GuestFeature.viewMaps,
  GuestFeature.changeCountry,
  GuestFeature.changeLanguage,
  GuestFeature.changeCurrency,
  GuestFeature.changeLocation,
  GuestFeature.changeTheme,
  GuestFeature.sharePublicListing,
  GuestFeature.compare,
};

class GuestFeatureGuard {
  GuestFeatureGuard({
    required this._isGuest,
    required this._hasSession,
  });

  final bool Function() _isGuest;
  final bool Function() _hasSession;

  bool allows(GuestFeature feature) {
    if (kGuestAllowedFeatures.contains(feature)) return true;
    if (!_hasSession()) return false;
    if (_isGuest()) return false;
    return true;
  }
}
