import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';

class AppLocalizationsWrapper {
  static const LocalizationsDelegate<AppLocalizations> delegate =
      AppLocalizations.delegate;

  static const supportedLocales = AppLocalizations.supportedLocales;
}

extension AppLocalizationsX on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);
}
