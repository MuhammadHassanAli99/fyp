import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../data/models/locale_models.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'locale_onboarding_store.dart';

class LocaleOnboardingScreen extends StatefulWidget {
  const LocaleOnboardingScreen({super.key});

  @override
  State<LocaleOnboardingScreen> createState() => _LocaleOnboardingScreenState();
}

class _LocaleOnboardingScreenState extends State<LocaleOnboardingScreen> {
  late final LocaleOnboardingStore _store;

  @override
  void initState() {
    super.initState();
    _store = LocaleOnboardingStore(ServiceLocator.instance.settingsRepository);
    _store.load();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      showBack: false,
      showSellFab: false,
      title: l10n.appName,
      body: SignalBuilder(
        builder: (context) {
          final countries = _store.countries.value;
          if (countries.isLoading || _store.detecting.value) {
            return LoadingView(
              message: _store.detecting.value
                  ? l10n.detectingCountryLanguage
                  : null,
            );
          }

          return SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 520),
                child: switch (_store.step.value) {
                  0 => _countryStep(context, l10n),
                  1 => _languageStep(context, l10n),
                  2 => _currencyStep(context, l10n),
                  _ => _locationStep(context, l10n),
                },
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _countryStep(BuildContext context, dynamic l10n) {
    final suggestion = _store.suggestion;
    final selected = _store.selectedCountry.value;
    final match = _store.filteredCountries
        .where((c) => c.code == selected)
        .toList();
    final label = match.isNotEmpty ? match.first.displayName : selected;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.selectCountry, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(l10n.countryConfirmMessage(label ?? suggestion?.iso2 ?? '')),
        const SizedBox(height: 16),
        TextField(
          decoration: InputDecoration(labelText: l10n.searchCountry),
          onChanged: (v) => _store.countryQuery.value = v,
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 280,
          child: ListView.builder(
            itemCount: _store.filteredCountries.length,
            itemBuilder: (context, index) {
              final country = _store.filteredCountries[index];
              final selectedCode = _store.selectedCountry.value == country.code;
              return ListTile(
                title: Text(country.displayName),
                selected: selectedCode,
                trailing: selectedCode ? const Icon(Icons.check) : null,
                onTap: () => _store.onCountryChanged(country.code),
              );
            },
          ),
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: () async {
            await _store.confirmSuggestedCountry();
          },
          child: Text(l10n.yesThisIsMyCountry),
        ),
      ],
    );
  }

  Widget _languageStep(BuildContext context, dynamic l10n) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.selectLanguage, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        _dropdown<String>(
          label: l10n.selectLanguage,
          value: _store.selectedLanguage.value,
          items: _languageItems(_store.languages.value),
          onChanged: (v) => _store.selectedLanguage.value = v,
        ),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: _store.goCurrency,
          child: Text(l10n.continueLabel),
        ),
      ],
    );
  }

  Widget _currencyStep(BuildContext context, dynamic l10n) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.selectCurrency, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 16),
        _dropdown<String>(
          label: l10n.selectCurrency,
          value: _store.selectedCurrency.value,
          items: _currencyItems(_store.currencies.value),
          onChanged: (v) => _store.selectedCurrency.value = v,
        ),
        const SizedBox(height: 16),
        _dropdown<String>(
          label: l10n.theme,
          value: _store.selectedTheme.value,
          items: [
            DropdownMenuItem(value: 'light', child: Text(l10n.themeLight)),
            DropdownMenuItem(value: 'dark', child: Text(l10n.themeDark)),
            DropdownMenuItem(value: 'system', child: Text(l10n.themeSystem)),
          ],
          onChanged: (v) {
            if (v != null) _store.selectedTheme.value = v;
          },
        ),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: () => _store.goLocation(),
          child: Text(l10n.continueLabel),
        ),
      ],
    );
  }

  Widget _locationStep(BuildContext context, dynamic l10n) {
    final regions = _store.regions.value.dataOrNull ?? const <RegionModel>[];
    final cities = _store.cities.value.dataOrNull ?? const <CityModel>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(l10n.chooseLocation, style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 8),
        Text(l10n.locationOptionalHint),
        const SizedBox(height: 16),
        FilledButton.tonal(
          onPressed: _store.locating.value ? null : _store.useGps,
          child: Text(
            _store.locating.value ? l10n.detectingCountryLanguage : l10n.useCurrentLocation,
          ),
        ),
        const SizedBox(height: 16),
        _dropdown<RegionModel>(
          label: l10n.selectRegion,
          value: _store.selectedRegion.value,
          items: regions
              .map((r) => DropdownMenuItem(value: r, child: Text(r.name)))
              .toList(),
          onChanged: _store.selectRegion,
        ),
        const SizedBox(height: 12),
        _dropdown<CityModel>(
          label: l10n.selectCity,
          value: _store.selectedCity.value,
          items: cities
              .map((c) => DropdownMenuItem(value: c, child: Text(c.name)))
              .toList(),
          onChanged: _store.selectCity,
        ),
        if (_store.detectNote.value != null) ...[
          const SizedBox(height: 12),
          Text(_store.detectNote.value!, style: Theme.of(context).textTheme.bodySmall),
        ],
        const SizedBox(height: 24),
        FilledButton(
          onPressed: () async {
            await _store.saveAndContinue();
            if (context.mounted) context.go(AppRoutes.login);
          },
          child: Text(l10n.continueLabel),
        ),
        TextButton(
          onPressed: () async {
            await _store.saveAndContinue();
            if (context.mounted) context.go(AppRoutes.login);
          },
          child: Text(l10n.skipLocation),
        ),
      ],
    );
  }

  List<DropdownMenuItem<String>> _languageItems(
    AsyncState<List<LanguageModel>> state,
  ) {
    if (state case AsyncData(:final data)) {
      return data
          .map((l) => DropdownMenuItem(value: l.code, child: Text(l.displayName)))
          .toList();
    }
    return const [];
  }

  List<DropdownMenuItem<String>> _currencyItems(
    AsyncState<List<CurrencyModel>> state,
  ) {
    if (state case AsyncData(:final data)) {
      return data
          .map((c) => DropdownMenuItem(value: c.code, child: Text(c.displayName)))
          .toList();
    }
    return const [];
  }

  Widget _dropdown<T>({
    required String label,
    required T? value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
  }) {
    final values = items.map((e) => e.value).toSet();
    final safe = values.contains(value) ? value : null;
    return DropdownButtonFormField<T>(
      key: ValueKey('$label-$safe'),
      decoration: InputDecoration(labelText: label),
      initialValue: safe,
      items: items,
      onChanged: onChanged,
    );
  }
}
