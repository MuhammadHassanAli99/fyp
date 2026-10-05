import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/profile_models.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'profile_store.dart';

class BusinessListScreen extends StatefulWidget {
  const BusinessListScreen({super.key});

  @override
  State<BusinessListScreen> createState() => _BusinessListScreenState();
}

class _BusinessListScreenState extends State<BusinessListScreen> {
  late final ProfileStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.profileStore;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _store.loadBusinesses();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.businessProfiles,
      actions: [
        IconButton(
          onPressed: () => context.push(AppRoutes.businessCreate),
          icon: const Icon(Icons.add),
        ),
      ],
      body: SignalBuilder(
        builder: (context) {
          final state = _store.businesses.value;
          final list = state.dataOrNull ?? const <BusinessSummary>[];
          if ((state.isIdle || state.isLoading) && list.isEmpty) {
            return const LoadingView();
          }
          if (state.hasError && list.isEmpty) {
            return EmptyState(
              title: 'Could not load businesses',
              subtitle: state.errorMessage,
              action: FilledButton(
                onPressed: () => _store.loadBusinesses(),
                child: Text(l10n.retry),
              ),
            );
          }
          if (list.isEmpty) {
            return EmptyState(
              title: 'No business profiles yet',
              subtitle: 'Create a company, dealer, agency, builder or gold shop.',
              action: FilledButton(
                onPressed: () => context.push(AppRoutes.businessCreate),
                child: Text(l10n.createBusiness),
              ),
            );
          }
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              for (final business in list)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.apartment_outlined, color: AppColors.gold),
                    title: Text(business.name),
                    subtitle: Text('${business.kindLabel}${business.role != null ? ' · ${business.role}' : ''}'),
                    trailing: business.verified
                        ? const Icon(Icons.verified, color: AppColors.success)
                        : const Icon(Icons.chevron_right, color: AppColors.goldMuted),
                    onTap: () => context.push('/business/${business.id}'),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class BusinessEditScreen extends StatefulWidget {
  const BusinessEditScreen({super.key, this.businessId});

  final int? businessId;

  @override
  State<BusinessEditScreen> createState() => _BusinessEditScreenState();
}

class _BusinessEditScreenState extends State<BusinessEditScreen> {
  final _name = TextEditingController();
  final _description = TextEditingController();
  String _kind = 'company';
  bool _saving = false;

  static const kinds = [
    ('company', 'Company'),
    ('dealer', 'Vehicle dealer'),
    ('agency', 'Property agency'),
    ('builder', 'Builder'),
    ('gold_shop', 'Gold shop'),
  ];

  @override
  void dispose() {
    _name.dispose();
    _description.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    final result = await ServiceLocator.instance.profileRepository.createBusiness({
      'kind': _kind,
      'legalName': _name.text.trim(),
      if (_description.text.trim().isNotEmpty) 'description': _description.text.trim(),
    });
    setState(() => _saving = false);
    result.when(
      success: (data) {
        ServiceLocator.instance.profileStore.loadBusinesses();
        final id = (data['id'] as num?)?.toInt();
        if (context.mounted) {
          if (id != null) {
            context.go('/business/$id');
          } else {
            context.pop();
          }
        }
      },
      failure: (message, _) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
        }
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.createBusiness,
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Business type', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              for (final kind in kinds)
                ChoiceChip(
                  label: Text(kind.$2),
                  selected: _kind == kind.$1,
                  onSelected: (_) => setState(() => _kind = kind.$1),
                ),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Business name'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _description,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'About'),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _saving || _name.text.trim().length < 2 ? null : _save,
            child: Text(l10n.save),
          ),
        ],
      ),
    );
  }
}

class BusinessDetailScreen extends StatefulWidget {
  const BusinessDetailScreen({super.key, required this.businessId});

  final int businessId;

  @override
  State<BusinessDetailScreen> createState() => _BusinessDetailScreenState();
}

class _BusinessDetailScreenState extends State<BusinessDetailScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final result = await ServiceLocator.instance.profileRepository.getBusiness(widget.businessId);
    if (!mounted) return;
    result.when(
      success: (data) => setState(() {
        _data = data;
        _loading = false;
      }),
      failure: (message, _) => setState(() {
        _error = message;
        _loading = false;
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: _data?['name'] as String? ?? 'Business',
      body: _loading
          ? const LoadingView()
          : _error != null
              ? EmptyState(title: _error!)
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text(
                      _data?['name'] as String? ?? '',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 4),
                    Text((_data?['kind'] as String? ?? '').replaceAll('_', ' ')),
                    if (_data?['verifiedAt'] != null)
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Row(
                          children: [
                            Icon(Icons.verified, color: AppColors.success, size: 18),
                            SizedBox(width: 6),
                            Text('Business verified'),
                          ],
                        ),
                      ),
                    if (_data?['description'] != null) ...[
                      const SizedBox(height: 16),
                      Text(_data!['description'] as String),
                    ],
                    if (_data?['address'] != null) ...[
                      const SizedBox(height: 12),
                      Text(_data!['address'] as String),
                    ],
                  ],
                ),
    );
  }
}
