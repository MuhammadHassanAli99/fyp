import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../data/remote/marketplace_apis.dart';
import 'compare_store.dart';

/// PakWheels-style Make → Model → Version (optional) picker.
Future<CompareCarSlot?> showVehicleCarPicker({
  required BuildContext context,
  required VehiclesApi vehiclesApi,
  CompareCarSlot? initial,
}) {
  return showModalBottomSheet<CompareCarSlot>(
    context: context,
    isScrollControlled: true,
    backgroundColor: AppColors.charcoalLight,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (ctx) => _VehicleCarPickerSheet(
      vehiclesApi: vehiclesApi,
      initial: initial,
    ),
  );
}

class _VehicleCarPickerSheet extends StatefulWidget {
  const _VehicleCarPickerSheet({
    required this.vehiclesApi,
    this.initial,
  });

  final VehiclesApi vehiclesApi;
  final CompareCarSlot? initial;

  @override
  State<_VehicleCarPickerSheet> createState() => _VehicleCarPickerSheetState();
}

class _VehicleCarPickerSheetState extends State<_VehicleCarPickerSheet> {
  NamedOption? _make;
  NamedOption? _model;
  VehicleVariantOption? _variant;

  List<NamedOption> _makes = const [];
  List<NamedOption> _models = const [];
  List<VehicleVariantOption> _variants = const [];

  bool _loadingMakes = true;
  bool _loadingModels = false;
  bool _loadingVariants = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    setState(() {
      _loadingMakes = true;
      _error = null;
    });
    try {
      final popular = await widget.vehiclesApi.makes(popular: true);
      final all = await widget.vehiclesApi.makes();
      final popularIds = popular.map((e) => e.id).toSet();
      final others = all.where((e) => !popularIds.contains(e.id)).toList();
      _makes = [...popular, ...others];

      final init = widget.initial;
      if (init?.makeId != null) {
        _make = _makes.cast<NamedOption?>().firstWhere(
              (m) => m?.intId == init!.makeId,
              orElse: () => NamedOption(
                id: '${init!.makeId}',
                name: init.makeName ?? 'Make',
              ),
            );
        await _loadModels(selectInitial: true);
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loadingMakes = false);
    }
  }

  Future<void> _loadModels({bool selectInitial = false}) async {
    final makeId = _make?.intId;
    if (makeId == null) return;
    setState(() {
      _loadingModels = true;
      _models = const [];
      _variants = const [];
      if (!selectInitial) {
        _model = null;
        _variant = null;
      }
    });
    try {
      final models = await widget.vehiclesApi.models(makeId);
      _models = models;
      final init = widget.initial;
      if (selectInitial && init?.modelId != null) {
        _model = models.cast<NamedOption?>().firstWhere(
              (m) => m?.intId == init!.modelId,
              orElse: () => null,
            );
        if (_model != null) await _loadVariants(selectInitial: true);
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loadingModels = false);
    }
  }

  Future<void> _loadVariants({bool selectInitial = false}) async {
    final modelId = _model?.intId;
    if (modelId == null) return;
    setState(() {
      _loadingVariants = true;
      _variants = const [];
      if (!selectInitial) _variant = null;
    });
    try {
      final variants = await widget.vehiclesApi.variants(modelId);
      _variants = variants;
      final init = widget.initial;
      if (selectInitial && init?.variantId != null) {
        _variant = variants.cast<VehicleVariantOption?>().firstWhere(
              (v) => v?.intId == init!.variantId,
              orElse: () => null,
            );
      }
    } catch (e) {
      _error = e.toString();
    } finally {
      if (mounted) setState(() => _loadingVariants = false);
    }
  }

  void _done() {
    if (_make == null || _model == null) return;
    final parts = [
      _make!.name,
      _model!.name,
      if (_variant != null) _variant!.name,
    ];
    Navigator.of(context).pop(
      CompareCarSlot(
        makeId: _make!.intId,
        makeName: _make!.name,
        modelId: _model!.intId,
        modelName: _model!.name,
        variantId: _variant?.intId,
        variantName: _variant?.name,
        label: parts.join(' '),
        price: _variant?.launchPrice,
        currency: _variant?.launchCurrency,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final height = MediaQuery.sizeOf(context).height * 0.85;
    return SizedBox(
      height: height,
      child: Column(
        children: [
          const SizedBox(height: 8),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.stoneDark,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Row(
              children: [
                _crumb('MAKE', _make == null),
                const Text('  ›  ', style: TextStyle(color: AppColors.stoneDark)),
                _crumb('MODEL', _make != null && _model == null),
                const Text('  ›  ', style: TextStyle(color: AppColors.stoneDark)),
                _crumb('VERSION (OPTIONAL)', _model != null),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(_error!, style: const TextStyle(color: AppColors.error)),
            ),
          Expanded(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(child: _makeColumn()),
                const VerticalDivider(width: 1, color: AppColors.stoneDark),
                Expanded(child: _modelColumn()),
                const VerticalDivider(width: 1, color: AppColors.stoneDark),
                Expanded(child: _variantColumn()),
              ],
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _make != null && _model != null ? _done : null,
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.gold,
                    foregroundColor: AppColors.charcoal,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  child: const Text('Done'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _crumb(String label, bool active) {
    return Text(
      label,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.4,
        color: active ? AppColors.gold : AppColors.stone.withValues(alpha: 0.55),
      ),
    );
  }

  Widget _makeColumn() {
    return _PickerColumn(
      title: 'MAKE',
      loading: _loadingMakes,
      children: [
        if (_makes.isNotEmpty) ...[
          const _SectionLabel('Popular & others'),
          for (final make in _makes)
            _PickerTile(
              label: make.name,
              selected: _make?.id == make.id,
              onTap: () {
                setState(() {
                  _make = make;
                  _model = null;
                  _variant = null;
                  _variants = const [];
                });
                _loadModels();
              },
            ),
        ],
      ],
    );
  }

  Widget _modelColumn() {
    return _PickerColumn(
      title: 'MODEL',
      loading: _loadingModels,
      emptyHint: _make == null ? 'Select a make' : null,
      children: [
        for (final model in _models)
          _PickerTile(
            label: model.name,
            selected: _model?.id == model.id,
            onTap: () {
              setState(() {
                _model = model;
                _variant = null;
              });
              _loadVariants();
            },
          ),
      ],
    );
  }

  Widget _variantColumn() {
    // Group variants by year range.
    final groups = <String, List<VehicleVariantOption>>{};
    for (final v in _variants) {
      groups.putIfAbsent(v.yearLabel, () => []).add(v);
    }

    return _PickerColumn(
      title: 'VERSION (OPTIONAL)',
      titleColor: AppColors.gold,
      loading: _loadingVariants,
      emptyHint: _model == null
          ? 'Select a model'
          : (_variants.isEmpty && !_loadingVariants ? 'No versions listed' : null),
      children: [
        for (final entry in groups.entries) ...[
          _SectionLabel(entry.key),
          for (final v in entry.value)
            _PickerTile(
              label: v.name,
              selected: _variant?.id == v.id,
              onTap: () => setState(() => _variant = v),
            ),
        ],
      ],
    );
  }
}

class _PickerColumn extends StatelessWidget {
  const _PickerColumn({
    required this.title,
    required this.children,
    this.loading = false,
    this.emptyHint,
    this.titleColor,
  });

  final String title;
  final List<Widget> children;
  final bool loading;
  final String? emptyHint;
  final Color? titleColor;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: Text(
            title,
            style: TextStyle(
              fontWeight: FontWeight.w800,
              letterSpacing: 0.6,
              color: titleColor ?? AppColors.stone.withValues(alpha: 0.85),
            ),
          ),
        ),
        Expanded(
          child: loading
              ? const Center(
                  child: CircularProgressIndicator(color: AppColors.gold),
                )
              : children.isEmpty && emptyHint != null
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(
                          emptyHint!,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: AppColors.stone.withValues(alpha: 0.55),
                          ),
                        ),
                      ),
                    )
                  : ListView(children: children),
        ),
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 4),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: AppColors.stone.withValues(alpha: 0.5),
        ),
      ),
    );
  }
}

class _PickerTile extends StatelessWidget {
  const _PickerTile({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        color: selected
            ? AppColors.gold.withValues(alpha: 0.18)
            : Colors.transparent,
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: AppColors.stone,
                ),
              ),
            ),
            Icon(
              Icons.chevron_right,
              size: 18,
              color: AppColors.stone.withValues(alpha: 0.45),
            ),
          ],
        ),
      ),
    );
  }
}
