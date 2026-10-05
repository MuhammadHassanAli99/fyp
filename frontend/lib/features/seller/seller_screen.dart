import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:timeago/timeago.dart' as timeago;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/auth/guest_feature.dart';
import '../../core/result/async_state.dart';
import '../../data/models/listing_model.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../../shared/widgets/listing_card.dart';

class SellerListingsPanel extends StatefulWidget {
  const SellerListingsPanel({super.key});

  @override
  State<SellerListingsPanel> createState() => _SellerListingsPanelState();
}

class _SellerListingsPanelState extends State<SellerListingsPanel> {
  final listings = signal<AsyncState<List<ListingModel>>>(const AsyncIdle());
  String? _marketplaceFilter;
  String? _statusFilter;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (ServiceLocator.instance.authRepository.isGuest) return;
    listings.value = AsyncLoading(previous: listings.value.dataOrNull);
    final result = await ServiceLocator.instance.listingsRepository.mine(
      marketplace: _marketplaceFilter,
    );
    result.when(
      success: (page) => listings.value = AsyncData(page.items),
      failure: (m, code) => listings.value = AsyncError(m, code: code),
    );
  }

  String _statusLabel(String? status, {ListingModel? item}) {
    final lifecycle = item?.effectiveLifecycle ?? status;
    final transaction = item?.transactionStatus;
    if (transaction == 'sold') return 'Sold';
    if (transaction == 'rented') return 'Rented';
    return switch (lifecycle) {
        'published' => 'Live',
        'pending_review' => 'Under review',
        'draft' => 'Draft',
        'rejected' => 'Rejected',
        'sold' => 'Sold',
        'rented' => 'Rented',
        'expired' => 'Expired',
        'archived' => 'Archived',
        _ => lifecycle?.replaceAll('_', ' ') ?? '',
      };
  }

  String _marketplaceLabel(String code) => switch (code) {
        'gold' => 'Gold',
        'property' => 'Property',
        'vehicles' => 'Vehicles',
        _ => code,
      };

  List<ListingModel> _filtered(List<ListingModel> items) {
    if (_statusFilter == null) return items;
    return items.where((e) => e.matchesStatusFilter(_statusFilter!)).toList();
  }

  void _openListing(ListingModel item) {
    context.push('/listing/${item.routeId}');
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return GuestGate(
      feature: GuestFeature.account,
      message: l10n.guestRestrictionMessage,
      child: Column(
          children: [
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  for (final op in [
                    (null, 'All markets'),
                    ('gold', 'Gold'),
                    ('property', 'Property'),
                    ('vehicles', 'Vehicles'),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(op.$2),
                        selected: _marketplaceFilter == op.$1,
                        onSelected: (_) {
                          setState(() => _marketplaceFilter = op.$1);
                          _load();
                        },
                        selectedColor: AppColors.gold.withValues(alpha: 0.25),
                      ),
                    ),
                ],
              ),
            ),
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  for (final op in [
                    (null, 'All status'),
                    ('published', 'Live'),
                    ('pending_review', 'Under review'),
                    ('draft', 'Draft'),
                    ('rejected', 'Rejected'),
                    ('sold', 'Sold'),
                    ('expired', 'Expired'),
                  ])
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChip(
                        label: Text(op.$2),
                        selected: _statusFilter == op.$1,
                        onSelected: (s) {
                          setState(() => _statusFilter = s ? op.$1 : null);
                        },
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: SignalBuilder(builder: (context) {
                final state = listings.value;
                if (state.isLoading && state.dataOrNull == null) {
                  return const LoadingView(message: 'Loading your ads…');
                }
                if (state case AsyncError(:final message)) {
                  return EmptyState(
                    title: 'Could not load listings',
                    subtitle: message,
                    action: FilledButton(
                      onPressed: _load,
                      child: Text(l10n.retry),
                    ),
                  );
                }
                final items = _filtered(state.dataOrNull ?? []);
                if (items.isEmpty) {
                  final hasFilters =
                      _marketplaceFilter != null || _statusFilter != null;
                  return EmptyState(
                    title: hasFilters ? 'No matching ads' : 'No ads yet',
                    subtitle: hasFilters
                        ? 'Try another marketplace or status filter.'
                        : 'Tap Sell (+) to post your first gold, property or vehicle ad.',
                    action: hasFilters
                        ? TextButton(
                            onPressed: () {
                              setState(() {
                                _marketplaceFilter = null;
                                _statusFilter = null;
                              });
                              _load();
                            },
                            child: const Text('Clear filters'),
                          )
                        : null,
                  );
                }

                return RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.separated(
                    padding: EdgeInsets.fromLTRB(
                      context.isCompact ? 12 : 16,
                      8,
                      context.isCompact ? 12 : 16,
                      96,
                    ),
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (_, i) => _MyAdRow(
                      listing: items[i],
                      statusLabel: _statusLabel(items[i].status, item: items[i]),
                      marketplaceLabel:
                          _marketplaceLabel(items[i].marketplace),
                      onTap: () => _openListing(items[i]),
                      onManage: () => context.push(
                        '/listing/${items[i].routeId}/manage',
                      ),
                    ),
                  ),
                );
              }),
            ),
          ],
        ),
      );
  }
}

/// Vertical list row for My ads (PakWheels-inspired).
class _MyAdRow extends StatelessWidget {
  const _MyAdRow({
    required this.listing,
    required this.statusLabel,
    required this.marketplaceLabel,
    required this.onTap,
    required this.onManage,
  });

  final ListingModel listing;
  final String statusLabel;
  final String marketplaceLabel;
  final VoidCallback onTap;
  final VoidCallback onManage;

  String get _operationLabel => switch (listing.operation) {
        'sell' => 'For sale',
        'rent' => 'For rent',
        'buy' => 'Wanted',
        'auction' => 'Auction',
        _ => listing.operation?.replaceAll('_', ' ') ?? '',
      };

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 6, left: 2),
          child: Row(
            children: [
              Text(
                marketplaceLabel,
                style: Theme.of(context).textTheme.labelMedium?.copyWith(
                      color: AppColors.gold,
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(width: 8),
              if (statusLabel.isNotEmpty)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.gold.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    statusLabel,
                    style: const TextStyle(fontSize: 11, color: AppColors.gold),
                  ),
                ),
              if (_operationLabel.isNotEmpty) ...[
                const SizedBox(width: 8),
                Text(
                  _operationLabel,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: AppColors.goldMuted,
                      ),
                ),
              ],
              const Spacer(),
              if (listing.createdAt != null)
                Text(
                  timeago.format(listing.createdAt!),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: AppColors.goldMuted,
                      ),
                ),
            ],
          ),
        ),
        ListingCard(
          listing: listing,
          compact: true,
          onTap: onTap,
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: onManage,
            child: const Text('Manage'),
          ),
        ),
      ],
    );
  }
}
