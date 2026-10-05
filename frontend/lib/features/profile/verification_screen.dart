import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'profile_store.dart';

class VerificationScreen extends StatefulWidget {
  const VerificationScreen({super.key});

  @override
  State<VerificationScreen> createState() => _VerificationScreenState();
}

class _VerificationScreenState extends State<VerificationScreen> {
  late final ProfileStore _store;
  String _docType = 'government_id';
  bool _busy = false;

  static const types = [
    ('government_id', 'Government ID'),
    ('passport', 'Passport'),
    ('driving_license', 'Driving licence'),
    ('business_license', 'Business licence'),
  ];

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.profileStore;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _store.loadVerification();
    });
  }

  Future<void> _submit() async {
    setState(() => _busy = true);
    final started = await ServiceLocator.instance.profileRepository.startVerification(
      docType: _docType,
    );
    await started.when(
      success: (data) async {
        final uuid = data['uuid'] as String?;
        if (uuid == null) return;
        final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
        if (picked == null) return;
        final bytes = await picked.readAsBytes();
        final attached = await ServiceLocator.instance.profileRepository.uploadVerificationDocument(
          requestUuid: uuid,
          bytes: bytes,
          mimeType: picked.mimeType ?? 'image/jpeg',
          filename: picked.name,
        );
        await attached.when(
          success: (_) => ServiceLocator.instance.profileRepository.submitVerification(uuid),
          failure: (message, _) async {
            if (mounted) {
              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
            }
          },
        );
      },
      failure: (message, _) async {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
        }
      },
    );
    setState(() => _busy = false);
    await _store.loadVerification();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.verification,
      body: SignalBuilder(
        builder: (context) {
          final snap = _store.verification.value.dataOrNull;
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(
                'Verification is reviewed by the platform. The app cannot mark you as verified.',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              Text('Status: ${snap?.overallStatus ?? 'NOT_STARTED'}'),
              if (snap?.identityVerified == true)
                const ListTile(
                  leading: Icon(Icons.verified, color: AppColors.success),
                  title: Text('Identity verified'),
                ),
              if (snap?.businessVerified == true)
                const ListTile(
                  leading: Icon(Icons.verified, color: AppColors.success),
                  title: Text('Business verified'),
                ),
              const SizedBox(height: 16),
              Wrap(
                spacing: 8,
                children: [
                  for (final type in types)
                    ChoiceChip(
                      label: Text(type.$2),
                      selected: _docType == type.$1,
                      onSelected: (_) => setState(() => _docType = type.$1),
                    ),
                ],
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: const Text('Upload document and submit'),
              ),
              const SizedBox(height: 24),
              for (final request in snap?.requests ?? const [])
                ListTile(
                  title: Text('${request['docType']} · ${request['status']}'),
                  subtitle: Text(request['createdAt'] as String? ?? ''),
                ),
            ],
          );
        },
      ),
    );
  }
}

class PrivacyScreen extends StatefulWidget {
  const PrivacyScreen({super.key});

  @override
  State<PrivacyScreen> createState() => _PrivacyScreenState();
}

class _PrivacyScreenState extends State<PrivacyScreen> {
  late final ProfileStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.profileStore;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _store.loadPrivacy();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.privacy,
      body: SignalBuilder(
        builder: (context) {
          final settings = _store.privacy.value.dataOrNull;
          if (_store.privacy.value.hasError && settings == null) {
            return EmptyState(
              title: 'Could not load privacy settings',
              subtitle: _store.privacy.value.errorMessage,
              action: FilledButton(
                onPressed: () => _store.loadPrivacy(),
                child: Text(l10n.retry),
              ),
            );
          }
          if (settings == null) return const LoadingView();
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('Who can see your profile'),
              const SizedBox(height: 8),
              RadioGroup<String>(
                groupValue: settings.visibility,
                onChanged: (value) {
                  if (value != null) {
                    _store.savePrivacy(settings.copyWith(visibility: value));
                  }
                },
                child: Column(
                  children: [
                    for (final option in [
                      ('public', 'Public'),
                      ('registered', 'Registered users'),
                      ('private', 'Private'),
                    ])
                      RadioListTile<String>(
                        title: Text(option.$2),
                        value: option.$1,
                      ),
                  ],
                ),
              ),
              SwitchListTile(
                title: const Text('Show email'),
                value: settings.showEmail,
                onChanged: (value) => _store.savePrivacy(settings.copyWith(showEmail: value)),
              ),
              SwitchListTile(
                title: const Text('Show phone'),
                value: settings.showPhone,
                onChanged: (value) => _store.savePrivacy(settings.copyWith(showPhone: value)),
              ),
              SwitchListTile(
                title: const Text('Show location'),
                value: settings.showLocation,
                onChanged: (value) => _store.savePrivacy(settings.copyWith(showLocation: value)),
              ),
              SwitchListTile(
                title: const Text('Show listings'),
                value: settings.showListings,
                onChanged: (value) => _store.savePrivacy(settings.copyWith(showListings: value)),
              ),
              SwitchListTile(
                title: const Text('Show reviews'),
                value: settings.showReviews,
                onChanged: (value) => _store.savePrivacy(settings.copyWith(showReviews: value)),
              ),
              const Divider(height: 32),
              ListTile(
                leading: const Icon(Icons.privacy_tip_outlined),
                title: const Text('Data rights (GDPR / CCPA)'),
                subtitle: const Text('Export, correct, opt out, or delete your data'),
                onTap: () => context.push(AppRoutes.privacyCenter),
              ),
            ],
          );
        },
      ),
    );
  }
}
