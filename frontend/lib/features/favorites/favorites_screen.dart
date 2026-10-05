import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/theme/app_colors.dart';
import '../../core/auth/guest_feature.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../data/models/favorite_models.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../../shared/widgets/listing_card.dart';
import '../../data/models/listing_model.dart';
import 'favorites_store.dart';

class FavoritesScreen extends StatefulWidget {
  const FavoritesScreen({super.key});

  @override
  State<FavoritesScreen> createState() => _FavoritesScreenState();
}

class _FavoritesScreenState extends State<FavoritesScreen> {
  late final FavoritesStore _store;
  final _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.favoritesStore;
    _store.listen();
    _store.load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _createCollection() async {
    final l10n = context.l10n;
    final name = await _prompt(l10n.newCollection, l10n.collectionName);
    if (name == null || name.trim().isEmpty) return;
    final result = await _store.createCollection(name.trim());
    if (!mounted) return;
    result.when(
      success: (_) {},
      failure: (m, _) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  Future<String?> _prompt(String title, String label, [String initial = '']) async {
    final controller = TextEditingController(text: initial);
    return showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: InputDecoration(labelText: label),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(MaterialLocalizations.of(context).cancelButtonLabel)),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: Text(context.l10n.save)),
        ],
      ),
    );
  }

  Future<void> _shareCollection(FavoriteCollection collection) async {
    final result = await _store.share(targetType: 'collection', targetId: collection.id);
    if (!mounted) return;
    result.when(
      success: (link) async {
        await Clipboard.setData(ClipboardData(text: link.url));
        await SharePlus.instance.share(ShareParams(text: link.url));
      },
      failure: (m, _) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.favorites,
      actions: [
        IconButton(
          tooltip: l10n.newCollection,
          icon: const Icon(Icons.create_new_folder_outlined),
          onPressed: _createCollection,
        ),
      ],
      body: GuestGate(
        feature: GuestFeature.favorite,
        message: l10n.guestRestrictionMessage,
        child: SignalBuilder(
          builder: (context) {
            final state = _store.items.value;
            final cols = _store.collections.value.dataOrNull ?? const <FavoriteCollection>[];
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: TextField(
                    controller: _search,
                    textInputAction: TextInputAction.search,
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search),
                      hintText: l10n.favoritesSearchHint,
                    ),
                    onSubmitted: _store.search,
                  ),
                ),
                const SizedBox(height: 8),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Row(
                    children: [
                      _Chip(
                        label: l10n.allMarketplaces,
                        selected: _store.marketplaceFilter.value == null,
                        onTap: () => _store.setMarketplace(null),
                      ),
                      _Chip(label: l10n.goldMarketplace, selected: _store.marketplaceFilter.value == 'gold', onTap: () => _store.setMarketplace('gold')),
                      _Chip(label: l10n.propertyMarketplace, selected: _store.marketplaceFilter.value == 'property', onTap: () => _store.setMarketplace('property')),
                      _Chip(label: l10n.vehiclesMarketplace, selected: _store.marketplaceFilter.value == 'vehicles', onTap: () => _store.setMarketplace('vehicles')),
                    ],
                  ),
                ),
                if (cols.isNotEmpty)
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                    child: Row(
                      children: [
                        _Chip(
                          label: l10n.unfiled,
                          selected: _store.collectionFilter.value == null,
                          onTap: () => _store.setCollection(null),
                        ),
                        for (final collection in cols)
                          Padding(
                            padding: EdgeInsetsDirectional.only(start: (collection.depth - 1) * 4.0),
                            child: _Chip(
                              label: '${collection.name} (${collection.itemCount})',
                              selected: _store.collectionFilter.value == collection.id,
                              onTap: () => _store.setCollection(collection.id),
                              onLongPress: () => _collectionMenu(collection),
                            ),
                          ),
                      ],
                    ),
                  ),
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    child: DropdownButton<String>(
                      value: _store.sort.value,
                      underline: const SizedBox.shrink(),
                      items: [
                        DropdownMenuItem(value: 'newest', child: Text(l10n.sortNewest)),
                        DropdownMenuItem(value: 'oldest', child: Text(l10n.sortOldest)),
                        DropdownMenuItem(value: 'price_asc', child: Text(l10n.sortPriceAsc)),
                        DropdownMenuItem(value: 'price_desc', child: Text(l10n.sortPriceDesc)),
                      ],
                      onChanged: (value) {
                        if (value != null) _store.setSort(value);
                      },
                    ),
                  ),
                ),
                Expanded(child: _body(state, l10n)),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _body(AsyncState<List<FavoriteItem>> state, dynamic l10n) {
    if (state.isLoading && state.dataOrNull == null) {
      return Center(child: Text(l10n.favoritesLoading as String));
    }
    if (state case AsyncError(:final message)) {
      return EmptyState(
        title: l10n.favoritesLoadError as String,
        subtitle: message,
        action: FilledButton(onPressed: _store.load, child: Text(l10n.retry as String)),
      );
    }
    final items = state.dataOrNull ?? const <FavoriteItem>[];
    if (items.isEmpty) {
      return EmptyState(
        title: l10n.favoritesEmpty as String,
        subtitle: l10n.favoritesEmptyHint as String,
      );
    }

    return RefreshIndicator(
      onRefresh: _store.load,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final cross = context.listingCrossAxisCount();
          return NotificationListener<ScrollNotification>(
            onNotification: (n) {
              if (n.metrics.pixels > n.metrics.maxScrollExtent - 400) {
                _store.loadMore();
              }
              return false;
            },
            child: GridView.builder(
              padding: const EdgeInsets.all(12),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: cross,
                mainAxisSpacing: 12,
                crossAxisSpacing: 12,
                childAspectRatio: cross == 1 ? 2.6 : 0.72,
              ),
              itemCount: items.length,
              itemBuilder: (context, index) {
                final item = items[index];
                return _FavoriteTile(
                  item: item,
                  compact: cross == 1,
                  onOpen: () {
                    if (item.routeId.isEmpty) return;
                    context.push('/listing/${item.routeId}');
                  },
                  onUnsave: () => _store.moveFavorite(item.id, null).then((_) => _store.load()),
                  onShare: () async {
                    final result = await _store.share(targetType: 'favorite', targetId: item.id);
                    result.when(
                      success: (link) => SharePlus.instance.share(ShareParams(text: link.url)),
                      failure: (m, _) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
                        }
                      },
                    );
                  },
                  availabilityLabel: _availabilityLabel(item.availability),
                );
              },
            ),
          );
        },
      ),
    );
  }

  String _availabilityLabel(String availability) {
    final l10n = context.l10n;
    return switch (availability) {
      'sold' => l10n.soldListing,
      'rented' => l10n.rentedListing,
      'expired' => l10n.expiredListing,
      'archived' => l10n.archivedListing,
      'unavailable' => l10n.unavailableListing,
      _ => '',
    };
  }

  Future<void> _collectionMenu(FavoriteCollection collection) async {
    final l10n = context.l10n;
    await showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(title: Text(collection.name), subtitle: Text(collection.visibility)),
            ListTile(
              leading: const Icon(Icons.edit_outlined),
              title: Text(l10n.renameCollection),
              onTap: () async {
                Navigator.pop(context);
                final name = await _prompt(l10n.renameCollection, l10n.collectionName, collection.name);
                if (name != null && name.trim().isNotEmpty) {
                  await _store.renameCollection(collection.id, name.trim());
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.create_new_folder_outlined),
              title: Text(l10n.newFolder),
              onTap: () async {
                Navigator.pop(context);
                final name = await _prompt(l10n.newFolder, l10n.collectionName);
                if (name != null && name.trim().isNotEmpty) {
                  await _store.createCollection(name.trim(), parentId: collection.id);
                }
              },
            ),
            ListTile(
              leading: const Icon(Icons.share_outlined),
              title: Text(l10n.shareCollection),
              onTap: () {
                Navigator.pop(context);
                _shareCollection(collection);
              },
            ),
            if (!collection.isDefault)
              ListTile(
                leading: const Icon(Icons.delete_outline),
                title: Text(l10n.deleteCollection),
                onTap: () async {
                  Navigator.pop(context);
                  await _store.deleteCollection(collection.id);
                },
              ),
          ],
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.selected, required this.onTap, this.onLongPress});
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: GestureDetector(
        onLongPress: onLongPress,
        child: FilterChip(
          label: Text(label),
          selected: selected,
          onSelected: (_) => onTap(),
        ),
      ),
    );
  }
}

class _FavoriteTile extends StatelessWidget {
  const _FavoriteTile({
    required this.item,
    required this.compact,
    required this.onOpen,
    required this.onUnsave,
    required this.onShare,
    required this.availabilityLabel,
  });

  final FavoriteItem item;
  final bool compact;
  final VoidCallback onOpen;
  final VoidCallback onUnsave;
  final VoidCallback onShare;
  final String availabilityLabel;

  @override
  Widget build(BuildContext context) {
    final listing = ListingModel(
      id: item.listingId?.toString() ?? item.entityId.toString(),
      uuid: item.listingUuid,
      title: item.title,
      marketplace: item.marketplaceCode,
      price: item.price ?? 0,
      currency: item.currency ?? 'USD',
      imageUrl: item.imageUrl,
      isFavorited: true,
      status: item.status,
    );
    return Stack(
      children: [
        ListingCard(
          listing: listing,
          compact: compact,
          onTap: item.routeId.isEmpty ? null : onOpen,
          onFavorite: onUnsave,
        ),
        PositionedDirectional(
          top: 8,
          end: 8,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (availabilityLabel.isNotEmpty)
                Material(
                  color: AppColors.gold.withValues(alpha: 0.9),
                  borderRadius: BorderRadius.circular(6),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    child: Text(availabilityLabel, style: Theme.of(context).textTheme.labelSmall),
                  ),
                ),
              IconButton.filledTonal(
                visualDensity: VisualDensity.compact,
                onPressed: onShare,
                icon: const Icon(Icons.share_outlined, size: 18),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
