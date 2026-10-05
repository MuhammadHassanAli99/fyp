import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../data/models/listing_model.dart';
import '../../data/services/fx_service.dart';
import '../formatters/price_formatter.dart';

class PriceText extends StatefulWidget {
  const PriceText({
    super.key,
    required this.amount,
    required this.currency,
    this.period,
    this.style,
  });

  final double amount;
  final String currency;
  final String? period;
  final TextStyle? style;

  @override
  State<PriceText> createState() => _PriceTextState();
}

class _PriceTextState extends State<PriceText> {
  double? _converted;
  String? _preferred;
  double? _rate;
  bool _stale = false;

  @override
  void initState() {
    super.initState();
    _loadConversion();
  }

  @override
  void didUpdateWidget(covariant PriceText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.amount != widget.amount ||
        oldWidget.currency != widget.currency) {
      _loadConversion();
    }
  }

  Future<void> _loadConversion() async {
    final settings = ServiceLocator.instance.settingsRepository;
    final preferred = settings.currencyCode.toUpperCase();
    final source = widget.currency.toUpperCase();
    if (preferred == source) {
      if (mounted) {
        setState(() {
          _converted = null;
          _preferred = preferred;
          _rate = null;
          _stale = false;
        });
      }
      return;
    }
    final result = await settings.fx.convert(
      amount: widget.amount,
      from: source,
      to: preferred,
    );
    if (!mounted) return;
    setState(() {
      _preferred = preferred;
      _converted = result?.amount;
      _rate = result?.rate;
      _stale = result?.stale == true ||
          (result?.fetchedAt != null &&
              DateTime.now().difference(result!.fetchedAt!) >
                  FxService.staleAfter);
    });
  }

  @override
  Widget build(BuildContext context) {
    final settings = ServiceLocator.instance.settingsRepository;
    final showOriginal = settings.showOriginalPrice;
    final hidePeriod = widget.period == null ||
        widget.period!.isEmpty ||
        widget.period == 'once' ||
        widget.period == 'total';

    final primaryCurrency = _converted != null && _preferred != null
        ? _preferred!
        : widget.currency;
    final primaryAmount = _converted ?? widget.amount;
    final primary = PriceFormatter.format(primaryAmount, primaryCurrency);
    final approxPrefix = _converted != null &&
            _preferred != null &&
            _preferred!.toUpperCase() != widget.currency.toUpperCase()
        ? '≈ '
        : '';
    final primaryText =
        hidePeriod ? '$approxPrefix$primary' : '$approxPrefix$primary / ${widget.period}';

    final style = widget.style ??
        Theme.of(context).textTheme.titleMedium?.copyWith(
              color: AppColors.gold,
              fontWeight: FontWeight.w700,
            );

    final showSecondary = showOriginal &&
        _converted != null &&
        _preferred != null &&
        _preferred!.toUpperCase() != widget.currency.toUpperCase();
    final stale = _stale;

    if (!showSecondary) {
      return Text(
        primaryText,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: style,
      );
    }

    final original = PriceFormatter.format(widget.amount, widget.currency);
    final rateHint = _rate != null
        ? ' · 1 ${widget.currency} ≈ ${_rate!.toStringAsFixed(4)} $_preferred'
        : '';
    final staleHint = stale ? ' · rate may be outdated' : '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          primaryText,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: style,
        ),
        Text(
          'Original $original$rateHint$staleHint',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: AppColors.stone.withValues(alpha: 0.7),
              ),
        ),
      ],
    );
  }
}

class ListingCard extends StatelessWidget {
  const ListingCard({
    super.key,
    required this.listing,
    this.onTap,
    this.onFavorite,
    this.onCompare,
    this.isGuest = false,
    this.compact = false,
  });

  final ListingModel listing;
  final VoidCallback? onTap;
  final VoidCallback? onFavorite;
  final VoidCallback? onCompare;
  final bool isGuest;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: compact ? _HorizontalCard(this) : _VerticalCard(this),
      ),
    );
  }
}

class _VerticalCard extends StatelessWidget {
  const _VerticalCard(this.parent);
  final ListingCard parent;

  @override
  Widget build(BuildContext context) {
    final listing = parent.listing;
    return LayoutBuilder(
      builder: (context, constraints) {
        final imageHeight = (constraints.maxHeight * 0.48).clamp(88.0, 180.0);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              height: imageHeight,
              child: _ImageHeader(listing: listing, fill: true),
            ),
            Expanded(
              child: ClipRect(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 8, 10, 6),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        listing.isVehicle
                            ? listing.vehicleTitleLine
                            : listing.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 4),
                      PriceText(
                        amount: listing.price,
                        currency: listing.currency,
                        period: listing.pricePeriod,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              color: AppColors.gold,
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Expanded(
                        child: Align(
                          alignment: Alignment.topLeft,
                          child: _MetaLine(listing: listing),
                        ),
                      ),
                      if (parent.onCompare != null ||
                          parent.onFavorite != null)
                        SizedBox(
                          height: 28,
                          child: Row(
                            children: [
                              if (parent.onCompare != null)
                                IconButton(
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(
                                    minWidth: 28,
                                    minHeight: 28,
                                  ),
                                  visualDensity: VisualDensity.compact,
                                  iconSize: 18,
                                  icon: const Icon(Icons.compare_arrows),
                                  tooltip: 'Compare',
                                  onPressed: parent.onCompare,
                                ),
                              if (parent.onFavorite != null)
                                IconButton(
                                  padding: EdgeInsets.zero,
                                  constraints: const BoxConstraints(
                                    minWidth: 28,
                                    minHeight: 28,
                                  ),
                                  visualDensity: VisualDensity.compact,
                                  iconSize: 18,
                                  icon: Icon(
                                    listing.isFavorited
                                        ? Icons.favorite
                                        : Icons.favorite_border,
                                    color: listing.isFavorited
                                        ? AppColors.gold
                                        : null,
                                  ),
                                  tooltip: parent.isGuest
                                      ? 'Sign in to save'
                                      : 'Favorite',
                                  onPressed: parent.onFavorite,
                                ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),
          ],
        );
      },
    );
  }
}

/// PakWheels-style horizontal row: image | title+specs | price.
class _HorizontalCard extends StatelessWidget {
  const _HorizontalCard(this.parent);
  final ListingCard parent;

  @override
  Widget build(BuildContext context) {
    final listing = parent.listing;
    return SizedBox(
      height: 118,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 132,
            child: _ImageHeader(listing: listing, fill: true),
          ),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    listing.isVehicle
                        ? listing.vehicleTitleLine
                        : listing.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 4),
                  if (listing.location != null && listing.location!.isNotEmpty)
                    Text(
                      listing.location!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.goldMuted,
                          ),
                    ),
                  const Spacer(),
                  _MetaLine(listing: listing, pipeSeparated: true),
                  const SizedBox(height: 4),
                  PriceText(
                    amount: listing.price,
                    currency: listing.currency,
                    period: listing.pricePeriod,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: AppColors.gold,
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                ],
              ),
            ),
          ),
          const Padding(
            padding: EdgeInsets.only(right: 8),
            child: Icon(Icons.chevron_right, color: AppColors.goldMuted),
          ),
        ],
      ),
    );
  }
}

class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.listing, this.pipeSeparated = false});
  final ListingModel listing;
  final bool pipeSeparated;

  @override
  Widget build(BuildContext context) {
    final parts = <String>[];

    if (listing.isGold) {
      if (listing.karat != null) {
        final k = listing.karat!;
        parts.add('${k == k.roundToDouble() ? k.toInt() : k}K');
      }
      final grams = listing.netWeightG;
      if (grams != null) {
        final settings = ServiceLocator.instance.settingsRepository;
        parts.add(
          settings.unitConverter.format(grams, settings.displayGoldWeightUnit),
        );
      } else if (listing.weightLabel.isNotEmpty) {
        parts.add(listing.weightLabel);
      }
      if (listing.form != null) parts.add(listing.form!);
    } else if (listing.isProperty) {
      if (listing.bedrooms != null) parts.add('${listing.bedrooms} Beds');
      if (listing.bathrooms != null) parts.add('${listing.bathrooms} Baths');
      final settings = ServiceLocator.instance.settingsRepository;
      final sqm = listing.detail<double>('areaSqm') ??
          (listing.areaValue != null
              ? settings.unitConverter.toCanonical(
                  listing.areaValue!,
                  listing.areaUnit ?? 'sqm',
                )
              : null);
      if (sqm != null) {
        parts.add(settings.unitConverter.format(sqm, settings.displayAreaUnit));
      } else if (listing.areaLabel.isNotEmpty) {
        parts.add(listing.areaLabel);
      }
    } else if (listing.isVehicle) {
      if (listing.year != null) parts.add('${listing.year}');
      final km = listing.mileageKm;
      if (km != null) {
        final settings = ServiceLocator.instance.settingsRepository;
        final metres = km * 1000.0;
        parts.add(
          settings.unitConverter.format(metres, settings.displayDistanceUnit),
        );
      } else if (listing.mileageLabel.isNotEmpty) {
        parts.add(listing.mileageLabel);
      }
      if (listing.fuelType != null) parts.add(listing.fuelType!);
      if (listing.engineCc != null) parts.add('${listing.engineCc} cc');
      if (listing.transmission != null) parts.add(listing.transmission!);
    }

    if (!pipeSeparated &&
        listing.location != null &&
        listing.location!.isNotEmpty) {
      parts.add(listing.location!);
    }
    if (listing.distanceKm != null) {
      parts.add('${listing.distanceKm!.toStringAsFixed(1)} km');
    }

    if (parts.isEmpty) return const SizedBox.shrink();

    return Text(
      parts.join(pipeSeparated ? ' | ' : ' · '),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: Theme.of(context).textTheme.bodySmall?.copyWith(
            color: AppColors.goldLight,
            fontWeight: FontWeight.w600,
          ),
    );
  }
}

/// Image with PakWheels-style overlays: one corner badge + photo count.
class _ImageHeader extends StatelessWidget {
  const _ImageHeader({required this.listing, this.fill = false});
  final ListingModel listing;
  final bool fill;

  @override
  Widget build(BuildContext context) {
    final image = Stack(
      fit: StackFit.expand,
      children: [
        listing.imageUrl != null
            ? CachedNetworkImage(
                imageUrl: listing.imageUrl!,
                fit: BoxFit.cover,
                memCacheWidth: ((fill ? 720 : 420) *
                        MediaQuery.devicePixelRatioOf(context))
                    .round()
                    .clamp(120, 900),
                placeholder: (_, _) => Container(
                  color: AppColors.charcoalSurface,
                  child: const Center(
                    child:
                        Icon(Icons.image_outlined, color: AppColors.goldMuted),
                  ),
                ),
                errorWidget: (_, _, _) => Container(
                  color: AppColors.charcoalSurface,
                  child: const Center(
                    child: Icon(Icons.broken_image_outlined,
                        color: AppColors.goldMuted),
                  ),
                ),
              )
            : Container(
                color: AppColors.charcoalSurface,
                child: Center(
                  child: Icon(
                    listing.isGold
                        ? Icons.diamond_outlined
                        : listing.isProperty
                            ? Icons.home_work_outlined
                            : listing.isVehicle
                                ? Icons.directions_car_outlined
                                : Icons.image_outlined,
                    color: AppColors.goldMuted,
                  ),
                ),
              ),
        // Sponsored is labeled separately from organic featured.
        if (listing.isSponsored)
          const Positioned(
            left: 0,
            top: 0,
            child: _CornerBadge(label: 'SPONSORED', emphasize: true),
          )
        else if (listing.isFeatured)
          const Positioned(
            left: 0,
            top: 0,
            child: _CornerBadge(label: 'FEATURED', emphasize: true),
          )
        else if (listing.isVerified)
          const Positioned(
            left: 0,
            top: 0,
            child: _CornerBadge(label: 'VERIFIED'),
          )
        else if (listing.operation != null && listing.operation != 'sell')
          Positioned(
            left: 0,
            top: 0,
            child: _CornerBadge(label: _shortOperation(listing.operation!)),
          ),
        // Photo count — bottom-left.
        if (listing.mediaCount > 0)
          Positioned(
            left: 6,
            bottom: 6,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: 0.65),
                borderRadius: BorderRadius.circular(4),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.photo_camera, size: 12, color: Colors.white),
                  const SizedBox(width: 3),
                  Text(
                    '${listing.mediaCount}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ),
        if (listing.hasVideo)
          const Positioned(
            right: 6,
            bottom: 6,
            child: Icon(Icons.play_circle_fill, color: Colors.white70, size: 22),
          ),
      ],
    );

    if (fill) return image;
    return AspectRatio(aspectRatio: 16 / 10, child: image);
  }

  String _shortOperation(String op) => switch (op) {
        'rent' => 'RENT',
        'buy' => 'WANTED',
        'auction' => 'AUCTION',
        'exchange' => 'EXCHANGE',
        _ => op.toUpperCase(),
      };
}

class _CornerBadge extends StatelessWidget {
  const _CornerBadge({required this.label, this.emphasize = false});
  final String label;
  final bool emphasize;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: emphasize
            ? const Color(0xFFB71C1C)
            : AppColors.charcoal.withValues(alpha: 0.88),
        borderRadius: const BorderRadius.only(
          bottomRight: Radius.circular(6),
        ),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: emphasize ? Colors.white : AppColors.gold,
          fontSize: 10,
          fontWeight: FontWeight.w800,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}
