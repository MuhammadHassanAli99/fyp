import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:signals_flutter/signals_flutter.dart'
    hide AsyncState, AsyncLoading, AsyncData, AsyncError;

import '../../app/localization/app_localizations_wrapper.dart';
import '../../app/theme/app_colors.dart';
import '../../core/di/service_locator.dart';
import '../../core/result/async_state.dart';
import '../../data/models/comparison_model.dart';
import '../../shared/widgets/app_scaffold.dart';
import 'compare_store.dart';
import 'vehicle_car_picker_sheet.dart';

class CompareScreen extends StatefulWidget {
  const CompareScreen({super.key});

  @override
  State<CompareScreen> createState() => _CompareScreenState();
}

class _CompareScreenState extends State<CompareScreen> {
  late final CompareStore _store;

  @override
  void initState() {
    super.initState();
    _store = ServiceLocator.instance.compareStore;
  }

  Future<void> _pickCar(int index) async {
    final selected = await showVehicleCarPicker(
      context: context,
      vehiclesApi: _store.vehiclesApi,
      initial: _store.activeSlots[index],
    );
    if (selected != null) _store.setSlot(index, selected);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return AppScaffold(
      title: l10n.compare,
      actions: [
        IconButton(
          tooltip: 'Clear',
          icon: const Icon(Icons.clear_all),
          onPressed: _store.clearActiveSelection,
        ),
        IconButton(
          tooltip: l10n.shareComparison,
          icon: const Icon(Icons.share_outlined),
          onPressed: () async {
            final setId = _store.comparison.value.dataOrNull?.id;
            if (setId == null) return;
            final numeric = int.tryParse(setId);
            if (numeric == null) return;
            final result = await ServiceLocator.instance.favoritesStore.share(
              targetType: 'comparison',
              targetId: numeric,
            );
            result.when(
              success: (link) => SharePlus.instance.share(ShareParams(text: link.url)),
              failure: (m, _) {
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
              },
            );
          },
        ),
      ],
      body: SignalBuilder(
        builder: (context) {
          final state = _store.comparison.value;
          final isVehicles = _store.isVehicles;

          return SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (isVehicles) ...[
                  _UsedNewTabs(
                    kind: _store.vehicleKind.value,
                    onChanged: _store.setVehicleKind,
                  ),
                  const SizedBox(height: 16),
                  _VehicleSlotRow(
                    slots: _store.activeSlots,
                    onPick: _pickCar,
                    onClear: _store.clearSlot,
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      TextButton(
                        onPressed: _store.clearActiveSelection,
                        child: const Text('Clear'),
                      ),
                      const Spacer(),
                      FilledButton(
                        onPressed: _store.filledSlotCount >= 2 && !state.isLoading
                            ? _store.runManualCompare
                            : null,
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.success,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 28,
                            vertical: 12,
                          ),
                        ),
                        child: Text(l10n.manualCompare == 'Manual Compare'
                            ? 'Compare'
                            : l10n.manualCompare),
                      ),
                    ],
                  ),
                ] else ...[
                  if (_store.shouldAutoAi.value)
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppColors.charcoalSurface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: AppColors.gold.withValues(alpha: 0.4),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            l10n.aiCompareTitle,
                            style: const TextStyle(
                              color: AppColors.gold,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Compare 2–4 items to unlock an AI report after the specs table.',
                            style: TextStyle(
                              color: AppColors.stone.withValues(alpha: 0.85),
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 16),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (var i = 0; i < _store.listingIds.value.length; i++)
                        Chip(
                          label: Text(
                            (state.dataOrNull?.listingTitles.length ?? 0) > i
                                ? state.dataOrNull!.listingTitles[i]
                                : '#${_store.listingIds.value[i]}',
                          ),
                          deleteIcon: const Icon(Icons.close, size: 16),
                          onDeleted: () => _store
                              .removeListing(_store.listingIds.value[i]),
                        ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  if (_store.listingIds.value.length >= 2)
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton(
                        onPressed:
                            state.isLoading ? null : _store.runManualCompare,
                        style: FilledButton.styleFrom(
                          backgroundColor: AppColors.success,
                          foregroundColor: Colors.white,
                        ),
                        child: const Text('Compare'),
                      ),
                    ),
                ],
                const SizedBox(height: 20),
                if (state.isLoading) const LoadingView(message: 'Comparing…'),
                if (state case AsyncData(:final data)) ...[
                  _ResultsHeader(comparison: data),
                  const SizedBox(height: 20),
                  _SpecsSection(
                    comparison: data,
                    hideCommon: _store.hideCommonSpecs.value,
                    onHideCommon: _store.setHideCommonSpecs,
                  ),
                  const SizedBox(height: 24),
                  _AiReportSection(comparison: data),
                  if (_store.suggestions.value.isNotEmpty) ...[
                    const SizedBox(height: 28),
                    _SuggestionsCarousel(
                      pairs: _store.suggestions.value,
                      onTap: _store.applySuggestion,
                    ),
                  ],
                ],
                if (state case AsyncError(:final message))
                  EmptyState(
                    title: message,
                    action: FilledButton(
                      onPressed: _store.runManualCompare,
                      child: Text(l10n.retry),
                    ),
                  ),
                if (!state.isLoading &&
                    state is! AsyncData &&
                    state is! AsyncError &&
                    ((isVehicles && _store.filledSlotCount == 0) ||
                        (!isVehicles && _store.listingIds.value.isEmpty)))
                  EmptyState(
                    title: l10n.compare,
                    subtitle: isVehicles
                        ? 'Select 2–3 cars (used or new), then tap Compare.'
                        : 'Add listings from the feed to compare side by side.',
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _UsedNewTabs extends StatelessWidget {
  const _UsedNewTabs({required this.kind, required this.onChanged});

  final VehicleCompareKind kind;
  final ValueChanged<VehicleCompareKind> onChanged;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.stoneDark),
      ),
      child: Row(
        children: [
          Expanded(
            child: _TabChip(
              label: 'Used cars',
              selected: kind == VehicleCompareKind.used,
              onTap: () => onChanged(VehicleCompareKind.used),
            ),
          ),
          Expanded(
            child: _TabChip(
              label: 'New cars',
              selected: kind == VehicleCompareKind.brandNew,
              onTap: () => onChanged(VehicleCompareKind.brandNew),
            ),
          ),
        ],
      ),
    );
  }
}

class _TabChip extends StatelessWidget {
  const _TabChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.gold.withValues(alpha: 0.2) : Colors.transparent,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontWeight: FontWeight.w700,
              color: selected ? AppColors.gold : AppColors.stone.withValues(alpha: 0.7),
            ),
          ),
        ),
      ),
    );
  }
}

class _VehicleSlotRow extends StatelessWidget {
  const _VehicleSlotRow({
    required this.slots,
    required this.onPick,
    required this.onClear,
  });

  final List<CompareCarSlot?> slots;
  final ValueChanged<int> onPick;
  final ValueChanged<int> onClear;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final narrow = constraints.maxWidth < 720;
        final children = [
          for (var i = 0; i < 3; i++)
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(right: i < 2 ? 10 : 0),
                child: _SlotField(
                  index: i,
                  slot: i < slots.length ? slots[i] : null,
                  onPick: () => onPick(i),
                  onClear: () => onClear(i),
                ),
              ),
            ),
        ];
        if (narrow) {
          return Column(
            children: [
              for (var i = 0; i < 3; i++)
                Padding(
                  padding: EdgeInsets.only(bottom: i < 2 ? 10 : 0),
                  child: _SlotField(
                    index: i,
                    slot: i < slots.length ? slots[i] : null,
                    onPick: () => onPick(i),
                    onClear: () => onClear(i),
                  ),
                ),
            ],
          );
        }
        return Row(children: children);
      },
    );
  }
}

class _SlotField extends StatelessWidget {
  const _SlotField({
    required this.index,
    required this.slot,
    required this.onPick,
    required this.onClear,
  });

  final int index;
  final CompareCarSlot? slot;
  final VoidCallback onPick;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final filled = slot?.isFilled == true;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Select Car-${index + 1}',
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 6),
        InkWell(
          onTap: onPick,
          borderRadius: BorderRadius.circular(8),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.stoneDark),
              borderRadius: BorderRadius.circular(8),
              color: AppColors.charcoalSurface,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    filled ? slot!.displayLabel : 'Make / Model / Version',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: filled
                          ? AppColors.stone
                          : AppColors.stone.withValues(alpha: 0.45),
                      fontWeight: filled ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                ),
                if (filled)
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: onClear,
                    icon: const Icon(Icons.close, size: 18),
                  )
                else
                  Icon(
                    Icons.keyboard_arrow_down,
                    color: AppColors.stone.withValues(alpha: 0.5),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _ResultsHeader extends StatelessWidget {
  const _ResultsHeader({required this.comparison});

  final ComparisonModel comparison;

  @override
  Widget build(BuildContext context) {
    final items = comparison.items;
    if (items.isEmpty) {
      return Text(
        comparison.listingTitles.join(' VS '),
        style: const TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w800,
          color: AppColors.gold,
        ),
      );
    }

    final title = items.map((e) => e.title).join(' VS ');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w800,
            color: AppColors.gold,
          ),
        ),
        const SizedBox(height: 14),
        LayoutBuilder(
          builder: (context, constraints) {
            final narrow = constraints.maxWidth < 700;
            final cards = [
              for (final item in items)
                Expanded(child: _CarResultCard(item: item)),
            ];
            if (narrow) {
              return Column(
                children: [
                  for (final item in items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _CarResultCard(item: item),
                    ),
                ],
              );
            }
            return IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (var i = 0; i < cards.length; i++) ...[
                    cards[i],
                    if (i < cards.length - 1) const SizedBox(width: 10),
                  ],
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}

class _CarResultCard extends StatelessWidget {
  const _CarResultCard({required this.item});

  final CompareItem item;

  @override
  Widget build(BuildContext context) {
    final variant = item.detail('variantName');
    final price = item.price;
    final currency = item.currency ?? '';
    final rating = item.rating ?? 0;
    final reviews = item.reviewCount ?? 0;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: AppColors.stoneDark),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AspectRatio(
            aspectRatio: 16 / 10,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: item.imageUrl != null && item.imageUrl!.isNotEmpty
                  ? Image.network(
                      item.imageUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) =>
                          _placeholder(),
                    )
                  : _placeholder(),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            item.title,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          if (variant != null && variant.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              variant,
              style: TextStyle(
                fontSize: 12,
                color: AppColors.stone.withValues(alpha: 0.7),
              ),
            ),
          ],
          const SizedBox(height: 8),
          if (price != null)
            Text(
              '$currency ${_formatPrice(price)}',
              style: const TextStyle(
                color: AppColors.success,
                fontWeight: FontWeight.w800,
                fontSize: 16,
              ),
            ),
          const SizedBox(height: 6),
          Row(
            children: [
              ...List.generate(5, (i) {
                final filled = rating >= i + 1;
                final half = !filled && rating > i && rating < i + 1;
                return Icon(
                  half
                      ? Icons.star_half
                      : (filled ? Icons.star : Icons.star_border),
                  size: 16,
                  color: AppColors.gold,
                );
              }),
              const SizedBox(width: 6),
              Text(
                reviews > 0 ? '$reviews reviews' : 'No reviews',
                style: TextStyle(
                  fontSize: 12,
                  color: AppColors.gold.withValues(alpha: 0.85),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _placeholder() => ColoredBox(
        color: AppColors.charcoal,
        child: Center(
          child: Icon(
            Icons.directions_car_outlined,
            color: AppColors.stone.withValues(alpha: 0.35),
            size: 40,
          ),
        ),
      );

  String _formatPrice(double price) {
    if (price >= 100000) {
      final lacs = price / 100000;
      return '${lacs.toStringAsFixed(lacs >= 10 ? 0 : 2)} lacs';
    }
    return price.toStringAsFixed(0).replaceAllMapped(
          RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
          (m) => '${m[1]},',
        );
  }
}

class _SpecsSection extends StatelessWidget {
  const _SpecsSection({
    required this.comparison,
    required this.hideCommon,
    required this.onHideCommon,
  });

  final ComparisonModel comparison;
  final bool hideCommon;
  final ValueChanged<bool> onHideCommon;

  @override
  Widget build(BuildContext context) {
    final fields = hideCommon
        ? comparison.fields.where((f) => f.differs).toList()
        : comparison.fields;

    if (fields.isEmpty) {
      return Text(comparison.aiVerdict ?? 'Comparison ready.');
    }

    final groups = <String, List<CompareField>>{};
    for (final f in fields) {
      final g = f.group?.isNotEmpty == true ? f.group! : 'Specifications';
      groups.putIfAbsent(g, () => []).add(f);
    }

    final colCount = comparison.items.isNotEmpty
        ? comparison.items.length
        : comparison.listingTitles.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'Compare Specifications',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
              ),
            ),
            Text(
              'Hide common specs',
              style: TextStyle(
                fontSize: 12,
                color: AppColors.stone.withValues(alpha: 0.75),
              ),
            ),
            const SizedBox(width: 8),
            Switch(
              value: hideCommon,
              onChanged: onHideCommon,
              activeThumbColor: AppColors.gold,
            ),
          ],
        ),
        const SizedBox(height: 8),
        for (final entry in groups.entries) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            color: AppColors.charcoalSurface,
            child: Text(
              entry.key,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
          for (var i = 0; i < entry.value.length; i++)
            _SpecRow(
              field: entry.value[i],
              zebra: i.isOdd,
              columns: colCount,
            ),
        ],
      ],
    );
  }
}

class _SpecRow extends StatelessWidget {
  const _SpecRow({
    required this.field,
    required this.zebra,
    required this.columns,
  });

  final CompareField field;
  final bool zebra;
  final int columns;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: zebra
          ? AppColors.charcoal.withValues(alpha: 0.35)
          : Colors.transparent,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            flex: 3,
            child: Text(
              field.label,
              style: TextStyle(
                color: AppColors.stone.withValues(alpha: 0.75),
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          for (var i = 0; i < columns; i++)
            Expanded(
              flex: 2,
              child: Center(
                child: i < field.values.length
                    ? _CellValue(cell: field.values[i], kind: field.kind)
                    : const Text('—'),
              ),
            ),
        ],
      ),
    );
  }
}

class _CellValue extends StatelessWidget {
  const _CellValue({required this.cell, this.kind});

  final CompareCell cell;
  final String? kind;

  @override
  Widget build(BuildContext context) {
    if (kind == 'boolean' || cell.isBooleanLike) {
      if (cell.isTruthy) {
        return const Icon(Icons.check, color: AppColors.success, size: 20);
      }
      if (cell.isFalsy) {
        return const Icon(Icons.close, color: AppColors.error, size: 20);
      }
    }
    return Text(
      cell.display,
      textAlign: TextAlign.center,
      style: TextStyle(
        fontWeight: cell.isBest ? FontWeight.w800 : FontWeight.w500,
        color: cell.isBest ? AppColors.gold : AppColors.stone,
      ),
    );
  }
}

class _AiReportSection extends StatelessWidget {
  const _AiReportSection({required this.comparison});

  final ComparisonModel comparison;

  @override
  Widget build(BuildContext context) {
    final summary = comparison.aiSummary;
    final recommendation = comparison.aiRecommendation;
    final hasAi = (summary != null && summary.isNotEmpty) ||
        (recommendation != null && recommendation.isNotEmpty);

    if (!hasAi) {
      // Fallback insight from differing rows when AI is unavailable.
      final diffs = comparison.fields.where((f) => f.differs).take(5).toList();
      if (diffs.isEmpty) return const SizedBox.shrink();
      return Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: AppColors.charcoalSurface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.gold.withValues(alpha: 0.35)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'AI Report',
              style: TextStyle(
                color: AppColors.gold,
                fontWeight: FontWeight.w800,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Key differences spotted across your selection:',
              style: TextStyle(color: AppColors.stone.withValues(alpha: 0.85)),
            ),
            const SizedBox(height: 8),
            for (final f in diffs)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  '• ${f.label}: ${f.values.map((v) => v.display).join(' vs ')}',
                  style: const TextStyle(height: 1.35),
                ),
              ),
          ],
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.charcoalSurface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.gold.withValues(alpha: 0.45)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.auto_awesome, color: AppColors.gold, size: 20),
              SizedBox(width: 8),
              Text(
                'AI Report',
                style: TextStyle(
                  color: AppColors.gold,
                  fontWeight: FontWeight.w800,
                  fontSize: 16,
                ),
              ),
            ],
          ),
          if (summary != null && summary.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(summary, style: const TextStyle(height: 1.45)),
          ],
          if (recommendation != null && recommendation.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              'Recommendation',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: AppColors.gold.withValues(alpha: 0.9),
              ),
            ),
            const SizedBox(height: 4),
            Text(recommendation, style: const TextStyle(height: 1.45)),
          ],
          if (comparison.aiDifferences.isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              'Notable differences',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: AppColors.gold.withValues(alpha: 0.9),
              ),
            ),
            const SizedBox(height: 4),
            for (final d in comparison.aiDifferences)
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text('• $d'),
              ),
          ],
          const SizedBox(height: 10),
          Text(
            'Generated from listing details. Verify specs and inspect in person before buying.',
            style: TextStyle(
              fontSize: 11,
              color: AppColors.stone.withValues(alpha: 0.55),
            ),
          ),
        ],
      ),
    );
  }
}

class _SuggestionsCarousel extends StatelessWidget {
  const _SuggestionsCarousel({
    required this.pairs,
    required this.onTap,
  });

  final List<CompareSuggestionPair> pairs;
  final ValueChanged<CompareSuggestionPair> onTap;

  @override
  Widget build(BuildContext context) {
    final title = pairs.first.anchorTitle;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '$title Comparisons with similar cars',
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 168,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: pairs.length,
            separatorBuilder: (context, index) => const SizedBox(width: 12),
            itemBuilder: (context, index) {
              final pair = pairs[index];
              return _SuggestionCard(
                pair: pair,
                onTap: () => onTap(pair),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _SuggestionCard extends StatelessWidget {
  const _SuggestionCard({required this.pair, required this.onTap});

  final CompareSuggestionPair pair;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 260,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.charcoalSurface,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: AppColors.stoneDark),
        ),
        child: Column(
          children: [
            _SuggestionHalf(item: pair.left, imageLeft: true),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Divider(
                      color: AppColors.stone.withValues(alpha: 0.25),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 8),
                    child: Text(
                      'vs',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppColors.stone.withValues(alpha: 0.55),
                      ),
                    ),
                  ),
                  Expanded(
                    child: Divider(
                      color: AppColors.stone.withValues(alpha: 0.25),
                    ),
                  ),
                ],
              ),
            ),
            _SuggestionHalf(item: pair.right, imageLeft: false),
          ],
        ),
      ),
    );
  }
}

class _SuggestionHalf extends StatelessWidget {
  const _SuggestionHalf({required this.item, required this.imageLeft});

  final CompareItem item;
  final bool imageLeft;

  @override
  Widget build(BuildContext context) {
    final thumb = SizedBox(
      width: 56,
      height: 40,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(4),
        child: item.imageUrl != null && item.imageUrl!.isNotEmpty
            ? Image.network(
                item.imageUrl!,
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) => ColoredBox(
                  color: AppColors.charcoal,
                  child: Icon(
                    Icons.directions_car,
                    size: 18,
                    color: AppColors.stone.withValues(alpha: 0.4),
                  ),
                ),
              )
            : ColoredBox(
                color: AppColors.charcoal,
                child: Icon(
                  Icons.directions_car,
                  size: 18,
                  color: AppColors.stone.withValues(alpha: 0.4),
                ),
              ),
      ),
    );

    final text = Expanded(
      child: Column(
        crossAxisAlignment:
            imageLeft ? CrossAxisAlignment.start : CrossAxisAlignment.end,
        children: [
          Text(
            item.title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
          ),
          if (item.price != null)
            Text(
              '${item.currency ?? ''} ${_shortPrice(item.price!)}',
              style: const TextStyle(
                color: AppColors.success,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
        ],
      ),
    );

    return Row(
      children: imageLeft ? [thumb, const SizedBox(width: 8), text] : [text, const SizedBox(width: 8), thumb],
    );
  }

  String _shortPrice(double price) {
    if (price >= 100000) {
      return '${(price / 100000).toStringAsFixed(2)} lacs';
    }
    return price.toStringAsFixed(0);
  }
}
