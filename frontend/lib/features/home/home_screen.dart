import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../data/models/gold_models.dart';
import '../../data/models/listing_model.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../../shared/widgets/listing_card.dart';
import '../compare/compare_store.dart';
import '../advertisements/ad_slot.dart';
import 'home_shell.dart';
import 'home_store.dart';
import 'marketplace_filters.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final HomeStore _store;
  late final CompareStore _compareStore;
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = HomeStore(
      sl.listingsRepository,
      sl.settingsRepository,
      gold: sl.goldRepository,
      property: sl.propertyRepository,
      vehicles: sl.vehicleRepository,
      ai: sl.authRepository.isGuest ? null : sl.aiRepository,
    );
    _compareStore = sl.compareStore;
    _store.load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String get _marketplaceTitle {
    return switch (_store.marketplace) {
      'property' => 'Property',
      'vehicles' => 'Vehicles',
      'gold' => 'Gold',
      _ => context.l10n.appName,
    };
  }

  String get _searchHint {
    return switch (_store.marketplace) {
      'property' => 'Search city, society, or keyword…',
      'vehicles' => 'Search make, model, or city…',
      'gold' => 'Search 22k gold ring, bars, coins…',
      _ => context.l10n.searchHint,
    };
  }

  List<(String?, String)> _karatChips() {
    final purities = _store.goldPurities.value;
    if (purities.isEmpty) {
      return const [
        (null, 'All karat'),
        ('24', '24K'),
        ('22', '22K'),
        ('21', '21K'),
        ('18', '18K'),
      ];
    }
    return [
      (null, 'All karat'),
      ...purities.map((p) => (p.karatKey, p.label)),
    ];
  }

  Future<void> _openFilters() async {
    final next = await showMarketplaceFilterSheet(
      context,
      query: _store.query.copy(),
    );
    if (next != null) _store.applyFilters(next);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final isGuest = ServiceLocator.instance.authRepository.isGuest;
    final marketplace = _store.marketplace;

    return HomeShell(
      child: AppScaffold(
        showBack: false,
        title: _marketplaceTitle,
        actions: [
          IconButton(
            icon: const Icon(Icons.grid_view_outlined),
            tooltip: l10n.switchMarketplace,
            onPressed: () => context.go(AppRoutes.marketplaceSelect),
          ),
          IconButton(
            icon: const Icon(Icons.compare_arrows),
            onPressed: () => context.push(AppRoutes.compare),
          ),
          if (marketplace == 'gold')
            IconButton(
              icon: const Icon(Icons.map_outlined),
              tooltip: 'Map',
              onPressed: () => context.push('${AppRoutes.map}?marketplace=gold'),
            ),
          if (marketplace == 'property') ...[
            IconButton(
              icon: const Icon(Icons.map_outlined),
              tooltip: 'Map',
              onPressed: () => context.push(AppRoutes.propertyMap),
            ),
            IconButton(
              icon: const Icon(Icons.notifications_active_outlined),
              tooltip: 'Saved searches',
              onPressed: () => context.push(AppRoutes.propertySavedSearches),
            ),
          ],
          if (marketplace == 'vehicles') ...[
            IconButton(
              icon: const Icon(Icons.map_outlined),
              tooltip: 'Map',
              onPressed: () => context.push(AppRoutes.vehicleMap),
            ),
            IconButton(
              icon: const Icon(Icons.notifications_active_outlined),
              tooltip: 'Saved searches',
              onPressed: () => context.push(AppRoutes.vehicleSavedSearches),
            ),
            IconButton(
              icon: const Icon(Icons.settings_input_component_outlined),
              tooltip: 'Parts',
              onPressed: () => context.push(AppRoutes.vehicleParts),
            ),
          ],
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => context.push(AppRoutes.settings),
          ),
          SignalBuilder(builder: (context) {
            final count = ServiceLocator.instance.notificationHub.unreadCount.value;
            return IconButton(
              tooltip: context.l10n.notifications,
              onPressed: () => context.push(AppRoutes.notifications),
              icon: Badge(
                isLabelVisible: count > 0,
                label: Text(count > 99 ? '99+' : '$count'),
                child: const Icon(Icons.notifications_outlined),
              ),
            );
          }),
        ],
        body: Column(
          children: [
            Padding(
              padding: EdgeInsets.fromLTRB(
                context.isCompact ? 12 : 16,
                0,
                context.isCompact ? 12 : 16,
                8,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _searchController,
                      readOnly: true,
                      decoration: InputDecoration(
                        hintText: _searchHint,
                        isDense: context.isCompact,
                        prefixIcon: const Icon(Icons.search),
                      ),
                      onTap: () {
                        final q = _searchController.text.trim();
                        context.push(
                          q.isEmpty
                              ? AppRoutes.search
                              : '${AppRoutes.search}?q=${Uri.encodeQueryComponent(q)}',
                        );
                      },
                    ),
                  ),
                  SignalBuilder(builder: (context) {
                    _store.filterTick.value;
                    final count = _store.query.activeFilterCount;
                    return Badge(
                      isLabelVisible: count > 0,
                      label: Text('$count'),
                      child: IconButton(
                        visualDensity: VisualDensity.compact,
                        icon: const Icon(Icons.tune),
                        tooltip: l10n.filter,
                        onPressed: _openFilters,
                      ),
                    );
                  }),
                  if (marketplace == 'property')
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(Icons.bookmark_add_outlined),
                      tooltip: 'Save search',
                      onPressed: () async {
                        if (ServiceLocator.instance.authRepository.isGuest) {
                          context.push(AppRoutes.login);
                          return;
                        }
                        await _store.saveCurrentSearch(
                          _store.query.q?.isNotEmpty == true
                              ? _store.query.q!
                              : 'Property search',
                        );
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'Search saved. You will be notified when matching properties are published.',
                            ),
                          ),
                        );
                      },
                    ),
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.sort),
                    tooltip: l10n.sort,
                    onPressed: () => showMarketplaceSortSheet(
                      context,
                      marketplace: marketplace,
                      current: _store.query.sort,
                      onSelected: _store.setSort,
                    ),
                  ),
                ],
              ),
            ),
            SignalBuilder(builder: (context) {
              if (marketplace != 'gold') return const SizedBox.shrink();
              final rates = _store.goldRates.value;
              final forecasts = _store.goldForecasts.value;
              if (rates.isEmpty && forecasts.isEmpty) {
                return const SizedBox.shrink();
              }
              return _GoldMarketBar(
                rates: rates,
                forecasts: forecasts,
                disclaimer: _store.goldRateDisclaimer.value,
              );
            }),
            SignalBuilder(builder: (context) {
              _store.filterTick.value;
              _store.vehicleCatalog.value;
              final selectedOp = _store.query.operation;
              return SizedBox(
                height: 44,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: [
                    if (marketplace == 'gold') ...[
                      for (final op in [
                        (null, 'All'),
                        ('sell', 'For sale'),
                        ('buy', 'Wanted'),
                        ('auction', 'Auction'),
                      ])
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(op.$2),
                            selected: selectedOp == op.$1,
                            onSelected: (_) => _store.setOperation(op.$1),
                            selectedColor:
                                AppColors.gold.withValues(alpha: 0.25),
                          ),
                        ),
                      const SizedBox(width: 8),
                      for (final k in _karatChips())
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: FilterChip(
                            label: Text(k.$2),
                            selected: _store.query.karat == k.$1,
                            onSelected: (s) {
                              final next = _store.query.copy();
                              next.karat = s ? k.$1 : null;
                              _store.applyFilters(next);
                            },
                          ),
                        ),
                    ],
                    if (marketplace == 'property') ...[
                      for (final op in [
                        (null, 'All'),
                        ('sell', 'For sale'),
                        ('rent', 'Rent'),
                        ('buy', 'Wanted'),
                      ])
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(op.$2),
                            selected: selectedOp == op.$1,
                            onSelected: (_) => _store.setOperation(op.$1),
                            selectedColor:
                                AppColors.gold.withValues(alpha: 0.25),
                          ),
                        ),
                      const SizedBox(width: 8),
                      for (final beds in [1, 2, 3, 4])
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: FilterChip(
                            label: Text('$beds+ Beds'),
                            selected: _store.query.bedroomsMin == beds,
                            onSelected: (s) {
                              final next = _store.query.copy();
                              next.bedroomsMin = s ? beds : null;
                              _store.applyFilters(next);
                            },
                          ),
                        ),
                    ],
                    if (marketplace == 'vehicles') ...[
                      for (final op in [
                        (null, 'All'),
                        ('sell', 'For sale'),
                        ('rent', 'Rent'),
                        ('buy', 'Wanted'),
                        ('auction', 'Auction'),
                      ])
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(op.$2),
                            selected: selectedOp == op.$1,
                            onSelected: (_) => _store.setOperation(op.$1),
                            selectedColor:
                                AppColors.gold.withValues(alpha: 0.25),
                          ),
                        ),
                      const SizedBox(width: 8),
                      for (final t in (_store.vehicleCatalog.value?.types
                                  .map((e) => e.code)
                                  .toList() ??
                              const [
                                'car',
                                'motorcycle',
                                'van',
                                'truck',
                                'bus',
                                'taxi',
                                'rickshaw',
                                'boat',
                              ])
                          .take(12))
                        Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: FilterChip(
                            label: Text(t.replaceAll('_', ' ')),
                            selected: _store.query.vehicleType == t,
                            onSelected: (s) {
                              final next = _store.query.copy();
                              next.vehicleType = s ? t : null;
                              next.makeId = null;
                              next.modelId = null;
                              _store.applyFilters(next);
                            },
                          ),
                        ),
                    ],
                  ],
                ),
              );
            }),
            SignalBuilder(builder: (context) {
              final recs = _store.recommended.value;
              if (recs.isEmpty) return const SizedBox.shrink();
              return SizedBox(
                height: 118,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
                      child: Text(
                        _store.recommendationNote.value ?? 'Recommended for you',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.labelLarge,
                      ),
                    ),
                    Expanded(
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        padding: const EdgeInsets.symmetric(horizontal: 16),
                        itemCount: recs.length,
                        separatorBuilder: (_, _) => const SizedBox(width: 8),
                        itemBuilder: (context, index) {
                          final listing = recs[index];
                          return ActionChip(
                            label: Text(listing.title, overflow: TextOverflow.ellipsis),
                            onPressed: () => context.push('/listing/${listing.routeId}'),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              );
            }),
            Expanded(
              child: SignalBuilder(builder: (context) {
                final state = _store.listings.value;
                if (state.isLoading && state.dataOrNull == null) {
                  return const LoadingView();
                }
                if (state.hasError && state.dataOrNull == null) {
                  final message = switch (state) {
                    AsyncError(:final message) => message,
                    _ => l10n.noListings,
                  };
                  return EmptyState(
                    title: l10n.noListings,
                    subtitle: message,
                    action: FilledButton(
                      onPressed: _store.load,
                      child: Text(l10n.retry),
                    ),
                  );
                }
                final items = state.dataOrNull ?? [];
                if (items.isEmpty) {
                  final hasFilters = _store.query.activeFilterCount > 0 ||
                      (_store.query.q?.isNotEmpty ?? false);
                  return EmptyState(
                    title: l10n.noListings,
                    subtitle: hasFilters
                        ? l10n.noListingsHint
                        : 'No published listings yet. Check back soon or switch marketplace.',
                    action: hasFilters
                        ? TextButton(
                            onPressed: _store.clearFilters,
                            child: const Text('Clear filters'),
                          )
                        : FilledButton(
                            onPressed: _store.load,
                            child: Text(l10n.retry),
                          ),
                  );
                }
                return RefreshIndicator(
                  onRefresh: _store.load,
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final width = constraints.maxWidth;
                      final crossAxisCount =
                          context.listingCrossAxisCount(marketplace: marketplace);
                      final pad = width < 600 ? 12.0 : 16.0;
                      // Keep desktop property/gold/vehicle feeds readable.
                      final contentWidth = width > 1400 ? 1320.0 : width;
                      final loadingMore = _store.loadingMore.value;
                      final hasMore = _store.hasMore.value;
                      final loadMoreError = _store.loadMoreError.value;
                      final extra = (hasMore || loadingMore || loadMoreError != null) ? 1 : 0;

                      Widget cardFor(ListingModel listing) {
                        return ListingCard(
                          listing: listing,
                          isGuest: isGuest,
                          compact: crossAxisCount == 1,
                          onTap: () =>
                              context.push('/listing/${listing.routeId}'),
                          onCompare: crossAxisCount == 1
                              ? null
                              : () {
                                  _compareStore.addListing(
                                    listing.id,
                                    listing: listing,
                                  );
                                  final count = _compareStore.isVehicles
                                      ? _compareStore.filledSlotCount
                                      : _compareStore.listingIds.value.length;
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(
                                        'Added to compare ($count)',
                                      ),
                                      action: SnackBarAction(
                                        label: 'Open',
                                        onPressed: () =>
                                            context.push(AppRoutes.compare),
                                      ),
                                    ),
                                  );
                                },
                          onFavorite: () async {
                                  final sl = ServiceLocator.instance;
                                  final listingId = int.tryParse(listing.id);
                                  if (listingId == null) return;
                                  if (isGuest) {
                                    sl.settingsRepository.setPendingRoute(
                                      '/listing/${listing.routeId}',
                                    );
                                    await sl.favoritesStore.rememberGuestSave(
                                      entityId: listingId,
                                      listingId: listingId,
                                      marketplaceCode: listing.marketplace,
                                      route: '/listing/${listing.routeId}',
                                    );
                                    if (context.mounted) {
                                      context.push(AppRoutes.login);
                                    }
                                    return;
                                  }
                                  final result = await sl.favoritesStore
                                      .toggleListing(listing);
                                  if (!context.mounted) return;
                                  result.when(
                                    success: (_) => _store.load(),
                                    failure: (m, code) {
                                      if (code == 'GUEST_NOT_ALLOWED') {
                                        context.push(AppRoutes.login);
                                        return;
                                      }
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(content: Text(m)),
                                      );
                                    },
                                  );
                                },
                        );
                      }

                      Widget footer() {
                        if (loadMoreError != null) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            child: TextButton(
                              onPressed: _store.loadMore,
                              child: Text(l10n.retry),
                            ),
                          );
                        }
                        if (loadingMore) {
                          return const Padding(
                            padding: EdgeInsets.symmetric(vertical: 16),
                            child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
                          );
                        }
                        if (!hasMore) {
                          return const SizedBox(height: 24);
                        }
                        return const SizedBox(height: 48);
                      }

                      Widget feed;
                      if (crossAxisCount == 1) {
                        feed = ListView.separated(
                          padding: EdgeInsets.all(pad),
                          itemCount: items.length + 1 + extra,
                          separatorBuilder: (_, _) =>
                              const SizedBox(height: 10),
                          itemBuilder: (_, i) {
                            if (i == 0) {
                              return const AdSlot(placementCode: 'home_banner_top');
                            }
                            if (i == items.length + 1) return footer();
                            return cardFor(items[i - 1]);
                          },
                        );
                      } else {
                        feed = GridView.builder(
                          padding: EdgeInsets.all(pad),
                          gridDelegate:
                              SliverGridDelegateWithFixedCrossAxisCount(
                            crossAxisCount: crossAxisCount,
                            crossAxisSpacing: 12,
                            mainAxisSpacing: 12,
                            childAspectRatio: context.listingChildAspectRatio(
                              crossAxisCount: crossAxisCount,
                              marketplace: marketplace,
                            ),
                          ),
                          itemCount: items.length,
                          itemBuilder: (_, i) => cardFor(items[i]),
                        );
                      }

                      feed = NotificationListener<ScrollNotification>(
                        onNotification: (n) {
                          if (n.metrics.pixels > n.metrics.maxScrollExtent - 480) {
                            _store.loadMore();
                          }
                          return false;
                        },
                        child: feed,
                      );

                      if (contentWidth >= width) return feed;
                      return Align(
                        alignment: Alignment.topCenter,
                        child: SizedBox(width: contentWidth, child: feed),
                      );
                    },
                  ),
                );
              }),
            ),
          ],
        ),
      ),
    );
  }
}

class _GoldMarketBar extends StatelessWidget {
  const _GoldMarketBar({
    required this.rates,
    required this.forecasts,
    this.disclaimer,
  });

  final List<GoldRate> rates;
  final List<GoldForecast> forecasts;
  final String? disclaimer;

  @override
  Widget build(BuildContext context) {
    GoldForecast? forecast;
    for (final item in forecasts) {
      if (item.horizon == '7d') {
        forecast = item;
        break;
      }
    }
    forecast ??= forecasts.isEmpty ? null : forecasts.first;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.charcoalSurface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.gold.withValues(alpha: 0.25)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 36,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  for (final rate in rates.take(6))
                    Padding(
                      padding: const EdgeInsets.only(right: 16),
                      child: Text(
                        '${rate.karat == rate.karat.roundToDouble() ? rate.karat.toInt() : rate.karat}K  ${rate.ratePerGram.toStringAsFixed(0)} ${rate.currency}/g',
                        style: const TextStyle(
                          color: AppColors.gold,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            if (forecast != null) ...[
              const SizedBox(height: 4),
              Text(
                '7-day forecast: ${forecast.lowerBound?.toStringAsFixed(0) ?? '—'}–${forecast.upperBound?.toStringAsFixed(0) ?? forecast.predictedRate.toStringAsFixed(0)} ${rates.isNotEmpty ? rates.first.currency : ''}  ·  Confidence: ${forecast.confidence == null ? 'Medium' : '${forecast.confidence!.toStringAsFixed(0)}%'}  ·  Model: ${forecast.modelId ?? 'v1'}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              Text(
                forecast.disclaimer ??
                    'Forecasts are estimated ranges, not guaranteed future prices.',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: AppColors.goldMuted,
                    ),
              ),
            ],
            if (disclaimer != null)
              Text(
                disclaimer!,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: AppColors.goldMuted,
                    ),
              ),
          ],
        ),
      ),
    );
  }
}
