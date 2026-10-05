import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;
import 'package:video_player/video_player.dart';

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/auth/guest_feature.dart';
import '../../core/network/api_client.dart';
import '../../core/result/async_state.dart';
import '../../data/models/gold_models.dart';
import '../../data/models/listing_model.dart';
import '../../data/models/property_models.dart';
import '../../data/models/vehicle_models.dart';
import '../../features/payment/checkout_nav.dart';
import '../../shared/extensions/context_extensions.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../../shared/widgets/listing_card.dart';
import '../chat/call_screen.dart';
import '../chat/communication_permissions.dart';
import '../reviews/reviews_section.dart';
import '../advertisements/ad_slot.dart';
import 'listing_detail_store.dart';

class ListingDetailScreen extends StatefulWidget {
  const ListingDetailScreen({
    super.key,
    required this.listingId,
    this.justPosted = false,
  });

  final String listingId;
  final bool justPosted;

  @override
  State<ListingDetailScreen> createState() => _ListingDetailScreenState();
}

class _ListingDetailScreenState extends State<ListingDetailScreen> {
  late final ListingDetailStore _store;
  int _galleryIndex = 0;

  @override
  void initState() {
    super.initState();
    _store = ListingDetailStore(
      ServiceLocator.instance.listingsRepository,
      widget.listingId,
      gold: ServiceLocator.instance.goldRepository,
      property: ServiceLocator.instance.propertyRepository,
      vehicles: ServiceLocator.instance.vehicleRepository,
      viewerCountryId: ServiceLocator.instance.settingsRepository.countryId,
    );
    _store.load();
  }

  bool _isOwner(ListingModel item) {
    final user = ServiceLocator.instance.authRepository.currentUser;
    if (user == null || user.isGuest) return false;
    final sellerId = item.seller?.id;
    if (sellerId == null || sellerId.isEmpty) return false;
    if (user.intId != null && sellerId == '${user.intId}') return true;
    return sellerId == user.id;
  }

  String _statusLabel(String? status) => switch (status) {
        'published' => 'Live',
        'pending_review' => 'Under review',
        'draft' => 'Draft',
        'rejected' => 'Rejected',
        'sold' => 'Sold',
        'rented' => 'Rented',
        'expired' => 'Expired',
        _ => status?.replaceAll('_', ' ') ?? '',
      };

  String _operationLabel(String? op) => switch (op) {
        'sell' => 'For sale',
        'rent' => 'For rent',
        'buy' => 'Wanted',
        'auction' => 'Auction',
        'exchange' => 'Exchange',
        _ => op?.replaceAll('_', ' ') ?? '',
      };

  Future<bool> _requireAccount(ListingModel item) async {
    final sl = ServiceLocator.instance;
    if (!sl.guestFeatureGuard.allows(GuestFeature.contactSeller)) {
      await sl.settingsRepository.setPendingRoute(
        '/listing/${widget.listingId}',
      );
      if (!mounted) return false;
      context.push(AppRoutes.login);
      return false;
    }
    return true;
  }

  Future<void> _contactSeller(ListingModel item) async {
    if (!await _requireAccount(item)) return;
    final id = item.uuid ?? item.id;
    final result =
        await ServiceLocator.instance.chatRepository.openForListing(id);
    if (!mounted) return;
    result.when(
      success: (conv) {
        ServiceLocator.instance.adsStore.recordConversion(kind: 'contact');
        context.push('/chat/${conv.uuid}');
      },
      failure: (m, _) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
      },
    );
  }

  Future<void> _startListingCall(ListingModel item, {required bool video}) async {
    if (!await _requireAccount(item)) return;
    final ok = video
        ? await ensureCameraAndMicrophone()
        : await ensureMicrophonePermission();
    if (!ok) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            video
                ? 'Camera and microphone are required'
                : 'Microphone permission is required',
          ),
        ),
      );
      return;
    }
    final result = await ServiceLocator.instance.chatRepository.startCall(
      listingId: item.uuid ?? item.id,
      kind: video ? 'video' : 'voice',
    );
    if (!mounted) return;
    result.when(
      success: (call) {
        ServiceLocator.instance.adsStore.recordConversion(kind: 'call');
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => CallScreen(
              call: call,
              outgoing: true,
              peerName: item.seller?.displayName ?? item.title,
            ),
          ),
        );
      },
      failure: (m, _) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
      },
    );
  }

  Future<void> _startMaskedCall(ListingModel item) async {
    if (!await _requireAccount(item)) return;
    final result = await ServiceLocator.instance.chatRepository
        .startMaskedCall(item.uuid ?? item.id);
    if (!mounted) return;
    result.when(
      success: (session) {
        ServiceLocator.instance.adsStore.recordConversion(kind: 'call');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              session.expiresAt == null
                  ? 'Masked call requested. Numbers stay hidden.'
                  : 'Masked call requested until ${session.expiresAt!.toLocal()}. Numbers stay hidden.',
            ),
          ),
        );
      },
      failure: (m, _) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
      },
    );
  }

  Future<void> _offerProperty(ListingModel item) async {
    if (ServiceLocator.instance.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final controller =
        TextEditingController(text: item.price.toStringAsFixed(0));
    final amount = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Make an offer'),
        content: TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: 'Amount (${item.currency})'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(ctx, double.tryParse(controller.text)),
            child: const Text('Send'),
          ),
        ],
      ),
    );
    if (amount == null || amount <= 0 || !mounted) return;
    final result = await _store.makeOffer(amount);
    if (!mounted) return;
    result.when(
      success: (_) => ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Offer sent')),
      ),
      failure: (m, _) =>
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  List<String> _badgeItems(Map<String, dynamic> raw) {
    final list = raw['badges'];
    if (list is List) {
      return [
        for (final item in list)
          if (item is Map && item['label'] != null) item['label'].toString(),
      ];
    }
    return [
      for (final badge in raw.values)
        if (badge is Map && badge['label'] != null) badge['label'].toString(),
    ];
  }

  Future<void> _buyVehicle() async {
    if (ServiceLocator.instance.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final result = await _store.buyVehicle();
    if (!mounted) return;
    result.when(
      success: (data) {
        pushCheckout(context, data);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Checkout started. Payment does not transfer legal ownership or registration.',
            ),
          ),
        );
      },
      failure: (m, _) =>
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  Future<void> _offerVehicle(ListingModel item) async {
    if (ServiceLocator.instance.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final controller =
        TextEditingController(text: item.price.toStringAsFixed(0));
    final amount = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Make an offer'),
        content: TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: 'Amount (${item.currency})'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(ctx, double.tryParse(controller.text.trim())),
            child: const Text('Send'),
          ),
        ],
      ),
    );
    if (amount == null || amount <= 0 || !mounted) return;
    final result = await _store.makeVehicleOffer(amount);
    if (!mounted) return;
    result.when(
      success: (_) => ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Offer sent')),
      ),
      failure: (m, _) =>
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  Future<void> _bookVehicle() async {
    if (ServiceLocator.instance.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final start = DateTime.now().add(const Duration(days: 1));
    final end = start.add(const Duration(days: 3));
    final result = await _store.bookVehicle(
      startDate: start.toIso8601String().substring(0, 10),
      endDate: end.toIso8601String().substring(0, 10),
    );
    if (!mounted) return;
    result.when(
      success: (data) {
        pushCheckout(context, data);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Rental payment started')),
        );
      },
      failure: (m, _) =>
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  Future<void> _bidVehicle(ListingModel item) async {
    if (ServiceLocator.instance.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final auction = item.auction;
    if (auction == null) return;
    final controller = TextEditingController(
      text: (auction.currentBid ?? auction.startPrice ?? 0).toString(),
    );
    final amount = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Place a bid'),
        content: TextField(
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: 'Bid (${item.currency})'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(ctx, double.tryParse(controller.text.trim())),
            child: const Text('Bid'),
          ),
        ],
      ),
    );
    if (amount == null || amount <= 0 || !mounted) return;
    final result = await _store.bidVehicle(amount);
    if (!mounted) return;
    result.when(
      success: (_) => ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Bid submitted')),
      ),
      failure: (m, _) =>
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  Future<void> _buyProperty() async {
    if (ServiceLocator.instance.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final result = await _store.buyProperty();
    if (!mounted) return;
    result.when(
      success: (data) {
        pushCheckout(context, data);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Checkout started. Payment does not transfer legal title.',
            ),
          ),
        );
      },
      failure: (m, _) =>
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  Future<void> _applyRent() async {
    if (ServiceLocator.instance.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final result = await _store.applyToRent();
    if (!mounted) return;
    result.when(
      success: (_) => ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Rental application submitted')),
      ),
      failure: (m, _) =>
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  Future<void> _bookStay() async {
    if (ServiceLocator.instance.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final start = DateTime.now().add(const Duration(days: 1));
    final end = start.add(const Duration(days: 2));
    String two(int n) => n.toString().padLeft(2, '0');
    String ymd(DateTime d) => '${d.year}-${two(d.month)}-${two(d.day)}';
    final result =
        await _store.bookStay(checkIn: ymd(start), checkOut: ymd(end));
    if (!mounted) return;
    result.when(
      success: (data) {
        pushCheckout(context, data);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Booking started')),
        );
      },
      failure: (m, _) =>
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m))),
    );
  }

  Future<void> _buyGold(ListingModel item) async {
    final sl = ServiceLocator.instance;
    if (sl.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final result = await _store.buy();
    if (!mounted) return;
    result.when(
      success: (buy) {
        pushCheckout(context, buy);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              [
                'Checkout started. Seller price ${buy.originalPrice ?? item.price} ${buy.originalCurrency ?? item.currency} is unchanged by the market rate.',
                if (buy.requiresPhysicalVerification)
                  'Independent physical verification is recommended.',
              ].join(' '),
            ),
          ),
        );
      },
      failure: (m, _) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
      },
    );
  }

  Future<void> _bidGold(ListingModel item) async {
    final sl = ServiceLocator.instance;
    if (sl.authRepository.isGuest) {
      context.push(AppRoutes.login);
      return;
    }
    final auction = item.auction;
    if (auction == null) return;
    final controller = TextEditingController(
      text: (auction.currentBid ?? auction.startPrice ?? 0).toString(),
    );
    final amount = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Place a bid'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Current highest bid is set by the server. Minimum increment: ${auction.bidIncrement ?? 1} ${auction.currency ?? item.currency}.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Your bid amount'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(ctx, double.tryParse(controller.text.trim())),
            child: const Text('Bid'),
          ),
        ],
      ),
    );
    if (amount == null || amount <= 0 || !mounted) return;
    final result = await _store.bid(amount);
    if (!mounted) return;
    result.when(
      success: (_) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'Bid submitted. Server time and highest bid are authoritative.',
            ),
          ),
        );
      },
      failure: (m, _) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return SignalBuilder(builder: (context) {
    return AppScaffold(
      title: l10n.listingDetails,
      onBack: () {
        if (context.canPop()) {
          context.pop();
        } else {
          context.go(AppRoutes.home);
        }
      },
      actions: [
        IconButton(
          tooltip: 'Home',
          icon: const Icon(Icons.home_outlined),
          onPressed: () => context.go(AppRoutes.home),
        ),
        IconButton(
          tooltip: 'Compare',
          icon: const Icon(Icons.compare_arrows),
          onPressed: () {
            final item = _store.listing.value.dataOrNull;
            if (item == null) return;
            ServiceLocator.instance.compareStore.addListing(
              item.id,
              listing: item,
            );
            context.push(AppRoutes.compare);
          },
        ),
        IconButton(
          tooltip: context.l10n.saveFavorite,
          icon: Icon(
            (_store.listing.value.dataOrNull?.isFavorited ?? false)
                ? Icons.favorite
                : Icons.favorite_border,
          ),
          onPressed: () async {
            final item = _store.listing.value.dataOrNull;
            if (item == null) return;
            final sl = ServiceLocator.instance;
            final listingId = int.tryParse(item.id);
            if (listingId == null) return;
            if (sl.authRepository.isGuest || !sl.authRepository.hasActiveSession) {
              sl.settingsRepository.setPendingRoute('/listing/${item.routeId}');
              await sl.favoritesStore.rememberGuestSave(
                entityId: listingId,
                listingId: listingId,
                marketplaceCode: item.marketplace,
                route: '/listing/${item.routeId}',
              );
              if (context.mounted) context.push(AppRoutes.login);
              return;
            }
            await sl.favoritesStore.toggleListing(item);
            await _store.load();
          },
        ),
        IconButton(
          tooltip: context.l10n.shareListing,
          icon: const Icon(Icons.share_outlined),
          onPressed: () async {
            final item = _store.listing.value.dataOrNull;
            if (item == null) return;
            final listingId = int.tryParse(item.id);
            final sl = ServiceLocator.instance;
            if (listingId != null && sl.authRepository.hasActiveSession && !sl.authRepository.isGuest) {
              final result = await sl.favoritesStore.share(
                targetType: 'listing',
                targetId: listingId,
              );
              result.when(
                success: (link) => SharePlus.instance.share(ShareParams(text: link.url)),
                failure: (m, _) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
                },
              );
              return;
            }
            await SharePlus.instance.share(
              ShareParams(text: '${ApiConfig.baseUrl}/listings/${item.routeId}'),
            );
          },
        ),
        IconButton(
          tooltip: 'Manage listing',
          icon: const Icon(Icons.tune),
          onPressed: () {
            final item = _store.listing.value.dataOrNull;
            if (item == null) return;
            if (!_isOwner(item) && item.canEdit != true) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Only the seller can manage this listing')),
              );
              return;
            }
            context.push('/listing/${item.routeId}/manage');
          },
        ),
      ],
      body: SignalBuilder(builder: (context) {
        final state = _store.listing.value;
        if (state.isLoading) return const LoadingView();
        if (state case AsyncError(:final message)) {
          return EmptyState(
            title: message,
            action: FilledButton(
              onPressed: _store.load,
              child: Text(l10n.retry),
            ),
          );
        }
        final item = state.dataOrNull!;
        final owner = _isOwner(item);
        final statusLabel = _statusLabel(item.status);
        final operation = _operationLabel(item.operation);
        final gallery = item.mediaItems.isNotEmpty
            ? item.mediaItems
            : item.galleryUrls
                .map((url) => ListingMediaItem(id: 0, url: url))
                .toList();
        final pad = context.isCompact ? 16.0 : 24.0;

        return RefreshIndicator(
          onRefresh: _store.load,
          child: SingleChildScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: EdgeInsets.fromLTRB(pad, pad, pad, 96),
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 800),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (widget.justPosted) ...[
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: AppColors.charcoalSurface,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: AppColors.gold.withValues(alpha: 0.35),
                          ),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Your listing was submitted',
                              style: Theme.of(context)
                                  .textTheme
                                  .titleMedium
                                  ?.copyWith(
                                    color: AppColors.gold,
                                    fontWeight: FontWeight.w700,
                                  ),
                            ),
                            const SizedBox(height: 6),
                            Text(
                              statusLabel.isEmpty
                                  ? 'Manage it anytime from Profile → My ads. Use Sell (+) to post another.'
                                  : 'Status: $statusLabel. Find it under Profile → My ads.',
                            ),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                FilledButton(
                                  onPressed: () => context.go(AppRoutes.home),
                                  child: const Text('Back to home'),
                                ),
                                OutlinedButton(
                                  onPressed: () =>
                                      context.push(AppRoutes.seller),
                                  child: Text(l10n.myAds),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],
                    _HeroGallery(
                      items: gallery,
                      index: _galleryIndex,
                      onIndexChanged: (i) => setState(() => _galleryIndex = i),
                      marketplace: item.marketplace,
                    ),
                    const SizedBox(height: 14),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        if (operation.isNotEmpty)
                          Chip(
                            label: Text(operation),
                            backgroundColor:
                                AppColors.gold.withValues(alpha: 0.15),
                            side: BorderSide(
                              color: AppColors.gold.withValues(alpha: 0.45),
                            ),
                          ),
                        if (statusLabel.isNotEmpty &&
                            (owner || item.status != 'published'))
                          Chip(
                            label: Text(statusLabel),
                            backgroundColor: AppColors.charcoalSurface,
                          ),
                        if (owner)
                          const Chip(
                            avatar: Icon(Icons.person_outline, size: 16),
                            label: Text('Your ad'),
                          ),
                        if (item.isFeatured)
                          const Chip(label: Text('Featured')),
                        if (item.isVerified)
                          const Chip(label: Text('Verified')),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Text(
                      item.isVehicle ? item.vehicleTitleLine : item.title,
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 8),
                    PriceText(
                      amount: item.price,
                      currency: item.currency,
                      period: item.pricePeriod,
                      style:
                          Theme.of(context).textTheme.headlineMedium?.copyWith(
                                color: AppColors.gold,
                                fontWeight: FontWeight.w700,
                              ),
                    ),
                    if (item.location != null) ...[
                      const SizedBox(height: 8),
                      Row(
                        children: [
                          const Icon(
                            Icons.place_outlined,
                            size: 18,
                            color: AppColors.gold,
                          ),
                          const SizedBox(width: 4),
                          Expanded(child: Text(item.location!)),
                        ],
                      ),
                    ],
                    if (item.categoryName != null &&
                        item.categoryName!.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Text(
                        item.categoryName!,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: AppColors.goldMuted,
                            ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    if (item.isGold) _GoldSpecs(listing: item),
                    if (item.isGold) ...[
                      const SizedBox(height: 16),
                      _GoldRiskCard(assessment: _store.risk.value),
                    ],
                    if ((item.isGold || item.isVehicle) && item.auction != null) ...[
                      const SizedBox(height: 16),
                      _GoldAuctionCard(auction: item.auction!),
                    ],
                    if (item.isProperty) _PropertySpecs(listing: item),
                    if ((item.isProperty || item.isVehicle) &&
                        _store.badges.value.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          for (final badge in _badgeItems(_store.badges.value))
                            Chip(
                              avatar: const Icon(Icons.verified_outlined, size: 16),
                              label: Text(badge),
                            ),
                        ],
                      ),
                    ],
                    if (item.isProperty && _store.valuation.value != null) ...[
                      const SizedBox(height: 16),
                      _PropertyValuationCard(valuation: _store.valuation.value!),
                    ],
                    if (item.isVehicle) _VehicleSpecs(listing: item),
                    if (item.isVehicle && _store.vehicleValuation.value != null) ...[
                      const SizedBox(height: 16),
                      _VehicleValuationCard(valuation: _store.vehicleValuation.value!),
                    ],
                    if (item.isVehicle && _store.vehicleLandedCost.value != null) ...[
                      const SizedBox(height: 16),
                      _VehicleLandedCostCard(quote: _store.vehicleLandedCost.value!),
                    ],
                    if (item.isVehicle && _store.vehicleFinance.value != null) ...[
                      const SizedBox(height: 16),
                      _VehicleFinanceCard(quote: _store.vehicleFinance.value!),
                    ],
                    if (item.isVehicle && _store.vehicleInsurance.value != null) ...[
                      const SizedBox(height: 16),
                      _VehicleInsuranceCard(quote: _store.vehicleInsurance.value!),
                    ],
                    if (item.description != null &&
                        item.description!.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      Text(
                        'Description',
                        style: Theme.of(context).textTheme.titleMedium,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        item.description!,
                        style: Theme.of(context).textTheme.bodyLarge,
                      ),
                    ],
                    if (item.seller != null &&
                        (item.seller!.displayName?.isNotEmpty ?? false)) ...[
                      const SizedBox(height: 20),
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(
                          backgroundColor: AppColors.charcoalSurface,
                          child: Text(
                            (item.seller!.displayName ?? 'S')[0].toUpperCase(),
                            style: const TextStyle(color: AppColors.gold),
                          ),
                        ),
                        title: Text(item.seller!.displayName!),
                        subtitle: Text(
                          [
                            if (owner) 'You',
                            if (item.seller!.isVerified) 'Verified',
                            if (item.seller!.rating != null)
                              '${item.seller!.rating!.toStringAsFixed(1)}★',
                            if (item.seller!.businessName != null)
                              item.seller!.businessName!,
                          ].join(' · '),
                        ),
                      ),
                    ],
                    ReviewsSection(
                      listingId: item.numericId ?? 0,
                      isOwner: owner,
                    ),
                    AdSlot(
                      placementCode: 'listing_detail_native',
                      listingId: item.numericId,
                    ),
                    if (!owner) ...[
                      const SizedBox(height: 24),
                      if (item.isGold && item.operation != 'auction')
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: FilledButton.icon(
                            onPressed: _store.busy.value
                                ? null
                                : () => _buyGold(item),
                            icon: const Icon(Icons.shopping_bag_outlined),
                            label: const Text('Buy'),
                          ),
                        ),
                      if (item.isGold && item.auction != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: FilledButton.icon(
                            onPressed: _store.busy.value
                                ? null
                                : () => _bidGold(item),
                            icon: const Icon(Icons.gavel),
                            label: const Text('Place bid'),
                          ),
                        ),
                      if (item.isProperty && item.operation != 'rent') ...[
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: FilledButton.icon(
                            onPressed: _store.busy.value
                                ? null
                                : _buyProperty,
                            icon: const Icon(Icons.shopping_bag_outlined),
                            label: const Text('Start purchase'),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: OutlinedButton.icon(
                            onPressed: _store.busy.value
                                ? null
                                : () => _offerProperty(item),
                            icon: const Icon(Icons.request_quote_outlined),
                            label: const Text('Make offer'),
                          ),
                        ),
                      ],
                      if (item.isProperty && item.operation == 'rent') ...[
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: FilledButton.icon(
                            onPressed: _store.busy.value ? null : _applyRent,
                            icon: const Icon(Icons.assignment_outlined),
                            label: const Text('Apply to rent'),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: OutlinedButton.icon(
                            onPressed: _store.busy.value ? null : _bookStay,
                            icon: const Icon(Icons.hotel_outlined),
                            label: const Text('Book stay'),
                          ),
                        ),
                      ],
                      if (item.isVehicle && item.operation != 'rent' && item.operation != 'auction') ...[
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: FilledButton.icon(
                            onPressed: _store.busy.value ? null : _buyVehicle,
                            icon: const Icon(Icons.shopping_bag_outlined),
                            label: const Text('Start purchase'),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: OutlinedButton.icon(
                            onPressed: _store.busy.value
                                ? null
                                : () => _offerVehicle(item),
                            icon: const Icon(Icons.request_quote_outlined),
                            label: const Text('Make offer'),
                          ),
                        ),
                      ],
                      if (item.isVehicle && item.operation == 'rent') ...[
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: FilledButton.icon(
                            onPressed: _store.busy.value ? null : _bookVehicle,
                            icon: const Icon(Icons.event_available_outlined),
                            label: const Text('Book rental'),
                          ),
                        ),
                      ],
                      if (item.isVehicle && item.auction != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: FilledButton.icon(
                            onPressed: _store.busy.value
                                ? null
                                : () => _bidVehicle(item),
                            icon: const Icon(Icons.gavel),
                            label: const Text('Place bid'),
                          ),
                        ),
                      Row(
                        children: [
                          if (item.allowChat)
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: () => _contactSeller(item),
                                icon: const Icon(Icons.chat_outlined),
                                label: Text(l10n.contactSeller),
                              ),
                            )
                          else
                            const Expanded(
                              child: Text('Chat is disabled for this listing'),
                            ),
                          const SizedBox(width: 12),
                          OutlinedButton(
                            onPressed: () {
                              if (ServiceLocator
                                  .instance.authRepository.isGuest) {
                                context.push(AppRoutes.login);
                                return;
                              }
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Favorites are coming soon'),
                                ),
                              );
                            },
                            child: Text(l10n.saveFavorite),
                          ),
                        ],
                      ),
                      if (item.allowCalls) ...[
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            OutlinedButton.icon(
                              onPressed: () =>
                                  _startListingCall(item, video: false),
                              icon: const Icon(Icons.call_outlined),
                              label: const Text('Voice call'),
                            ),
                            OutlinedButton.icon(
                              onPressed: () =>
                                  _startListingCall(item, video: true),
                              icon: const Icon(Icons.videocam_outlined),
                              label: const Text('Video call'),
                            ),
                            OutlinedButton.icon(
                              onPressed: () => _startMaskedCall(item),
                              icon: const Icon(Icons.phonelink_lock_outlined),
                              label: const Text('Masked call'),
                            ),
                          ],
                        ),
                      ],
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: () => context.push(
                          AppRoutes.supportWith(
                            SupportContextQuery(
                              marketplace: item.marketplace,
                              entityType: 'listing',
                              entityId: int.tryParse(item.id)?.toString(),
                              listingId: int.tryParse(item.id)?.toString(),
                              listingUuid: item.uuid ?? (item.id.contains('-') ? item.id : null),
                              category: item.marketplace == 'gold'
                                  ? 'gold'
                                  : item.marketplace == 'property'
                                      ? 'property'
                                      : 'vehicles',
                            ),
                          ),
                        ),
                        icon: const Icon(Icons.support_agent_outlined),
                        label: const Text('Report a problem'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        );
      }),
    );
    });
  }
}

class _HeroGallery extends StatelessWidget {
  const _HeroGallery({
    required this.items,
    required this.index,
    required this.onIndexChanged,
    required this.marketplace,
  });

  final List<ListingMediaItem> items;
  final int index;
  final ValueChanged<int> onIndexChanged;
  final String marketplace;

  IconData get _placeholderIcon => switch (marketplace) {
        'gold' => Icons.diamond_outlined,
        'property' => Icons.home_work_outlined,
        'vehicles' => Icons.directions_car_outlined,
        _ => Icons.image_outlined,
      };

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: AspectRatio(
            aspectRatio: 16 / 10,
            child: items.isEmpty
                ? Container(
                    color: AppColors.charcoalSurface,
                    child: Icon(_placeholderIcon,
                        color: AppColors.goldMuted, size: 48),
                  )
                : PageView.builder(
                    itemCount: items.length,
                    onPageChanged: onIndexChanged,
                    itemBuilder: (_, i) {
                      final item = items[i];
                      if (item.isVideo) return _GalleryVideo(url: item.url);
                      return InteractiveViewer(
                        minScale: 1,
                        maxScale: 4,
                        child: CachedNetworkImage(
                        imageUrl: item.url,
                        fit: BoxFit.cover,
                        placeholder: (_, _) => Container(
                          color: AppColors.charcoalSurface,
                          child: const Center(
                            child: CircularProgressIndicator(
                              color: AppColors.gold,
                              strokeWidth: 2,
                            ),
                          ),
                        ),
                        errorWidget: (_, _, _) => Container(
                          color: AppColors.charcoalSurface,
                          child: Icon(_placeholderIcon, color: AppColors.goldMuted),
                        ),
                      ),
                      );
                    },
                  ),
          ),
        ),
        if (items.length > 1) ...[
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < items.length; i++)
                Container(
                  width: 7,
                  height: 7,
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: i == index
                        ? AppColors.gold
                        : AppColors.gold.withValues(alpha: 0.25),
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _GalleryVideo extends StatefulWidget {
  const _GalleryVideo({required this.url});
  final String url;

  @override
  State<_GalleryVideo> createState() => _GalleryVideoState();
}

class _GalleryVideoState extends State<_GalleryVideo> {
  VideoPlayerController? _controller;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    final controller = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _controller = controller;
    controller.initialize().then((_) {
      if (mounted) setState(() => _ready = true);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    if (!_ready || controller == null || !controller.value.isInitialized) {
      return Container(
        color: AppColors.charcoalSurface,
        child: const Center(
          child: CircularProgressIndicator(color: AppColors.gold, strokeWidth: 2),
        ),
      );
    }
    return GestureDetector(
      onTap: () {
        if (controller.value.isPlaying) {
          controller.pause();
        } else {
          controller.play();
        }
        setState(() {});
      },
      child: Stack(
        fit: StackFit.expand,
        children: [
          FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(
              width: controller.value.size.width,
              height: controller.value.size.height,
              child: VideoPlayer(controller),
            ),
          ),
          if (!controller.value.isPlaying)
            const Center(
              child: Icon(Icons.play_circle_fill, color: Colors.white70, size: 56),
            ),
        ],
      ),
    );
  }
}

class _GoldSpecs extends StatelessWidget {
  const _GoldSpecs({required this.listing});
  final ListingModel listing;

  @override
  Widget build(BuildContext context) {
    final rows = <(String, String)>[
      if (listing.karat != null)
        (
          'Karat',
          '${listing.karat == listing.karat!.roundToDouble() ? listing.karat!.toInt() : listing.karat}K'
        ),
      if (listing.fineness != null) ('Fineness', '${listing.fineness}'),
      if (listing.metalType != null)
        ('Metal', listing.metalType!.replaceAll('_', ' ')),
      if (listing.weightLabel.isNotEmpty) ('Net weight', listing.weightLabel),
      if (listing.grossWeightG != null)
        ('Gross weight', '${listing.grossWeightG} g'),
      if (listing.stoneWeightG != null)
        ('Stone/other weight', '${listing.stoneWeightG} g'),
      if (listing.fineGoldWeightG != null)
        ('Fine gold weight', '${listing.fineGoldWeightG} g'),
      if (listing.form != null) ('Form', listing.form!),
      if (listing.jewelleryType != null)
        ('Type', listing.jewelleryType!.replaceAll('_', ' ')),
      if (listing.brandName != null) ('Brand', listing.brandName!),
      if (listing.serialNumber != null) ('Serial', listing.serialNumber!),
      if (listing.packaging != null) ('Packaging', listing.packaging!),
      if (listing.makingCharges != null)
        (
          'Making charges',
          '${listing.makingCharges!.toStringAsFixed(0)} ${listing.currency}${listing.makingChargeType == null ? '' : ' (${listing.makingChargeType})'}'
        ),
      if (listing.isHallmarked)
        ('Hallmark', listing.hallmarkCode ?? 'Declared'),
      if (listing.hasCertificate)
        ('Certificate', listing.certificateNumber ?? 'On file (protected)'),
      if (listing.isInvestmentGrade) ('Investment grade', 'Yes'),
      if (listing.buybackAvailable) ('Buyback', 'Available'),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Gold details', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        _SpecGrid(rows: rows),
      ],
    );
  }
}

class _GoldRiskCard extends StatelessWidget {
  const _GoldRiskCard({this.assessment});
  final GoldRiskAssessment? assessment;

  @override
  Widget build(BuildContext context) {
    final item = assessment;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            item?.headline ?? 'AI authenticity assessment',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: AppColors.gold,
                ),
          ),
          const SizedBox(height: 8),
          Text(
            item?.recommendation ??
                'AI could not confidently assess authenticity.',
          ),
          const SizedBox(height: 8),
          Text(
            item?.disclaimer ??
                'AI authenticity assessment is a risk-support tool. It cannot prove physical gold is genuine. Independent physical verification is recommended for high-value transactions.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (item != null && item.reasons.isNotEmpty) ...[
            const SizedBox(height: 8),
            for (final reason in item.reasons.take(5))
              Text('• $reason', style: Theme.of(context).textTheme.bodySmall),
          ],
        ],
      ),
    );
  }
}

class _GoldAuctionCard extends StatelessWidget {
  const _GoldAuctionCard({required this.auction});
  final ListingAuction auction;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Auction', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text('Status: ${auction.status ?? 'unknown'}'),
          Text(
            'Highest bid: ${auction.currentBid?.toStringAsFixed(0) ?? '—'} ${auction.currency ?? ''}',
          ),
          Text('Bids: ${auction.bidCount}'),
          if (auction.endsAt != null) Text('Ends: ${auction.endsAt}'),
          if (auction.serverNow != null)
            Text(
              'Server time: ${auction.serverNow}',
              style: Theme.of(context).textTheme.bodySmall,
            ),
        ],
      ),
    );
  }
}

class _PropertySpecs extends StatelessWidget {
  const _PropertySpecs({required this.listing});
  final ListingModel listing;

  @override
  Widget build(BuildContext context) {
    final rows = <(String, String)>[
      if (listing.propertyKind != null)
        ('Type', listing.propertyKind!.replaceAll('_', ' ')),
      if (listing.operation != null)
        (
          'Purpose',
          switch (listing.operation!) {
            'sell' => 'For sale',
            'rent' => 'For rent',
            'buy' => 'Wanted',
            'auction' => 'Auction',
            'exchange' => 'Exchange',
            _ => listing.operation!,
          },
        ),
      if (listing.bedrooms != null) ('Bedrooms', '${listing.bedrooms}'),
      if (listing.bathrooms != null) ('Bathrooms', '${listing.bathrooms}'),
      if (listing.areaLabel.isNotEmpty) ('Area', listing.areaLabel),
      if (listing.furnishing != null) ('Furnishing', listing.furnishing!),
      if (listing.parkingSpaces != null)
        ('Parking', '${listing.parkingSpaces}'),
      if (listing.societyName != null) ('Society', listing.societyName!),
      if (listing.pricePerSqm != null)
        (
          'Price / area',
          '${listing.pricePerSqm!.toStringAsFixed(0)} ${listing.currency}'
        ),
    ];

    final amenities = <String>[
      if (listing.hasSwimmingPool) 'Pool',
      if (listing.hasGym) 'Gym',
      if (listing.hasGarden) 'Garden',
      if (listing.hasElevator) 'Elevator',
      if (listing.hasSecurity) 'Security',
      if (listing.isGatedCommunity) 'Gated',
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Property details',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        _SpecGrid(rows: rows),
        if (amenities.isNotEmpty) ...[
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final a in amenities)
                Chip(
                  label: Text(a),
                  backgroundColor: AppColors.charcoalSurface,
                ),
            ],
          ),
        ],
      ],
    );
  }
}

class _PropertyValuationCard extends StatelessWidget {
  const _PropertyValuationCard({required this.valuation});
  final PropertyValuation valuation;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'AI valuation assistance',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            '${valuation.valueLow.toStringAsFixed(0)} – ${valuation.valueHigh.toStringAsFixed(0)} ${valuation.currency}',
          ),
          Text(
            'Mid ${valuation.valueMid.toStringAsFixed(0)} · confidence ${(valuation.confidence * (valuation.confidence <= 1 ? 100 : 1)).toStringAsFixed(0)}%',
          ),
          const SizedBox(height: 8),
          Text(
            valuation.disclaimer,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}

class _VehicleValuationCard extends StatelessWidget {
  const _VehicleValuationCard({required this.valuation});
  final VehicleValuation valuation;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'AI valuation assistance',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            '${valuation.valueLow.toStringAsFixed(0)} – ${valuation.valueHigh.toStringAsFixed(0)} ${valuation.currency}',
          ),
          Text(
            'Mid ${valuation.valueMid.toStringAsFixed(0)} · confidence ${(valuation.confidence * (valuation.confidence <= 1 ? 100 : 1)).toStringAsFixed(0)}%',
          ),
          const SizedBox(height: 8),
          Text(
            valuation.disclaimer,
            style: Theme.of(context).textTheme.bodySmall,
          ),
          if (valuation.legalDisclaimer != null) ...[
            const SizedBox(height: 8),
            Text(
              valuation.legalDisclaimer!,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ],
      ),
    );
  }
}

class _VehicleLandedCostCard extends StatelessWidget {
  const _VehicleLandedCostCard({required this.quote});
  final VehicleLandedCost quote;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Estimated landed cost (${quote.status})',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text('${quote.total.toStringAsFixed(0)} ${quote.currency}'),
          const SizedBox(height: 8),
          for (final entry in quote.components.entries)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Row(
                children: [
                  Expanded(child: Text(entry.key.replaceAllMapped(
                    RegExp(r'([A-Z])'),
                    (m) => ' ${m[1]!.toLowerCase()}',
                  ))),
                  Text('${entry.value.toStringAsFixed(0)} ${quote.currency}'),
                ],
              ),
            ),
          const SizedBox(height: 8),
          Text(quote.disclaimer, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _VehicleFinanceCard extends StatelessWidget {
  const _VehicleFinanceCard({required this.quote});
  final VehicleFinanceQuote quote;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            quote.isEstimate ? 'Estimated monthly payment' : 'Lender offer',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text(
            '${quote.estimatedMonthly.toStringAsFixed(0)} ${quote.currency} / month',
          ),
          Text(
            'Loan ${quote.loanAmount.toStringAsFixed(0)} · down ${quote.downPayment.toStringAsFixed(0)} · ${quote.termMonths} months',
          ),
          const SizedBox(height: 8),
          Text(quote.disclaimer, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _VehicleInsuranceCard extends StatelessWidget {
  const _VehicleInsuranceCard({required this.quote});
  final VehicleInsuranceQuote quote;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            quote.isEstimate ? 'Insurance estimate' : 'Insurance quote',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          Text('${quote.premium.toStringAsFixed(0)} ${quote.currency}'),
          if (quote.coverage != null) Text(quote.coverage!),
          const SizedBox(height: 8),
          Text(quote.disclaimer, style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _VehicleSpecs extends StatelessWidget {
  const _VehicleSpecs({required this.listing});
  final ListingModel listing;

  @override
  Widget build(BuildContext context) {
    final rows = <(String, String)>[
      if (listing.year != null) ('Year', '${listing.year}'),
      if (listing.makeName != null) ('Make', listing.makeName!),
      if (listing.modelName != null) ('Model', listing.modelName!),
      if (listing.variantName != null) ('Variant', listing.variantName!),
      if (listing.mileageLabel.isNotEmpty) ('Mileage', listing.mileageLabel),
      if (listing.fuelType != null) ('Fuel', listing.fuelType!),
      if (listing.transmission != null)
        ('Transmission', listing.transmission!),
      if (listing.bodyType != null) ('Body', listing.bodyType!),
      if (listing.engineCc != null) ('Engine', '${listing.engineCc} cc'),
      if (listing.colorExterior != null) ('Color', listing.colorExterior!),
      if (listing.dealRating != null)
        ('Deal rating', listing.dealRating!.replaceAll('_', ' ')),
      if (listing.isInspected)
        (
          'Inspection',
          listing.inspectionScore != null
              ? 'Score ${listing.inspectionScore}'
              : 'Inspected'
        ),
      if (listing.financeAvailable) ('Finance', 'Available'),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Vehicle specifications',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 8),
        _SpecGrid(rows: rows),
      ],
    );
  }
}

class _SpecGrid extends StatelessWidget {
  const _SpecGrid({required this.rows});
  final List<(String, String)> rows;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return Text(
        'No specifications published yet.',
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Theme.of(context)
                  .colorScheme
                  .onSurface
                  .withValues(alpha: 0.6),
            ),
      );
    }
    return Container(
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.2)),
      ),
      child: Column(
        children: [
          for (var i = 0; i < rows.length; i++)
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              decoration: BoxDecoration(
                border: i == rows.length - 1
                    ? null
                    : Border(
                        bottom: BorderSide(
                          color: AppColors.stoneDark.withValues(alpha: 0.5),
                        ),
                      ),
              ),
              child: Row(
                children: [
                  Expanded(
                    flex: 2,
                    child: Text(
                      rows[i].$1,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: AppColors.goldMuted,
                          ),
                    ),
                  ),
                  Expanded(
                    flex: 3,
                    child: Text(
                      rows[i].$2,
                      style: Theme.of(context).textTheme.bodyLarge,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
