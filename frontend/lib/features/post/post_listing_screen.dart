import 'dart:io';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/router.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/auth/guest_feature.dart';
import '../../core/result/async_state.dart';
import '../../core/result/result.dart';
import '../../data/models/gold_models.dart';
import '../../shared/widgets/app_scaffold.dart';
import '../../shared/widgets/drop_zone.dart';
import 'post_listing_store.dart';

class PostListingScreen extends StatefulWidget {
  const PostListingScreen({super.key});

  @override
  State<PostListingScreen> createState() => _PostListingScreenState();
}

class _PostListingScreenState extends State<PostListingScreen> {
  late final PostListingStore _store;

  @override
  void initState() {
    super.initState();
    final sl = ServiceLocator.instance;
    _store = PostListingStore(
      catalog: sl.catalogRepository,
      listings: sl.listingsRepository,
      settings: sl.settingsRepository,
      prefs: sl.prefs,
      profile: sl.profileRepository,
      gold: sl.goldRepository,
      database: sl.database,
      ai: sl.aiRepository,
    );
    _store.bootstrap();
  }

  @override
  void dispose() {
    _store.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final result = await _store.publish();
    if (!mounted) return;
    if (result case Success(:final data)) {
      final listing = data.listing;
      final status = listing.status ?? 'pending_review';
      final published = status == 'published';

      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: Text(published ? 'Listing live' : 'Listing submitted'),
          content: Text(
            published
                ? 'Your ad is now visible in the marketplace feed.'
                : 'Your ad is under quick review and usually goes live within seconds. You can keep browsing meanwhile.',
          ),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(ctx);
                context.go(AppRoutes.seller);
              },
              child: Text(context.l10n.myAds),
            ),
            TextButton(
              onPressed: () {
                Navigator.pop(ctx);
                context.go(AppRoutes.post);
              },
              child: const Text('Post another'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.pop(ctx);
                // Replace stack with listing; AppScaffold Back falls back to Home.
                context.go('/listing/${listing.routeId}?posted=1');
              },
              child: const Text('View listing'),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;

    return AppScaffold(
      title: l10n.postListing,
      showSellFab: false,
      body: GuestGate(
        feature: GuestFeature.postListing,
        message: l10n.guestRestrictionMessage,
        child: SignalBuilder(builder: (context) {
          final step = _store.step.value;
          return Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'Step ${_store.stepIndex + 1} of ${_store.totalSteps}',
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            color: AppColors.gold,
                          ),
                    ),
                    const SizedBox(height: 8),
                    LinearProgressIndicator(
                      value: (_store.stepIndex + 1) / _store.totalSteps,
                      color: AppColors.gold,
                      backgroundColor: AppColors.charcoalSurface,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Completeness ${_store.completeness.score}%'
                      '${_store.completeness.missing.isEmpty ? '' : ' · missing ${_store.completeness.missing.join(', ')}'}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: AppColors.goldMuted,
                          ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _stepTitle(step),
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                  ],
                ),
              ),
              if (_store.error.value != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  child: Material(
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(8),
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Text(
                        _store.error.value!,
                        style: TextStyle(
                          color: Theme.of(context).colorScheme.onErrorContainer,
                        ),
                      ),
                    ),
                  ),
                ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 720),
                      child: _buildStep(step),
                    ),
                  ),
                ),
              ),
              SafeArea(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                  child: Row(
                    children: [
                      if (_store.stepIndex > 0)
                        OutlinedButton(
                          onPressed:
                              _store.submitting.value ? null : _store.back,
                          child: const Text('Back'),
                        ),
                      const Spacer(),
                      if (step != PostStep.review)
                        FilledButton(
                          onPressed: _store.submitting.value
                              ? null
                              : () => _store.next(),
                          child: const Text('Continue'),
                        )
                      else
                        FilledButton.icon(
                          onPressed:
                              _store.submitting.value ? null : _submit,
                          icon: _store.submitting.value
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.publish_outlined),
                          label: Text(
                            _store.submitting.value
                                ? 'Publishing…'
                                : 'Publish listing',
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          );
        }),
      ),
    );
  }

  String _stepTitle(PostStep step) => switch (step) {
        PostStep.basics => 'What are you selling?',
        PostStep.category => 'Choose a category',
        PostStep.details => 'Specifications',
        PostStep.pricing => 'Title & price',
        PostStep.contact => 'Location & contact',
        PostStep.media => 'Photos & video',
        PostStep.review => 'Review & publish',
      };

  Widget _buildStep(PostStep step) => switch (step) {
        PostStep.basics => _BasicsStep(store: _store),
        PostStep.category => _CategoryStep(store: _store),
        PostStep.details => _DetailsStep(store: _store),
        PostStep.pricing => _PricingStep(store: _store),
        PostStep.contact => _ContactStep(store: _store),
        PostStep.media => _MediaStep(store: _store),
        PostStep.review => _ReviewStep(store: _store),
      };
}

class _StoreField extends StatefulWidget {
  const _StoreField({
    required this.value,
    required this.onChanged,
    this.label,
    this.hint,
    this.keyboardType,
    this.minLines,
    this.maxLines = 1,
  });

  final String value;
  final ValueChanged<String> onChanged;
  final String? label;
  final String? hint;
  final TextInputType? keyboardType;
  final int? minLines;
  final int maxLines;

  @override
  State<_StoreField> createState() => _StoreFieldState();
}

class _StoreFieldState extends State<_StoreField> {
  late final TextEditingController _c =
      TextEditingController(text: widget.value);

  @override
  void didUpdateWidget(covariant _StoreField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.value != oldWidget.value && widget.value != _c.text) {
      _c.text = widget.value;
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _c,
      decoration: InputDecoration(labelText: widget.label, hintText: widget.hint),
      keyboardType: widget.keyboardType,
      minLines: widget.minLines,
      maxLines: widget.maxLines,
      onChanged: widget.onChanged,
    );
  }
}

class _BasicsStep extends StatelessWidget {
  const _BasicsStep({required this.store});
  final PostListingStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      const ops = [('sell', 'Sell'), ('buy', 'Wanted'), ('auction', 'Auction')];
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Marketplace'),
          const SizedBox(height: 8),
          const Chip(
            avatar: Icon(Icons.diamond_outlined, size: 18),
            label: Text('Gold'),
            backgroundColor: AppColors.gold,
          ),
          const SizedBox(height: 24),
          const Text('Sell as'),
          const SizedBox(height: 8),
          Text(
            'Personal items are posted as a person. Brand/shop ads need a Gold store with a proper application.',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.65),
                ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              ChoiceChip(
                label: const Text('Person (personal ad)'),
                selected: store.sellerBusinessId.value == null,
                onSelected: (_) => store.sellerBusinessId.value = null,
                selectedColor: AppColors.gold.withValues(alpha: 0.25),
              ),
              for (final business in store.businesses.value)
                ChoiceChip(
                  label: Text('${business.name} (store)'),
                  selected: store.sellerBusinessId.value == business.id,
                  onSelected: (_) => store.sellerBusinessId.value = business.id,
                  selectedColor: AppColors.gold.withValues(alpha: 0.25),
                ),
            ],
          ),
          if (store.businesses.value.isEmpty) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => context.push(AppRoutes.goldStoreApply),
                icon: const Icon(Icons.storefront_outlined, size: 18),
                label: const Text('Open a Gold store (brand)'),
              ),
            ),
          ],
          if (store.sellerBusinessId.value != null) ...[
            const SizedBox(height: 8),
            Builder(builder: (context) {
              final progress = store.myGoldStores.value
                  .where((s) => s.id == store.sellerBusinessId.value)
                  .firstOrNull;
              if (progress == null) {
                return Text(
                  'Post complete ads (photo, karat, weight). A store needs 3–4 proper ads before it is shown as a brand.',
                  style: Theme.of(context).textTheme.bodySmall,
                );
              }
              return Text(
                progress.brandReady
                    ? 'This store is live as a brand · ${progress.proper}/${progress.minRequired} proper ads'
                    : 'Building brand storefront · ${progress.proper}/${progress.minRequired} proper ads (need ${progress.minRequired - progress.proper} more)',
                style: Theme.of(context).textTheme.bodySmall,
              );
            }),
          ],
          const SizedBox(height: 24),
          const Text('I want to'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              for (final op in ops)
                ChoiceChip(
                  label: Text(op.$2),
                  selected: store.operation.value == op.$1,
                  onSelected: (_) => store.operation.value = op.$1,
                  selectedColor: AppColors.gold.withValues(alpha: 0.25),
                ),
            ],
          ),
          const SizedBox(height: 16),
          Text(
            'Sell gold in a few simple steps.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Theme.of(context)
                      .colorScheme
                      .onSurface
                      .withValues(alpha: 0.65),
                ),
          ),
        ],
      );
    });
  }
}

class _CategoryStep extends StatelessWidget {
  const _CategoryStep({required this.store});
  final PostListingStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      final state = store.categories.value;
      if (state.isLoading) {
        return const LoadingView(message: 'Loading categories…');
      }
      if (state case AsyncError(:final message)) {
        return EmptyState(
          title: 'Could not load categories',
          subtitle: message,
          action: FilledButton(
            onPressed: store.loadCategories,
            child: const Text('Retry'),
          ),
        );
      }
      final options = store.leafOptions.value;
      if (options.isEmpty) {
        return const EmptyState(
          title: 'No categories',
          subtitle: 'Categories are empty for this marketplace.',
        );
      }
      final selected = store.selectedCategoryId.value;
      return Column(
        children: [
          for (final opt in options)
            ListTile(
              title: Text(opt.label),
              leading: Icon(
                selected == opt.category.intId
                    ? Icons.radio_button_checked
                    : Icons.radio_button_off,
                color: AppColors.gold,
              ),
              onTap: () {
                final id = opt.category.intId;
                if (id == null) return;
                store.selectedCategoryId.value = id;
                store.selectedCategoryLabel.value = opt.label;
              },
            ),
        ],
      );
    });
  }
}

class _DetailsStep extends StatelessWidget {
  const _DetailsStep({required this.store});
  final PostListingStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      return _GoldDetails(store: store);
    });
  }
}

class _GoldDetails extends StatelessWidget {
  const _GoldDetails({required this.store});
  final PostListingStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Karat / purity'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              for (final k in store.goldPurities.value.isEmpty
                  ? [
                      GoldPurity(karat: 24, fineness: 999, label: '24K'),
                      GoldPurity(karat: 22, fineness: 916, label: '22K'),
                      GoldPurity(karat: 21, fineness: 875, label: '21K'),
                      GoldPurity(karat: 18, fineness: 750, label: '18K'),
                      GoldPurity(karat: 14, fineness: 585, label: '14K'),
                    ]
                  : store.goldPurities.value)
                ChoiceChip(
                  label: Text(k.label),
                  selected: store.karat.value == k.karatKey,
                  onSelected: (_) => store.karat.value = k.karatKey,
                ),
            ],
          ),
          const SizedBox(height: 16),
          _StoreField(
            value: store.weightG.value,
            onChanged: (v) => store.weightG.value = v,
            label: 'Gross weight (grams)',
            hint: 'e.g. 45.5',
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ),
          const SizedBox(height: 12),
          _StoreField(
            value: store.stoneWeightG.value,
            onChanged: (v) => store.stoneWeightG.value = v,
            label: 'Stone / other material weight (g)',
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ),
          const SizedBox(height: 16),
          const Text('Form'),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              for (final f in ['jewellery', 'bar', 'coin', 'biscuit', 'scrap'])
                ChoiceChip(
                  label: Text(f),
                  selected: store.goldForm.value == f,
                  onSelected: (_) => store.goldForm.value = f,
                ),
            ],
          ),
          if (store.goldForm.value == 'jewellery') ...[
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: store.jewelleryType.value,
              decoration: const InputDecoration(labelText: 'Jewellery type'),
              items: const [
                DropdownMenuItem(value: 'ring', child: Text('Ring')),
                DropdownMenuItem(value: 'bangle', child: Text('Bangle')),
                DropdownMenuItem(value: 'bracelet', child: Text('Bracelet')),
                DropdownMenuItem(value: 'necklace', child: Text('Necklace')),
                DropdownMenuItem(value: 'earring', child: Text('Earring')),
                DropdownMenuItem(value: 'pendant', child: Text('Pendant')),
                DropdownMenuItem(value: 'chain', child: Text('Chain')),
                DropdownMenuItem(value: 'set', child: Text('Set')),
              ],
              onChanged: (v) => store.jewelleryType.value = v,
            ),
          ],
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Hallmarked'),
            value: store.isHallmarked.value,
            onChanged: (v) => store.isHallmarked.value = v,
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Has certificate'),
            value: store.hasCertificate.value,
            onChanged: (v) => store.hasCertificate.value = v,
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Investment grade'),
            value: store.isInvestmentGrade.value,
            onChanged: (v) => store.isInvestmentGrade.value = v,
          ),
          _StoreField(
            value: store.makingCharges.value,
            onChanged: (v) => store.makingCharges.value = v,
            label: 'Making charges (optional)',
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
          ),
          if (store.goldMakingTypes.value.isNotEmpty) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: store.makingChargeType.value,
              decoration: const InputDecoration(labelText: 'Making charge type'),
              items: [
                for (final t in store.goldMakingTypes.value)
                  DropdownMenuItem(value: t.api, child: Text(t.label)),
              ],
              onChanged: (v) {
                if (v != null) store.makingChargeType.value = v;
              },
            ),
          ],
          if (store.goldBrands.value.isNotEmpty) ...[
            const SizedBox(height: 12),
            DropdownButtonFormField<int?>(
              initialValue: store.brandId.value,
              decoration: const InputDecoration(labelText: 'Brand'),
              items: [
                const DropdownMenuItem<int?>(value: null, child: Text('None')),
                for (final b in store.goldBrands.value)
                  DropdownMenuItem(value: b.id, child: Text(b.name)),
              ],
              onChanged: (v) => store.brandId.value = v,
            ),
          ],
          if (store.isHallmarked.value)
            _StoreField(
              value: store.hallmarkCode.value,
              onChanged: (v) => store.hallmarkCode.value = v,
              label: 'Hallmark code',
            ),
          if (store.hasCertificate.value)
            _StoreField(
              value: store.certificateNumber.value,
              onChanged: (v) => store.certificateNumber.value = v,
              label: 'Certificate number',
            ),
          _StoreField(
            value: store.serialNumber.value,
            onChanged: (v) => store.serialNumber.value = v,
            label: 'Serial number (optional)',
          ),
          _StoreField(
            value: store.packaging.value,
            onChanged: (v) => store.packaging.value = v,
            label: 'Packaging (optional)',
          ),
          if (store.operation.value == 'auction') ...[
            const SizedBox(height: 16),
            const Text('Auction terms are confirmed by the server after you publish.'),
            _StoreField(
              value: store.auctionStartPrice.value,
              onChanged: (v) => store.auctionStartPrice.value = v,
              label: 'Starting bid',
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            _StoreField(
              value: store.auctionIncrement.value,
              onChanged: (v) => store.auctionIncrement.value = v,
              label: 'Minimum increment',
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
            ),
            _StoreField(
              value: store.auctionHours.value,
              onChanged: (v) => store.auctionHours.value = v,
              label: 'Duration (hours)',
              keyboardType: TextInputType.number,
            ),
          ],
        ],
      );
    });
  }
}

class _PricingStep extends StatelessWidget {
  const _PricingStep({required this.store});
  final PostListingStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      return Column(
        children: [
          _StoreField(
            value: store.title.value,
            onChanged: (v) => store.title.value = v,
            label: 'Title',
            hint: 'Write a clear, searchable title',
          ),
          const SizedBox(height: 12),
          _StoreField(
            value: store.description.value,
            onChanged: (v) => store.description.value = v,
            label: 'Description',
            minLines: 4,
            maxLines: 8,
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: Builder(builder: (context) {
              final entitlements = ServiceLocator
                  .instance.subscriptionStore.snapshot.value.dataOrNull?.entitlements;
              final allowed = entitlements?.has('generate_description') == true;
              return OutlinedButton.icon(
                onPressed: !allowed || store.generatingDescription.value
                    ? null
                    : () async {
                        final result = await store.generateAiDescription();
                        if (!context.mounted) return;
                        if (result.isFailure) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(result.when(
                              success: (_) => '',
                              failure: (m, _) => m,
                            ))),
                          );
                        }
                      },
                icon: store.generatingDescription.value
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.auto_awesome),
                label: Text(
                  allowed ? 'Generate with AI' : 'AI description not on your plan',
                ),
              );
            }),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                flex: 2,
                child: _StoreField(
                  value: store.price.value,
                  onChanged: (v) => store.price.value = v,
                  label: store.operation.value == 'rent' ? 'Rent amount' : 'Price',
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: DropdownButtonFormField<String>(
              initialValue: store.currency.value,
                  decoration: const InputDecoration(labelText: 'Currency'),
                  items: const [
                    DropdownMenuItem(value: 'PKR', child: Text('PKR')),
                    DropdownMenuItem(value: 'USD', child: Text('USD')),
                    DropdownMenuItem(value: 'AED', child: Text('AED')),
                    DropdownMenuItem(value: 'EUR', child: Text('EUR')),
                    DropdownMenuItem(value: 'GBP', child: Text('GBP')),
                  ],
                  onChanged: (v) {
                    if (v != null) store.currency.value = v;
                  },
                ),
              ),
            ],
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Price negotiable'),
            value: store.priceNegotiable.value,
            onChanged: (v) => store.priceNegotiable.value = v,
          ),
          DropdownButtonFormField<String>(
              initialValue: store.conditionCode.value,
            decoration: const InputDecoration(labelText: 'Condition'),
            items: const [
              DropdownMenuItem(value: 'new', child: Text('New')),
              DropdownMenuItem(value: 'like_new', child: Text('Like new')),
              DropdownMenuItem(value: 'excellent', child: Text('Excellent')),
              DropdownMenuItem(value: 'good', child: Text('Good')),
              DropdownMenuItem(value: 'fair', child: Text('Fair')),
              DropdownMenuItem(value: 'used', child: Text('Used')),
            ],
            onChanged: (v) => store.conditionCode.value = v,
          ),
        ],
      );
    });
  }
}

class _MediaStep extends StatefulWidget {
  const _MediaStep({required this.store});
  final PostListingStore store;

  @override
  State<_MediaStep> createState() => _MediaStepState();
}

class _MediaStepState extends State<_MediaStep> {
  bool _busy = false;

  Future<void> _add({required bool video}) async {
    setState(() => _busy = true);
    try {
      final picker = ImagePicker();
      final file = video
          ? await picker.pickVideo(
              source: ImageSource.gallery,
              maxDuration: const Duration(minutes: 2),
            )
          : await picker.pickImage(
              source: ImageSource.gallery,
              imageQuality: 85,
              maxWidth: 1920,
            );
      if (file == null) return;
      final uploaded =
          await ServiceLocator.instance.mediaUploadService.uploadFile(
        file: File(file.path),
        purpose: 'listing_media',
        mimeType: video ? 'video/mp4' : null,
      );
      final items = List<Map<String, dynamic>>.from(widget.store.mediaItems.value);
      items.add({
        'url': uploaded.fileUrl,
        'thumbUrl': uploaded.fileUrl,
        'kind': video ? 'video' : 'image',
        'isPrimary': items.isEmpty,
      });
      widget.store.mediaItems.value = items;
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Upload failed: $e')),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (_) {
      final items = widget.store.mediaItems.value;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Add photos or a short video here while posting. Buyers trust ads with clear media.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          MediaDropZone(
            title: context.l10n.dropFilesHint,
            allowed: const {
              DropMediaKind.image,
              DropMediaKind.video,
              DropMediaKind.document,
            },
            onQueued: (files) async {
              setState(() => _busy = true);
              try {
                for (final file in files) {
                  final uploaded =
                      await ServiceLocator.instance.mediaUploadService.uploadBytes(
                    bytes: file.bytes,
                    purpose: file.kind == DropMediaKind.document
                        ? 'document'
                        : 'listing_media',
                    mimeType: file.mimeType,
                    filename: file.name,
                  );
                  final items = List<Map<String, dynamic>>.from(
                    widget.store.mediaItems.value,
                  );
                  items.add({
                    'url': uploaded.fileUrl,
                    'thumbUrl': uploaded.fileUrl,
                    'kind': file.kind == DropMediaKind.video
                        ? 'video'
                        : file.kind == DropMediaKind.document
                            ? 'document'
                            : 'image',
                    'isPrimary': items.isEmpty,
                  });
                  widget.store.mediaItems.value = items;
                }
              } catch (e) {
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(content: Text('Upload failed: $e')),
                );
              } finally {
                if (mounted) setState(() => _busy = false);
              }
            },
          ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: _busy ? null : () => _add(video: false),
                icon: const Icon(Icons.add_photo_alternate_outlined),
                label: const Text('Add photo'),
              ),
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _add(video: true),
                icon: const Icon(Icons.videocam_outlined),
                label: const Text('Add video'),
              ),
            ],
          ),
          if (_busy) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: AppColors.gold),
          ],
          const SizedBox(height: 16),
          if (items.isEmpty)
            const Text('No media yet — you can still publish without photos.')
          else
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (var i = 0; i < items.length; i++)
                  Chip(
                    avatar: Icon(
                      items[i]['kind'] == 'video'
                          ? Icons.videocam
                          : Icons.image,
                      size: 16,
                    ),
                    label: Text(
                      items[i]['kind'] == 'video'
                          ? 'Video ${i + 1}'
                          : 'Photo ${i + 1}${items[i]['isPrimary'] == true ? ' · cover' : ''}',
                    ),
                    onDeleted: () {
                      final next = List<Map<String, dynamic>>.from(items)
                        ..removeAt(i);
                      if (next.isNotEmpty) {
                        next[0] = {...next[0], 'isPrimary': true};
                      }
                      widget.store.mediaItems.value = next;
                    },
                  ),
              ],
            ),
        ],
      );
    });
  }
}

class _ContactStep extends StatelessWidget {
  const _ContactStep({required this.store});
  final PostListingStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      return Column(
        children: [
          _StoreField(
            value: store.contactPhone.value,
            onChanged: (v) => store.contactPhone.value = v,
            label: 'Phone',
            hint: '+923001234567',
            keyboardType: TextInputType.phone,
          ),
          const SizedBox(height: 12),
          _StoreField(
            value: store.contactWhatsapp.value,
            onChanged: (v) => store.contactWhatsapp.value = v,
            label: 'WhatsApp (optional)',
            keyboardType: TextInputType.phone,
          ),
          const SizedBox(height: 12),
          _StoreField(
            value: store.address.value,
            onChanged: (v) => store.address.value = v,
            label: 'Address / landmark (optional)',
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Allow chat'),
            value: store.allowChat.value,
            onChanged: (v) => store.allowChat.value = v,
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Allow calls'),
            value: store.allowCalls.value,
            onChanged: (v) => store.allowCalls.value = v,
          ),
        ],
      );
    });
  }
}

class _ReviewStep extends StatelessWidget {
  const _ReviewStep({required this.store});
  final PostListingStore store;

  @override
  Widget build(BuildContext context) {
    return SignalBuilder(builder: (context) {
      final rows = <(String, String)>[
        ('Marketplace', store.marketplaceCode.value),
        ('Operation', store.operation.value),
        ('Category', store.selectedCategoryLabel.value ?? '—'),
        ('Title', store.title.value),
        ('Price', '${store.price.value} ${store.currency.value}'),
        ('Phone', store.contactPhone.value),
        if (store.marketplaceCode.value == 'gold') ...[
          ('Karat', '${store.karat.value}K'),
          ('Weight', '${store.weightG.value} g'),
          ('Form', store.goldForm.value),
        ],
      ];

      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Confirm details before publishing. Your ad is reviewed automatically and usually goes live within seconds.',
            style: Theme.of(context).textTheme.bodyMedium,
          ),
          const SizedBox(height: 16),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 110,
                    child: Text(
                      row.$1,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.gold,
                            fontWeight: FontWeight.w600,
                          ),
                    ),
                  ),
                  Expanded(child: Text(row.$2)),
                ],
              ),
            ),
        ],
      );
    });
  }
}
