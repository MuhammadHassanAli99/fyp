import 'package:collection/collection.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'settings_store.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final SettingsStore _store;
  late final TextEditingController _postalCtrl;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.settingsStore;
    _postalCtrl = TextEditingController(text: _store.postalCode.value ?? '');
    _store.loadCatalogs();
  }

  @override
  void dispose() {
    _postalCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.settings,
      body: SignalBuilder(
        builder: (context) {
          final countries = _store.countries.value.dataOrNull ?? const [];
          final languages = _store.languages.value.dataOrNull ?? const [];
          final currencies = _store.currencies.value.dataOrNull ?? const [];
          final regions = _store.regions.value.dataOrNull ?? const [];
          final cities = _store.cities.value.dataOrNull ?? const [];
          final loading = _store.countries.value.isLoading;

          if (loading && countries.isEmpty) {
            return const LoadingView(message: 'Loading settings…');
          }

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _sectionTitle('Region & language'),
              _dropdownTile<String>(
                title: l10n.country,
                value: _ensureValue(
                  _store.countryCode.value,
                  countries.map((e) => e.code),
                ),
                items: [
                  for (final c in countries)
                    DropdownMenuItem(
                      value: c.code,
                      child: Text(c.displayName),
                    ),
                ],
                onChanged: (v) {
                  if (v != null) _store.setCountry(v);
                },
              ),
              _dropdownTile<String>(
                title: l10n.language,
                subtitle: _store.isRtl ? 'RTL layout enabled' : null,
                value: _ensureValue(
                  _store.languageCode.value,
                  languages.map((e) => e.code),
                ),
                items: [
                  for (final l in languages)
                    DropdownMenuItem(
                      value: l.code,
                      child: Text(l.displayName),
                    ),
                ],
                onChanged: (v) {
                  if (v != null) _store.setLanguage(v);
                },
              ),
              _dropdownTile<String>(
                title: l10n.currency,
                value: _ensureValue(
                  _store.currencyCode.value,
                  currencies.map((e) => e.code),
                ),
                items: [
                  for (final c in currencies)
                    DropdownMenuItem(
                      value: c.code,
                      child: Text(c.displayName),
                    ),
                ],
                onChanged: (v) {
                  if (v != null) _store.setCurrency(v);
                },
              ),
              SwitchListTile(
                title: const Text('Show original price'),
                subtitle: const Text(
                  'When converted, also show the seller’s currency',
                ),
                value: _store.showOriginalPrice.value,
                onChanged: _store.setShowOriginalPrice,
              ),
              if (_store.timezone.value != null)
                ListTile(
                  title: const Text('Timezone'),
                  subtitle: Text(_store.timezone.value!),
                ),
              ListTile(
                title: const Text('Date & time format'),
                subtitle: Text(
                  '${_store.dateFormat.value} · ${_store.timeFormat.value}',
                ),
              ),
              const Divider(height: 32),
              _sectionTitle('Location'),
              ListTile(
                leading: _store.locating.value
                    ? const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.my_location),
                title: const Text('Use GPS'),
                subtitle: Text(
                  _store.statusMessage.value ??
                      'Detect country, city and postal code',
                ),
                onTap: _store.locating.value ? null : _store.detectLocation,
              ),
              _dropdownTile<int?>(
                title: 'Province / State',
                value: _store.regionId.value,
                items: [
                  const DropdownMenuItem<int?>(
                    value: null,
                    child: Text('Any / not set'),
                  ),
                  for (final r in regions)
                    DropdownMenuItem<int?>(
                      value: r.id,
                      child: Text(r.name),
                    ),
                ],
                onChanged: (id) {
                  final region =
                      regions.where((e) => e.id == id).firstOrNull;
                  _store.setRegion(region);
                },
              ),
              _dropdownTile<int?>(
                title: 'City',
                value: _store.cityId.value,
                items: [
                  const DropdownMenuItem<int?>(
                    value: null,
                    child: Text('Any / not set'),
                  ),
                  for (final c in cities)
                    DropdownMenuItem<int?>(
                      value: c.id,
                      child: Text(c.name),
                    ),
                ],
                onChanged: (id) {
                  final city = cities.where((e) => e.id == id).firstOrNull;
                  _store.setCity(city);
                },
              ),
              ListTile(
                title: const Text('Postal code'),
                subtitle: TextField(
                  controller: _postalCtrl,
                  decoration: const InputDecoration(
                    hintText: 'Postal / ZIP code',
                    isDense: true,
                  ),
                  onChanged: _store.setPostalCode,
                ),
              ),
              const Divider(height: 32),
              _sectionTitle('Appearance'),
              _dropdownTile<String>(
                title: l10n.theme,
                value: _store.themeMode.value,
                items: [
                  DropdownMenuItem(
                    value: 'light',
                    child: Text(l10n.themeLight),
                  ),
                  DropdownMenuItem(
                    value: 'dark',
                    child: Text(l10n.themeDark),
                  ),
                  DropdownMenuItem(
                    value: 'system',
                    child: Text(l10n.themeSystem),
                  ),
                ],
                onChanged: (v) {
                  if (v != null) _store.setThemeMode(v);
                },
              ),
              _dropdownTile<String>(
                title: l10n.measurement,
                value: _store.measurement.value,
                items: [
                  DropdownMenuItem(
                    value: 'metric',
                    child: Text(l10n.measurementMetric),
                  ),
                  DropdownMenuItem(
                    value: 'imperial',
                    child: Text(l10n.measurementImperial),
                  ),
                ],
                onChanged: (v) {
                  if (v != null) _store.setMeasurement(v);
                },
              ),
              const Divider(height: 32),
              _sectionTitle('Security'),
              _sectionTitle('Support'),
              ListTile(
                leading: const Icon(Icons.support_agent_outlined),
                title: const Text('Help & Support'),
                subtitle: const Text('Tickets, live chat, knowledge base and forum'),
                onTap: () => context.push(AppRoutes.support),
              ),
              ListTile(
                leading: const Icon(Icons.smart_toy_outlined),
                title: const Text('AI assistant'),
                subtitle: const Text('In-app assistant with approved tools'),
                onTap: () => context.push(AppRoutes.aiSupport),
              ),
              ListTile(
                leading: const Icon(Icons.notifications_outlined),
                title: Text(l10n.notifications),
                subtitle: Text(l10n.notificationSettings),
                onTap: () => context.push(AppRoutes.notifications),
              ),
              ListTile(
                leading: const Icon(Icons.tune),
                title: Text(l10n.notificationSettings),
                onTap: () => context.push(AppRoutes.notificationSettings),
              ),
              _BiometricTile(),
              ListTile(
                leading: const Icon(Icons.devices_outlined),
                title: const Text('Devices & sessions'),
                onTap: () => context.push(AppRoutes.devices),
              ),
              ListTile(
                leading: const Icon(Icons.security_outlined),
                title: const Text('Account security'),
                onTap: () => context.push(AppRoutes.securityStatus),
              ),
              ListTile(
                leading: const Icon(Icons.privacy_tip_outlined),
                title: const Text('Privacy & data rights'),
                onTap: () => context.push(AppRoutes.privacyCenter),
              ),
              ListTile(
                leading: const Icon(Icons.swap_horiz),
                title: Text(l10n.switchMarketplace),
                onTap: () {
                  ServiceLocator.instance.compareStore.clear();
                  context.go(AppRoutes.marketplaceSelect);
                },
              ),
              ListTile(
                leading: const Icon(Icons.gavel_outlined),
                title: Text(l10n.legalDocuments),
                subtitle: const Text('Terms, privacy, seller and marketplace policies'),
                onTap: () => context.push(AppRoutes.legal),
              ),
              ListTile(
                leading: const Icon(Icons.logout),
                title: Text(l10n.logout),
                onTap: () async {
                  await ServiceLocator.instance.authRepository.logout();
                  ServiceLocator.instance.routerRefresh.refresh();
                  if (context.mounted) context.go(AppRoutes.login);
                },
              ),
              const SizedBox(height: 24),
              Text(
                'Guest mode: browse freely. Sign in to contact sellers, post ads, or save favorites.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _sectionTitle(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        text,
        style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
      ),
    );
  }

  String? _ensureValue(String? current, Iterable<String> options) {
    if (current == null) return null;
    final list = options.toList();
    if (list.isEmpty) return current;
    return list.contains(current) ? current : list.first;
  }

  Widget _dropdownTile<T>({
    required String title,
    String? subtitle,
    required T? value,
    required List<DropdownMenuItem<T>> items,
    required ValueChanged<T?> onChanged,
  }) {
    if (items.isEmpty) {
      return ListTile(
        title: Text(title),
        subtitle: Text(subtitle ?? 'Loading…'),
      );
    }
    // DropdownButton requires the value to exist in items.
    final values = items.map((e) => e.value).toSet();
    final safeValue = values.contains(value) ? value : null;

    return ListTile(
      title: Text(title),
      subtitle: subtitle != null ? Text(subtitle) : null,
      trailing: DropdownButton<T>(
        value: safeValue,
        items: items,
        onChanged: onChanged,
      ),
    );
  }
}

class _BiometricTile extends StatefulWidget {
  @override
  State<_BiometricTile> createState() => _BiometricTileState();
}

class _BiometricTileState extends State<_BiometricTile> {
  bool _available = false;
  bool _enabled = false;
  bool _busy = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final biometric = ServiceLocator.instance.biometricService;
    final available = await biometric.isAvailable;
    final enabled = await biometric.isEnabled;
    if (!mounted) return;
    setState(() {
      _available = available;
      _enabled = enabled;
      _busy = false;
    });
  }

  Future<void> _toggle(bool value) async {
    final biometric = ServiceLocator.instance.biometricService;
    if (value) {
      final ok = await biometric.authenticate(
        reason: 'Confirm to enable fingerprint / Windows Hello unlock',
      );
      if (!ok) return;
    }
    await biometric.setEnabled(value);
    if (!mounted) return;
    setState(() => _enabled = value);
  }

  @override
  Widget build(BuildContext context) {
    if (_busy) {
      return const ListTile(
        leading: Icon(Icons.fingerprint),
        title: Text('Fingerprint / Windows Hello'),
        trailing: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    return SwitchListTile(
      secondary: const Icon(Icons.fingerprint),
      title: const Text('Fingerprint / Windows Hello'),
      subtitle: Text(
        _available
            ? 'Unlock the app with this device after you sign in'
            : 'Not available on this device',
      ),
      value: _enabled && _available,
      onChanged: _available ? _toggle : null,
    );
  }
}
