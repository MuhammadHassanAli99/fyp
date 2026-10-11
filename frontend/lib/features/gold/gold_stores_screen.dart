import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../data/models/gold_models.dart';
import '../../shared/widgets/app_scaffold.dart';

class GoldStoresScreen extends StatefulWidget {
  const GoldStoresScreen({super.key});

  @override
  State<GoldStoresScreen> createState() => _GoldStoresScreenState();
}

class _GoldStoresScreenState extends State<GoldStoresScreen> {
  final _search = TextEditingController();
  AsyncState<GoldStoreListResult> _state = const AsyncIdle();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({String? q}) async {
    setState(() => _state = const AsyncLoading());
    final result = await ServiceLocator.instance.goldRepository.listStores(q: q);
    if (!mounted) return;
    result.when(
      success: (data) => setState(() => _state = AsyncData(data)),
      failure: (message, _) => setState(() => _state = AsyncError(message)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final items = _state.dataOrNull?.items ?? const <GoldStoreSummary>[];
    return AppScaffold(
      title: 'Gold stores',
      actions: [
        IconButton(
          tooltip: 'Open a Gold store',
          onPressed: () => context.push(AppRoutes.goldStoreApply),
          icon: const Icon(Icons.add_business_outlined),
        ),
      ],
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _search,
              decoration: InputDecoration(
                hintText: 'Search brand shops',
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(
                  icon: const Icon(Icons.tune),
                  onPressed: () => _load(q: _search.text.trim()),
                ),
              ),
              onSubmitted: (value) => _load(q: value.trim()),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              'Stores are brand shops. A store goes live after approval and at least 3 properly posted gold ads. Personal items are posted as a person, not as a brand.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context)
                        .colorScheme
                        .onSurface
                        .withValues(alpha: 0.65),
                  ),
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: (_state.isIdle || _state.isLoading) && items.isEmpty
                ? const LoadingView()
                : _state.hasError && items.isEmpty
                    ? EmptyState(
                        title: 'Could not load stores',
                        subtitle: _state.errorMessage,
                        action: FilledButton(
                          onPressed: () => _load(),
                          child: const Text('Retry'),
                        ),
                      )
                    : items.isEmpty
                        ? EmptyState(
                            title: 'No brand stores yet',
                            subtitle:
                                'Open a Gold store through the proper application, then publish at least 3 complete ads.',
                            action: FilledButton(
                              onPressed: () =>
                                  context.push(AppRoutes.goldStoreApply),
                              child: const Text('Apply for a store'),
                            ),
                          )
                        : RefreshIndicator(
                            onRefresh: () => _load(q: _search.text.trim()),
                            child: ListView.separated(
                              padding: const EdgeInsets.all(16),
                              itemCount: items.length,
                              separatorBuilder: (_, _) =>
                                  const SizedBox(height: 8),
                              itemBuilder: (context, index) {
                                final store = items[index];
                                return Card(
                                  child: ListTile(
                                    leading: CircleAvatar(
                                      backgroundColor:
                                          AppColors.gold.withValues(alpha: 0.2),
                                      child: const Icon(Icons.storefront,
                                          color: AppColors.gold),
                                    ),
                                    title: Text(store.name),
                                    subtitle: Text(
                                      store.verified
                                          ? 'Verified brand · ${store.progressLabel}'
                                          : 'Brand shop · ${store.progressLabel}',
                                    ),
                                    trailing: const Icon(Icons.chevron_right),
                                    onTap: () => context.push(
                                      '/gold/stores/${store.id}',
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}

class GoldStoreApplyScreen extends StatefulWidget {
  const GoldStoreApplyScreen({super.key});

  @override
  State<GoldStoreApplyScreen> createState() => _GoldStoreApplyScreenState();
}

class _GoldStoreApplyScreenState extends State<GoldStoreApplyScreen> {
  final _name = TextEditingController();
  final _tradeName = TextEditingController();
  final _description = TextEditingController();
  final _license = TextEditingController();
  final _address = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _offerings = TextEditingController(text: 'jewellery, bars, coins');
  bool _saving = false;

  @override
  void dispose() {
    _name.dispose();
    _tradeName.dispose();
    _description.dispose();
    _license.dispose();
    _address.dispose();
    _phone.dispose();
    _email.dispose();
    _offerings.dispose();
    super.dispose();
  }

  bool get _canSubmit =>
      _name.text.trim().length >= 2 &&
      _license.text.trim().length >= 2 &&
      _address.text.trim().length >= 5 &&
      _phone.text.trim().length >= 6;

  Future<void> _submit() async {
    setState(() => _saving = true);
    final offerings = _offerings.text
        .split(',')
        .map((e) => e.trim())
        .where((e) => e.isNotEmpty)
        .map((category) => {'category': category})
        .toList();
    final result = await ServiceLocator.instance.goldRepository.applyForStore({
      'legalName': _name.text.trim(),
      if (_tradeName.text.trim().isNotEmpty) 'tradeName': _tradeName.text.trim(),
      if (_description.text.trim().isNotEmpty)
        'description': _description.text.trim(),
      'licenseReference': _license.text.trim(),
      'address': _address.text.trim(),
      'contactPhone': _phone.text.trim(),
      if (_email.text.trim().isNotEmpty) 'contactEmail': _email.text.trim(),
      'minListingsRequired': 3,
      if (offerings.isNotEmpty) 'offerings': offerings,
      'certifications': const ['licensed_jeweller'],
    });
    if (!mounted) return;
    setState(() => _saving = false);
    result.when(
      success: (data) {
        final id = (data['id'] as num?)?.toInt();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Store application submitted. After approval, publish at least 3 proper ads to go live as a brand.',
            ),
          ),
        );
        if (id != null) {
          context.go('/gold/stores/$id');
        } else {
          context.pop();
        }
      },
      failure: (message, _) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return AppScaffold(
      title: 'Open a Gold store',
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Stores are brand shops in Gold Marketplace. Personal sellers can still post ads as a person without opening a store.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Legal shop name *'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _tradeName,
            decoration: const InputDecoration(labelText: 'Trade / brand name'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _license,
            decoration:
                const InputDecoration(labelText: 'License / registration *'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _address,
            decoration: const InputDecoration(labelText: 'Shop address *'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            decoration: const InputDecoration(labelText: 'Contact phone *'),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            decoration: const InputDecoration(labelText: 'Contact email'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _offerings,
            decoration: const InputDecoration(
              labelText: 'Offerings',
              helperText: 'Comma-separated, e.g. jewellery, bars, coins',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _description,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'About the shop'),
          ),
          const SizedBox(height: 12),
          Text(
            'After approval you must publish at least 3 complete gold ads (photo, karat, weight) before the store appears as a public brand.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.65),
                ),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _saving || !_canSubmit ? null : _submit,
            child: Text(_saving ? 'Submitting…' : 'Submit store application'),
          ),
        ],
      ),
    );
  }
}

class GoldStoreDetailScreen extends StatefulWidget {
  const GoldStoreDetailScreen({super.key, required this.storeId});

  final int storeId;

  @override
  State<GoldStoreDetailScreen> createState() => _GoldStoreDetailScreenState();
}

class _GoldStoreDetailScreenState extends State<GoldStoreDetailScreen> {
  Map<String, dynamic>? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final result =
        await ServiceLocator.instance.goldRepository.getStore(widget.storeId);
    if (!mounted) return;
    result.when(
      success: (data) => setState(() {
        _data = data;
        _loading = false;
        _error = null;
      }),
      failure: (message, _) => setState(() {
        _error = message;
        _loading = false;
      }),
    );
  }

  @override
  Widget build(BuildContext context) {
    final store = _data?['store'] is Map
        ? GoldStoreSummary.fromJson(Map<String, dynamic>.from(_data!))
        : null;
    final listings = (_data?['listings'] as List? ?? const [])
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();

    return AppScaffold(
      title: store?.name ?? _data?['name']?.toString() ?? 'Gold store',
      body: _loading
          ? const LoadingView()
          : _error != null
              ? EmptyState(title: _error!)
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    Text(
                      store?.name ?? '',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 4),
                    Text(store?.statusLabel ?? 'Gold store'),
                    if (store != null) ...[
                      const SizedBox(height: 12),
                      LinearProgressIndicator(
                        value: store.minListingsRequired == 0
                            ? 0
                            : (store.properListingCount /
                                    store.minListingsRequired)
                                .clamp(0.0, 1.0),
                        color: AppColors.gold,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        store.isBrandReady
                            ? 'Live as a brand shop · ${store.progressLabel}'
                            : 'Need ${store.listingsRemaining} more proper ads to unlock brand storefront · ${store.progressLabel}',
                      ),
                    ],
                    if (_data?['description'] != null) ...[
                      const SizedBox(height: 16),
                      Text(_data!['description'].toString()),
                    ],
                    if (_data?['address'] != null) ...[
                      const SizedBox(height: 12),
                      Text(_data!['address'].toString()),
                    ],
                    const SizedBox(height: 20),
                    Text('Store ads',
                        style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    if (listings.isEmpty)
                      const Text('No ads in this store yet.')
                    else
                      for (final item in listings)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(item['title']?.toString() ?? 'Listing'),
                          subtitle: Text(
                            [
                              if (item['karat'] != null) '${item['karat']}K',
                              if (item['weightG'] != null)
                                '${item['weightG']}g',
                              item['status']?.toString(),
                            ].whereType<String>().join(' · '),
                          ),
                          onTap: () {
                            final id = item['uuid'] ?? item['id'];
                            if (id != null) {
                              context.push('/listing/$id');
                            }
                          },
                        ),
                    const SizedBox(height: 16),
                    OutlinedButton.icon(
                      onPressed: () => context.push(AppRoutes.post),
                      icon: const Icon(Icons.add),
                      label: const Text('Post a gold ad'),
                    ),
                  ],
                ),
    );
  }
}
