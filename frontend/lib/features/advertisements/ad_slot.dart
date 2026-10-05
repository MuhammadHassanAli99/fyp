import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../reviews/data/review_models.dart';

class AdSlot extends StatefulWidget {
  const AdSlot({
    super.key,
    required this.placementCode,
    this.ads,
    this.listingId,
  });

  final String placementCode;
  final List<ServedAd>? ads;
  final int? listingId;

  @override
  State<AdSlot> createState() => _AdSlotState();
}

class _AdSlotState extends State<AdSlot> {
  List<ServedAd> _ads = const [];
  final _tracked = <String>{};
  final _impressions = <String, String>{};

  @override
  void initState() {
    super.initState();
    if (widget.ads != null) {
      _ads = widget.ads!;
      _track();
    } else {
      _load();
    }
  }

  Future<void> _load() async {
    final ads = await ServiceLocator.instance.adsStore.serve(widget.placementCode);
    if (!mounted) return;
    setState(() => _ads = ads);
    _track();
  }

  Future<void> _track() async {
    for (final ad in _ads) {
      if (_tracked.contains(ad.uuid)) continue;
      _tracked.add(ad.uuid);
      final uuid = await ServiceLocator.instance.adsStore.recordImpression(ad, listingId: widget.listingId);
      if (uuid != null) _impressions[ad.uuid] = uuid;
    }
  }

  Future<void> _open(ServedAd ad) async {
    await ServiceLocator.instance.adsStore.recordClick(ad, impressionUuid: _impressions[ad.uuid]);
    if (!mounted) return;
    if (ad.listingId != null) {
      context.push('/listing/${ad.listingId}');
      return;
    }
    final url = ad.landingUrl ?? ad.deepLink;
    if (url == null) return;
    final uri = Uri.tryParse(url);
    if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    if (_ads.isEmpty) return const SizedBox.shrink();
    final ad = _ads.first;
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 8),
      color: AppColors.charcoalSurface,
      child: InkWell(
        onTap: () => _open(ad),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              if (ad.imageUrl != null)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.network(ad.imageUrl!, width: 88, height: 66, fit: BoxFit.cover),
                )
              else
                const Icon(Icons.campaign_outlined, color: AppColors.gold),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      ad.label.toUpperCase(),
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppColors.goldMuted),
                    ),
                    Text(ad.headline ?? 'Sponsored', style: Theme.of(context).textTheme.titleSmall),
                    if (ad.body != null)
                      Text(ad.body!, maxLines: 2, overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
              Text(ad.ctaLabel ?? 'View', style: const TextStyle(color: AppColors.gold)),
            ],
          ),
        ),
      ),
    );
  }
}
